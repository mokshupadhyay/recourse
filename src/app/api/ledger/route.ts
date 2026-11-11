import { handle } from "@/lib/http";
import { sampleHistoryOn, setSampleHistory } from "@/lib/store";
import { currentLedger } from "@/lib/trust";

export const GET = handle(async () => Response.json({ ledger: currentLedger(), sampleHistory: sampleHistoryOn() }));

// Switches the labelled sample history on or off.
export const POST = handle(async (request) => {
  const { sampleHistory } = (await request.json()) as { sampleHistory?: boolean };
  setSampleHistory(Boolean(sampleHistory));
  return Response.json({ ledger: currentLedger(), sampleHistory: sampleHistoryOn() });
});
