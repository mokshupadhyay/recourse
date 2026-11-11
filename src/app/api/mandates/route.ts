import { handle } from "@/lib/http";
import { createMandate, MandateTermsSchema } from "@/lib/mandate";
import { signingSecret } from "@/lib/secret";
import { createCase, getCase, record } from "@/lib/store";

// The buyer signs the terms they reviewed. This opens a case.
export const POST = handle(async (request) => {
  const body = (await request.json()) as { terms?: unknown; principal?: string };
  const parsed = MandateTermsSchema.safeParse(body.terms);
  if (!parsed.success) return Response.json({ error: "Mandate terms are incomplete." }, { status: 400 });
  if (!(parsed.data.maxTotal > 0)) return Response.json({ error: "Set a price cap above zero." }, { status: 400 });

  const mandate = createMandate(parsed.data, body.principal ?? "demo-buyer", signingSecret());
  const created = createCase(mandate);
  record(created.id, "buyer", "mandate_signed", `Buyer signed mandate ${mandate.id}: up to $${mandate.maxTotal.toFixed(2)} for "${mandate.itemDescription}".`, {
    signature: mandate.signature,
  });
  return Response.json({ case: getCase(created.id) });
});
