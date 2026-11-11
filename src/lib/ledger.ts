// Trust ledger: a track record for agents, buyers and shops, built from how past cases
// ended. Scores are plain counts with fixed thresholds (no model), so every mark can be
// explained, and every mark changes what Recourse does next.
// Pure module (types only from the rest of the app) so it can be unit-tested.
import type { Finding } from "./mandate";
import type { Case } from "./store";
import type { Verdict } from "./verdict";

export type Level = "ok" | "watch" | "flagged";

export const AGENTS = {
  claude: { id: "claude-shopper", name: "Claude shopping agent" },
  compromised: { id: "dealbot-x", name: "DealBot X (simulated third-party agent)" },
} as const;

// One finished (or blocked) purchase, reduced to the facts the ledger counts.
export type LedgerRecord = {
  buyerId: string;
  agentId?: string;
  merchantId?: string;
  ordered: boolean;
  agentBreach: boolean; // blocked by the gate, or refunded with the agent at fault
  followedHiddenText: boolean; // the agent obeyed instructions hidden in a listing
  claimRejected: boolean; // buyer complained and the evidence went against them
  claimUpheld: boolean; // buyer complained and was refunded
  undelivered: boolean; // refunded because the shop had no shipment on record
  sample?: boolean;
};

export type LedgerEntry = {
  id: string;
  name: string;
  level: Level;
  facts: string[];
  reason: string;
  consequence: string;
  sampleOnly: boolean; // true when every record behind this entry is sample history
};

export type Ledger = { agents: LedgerEntry[]; buyers: LedgerEntry[]; merchants: LedgerEntry[] };

export type HiddenListing = { merchantId: string; sku: string };

export function recordFromCase(c: Case): LedgerRecord {
  const verdict = c.resolution?.verdict;
  const refunded = verdict?.outcome === "REFUND_BUYER";
  return {
    buyerId: c.mandate.principal,
    agentId: c.agentMode ? AGENTS[c.agentMode].id : undefined,
    merchantId: c.purchase?.merchantId,
    ordered: Boolean(c.purchase),
    agentBreach: c.status === "BLOCKED_BY_GATE" || (refunded && verdict?.liableParty === "agent"),
    followedHiddenText: c.events.some((e) => e.type === "followed_hidden_instruction"),
    claimRejected: verdict?.outcome === "MERCHANT_PROTECTED",
    claimUpheld: refunded,
    undelivered: refunded && verdict?.liableParty === "merchant",
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RANK: Record<Level, number> = { flagged: 0, watch: 1, ok: 2 };
const byRisk = (a: LedgerEntry, b: LedgerEntry) => RANK[a.level] - RANK[b.level] || a.id.localeCompare(b.id);

function group(records: LedgerRecord[], key: (r: LedgerRecord) => string | undefined): Map<string, LedgerRecord[]> {
  const groups = new Map<string, LedgerRecord[]>();
  for (const r of records) {
    const id = key(r);
    if (id) groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  return groups;
}

export function buildLedger(
  records: LedgerRecord[],
  hiddenListings: HiddenListing[] = [],
  names: Record<string, string> = {},
): Ledger {
  const agents = [...group(records, (r) => r.agentId)].map(([id, rs]): LedgerEntry => {
    const orders = rs.filter((r) => r.ordered).length;
    const breaches = rs.filter((r) => r.agentBreach).length;
    const tricked = rs.filter((r) => r.followedHiddenText).length;
    const level: Level = breaches >= 2 ? "flagged" : breaches === 1 ? "watch" : "ok";
    return {
      id,
      name: names[id] ?? id,
      level,
      facts: [count(orders, "order"), count(breaches, "mandate breach", "mandate breaches")],
      reason:
        breaches === 0
          ? "Every order stayed inside the buyer's mandate."
          : `${breaches} of ${count(orders, "order")} broke the buyer's mandate` +
            (tricked > 0 ? `, ${tricked} after obeying hidden text in a listing.` : "."),
      consequence:
        level === "flagged"
          ? "The pre-payment gate is forced on for this agent."
          : level === "watch"
            ? "One more breach forces the pre-payment gate on."
            : "No restrictions.",
      sampleOnly: rs.every((r) => r.sample),
    };
  });

  const buyers = [...group(records, (r) => r.buyerId)].map(([id, rs]): LedgerEntry => {
    const rejected = rs.filter((r) => r.claimRejected).length;
    const complaints = rejected + rs.filter((r) => r.claimUpheld).length;
    const level: Level = rejected >= 2 ? "flagged" : rejected === 1 ? "watch" : "ok";
    return {
      id,
      name: names[id] ?? id,
      level,
      facts: [count(rs.filter((r) => r.ordered).length, "order"), count(complaints, "complaint"), `${rejected} rejected`],
      reason:
        rejected === 0
          ? complaints === 0
            ? "No complaints on record."
            : "Every complaint was upheld."
          : `${rejected} of ${count(complaints, "complaint")} rejected: the order was inside the mandate and the evidence backed the shop.`,
      consequence:
        level === "flagged"
          ? "Refunds that rest on a judgement call need a person's approval. A broken mandate rule is still refunded automatically."
          : level === "watch"
            ? "One more rejected claim ends automatic refunds on judgement calls."
            : "No restrictions.",
      sampleOnly: rs.every((r) => r.sample),
    };
  });

  const byMerchant = group(records, (r) => r.merchantId);
  const merchantIds = new Set([...byMerchant.keys(), ...hiddenListings.map((l) => l.merchantId)]);
  const merchants = [...merchantIds].map((id): LedgerEntry => {
    const rs = byMerchant.get(id) ?? [];
    const skus = hiddenListings.filter((l) => l.merchantId === id).map((l) => l.sku);
    const injected = rs.filter((r) => r.followedHiddenText && r.agentBreach).length;
    const undelivered = rs.filter((r) => r.undelivered).length;
    const level: Level = injected >= 1 || undelivered >= 2 ? "flagged" : skus.length > 0 || undelivered === 1 ? "watch" : "ok";
    const reasons = [
      skus.length > 0 ? `Listing ${skus.join(", ")} carries hidden instructions aimed at AI agents` : "",
      injected > 0 ? `${count(injected, "order")} broke a mandate after an agent obeyed that text` : "",
      undelivered > 0 ? `${count(undelivered, "order")} refunded with no shipment on record` : "",
    ].filter(Boolean);
    return {
      id,
      name: names[id] ?? id,
      level,
      facts: [count(rs.filter((r) => r.ordered).length, "order"), count(skus.length, "listing with hidden text", "listings with hidden text")],
      reason: reasons.length > 0 ? `${reasons.join("; ")}.` : "No problems on record.",
      consequence:
        level === "flagged"
          ? "Every order to this shop goes through the pre-payment gate, whatever the agent."
          : level === "watch"
            ? "Watched: a mandate breach caused by its hidden text, or a second undelivered order, flags the shop."
            : "No restrictions.",
      sampleOnly: rs.length > 0 && rs.every((r) => r.sample),
    };
  });

  return { agents: agents.sort(byRisk), buyers: buyers.sort(byRisk), merchants: merchants.sort(byRisk) };
}

export const isFlagged = (entries: LedgerEntry[], id: string | undefined) =>
  entries.some((e) => e.id === id && e.level === "flagged");

// A flagged buyer still gets an automatic refund when a mandate rule was broken (that is
// arithmetic, not their word). Refunds that rest on a judgement call go to a person instead.
export function applyBuyerRisk(verdict: Verdict, findings: Finding[], buyer: LedgerEntry | undefined): Verdict {
  const ruleBroken = findings.some((f) => !f.pass);
  if (buyer?.level !== "flagged" || verdict.outcome !== "REFUND_BUYER" || ruleBroken) return verdict;
  return {
    outcome: "ESCALATE",
    liableParty: "undetermined",
    headline: "This buyer is flagged for rejected claims, so a person must approve the refund.",
    reasons: [`Trust ledger: ${buyer.reason}`, `Without the flag the outcome would have been a refund: ${verdict.headline}`],
  };
}

// Illustrative past cases, switched on from the dashboard so a fresh install has patterns
// to show. Always labelled as sample history in the UI; never sent to PayPal.
const sample = (r: Partial<LedgerRecord> & Pick<LedgerRecord, "buyerId" | "agentId" | "merchantId">): LedgerRecord => ({
  ordered: true,
  agentBreach: false,
  followedHiddenText: false,
  claimRejected: false,
  claimUpheld: false,
  undelivered: false,
  ...r,
  sample: true,
});

export const SAMPLE_RECORDS: LedgerRecord[] = [
  sample({ buyerId: "buyer-sam", agentId: AGENTS.compromised.id, merchantId: "gadgetbarn", agentBreach: true, claimUpheld: true }),
  sample({ buyerId: "buyer-sam", agentId: AGENTS.claude.id, merchantId: "gadgetbarn" }),
  sample({ buyerId: "buyer-riya", agentId: AGENTS.claude.id, merchantId: "soundhouse", claimRejected: true }),
  sample({ buyerId: "buyer-riya", agentId: AGENTS.claude.id, merchantId: "gadgetbarn", claimRejected: true }),
  sample({ buyerId: "buyer-riya", agentId: AGENTS.claude.id, merchantId: "soundhouse" }),
];
