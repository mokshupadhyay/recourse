// The live trust ledger: stored cases (plus sample history when switched on) run through
// the pure rules in ledger.ts.
import { LISTINGS, MERCHANTS } from "./catalog";
import { AGENTS, buildLedger, recordFromCase, SAMPLE_RECORDS, type Ledger } from "./ledger";
import { listCases, sampleHistoryOn } from "./store";

const NAMES: Record<string, string> = {
  ...MERCHANTS,
  ...Object.fromEntries(Object.values(AGENTS).map((a) => [a.id, a.name])),
};

export function currentLedger(): Ledger {
  const records = [...(sampleHistoryOn() ? SAMPLE_RECORDS : []), ...listCases().map(recordFromCase)];
  const hidden = LISTINGS.filter((l) => l.hiddenText).map((l) => ({ merchantId: l.merchantId, sku: l.sku }));
  return buildLedger(records, hidden, NAMES);
}
