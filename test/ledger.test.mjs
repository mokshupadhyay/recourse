// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBuyerRisk, buildLedger, isFlagged, SAMPLE_RECORDS } from "../src/lib/ledger.ts";

const rec = (over = {}) => ({
  buyerId: "b1",
  agentId: "a1",
  merchantId: "shop",
  ordered: true,
  agentBreach: false,
  followedHiddenText: false,
  claimRejected: false,
  claimUpheld: false,
  undelivered: false,
  ...over,
});
const level = (entries, id) => entries.find((e) => e.id === id)?.level;

test("agent: one breach is watched, two are flagged", () => {
  assert.equal(level(buildLedger([rec()]).agents, "a1"), "ok");
  assert.equal(level(buildLedger([rec({ agentBreach: true })]).agents, "a1"), "watch");
  const two = buildLedger([rec({ agentBreach: true }), rec({ agentBreach: true }), rec()]);
  assert.equal(level(two.agents, "a1"), "flagged");
  assert.ok(isFlagged(two.agents, "a1"));
  assert.ok(!isFlagged(two.agents, "someone-else"));
});

test("buyer: rejected claims flag the buyer, upheld claims do not", () => {
  const upheld = buildLedger([rec({ claimUpheld: true }), rec({ claimUpheld: true })]);
  assert.equal(level(upheld.buyers, "b1"), "ok");
  const rejected = buildLedger([rec({ claimRejected: true }), rec({ claimRejected: true })]);
  assert.equal(level(rejected.buyers, "b1"), "flagged");
});

test("shop: hidden listing text is watched, and flagged once it causes a breach", () => {
  const hidden = [{ merchantId: "shop", sku: "SKU-1" }];
  assert.equal(level(buildLedger([], hidden).merchants, "shop"), "watch");
  const caused = buildLedger([rec({ agentBreach: true, followedHiddenText: true })], hidden);
  assert.equal(level(caused.merchants, "shop"), "flagged");
  assert.match(caused.merchants[0].reason, /SKU-1/);
});

test("flagged buyer: judgement-call refunds escalate, rule breaches still refund", () => {
  const flagged = buildLedger([rec({ claimRejected: true }), rec({ claimRejected: true })]).buyers[0];
  const refund = { outcome: "REFUND_BUYER", liableParty: "merchant", headline: "No shipment on record.", reasons: [] };
  const pass = [{ check: "price_cap", pass: true, detail: "" }];
  const fail = [{ check: "price_cap", pass: false, detail: "" }];
  assert.equal(applyBuyerRisk(refund, pass, flagged).outcome, "ESCALATE");
  assert.equal(applyBuyerRisk(refund, fail, flagged).outcome, "REFUND_BUYER");
  assert.equal(applyBuyerRisk(refund, pass, undefined).outcome, "REFUND_BUYER");
  const kept = { ...refund, outcome: "MERCHANT_PROTECTED" };
  assert.equal(applyBuyerRisk(kept, pass, flagged).outcome, "MERCHANT_PROTECTED");
});

test("sample history is labelled and flags only the sample buyer", () => {
  const ledger = buildLedger(SAMPLE_RECORDS);
  assert.ok(SAMPLE_RECORDS.every((r) => r.sample));
  assert.equal(level(ledger.buyers, "buyer-riya"), "flagged");
  assert.equal(level(ledger.agents, "dealbot-x"), "watch");
  assert.ok(ledger.buyers.every((b) => b.sampleOnly));
});
