import { handle } from "@/lib/http";
import { resolveComplaint } from "@/lib/resolver";

export const maxDuration = 300;

export const POST = handle(async (request) => {
  const { caseId, complaint } = (await request.json()) as { caseId?: string; complaint?: string };
  if (!caseId || !complaint?.trim()) return Response.json({ error: "A case and a complaint are required." }, { status: 400 });
  return Response.json({ case: await resolveComplaint(caseId, complaint.trim()) });
});
