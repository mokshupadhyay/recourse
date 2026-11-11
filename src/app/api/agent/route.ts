import { runAgent } from "@/lib/agent";
import { handle } from "@/lib/http";
import { getCase } from "@/lib/store";

export const maxDuration = 300;

export const POST = handle(async (request) => {
  const { caseId, mode, gate } = (await request.json()) as { caseId?: string; mode?: string; gate?: boolean };
  const current = caseId ? getCase(caseId) : undefined;
  if (!current) return Response.json({ error: "Case not found." }, { status: 404 });
  if (current.orderId) return Response.json({ error: "The agent already placed an order for this mandate." }, { status: 409 });
  const updated = await runAgent(current.id, mode === "compromised" ? "compromised" : "claude", Boolean(gate));
  return Response.json({ case: updated });
});
