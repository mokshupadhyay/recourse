"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Case, CaseEvent } from "@/lib/store";
import type { MandateTerms } from "@/lib/mandate";
import { AGENTS, type Ledger, type LedgerEntry, type Level } from "@/lib/ledger";

type Config = { paypal: boolean; claude: boolean };
type Overview = { cases: Case[]; config: Config; ledger: Ledger; sampleHistory: boolean };
const BUYERS = ["demo-buyer", "buyer-riya"];
const LEVEL_STYLE: Record<Level, string> = {
  ok: "bg-emerald-100 text-emerald-900",
  watch: "bg-amber-100 text-amber-900",
  flagged: "bg-red-100 text-red-900",
};

const DEMO_REQUEST = "Buy me wireless noise-cancelling headphones for under $80. No add-ons or protection plans.";
const DEMO_TERMS: MandateTerms = {
  intent: DEMO_REQUEST,
  itemDescription: "Wireless noise-cancelling headphones",
  mustHave: ["wireless", "noise cancelling"],
  mustNotHave: ["add-ons", "protection plans"],
  maxTotal: 80,
  maxQuantity: 1,
  allowedMerchants: [],
  validForHours: 24,
};
const COMPLAINTS = [
  "This is not what I asked for. I set an $80 limit and said no protection plans.",
  "I never authorised this purchase. I want my money back.",
  "The package never arrived.",
];

const STATUS_STYLE: Record<Case["status"], string> = {
  MANDATE_SIGNED: "bg-slate-200 text-slate-800",
  BLOCKED_BY_GATE: "bg-amber-100 text-amber-900",
  AWAITING_PAYER_APPROVAL: "bg-blue-100 text-blue-900",
  PAID: "bg-indigo-100 text-indigo-900",
  REFUNDED: "bg-emerald-100 text-emerald-900",
  MERCHANT_PROTECTED: "bg-emerald-100 text-emerald-900",
  ESCALATED: "bg-orange-100 text-orange-900",
};
const ACTOR_STYLE: Record<CaseEvent["actor"], string> = {
  buyer: "bg-sky-600",
  agent: "bg-violet-600",
  recourse: "bg-slate-900",
  paypal: "bg-blue-700",
  merchant: "bg-teal-600",
};

const list = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);
const label = (status: string) => status.replaceAll("_", " ").toLowerCase();

async function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(path, body === undefined && method === "GET" ? undefined : {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
  return json as T;
}

export default function Dashboard() {
  const params = useSearchParams();
  const [cases, setCases] = useState<Case[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("case"));
  const [request, setRequest] = useState(DEMO_REQUEST);
  const [terms, setTerms] = useState<MandateTerms | null>(null);
  const [mode, setMode] = useState<"claude" | "compromised">("claude");
  const [gate, setGate] = useState(false);
  const [complaint, setComplaint] = useState(COMPLAINTS[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [sampleHistory, setSampleHistory] = useState(false);
  const [buyer, setBuyer] = useState(BUYERS[0]);

  const show = useCallback((data: Overview) => {
    setCases(data.cases);
    setConfig(data.config);
    setLedger(data.ledger);
    setSampleHistory(data.sampleHistory);
  }, []);

  const refresh = useCallback(async () => {
    show(await api<Overview>("/api/cases", undefined, "GET"));
  }, [show]);

  useEffect(() => {
    let live = true;
    api<Overview>("/api/cases", undefined, "GET").then(
      (data) => {
        if (live) show(data);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [show]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await refresh().catch(() => {});
      setBusy(null);
    }
  };

  const selected = cases.find((c) => c.id === selectedId) ?? cases[0];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Recourse</h1>
          <p className="text-slate-600">Buyer and seller protection for purchases made by AI agents. PayPal sandbox only.</p>
        </div>
        {config && (
          <div className="flex gap-2 text-xs">
            <Badge ok={config.paypal} text={config.paypal ? "PayPal sandbox connected" : "PayPal keys missing"} />
            <Badge ok={config.claude} text={config.claude ? "Claude connected" : "Claude key missing"} />
          </div>
        )}
      </header>

      {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <section className="space-y-4">
          <Card title="1. Buyer writes a mandate">
            <textarea className="input h-24" value={request} onChange={(e) => setRequest(e.target.value)} />
            <div className="mt-2 flex gap-2">
              <button className="btn" disabled={!!busy} onClick={() => run("draft", async () => {
                const data = await api<{ terms: MandateTerms }>("/api/mandates/draft", { request });
                setTerms(data.terms);
              })}>
                {busy === "draft" ? "Drafting…" : "Draft terms with AI"}
              </button>
              <button className="btn-quiet" onClick={() => { setRequest(DEMO_REQUEST); setTerms(DEMO_TERMS); }}>Use demo terms</button>
            </div>
          </Card>

          {terms && (
            <Card title="2. Buyer reviews and signs">
              <Field name="What may be bought">
                <input className="input" value={terms.itemDescription} onChange={(e) => setTerms({ ...terms, itemDescription: e.target.value })} />
              </Field>
              <Field name="Must have (comma separated)">
                <input className="input" value={terms.mustHave.join(", ")} onChange={(e) => setTerms({ ...terms, mustHave: list(e.target.value) })} />
              </Field>
              <Field name="Must not have">
                <input className="input" value={terms.mustNotHave.join(", ")} onChange={(e) => setTerms({ ...terms, mustNotHave: list(e.target.value) })} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field name="Cap (USD)">
                  <input className="input" type="number" value={terms.maxTotal} onChange={(e) => setTerms({ ...terms, maxTotal: Number(e.target.value) })} />
                </Field>
                <Field name="Max units">
                  <input className="input" type="number" value={terms.maxQuantity} onChange={(e) => setTerms({ ...terms, maxQuantity: Number(e.target.value) })} />
                </Field>
                <Field name="Valid (hours)">
                  <input className="input" type="number" value={terms.validForHours} onChange={(e) => setTerms({ ...terms, validForHours: Number(e.target.value) })} />
                </Field>
              </div>
              <Field name="Allowed merchants (empty = any)">
                <input className="input" value={terms.allowedMerchants.join(", ")} onChange={(e) => setTerms({ ...terms, allowedMerchants: list(e.target.value) })} />
              </Field>
              <Field name="Signing as buyer">
                <select className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                  {BUYERS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <button className="btn mt-2 w-full" disabled={!!busy} onClick={() => run("sign", async () => {
                const data = await api<{ case: Case }>("/api/mandates", { terms: { ...terms, intent: request }, principal: buyer });
                setSelectedId(data.case.id);
                setTerms(null);
              })}>
                Sign mandate
              </button>
            </Card>
          )}

          <Card title="Cases">
            {cases.length === 0 && <p className="text-sm text-slate-500">No cases yet. Sign a mandate to start.</p>}
            <ul className="space-y-1">
              {cases.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSelectedId(c.id)} className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${selected?.id === c.id ? "bg-slate-100" : ""}`}>
                    <span className="font-mono text-xs text-slate-500">{c.id}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>{label(c.status)}</span>
                    <span className="block truncate text-slate-700">{c.mandate.itemDescription} · up to ${c.mandate.maxTotal}</span>
                  </button>
                </li>
              ))}
            </ul>
            {cases.length > 0 && (
              <button className="btn-quiet mt-2" onClick={() => run("reset", async () => { await api("/api/cases", undefined, "DELETE"); setSelectedId(null); })}>Clear all cases</button>
            )}
          </Card>
        </section>

        <section className="space-y-4">
          {!selected && <Card title="How it works"><p className="text-sm text-slate-600">A buyer signs a mandate. An agent shops and pays with PayPal. If something goes wrong, Recourse compares the mandate, the order and the shipment, then refunds the buyer or hands the merchant an evidence packet.</p></Card>}
          {selected && (
            <>
              <Card title={`Case ${selected.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`rounded px-2 py-0.5 ${STATUS_STYLE[selected.status]}`}>{label(selected.status)}</span>
                  <span>Buyer <b>{selected.mandate.principal}</b>{selected.agentMode && <> · agent <b>{AGENTS[selected.agentMode].id}</b></>} ·</span>
                  <span>Mandate <span className="font-mono text-xs">{selected.mandate.id}</span>: up to <b>${selected.mandate.maxTotal.toFixed(2)}</b>, {selected.mandate.maxQuantity} unit(s)</span>
                </div>
                <p className="mt-2 text-sm text-slate-700">“{selected.mandate.intent}”</p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-400">signature {selected.mandate.signature}</p>
                {selected.purchase && (
                  <p className="mt-2 text-sm">
                    Agent ordered <b>{selected.purchase.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</b> from {selected.purchase.merchantId} for <b>${selected.purchase.total.toFixed(2)}</b>
                    {selected.orderId && <> (PayPal order <span className="font-mono text-xs">{selected.orderId}</span>)</>}.
                  </p>
                )}
              </Card>

              {selected.status === "MANDATE_SIGNED" && (
                <Card title="3. Agent shops and pays">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                      <option value="claude">Claude shopping agent</option>
                      <option value="compromised">Simulated compromised agent (obeys hidden listing text)</option>
                    </select>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} /> Pre-payment gate</label>
                    <button className="btn" disabled={!!busy} onClick={() => run("agent", async () => { await api("/api/agent", { caseId: selected.id, mode, gate }); })}>
                      {busy === "agent" ? "Agent working…" : "Run agent"}
                    </button>
                  </div>
                </Card>
              )}

              {selected.status === "AWAITING_PAYER_APPROVAL" && selected.approveUrl && (
                <Card title="4. Wallet approval">
                  <p className="text-sm text-slate-600">Log in with your sandbox buyer account to approve. You return here and PayPal captures the payment.</p>
                  <a className="btn mt-2 inline-block" href={selected.approveUrl}>Approve in PayPal sandbox</a>
                </Card>
              )}

              {selected.status === "PAID" && (
                <Card title="5. Something goes wrong">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-600">Merchant:</span>
                    <button className="btn-quiet" disabled={!!busy} onClick={() => run("ship", async () => { await api("/api/ship", { caseId: selected.id, status: "SHIPPED" }); })}>Register shipment</button>
                    <button className="btn-quiet" disabled={!!busy} onClick={() => run("ship", async () => { await api("/api/ship", { caseId: selected.id, status: "DELIVERED" }); })}>Register as delivered</button>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {COMPLAINTS.map((c) => <button key={c} className="rounded-full border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100" onClick={() => setComplaint(c)}>{c.slice(0, 34)}…</button>)}
                  </div>
                  <textarea className="input h-16" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
                  <div className="mt-2 flex gap-2">
                    <button className="btn" disabled={!!busy} onClick={() => run("resolve", async () => { await api("/api/complaints", { caseId: selected.id, complaint }); })}>
                      {busy === "resolve" ? "Resolving…" : "File complaint"}
                    </button>
                    <button className="btn-quiet" disabled={!!busy} onClick={() => run("disputes", async () => { await api("/api/disputes"); })}>Sync PayPal disputes</button>
                  </div>
                </Card>
              )}

              {selected.resolution && (
                <Card title="Verdict">
                  <p className="text-lg font-semibold">{label(selected.resolution.verdict.outcome)} <span className="text-sm font-normal text-slate-500">· liable: {selected.resolution.verdict.liableParty}</span></p>
                  <p className="text-sm text-slate-700">{selected.resolution.verdict.headline}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                    {selected.resolution.verdict.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                  {selected.resolution.refundId && <p className="mt-2 text-sm">PayPal refund <span className="font-mono text-xs">{selected.resolution.refundId}</span></p>}
                  <table className="mt-3 w-full text-left text-xs">
                    <tbody>
                      {selected.resolution.findings.map((f) => (
                        <tr key={f.check} className="border-t border-slate-100">
                          <td className="py-1 pr-2">{f.pass ? "✅" : "❌"}</td>
                          <td className="py-1 pr-2 font-mono">{f.check}</td>
                          <td className="py-1 text-slate-600">{f.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selected.resolution.evidencePacket != null && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-sm font-medium">Evidence packet for the merchant</summary>
                      <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900 p-3 text-slate-100">{JSON.stringify(selected.resolution.evidencePacket, null, 2)}</pre>
                    </details>
                  )}
                </Card>
              )}

              <Card title="Flight recorder">
                <ol className="space-y-2">
                  {selected.events.map((e, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className={`mt-0.5 h-fit w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-medium text-white ${ACTOR_STYLE[e.actor]}`}>{e.actor}</span>
                      <span>
                        <span className="text-slate-800">{e.summary}</span>
                        <span className="ml-2 font-mono text-[11px] text-slate-400">{new Date(e.at).toLocaleTimeString()}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            </>
          )}
        </section>
      </div>

      {ledger && (
        <section className="mt-6">
          <Card title="Trust ledger">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <p>A track record built from how cases ended. Marks are plain counts, and each one changes what Recourse does next.</p>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sampleHistory} disabled={!!busy} onChange={(e) => run("sample", async () => { await api("/api/ledger", { sampleHistory: e.target.checked }); })} />
                Include sample history
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <LedgerColumn title="Agents" entries={ledger.agents} />
              <LedgerColumn title="Buyers" entries={ledger.buyers} />
              <LedgerColumn title="Shops" entries={ledger.merchants} />
            </div>
            {sampleHistory && <p className="mt-3 text-xs text-slate-500">Rows marked “sample” come from illustrative past cases, not from PayPal. Unmarked rows include cases run here.</p>}
          </Card>
        </section>
      )}

      <style>{`
        .input { width: 100%; border: 1px solid #cbd5e1; border-radius: 0.375rem; padding: 0.375rem 0.5rem; font-size: 0.875rem; background: white; }
        .btn { background: #0f172a; color: white; border-radius: 0.375rem; padding: 0.4rem 0.8rem; font-size: 0.875rem; font-weight: 500; }
        .btn:disabled { opacity: 0.5; }
        .btn-quiet { border: 1px solid #cbd5e1; border-radius: 0.375rem; padding: 0.4rem 0.8rem; font-size: 0.875rem; background: white; }
      `}</style>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </div>
  );
}

function LedgerColumn({ title, entries }: { title: string; entries: LedgerEntry[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      {entries.length === 0 && <p className="text-sm text-slate-500">Nothing on record yet.</p>}
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="rounded-md border border-slate-200 p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{e.name}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
              {e.sampleOnly && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">sample</span>}
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">{e.id} · {e.facts.join(" · ")}</p>
            <p className="mt-1 text-slate-700">{e.reason}</p>
            {e.level !== "ok" && <p className="mt-1 text-xs text-slate-600"><b>Effect:</b> {e.consequence}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs text-slate-600">
      {name}
      {children}
    </label>
  );
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`rounded-full px-2 py-1 ${ok ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{text}</span>;
}
