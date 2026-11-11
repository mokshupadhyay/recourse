import { draftMandateTerms } from "@/lib/agent";
import { MERCHANTS } from "@/lib/catalog";
import { handle } from "@/lib/http";

// Plain words in, structured terms out. Nothing is signed here: the buyer reviews first.
export const POST = handle(async (request) => {
  const { request: text } = (await request.json()) as { request?: string };
  if (!text?.trim()) return Response.json({ error: "Describe what you want to buy." }, { status: 400 });
  return Response.json({ terms: await draftMandateTerms(text.trim(), Object.keys(MERCHANTS)) });
});
