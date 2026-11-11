import { handle } from "@/lib/http";
import { paypalConfigured } from "@/lib/paypal";
import { listCases, resetAll, sampleHistoryOn } from "@/lib/store";
import { currentLedger } from "@/lib/trust";

export const GET = handle(async () =>
  Response.json({
    cases: listCases(),
    ledger: currentLedger(),
    sampleHistory: sampleHistoryOn(),
    config: { paypal: paypalConfigured(), claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) },
  }),
);

export const DELETE = handle(async () => {
  resetAll();
  return Response.json({ ok: true });
});
