// Run with: npm test   (Node 24 runs the TypeScript sources directly)
import assert from "node:assert/strict";
import { test } from "node:test";
import { breaches, checkMandate, createMandate, verifySignature } from "../src/lib/mandate.ts";
import { decide } from "../src/lib/verdict.ts";

const SECRET = "test-secret";
const NOW = new Date("2026-11-11T10:00:00Z");
const terms = {
  intent: "Wireless noise-cancelling headphones under $80, no add-ons",
  itemDescription: "Wireless noise-cancelling headphones",
  mustHave: ["wireless", "noise cancelling"],
  mustNotHave: ["add-ons"],
  maxTotal: 80,
  maxQuantity: 1,
  allowedMerchants: ["soundhouse"],
  validForHours: 24,
};
const mandate = createMandate(terms, "buyer-1", SECRET, NOW);
const purchase = (over = {}) => ({
  merchantId: "soundhouse",
  items: [{ name: "Aria 200", quantity: 1, unitPrice: 74 }],
  total: 74,
  currency: "USD",
  createdAt: "2026-11-11T11:00:00Z",
  ...over,
});
const failedChecks = (p) => breaches(checkMandate(mandate, p, SECRET)).map((f) => f.check);
const review = (over = {}) => ({ claim: "unauthorized", matchesIntent: true, confidence: 0.95, reasoning: "Matches.", ...over });

test("signature verifies, and fails after tampering or with another key", () => {
  assert.equal(verifySignature(mandate, SECRET), true);
  assert.equal(verifySignature({ ...mandate, maxTotal: 150 }, SECRET), false);
  assert.equal(verifySignature(mandate, "other-secret"), false);
});

test("an in-scope purchase passes every rule check", () => {
  assert.deepEqual(failedChecks(purchase()), []);
  assert.deepEqual(failedChecks(purchase({ total: 80 })), [], "exactly at the cap is allowed");
});

test("each limit is enforced", () => {
  assert.deepEqual(failedChecks(purchase({ total: 129 })), ["price_cap"]);
  assert.deepEqual(failedChecks(purchase({ items: [{ name: "Aria 200", quantity: 2, unitPrice: 37 }] })), ["quantity"]);
  assert.deepEqual(failedChecks(purchase({ merchantId: "gadgetbarn" })), ["merchant"]);
  assert.deepEqual(failedChecks(purchase({ createdAt: "2026-11-13T10:00:00Z" })), ["validity_window"]);
  assert.deepEqual(failedChecks(purchase({ currency: "EUR" })), ["currency"]);
});

test("a rule breach refunds the buyer and blames the agent", () => {
  const verdict = decide(checkMandate(mandate, purchase({ total: 129 }), SECRET), review(), null);
  assert.equal(verdict.outcome, "REFUND_BUYER");
  assert.equal(verdict.liableParty, "agent");
});

test("a tampered mandate is escalated, never auto-resolved", () => {
  const forged = { ...mandate, maxTotal: 500 };
  const verdict = decide(checkMandate(forged, purchase({ total: 129 }), SECRET), review(), null);
  assert.equal(verdict.outcome, "ESCALATE");
});

test("in-scope purchase with an 'unauthorised' claim protects the merchant", () => {
  const verdict = decide(checkMandate(mandate, purchase(), SECRET), review(), null);
  assert.equal(verdict.outcome, "MERCHANT_PROTECTED");
});

test("wrong item inside the price cap still refunds the buyer", () => {
  const verdict = decide(checkMandate(mandate, purchase(), SECRET), review({ claim: "wrong_item", matchesIntent: false }), null);
  assert.equal(verdict.outcome, "REFUND_BUYER");
  assert.equal(verdict.liableParty, "agent");
});

test("low confidence or a missing review escalates to a person", () => {
  const findings = checkMandate(mandate, purchase(), SECRET);
  assert.equal(decide(findings, review({ confidence: 0.5 }), null).outcome, "ESCALATE");
  assert.equal(decide(findings, null, null).outcome, "ESCALATE");
});

test("'not received' depends on the shipment record", () => {
  const findings = checkMandate(mandate, purchase(), SECRET);
  const claim = review({ claim: "not_received" });
  const none = decide(findings, claim, null);
  assert.equal(none.outcome, "REFUND_BUYER");
  assert.equal(none.liableParty, "merchant");
  assert.equal(decide(findings, claim, { trackingNumber: "T1", status: "DELIVERED" }).outcome, "MERCHANT_PROTECTED");
  assert.equal(decide(findings, claim, { trackingNumber: "T1", status: "SHIPPED" }).outcome, "ESCALATE");
});
