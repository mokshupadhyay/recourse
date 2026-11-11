// Turns the facts of a case into a decision. Pure function: the model contributes two
// judgements (what the buyer is claiming, whether the item matches the intent) and
// everything else is rules, so the same facts always give the same outcome.
import type { Finding } from "./mandate";

export type Claim = "unauthorized" | "wrong_item" | "not_received" | "other";

export type SemanticReview = {
  claim: Claim;
  matchesIntent: boolean;
  confidence: number; // 0..1
  reasoning: string;
};

export type Shipment = { trackingNumber: string; carrier?: string; status: string } | null;

export type Outcome = "REFUND_BUYER" | "MERCHANT_PROTECTED" | "ESCALATE";

export type Verdict = {
  outcome: Outcome;
  liableParty: "agent" | "merchant" | "buyer" | "undetermined";
  headline: string;
  reasons: string[];
};

export const CONFIDENCE_FLOOR = 0.75;

export function decide(
  findings: Finding[],
  semantic: SemanticReview | null,
  shipment: Shipment,
): Verdict {
  const failed = findings.filter((f) => !f.pass);

  if (failed.some((f) => f.check === "signature")) {
    return {
      outcome: "ESCALATE",
      liableParty: "undetermined",
      headline: "Mandate signature is invalid, so there is no trustworthy record of consent.",
      reasons: failed.map((f) => f.detail),
    };
  }

  if (failed.length > 0) {
    return {
      outcome: "REFUND_BUYER",
      liableParty: "agent",
      headline: "The agent acted outside the mandate the buyer signed.",
      reasons: failed.map((f) => f.detail),
    };
  }

  if (!semantic) {
    return {
      outcome: "ESCALATE",
      liableParty: "undetermined",
      headline: "Rule checks passed, but the intent review was unavailable.",
      reasons: ["A person should compare the item with the buyer's request."],
    };
  }

  if (semantic.confidence < CONFIDENCE_FLOOR) {
    return {
      outcome: "ESCALATE",
      liableParty: "undetermined",
      headline: "The intent review was not confident enough to move money automatically.",
      reasons: [semantic.reasoning],
    };
  }

  if (!semantic.matchesIntent) {
    return {
      outcome: "REFUND_BUYER",
      liableParty: "agent",
      headline: "The item bought does not match what the buyer asked for.",
      reasons: [semantic.reasoning],
    };
  }

  if (semantic.claim === "not_received") {
    if (!shipment) {
      return {
        outcome: "REFUND_BUYER",
        liableParty: "merchant",
        headline: "The order is within the mandate, but the merchant has no shipment on record.",
        reasons: ["No tracking was registered with PayPal for this transaction."],
      };
    }
    if (shipment.status === "DELIVERED") {
      return {
        outcome: "MERCHANT_PROTECTED",
        liableParty: "buyer",
        headline: "The order is within the mandate and tracking shows it was delivered.",
        reasons: [`Tracking ${shipment.trackingNumber} has status DELIVERED.`],
      };
    }
    return {
      outcome: "ESCALATE",
      liableParty: "undetermined",
      headline: "The order shipped but is not yet marked delivered.",
      reasons: [`Tracking ${shipment.trackingNumber} has status ${shipment.status}.`],
    };
  }

  return {
    outcome: "MERCHANT_PROTECTED",
    liableParty: "buyer",
    headline: "The buyer signed a mandate and the agent stayed inside it.",
    reasons: [
      "Every rule check passed (signature, price cap, quantity, merchant, validity window).",
      semantic.reasoning,
    ],
  };
}
