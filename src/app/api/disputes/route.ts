import { handle } from "@/lib/http";
import { callPayPal } from "@/lib/paypal";
import { resolveComplaint } from "@/lib/resolver";
import { listCases, record, updateCase } from "@/lib/store";

export const maxDuration = 300;

type Dispute = {
  dispute_id: string;
  reason?: string;
  status?: string;
  disputed_transactions?: Array<{ seller_transaction_id?: string }>;
  messages?: Array<{ content?: string }>;
};

// Pulls formal PayPal disputes, links each to its case by capture id, and resolves it.
export const POST = handle(async () => {
  const listed = await callPayPal<{ items?: Dispute[] }>("list_disputes", {});
  const linked: string[] = [];
  for (const summary of listed.items ?? []) {
    const dispute = await callPayPal<Dispute>("get_dispute", { dispute_id: summary.dispute_id });
    const captureIds = (dispute.disputed_transactions ?? []).map((t) => t.seller_transaction_id);
    const match = listCases().find((c) => c.captureId && captureIds.includes(c.captureId) && !c.disputeId);
    if (!match) continue;
    updateCase(match.id, (c) => {
      c.disputeId = dispute.dispute_id;
    });
    record(match.id, "paypal", "dispute_opened", `PayPal dispute ${dispute.dispute_id} (${dispute.reason ?? "no reason given"}) linked to this case.`);
    const complaint = [dispute.reason, ...(dispute.messages ?? []).map((m) => m.content)].filter(Boolean).join(". ");
    if (match.status === "PAID") await resolveComplaint(match.id, complaint || "Buyer opened a PayPal dispute.");
    linked.push(match.id);
  }
  return Response.json({ disputesSeen: listed.items?.length ?? 0, linked });
});
