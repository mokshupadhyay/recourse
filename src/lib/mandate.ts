// Mandates: the signed, scoped permission a person gives an AI agent before it spends.
// This file is dependency-light on purpose (zod + node:crypto only) so the rules that
// decide refunds can be unit-tested without PayPal or an LLM.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";

export const MandateTermsSchema = z.object({
  intent: z.string().describe("The buyer's request in their own words, verbatim."),
  itemDescription: z.string().describe("Short description of what may be bought."),
  mustHave: z.array(z.string()).describe("Attributes the item must have."),
  mustNotHave: z.array(z.string()).describe("Attributes or add-ons the buyer excluded."),
  maxTotal: z.number().describe("Hard cap on the order total, in USD, including add-ons."),
  maxQuantity: z.number().describe("Maximum number of units."),
  allowedMerchants: z
    .array(z.string())
    .describe("Merchant ids the agent may buy from. Empty means any merchant."),
  validForHours: z.number().describe("How long the permission lasts, in hours."),
});
export type MandateTerms = z.infer<typeof MandateTermsSchema>;

export type Mandate = Omit<MandateTerms, "validForHours"> & {
  id: string;
  version: 1;
  principal: string;
  currency: "USD";
  createdAt: string;
  expiresAt: string;
  signature: string;
};

export type PurchaseItem = { name: string; quantity: number; unitPrice: number };
export type PurchaseFacts = {
  merchantId: string;
  items: PurchaseItem[];
  total: number;
  currency: string;
  createdAt: string;
};

export type Finding = { check: string; pass: boolean; detail: string };

// Stable JSON: keys sorted, so the same mandate always produces the same bytes to sign.
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sign(unsigned: Omit<Mandate, "signature">, secret: string): string {
  return createHmac("sha256", secret).update(canonicalize(unsigned)).digest("hex");
}

// Demo stand-in for a user-held key: an HMAC with a server secret. A production
// version would have the buyer sign with a passkey so the server cannot forge consent.
export function createMandate(
  terms: MandateTerms,
  principal: string,
  secret: string,
  now: Date = new Date(),
): Mandate {
  const { validForHours, ...rest } = terms;
  const unsigned: Omit<Mandate, "signature"> = {
    ...rest,
    id: `mnd_${randomUUID().slice(0, 8)}`,
    version: 1,
    principal,
    currency: "USD",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + validForHours * 3_600_000).toISOString(),
  };
  return { ...unsigned, signature: sign(unsigned, secret) };
}

export function verifySignature(mandate: Mandate, secret: string): boolean {
  const { signature, ...unsigned } = mandate;
  const expected = Buffer.from(sign(unsigned, secret), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const money = (n: number) => `$${n.toFixed(2)}`;

// The rule-based half of the verdict. Each finding is something a card network or a
// merchant could check without trusting any model.
export function checkMandate(mandate: Mandate, purchase: PurchaseFacts, secret: string): Finding[] {
  const quantity = purchase.items.reduce((sum, item) => sum + item.quantity, 0);
  const boughtAt = new Date(purchase.createdAt).getTime();
  const merchantOk =
    mandate.allowedMerchants.length === 0 || mandate.allowedMerchants.includes(purchase.merchantId);
  return [
    {
      check: "signature",
      pass: verifySignature(mandate, secret),
      detail: "Mandate signature matches its contents (not altered after the buyer approved it).",
    },
    {
      check: "price_cap",
      pass: purchase.total <= mandate.maxTotal + 1e-9,
      detail: `Order total ${money(purchase.total)} against a cap of ${money(mandate.maxTotal)}.`,
    },
    {
      check: "currency",
      pass: purchase.currency === mandate.currency,
      detail: `Paid in ${purchase.currency}; mandate allows ${mandate.currency}.`,
    },
    {
      check: "quantity",
      pass: quantity <= mandate.maxQuantity,
      detail: `${quantity} unit(s) bought against a limit of ${mandate.maxQuantity}.`,
    },
    {
      check: "merchant",
      pass: merchantOk,
      detail: merchantOk
        ? `Merchant ${purchase.merchantId} is allowed.`
        : `Merchant ${purchase.merchantId} is not in the allowed list (${mandate.allowedMerchants.join(", ")}).`,
    },
    {
      check: "validity_window",
      pass: boughtAt >= new Date(mandate.createdAt).getTime() && boughtAt <= new Date(mandate.expiresAt).getTime(),
      detail: `Purchased ${purchase.createdAt}; mandate valid ${mandate.createdAt} to ${mandate.expiresAt}.`,
    },
  ];
}

export const breaches = (findings: Finding[]) => findings.filter((f) => !f.pass);
