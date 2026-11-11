"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Case, CaseEvent } from "@/lib/store";
import type { Finding, MandateTerms } from "@/lib/mandate";
import { AGENTS, type Ledger, type LedgerEntry, type Level } from "@/lib/ledger";
import { LISTINGS, MERCHANTS } from "@/lib/catalog";

type Config = { paypal: boolean; claude: boolean };
type Overview = { cases: Case[]; config: Config; ledger: Ledger; sampleHistory: boolean };
type Mode = keyof typeof AGENTS;
type Tone = "neutral" | "info" | "good" | "warn" | "bad";

const BUYERS = ["demo-buyer", "buyer-riya"];
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
  { label: "Not what I asked for", text: "This is not what I asked for. I set an $80 limit and said no protection plans." },
  { label: "I never authorised this", text: "I never authorised this purchase. I want my money back." },
  { label: "It never arrived", text: "The package never arrived." },
];

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-indigo-50 text-indigo-700",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-rose-50 text-rose-700",
};
const DOT: Record<Tone, string> = {
  neutral: "bg-slate-400",
  info: "bg-indigo-500",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
};

const STATUS: Record<Case["status"], { label: string; tone: Tone }> = {
  MANDATE_SIGNED: { label: "Ready for the agent", tone: "neutral" },
  BLOCKED_BY_GATE: { label: "Blocked before payment", tone: "warn" },
  AWAITING_PAYER_APPROVAL: { label: "Waiting for payment", tone: "info" },
  PAID: { label: "Paid", tone: "info" },
  REFUNDED: { label: "Buyer refunded", tone: "good" },
  MERCHANT_PROTECTED: { label: "Merchant protected", tone: "good" },
  ESCALATED: { label: "Needs a person", tone: "warn" },
};

const ACTOR: Record<CaseEvent["actor"], { label: string; dot: string; text: string }> = {
  buyer: { label: "Buyer", dot: "bg-sky-500", text: "text-sky-700" },
  agent: { label: "Agent", dot: "bg-violet-500", text: "text-violet-700" },
  recourse: { label: "Recourse", dot: "bg-slate-900", text: "text-slate-900" },
  paypal: { label: "PayPal", dot: "bg-blue-600", text: "text-blue-700" },
  merchant: { label: "Merchant", dot: "bg-teal-500", text: "text-teal-700" },
};

// Events worth a second look get a tinted row in the timeline.
const EVENT_TONE: Record<string, Tone> = {
  followed_hidden_instruction: "bad",
  agent_failed: "bad",
  capture_failed: "bad",
  gate_blocked: "warn",
  gate_forced: "warn",
  gate_passed: "good",
  payment_captured: "good",
  refund_issued: "good",
  dispute_claim_accepted: "good",
  evidence_packet: "good",
  verdict: "info",
};

const CHECK_LABEL: Record<string, string> = {
  signature: "Mandate signature",
  price_cap: "Price cap",
  currency: "Currency",
  quantity: "Quantity",
  merchant: "Merchant",
  validity_window: "Time window",
};
const CLAIM_LABEL: Record<string, string> = {
  unauthorized: "Buyer says they never authorised it",
  wrong_item: "Buyer says it is the wrong item",
  not_received: "Buyer says it never arrived",
  other: "Another kind of complaint",
};
const LEVEL_TONE: Record<Level, Tone> = { ok: "good", watch: "warn", flagged: "bad" };

const STEPS = ["Mandate signed", "Agent shops", "Buyer pays", "Complaint", "Outcome"];

const usd = (n: number) => `$${n.toFixed(2)}`;
const list = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const merchantName = (id: string) => MERCHANTS[id as keyof typeof MERCHANTS] ?? id;

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
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [sampleHistory, setSampleHistory] = useState(false);
  const [tab, setTab] = useState<"cases" | "ledger">("cases");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("case"));
  const [request, setRequest] = useState(DEMO_REQUEST);
  const [terms, setTerms] = useState<MandateTerms | null>(null);
  const [buyer, setBuyer] = useState(BUYERS[0]);
  const [mode, setMode] = useState<Mode>("claude");
  const [gate, setGate] = useState(false);
  const [complaint, setComplaint] = useState(COMPLAINTS[0].text);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const flagged = ledger ? [...ledger.agents, ...ledger.buyers, ...ledger.merchants].filter((e) => e.level === "flagged").length : 0;
  const agentFlagged = ledger?.agents.some((a) => a.id === AGENTS[mode].id && a.level === "flagged") ?? false;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-white"><Icon name="shield" size={18} /></span>
            <div>
              <h1 className="text-lg font-semibold leading-tight tracking-tight">Recourse</h1>
              <p className="text-xs text-slate-500">Buyer and seller protection for purchases made by AI agents</p>
            </div>
          </div>
          <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <TabButton active={tab === "cases"} onClick={() => setTab("cases")}>Cases</TabButton>
            <TabButton active={tab === "ledger"} onClick={() => setTab("ledger")}>
              Trust ledger
              {flagged > 0 && <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 text-xs font-medium text-rose-700">{flagged} flagged</span>}
            </TabButton>
          </nav>
          {config && (
            <div className="flex gap-4 text-xs text-slate-600">
              <Connection ok={config.paypal} on="PayPal sandbox" off="PayPal keys missing" />
              <Connection ok={config.claude} on="Claude" off="Claude key missing" />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span className="mt-0.5"><Icon name="alert" /></span>
            <p className="flex-1">{error}</p>
            <button className="text-rose-600 hover:text-rose-900" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {tab === "ledger" && ledger && (
          <LedgerView ledger={ledger} sampleHistory={sampleHistory} busy={!!busy} onToggle={(on) => run("sample", async () => { await api("/api/ledger", { sampleHistory: on }); })} />
        )}

        {tab === "cases" && (
          <div className="grid gap-6 lg:grid-cols-[21rem_1fr]">
            <aside className="space-y-5">
              <section className="card">
                <Eyebrow>New purchase</Eyebrow>
                <label className="mt-2 block text-sm font-medium text-slate-900" htmlFor="request">What should the agent buy?</label>
                <p className="text-xs text-slate-500">Say it in your own words, including your budget.</p>
                <textarea id="request" className="input mt-2 h-24 resize-none" value={request} onChange={(e) => setRequest(e.target.value)} />
                <div className="mt-2 flex gap-2">
                  <button className="btn flex-1" disabled={!!busy || !request.trim()} onClick={() => run("draft", async () => {
                    const data = await api<{ terms: MandateTerms }>("/api/mandates/draft", { request });
                    setTerms(data.terms);
                  })}>
                    {busy === "draft" ? "Drafting…" : "Draft the mandate"}
                  </button>
                  <button className="btn-ghost" disabled={!!busy} onClick={() => { setRequest(DEMO_REQUEST); setTerms(DEMO_TERMS); }}>Use demo</button>
                </div>

                {terms && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <p className="text-sm font-medium text-slate-900">Review the limits, then sign</p>
                    <p className="mb-3 text-xs text-slate-500">These are the only rules the agent may spend under.</p>
                    <Field name="What may be bought">
                      <input className="input" value={terms.itemDescription} onChange={(e) => setTerms({ ...terms, itemDescription: e.target.value })} />
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
                    <Field name="Must have (comma separated)">
                      <input className="input" value={terms.mustHave.join(", ")} onChange={(e) => setTerms({ ...terms, mustHave: list(e.target.value) })} />
                    </Field>
                    <Field name="Must not have">
                      <input className="input" value={terms.mustNotHave.join(", ")} onChange={(e) => setTerms({ ...terms, mustNotHave: list(e.target.value) })} />
                    </Field>
                    <Field name="Allowed shops (empty means any)">
                      <input className="input" value={terms.allowedMerchants.join(", ")} placeholder="soundhouse, gadgetbarn" onChange={(e) => setTerms({ ...terms, allowedMerchants: list(e.target.value) })} />
                    </Field>
                    <Field name="Signing as">
                      <select className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                        {BUYERS.map((b) => <option key={b}>{b}</option>)}
                      </select>
                    </Field>
                    <button className="btn mt-1 w-full" disabled={!!busy} onClick={() => run("sign", async () => {
                      const data = await api<{ case: Case }>("/api/mandates", { terms: { ...terms, intent: request }, principal: buyer });
                      setSelectedId(data.case.id);
                      setTerms(null);
                    })}>
                      <Icon name="lock" /> Sign mandate
                    </button>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="flex items-center justify-between">
                  <Eyebrow>Cases</Eyebrow>
                  {cases.length > 0 && (
                    <button className="text-xs text-slate-500 hover:text-slate-900" disabled={!!busy} onClick={() => run("reset", async () => { await api("/api/cases", undefined, "DELETE"); setSelectedId(null); })}>Clear all</button>
                  )}
                </div>
                {cases.length === 0 && <p className="mt-2 text-sm text-slate-500">No cases yet. Sign a mandate to open one.</p>}
                <ul className="mt-2 space-y-1">
                  {cases.map((c) => {
                    const active = selected?.id === c.id;
                    return (
                      <li key={c.id}>
                        <button onClick={() => setSelectedId(c.id)} className={`w-full rounded-lg border px-3 py-2 text-left transition ${active ? "border-slate-900 bg-slate-50" : "border-transparent hover:bg-slate-50"}`}>
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[STATUS[c.status].tone]}`} />
                            {STATUS[c.status].label}
                            {c.purchase && <span className="ml-auto font-normal text-slate-500">{usd(c.purchase.total)}</span>}
                          </span>
                          <span className="mt-0.5 block truncate pl-4 text-xs text-slate-500">
                            {c.mandate.principal} · cap {usd(c.mandate.maxTotal)}{c.agentMode ? ` · ${AGENTS[c.agentMode].id}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </aside>

            <section className="min-w-0 space-y-5">
              {!selected && <HowItWorks />}
              {selected && (
                <>
                  <CaseHeader c={selected} />

                  {selected.status === "MANDATE_SIGNED" && (
                    <NextStep step="Step 2" title="Send an agent shopping" hint="The agent browses the demo store and asks PayPal for an order. Pick which agent to send.">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <AgentOption active={mode === "claude"} onClick={() => setMode("claude")} name={AGENTS.claude.name} note="Treats listing text as product information, never as instructions." />
                        <AgentOption active={mode === "compromised"} onClick={() => setMode("compromised")} name={AGENTS.compromised.name} note="Obeys hidden text planted in a listing. Shows what a tricked agent does." />
                      </div>
                      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-sm">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-slate-900" checked={gate || agentFlagged} disabled={agentFlagged} onChange={(e) => setGate(e.target.checked)} />
                        <span>
                          <span className="font-medium text-slate-900">Pre-payment gate</span>
                          <span className="block text-xs text-slate-500">
                            {agentFlagged
                              ? "Forced on: the trust ledger has flagged this agent for mandate breaches."
                              : "Check the order against the mandate before PayPal creates it. Off shows what happens with no gate."}
                          </span>
                        </span>
                      </label>
                      <button className="btn mt-3" disabled={!!busy} onClick={() => run("agent", async () => { await api("/api/agent", { caseId: selected.id, mode, gate }); })}>
                        {busy === "agent" ? "Agent is shopping…" : "Run the agent"}
                      </button>
                    </NextStep>
                  )}

                  {selected.status === "AWAITING_PAYER_APPROVAL" && selected.approveUrl && (
                    <NextStep step="Step 3" title="Approve the payment in PayPal" hint={`The agent placed an order for ${usd(selected.purchase?.total ?? 0)}. Log in as the sandbox buyer to approve; PayPal then captures the money and sends you back here.`}>
                      <a className="btn" href={selected.approveUrl}>Approve in PayPal sandbox <Icon name="arrow" /></a>
                    </NextStep>
                  )}

                  {selected.status === "PAID" && (
                    <NextStep step="Step 4" title="Something goes wrong" hint="Play both sides: the shop can register a shipment, and the buyer can complain.">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 p-3">
                          <p className="text-sm font-medium text-slate-900">Shop</p>
                          <p className="mb-2 text-xs text-slate-500">Registers tracking with PayPal for this order.</p>
                          <div className="flex flex-wrap gap-2">
                            <button className="btn-ghost" disabled={!!busy} onClick={() => run("ship", async () => { await api("/api/ship", { caseId: selected.id, status: "SHIPPED" }); })}>Mark as shipped</button>
                            <button className="btn-ghost" disabled={!!busy} onClick={() => run("ship", async () => { await api("/api/ship", { caseId: selected.id, status: "DELIVERED" }); })}>Mark as delivered</button>
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3">
                          <p className="text-sm font-medium text-slate-900">Buyer</p>
                          <p className="mb-2 text-xs text-slate-500">Files a complaint. Recourse decides and acts through PayPal.</p>
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {COMPLAINTS.map((c) => (
                              <button key={c.label} onClick={() => setComplaint(c.text)} className={`rounded-full border px-2.5 py-1 text-xs transition ${complaint === c.text ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>{c.label}</button>
                            ))}
                          </div>
                          <textarea className="input h-16 resize-none" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
                          <button className="btn mt-2" disabled={!!busy || !complaint.trim()} onClick={() => run("resolve", async () => { await api("/api/complaints", { caseId: selected.id, complaint }); })}>
                            {busy === "resolve" ? "Reviewing the case…" : "File complaint"}
                          </button>
                        </div>
                      </div>
                      <button className="mt-3 text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline" disabled={!!busy} onClick={() => run("disputes", async () => { await api("/api/disputes"); })}>
                        Or pull disputes opened in PayPal&apos;s Resolution Center
                      </button>
                    </NextStep>
                  )}

                  <AgentWork c={selected} />
                  <Outcome c={selected} />
                  <Timeline events={selected.events} />
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Case header: the request, the limits, and where the case stands ---

function CaseHeader({ c }: { c: Case }) {
  const m = c.mandate;
  const final = c.status === "REFUNDED" || c.status === "MERCHANT_PROTECTED" || c.status === "ESCALATED";
  const blocked = c.status === "BLOCKED_BY_GATE";
  const done = final ? 5 : c.status === "PAID" ? 3 : c.status === "AWAITING_PAYER_APPROVAL" ? 2 : 1;
  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>The buyer asked</Eyebrow>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[STATUS[c.status].tone]}`}>{STATUS[c.status].label}</span>
      </div>
      <p className="mt-2 text-xl font-medium leading-snug text-slate-900">“{m.intent}”</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip strong>Up to {usd(m.maxTotal)}</Chip>
        <Chip>{m.maxQuantity} unit{m.maxQuantity === 1 ? "" : "s"}</Chip>
        {m.mustHave.map((x) => <Chip key={`h-${x}`}>Must be {x}</Chip>)}
        {m.mustNotHave.map((x) => <Chip key={`n-${x}`} tone="bad">No {x}</Chip>)}
        <Chip>{m.allowedMerchants.length ? `Only ${m.allowedMerchants.join(", ")}` : "Any shop"}</Chip>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1 text-emerald-700"><Icon name="lock" /> Signed by {m.principal}</span>
        <span className="font-mono" title={m.signature}>{m.signature.slice(0, 16)}…</span>
        <span>· valid until {new Date(m.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
        <span className="font-mono">· {c.id}</span>
      </p>

      <ol className="mt-5 grid grid-cols-5 gap-2">
        {STEPS.map((step, i) => {
          const state = blocked ? (i === 0 ? "done" : i === 1 ? "stopped" : "skipped") : i < done ? "done" : i === done ? "current" : "todo";
          const bar = state === "done" ? "bg-slate-900" : state === "current" ? "bg-indigo-500" : state === "stopped" ? "bg-amber-500" : "bg-slate-200";
          return (
            <li key={step}>
              <span className={`block h-1.5 rounded-full ${bar}`} />
              <span className={`mt-1.5 block text-xs ${state === "todo" || state === "skipped" ? "text-slate-400" : "font-medium text-slate-900"}`}>
                {i + 1}. {state === "stopped" ? "Blocked here" : step}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --- Outcome: what was decided, who was at fault, and the evidence ---

function Outcome({ c }: { c: Case }) {
  const total = c.purchase ? usd(c.purchase.total) : "";

  if (c.status === "BLOCKED_BY_GATE") {
    const failed = (c.events.find((e) => e.type === "gate_blocked")?.data ?? []) as Finding[];
    return (
      <section className="card border-amber-300">
        <Eyebrow>Outcome</Eyebrow>
        <div className="mt-2"><Banner tone="warn" icon="shield" title="Order blocked before payment" text={`The agent asked for a ${total} order that breaks the mandate. Recourse refused it, so no money moved.`} /></div>
        <ul className="mt-3 space-y-1.5">{failed.map((f) => <CheckRow key={f.check} f={f} />)}</ul>
      </section>
    );
  }

  const r = c.resolution;
  if (!r) return null;
  const banner =
    r.verdict.outcome === "REFUND_BUYER"
      ? { tone: "good" as Tone, icon: "check" as IconName, title: `Buyer refunded ${total}`, border: "border-emerald-300" }
      : r.verdict.outcome === "MERCHANT_PROTECTED"
        ? { tone: "info" as Tone, icon: "shield" as IconName, title: `Merchant keeps the ${total}`, border: "border-indigo-300" }
        : { tone: "warn" as Tone, icon: "alert" as IconName, title: "Sent to a person to decide", border: "border-amber-300" };
  const fault = { agent: "The agent", merchant: "The shop", buyer: "The buyer", undetermined: "Not determined" }[r.verdict.liableParty];

  return (
    <section className={`card ${banner.border}`}>
      <Eyebrow>Outcome</Eyebrow>
      <div className="mt-2"><Banner tone={banner.tone} icon={banner.icon} title={banner.title} text={r.verdict.headline} /></div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Fact name="At fault">{fault}</Fact>
        <Fact name="Complaint">“{r.complaint}”</Fact>
        <Fact name={r.refundId ? "PayPal refund" : "Shipment"}>
          {r.refundId ? <span className="font-mono text-xs">{r.refundId}</span> : r.shipment ? `${r.shipment.status.toLowerCase()} · ${r.shipment.trackingNumber}` : "None on record"}
        </Fact>
      </dl>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-slate-900">Rule checks</p>
          <p className="mb-2 text-xs text-slate-500">Fixed rules. No model is involved.</p>
          <ul className="space-y-1.5">{r.findings.map((f) => <CheckRow key={f.check} f={f} />)}</ul>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">AI review</p>
          <p className="mb-2 text-xs text-slate-500">Claude answers two questions only.</p>
          {r.semantic ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p><span className="text-slate-500">What is claimed: </span>{CLAIM_LABEL[r.semantic.claim]}</p>
              <p><span className="text-slate-500">Item matches the request: </span><b>{r.semantic.matchesIntent ? "yes" : "no"}</b></p>
              <div>
                <div className="flex justify-between text-xs text-slate-500"><span>Confidence</span><span>{Math.round(r.semantic.confidence * 100)}%</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 rounded-full bg-slate-900" style={{ width: `${Math.round(r.semantic.confidence * 100)}%` }} /></div>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">{r.semantic.reasoning}</p>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">The review was unavailable, so nothing was decided automatically.</p>
          )}
        </div>
      </div>

      {r.verdict.reasons.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-900">Why</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">{r.verdict.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      {r.evidencePacket != null && (
        <details className="mt-4 rounded-lg border border-slate-200 text-sm">
          <summary className="cursor-pointer px-3 py-2 font-medium text-slate-900">Evidence packet for the shop</summary>
          <pre className="max-h-72 overflow-auto rounded-b-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(r.evidencePacket, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

// --- What the agent saw and chose in the store ---

function AgentWork({ c }: { c: Case }) {
  if (!c.agentMode) return null;
  const searched = c.events.some((e) => e.type === "search_store");
  const opened = new Set(c.events.filter((e) => e.type === "view_listing").map((e) => /listing (\S+):/.exec(e.summary)?.[1]));
  const ordered = new Set(c.purchase?.items.map((i) => i.name));
  const obeyed = c.events.some((e) => e.type === "followed_hidden_instruction");

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>What the agent did in the store</Eyebrow>
        <span className="text-xs text-slate-500">{AGENTS[c.agentMode].name}</span>
      </div>
      <div className="mt-3 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LISTINGS.map((l) => {
          const chosen = ordered.has(l.name);
          const over = l.price > c.mandate.maxTotal;
          return (
            <div key={l.sku} className={`flex flex-col rounded-lg border p-3 text-sm ${chosen ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"} ${!searched ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap gap-1">
                {chosen && <Tag tone={c.status === "BLOCKED_BY_GATE" ? "warn" : "info"}>{c.status === "BLOCKED_BY_GATE" ? "Tried to order" : "Ordered"}</Tag>}
                {!chosen && opened.has(l.sku) && <Tag tone="neutral">Opened</Tag>}
                {!chosen && !opened.has(l.sku) && searched && <Tag tone="neutral">Seen in search</Tag>}
              </div>
              <p className="mt-1.5 font-medium leading-snug text-slate-900">{l.name}</p>
              <p className="text-xs text-slate-500">{merchantName(l.merchantId)}</p>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                <span className="text-base font-semibold">{usd(l.price)}</span>
                {over && <span className="text-xs font-medium text-rose-600">over the {usd(c.mandate.maxTotal)} cap</span>}
              </p>
              {l.hiddenText && (
                <div className="mt-2 rounded-md border border-dashed border-rose-300 bg-rose-50 p-2">
                  <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700"><Icon name="alert" /> Hidden text only agents can read</p>
                  <p className="mt-1 text-xs leading-relaxed text-rose-900">{l.hiddenText}</p>
                  {chosen && <p className="mt-1 text-xs font-medium text-rose-700">{obeyed ? "The agent obeyed it." : "The agent ordered this anyway."}</p>}
                  {!chosen && c.purchase && <p className="mt-1 text-xs font-medium text-emerald-700">The agent ignored it.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {c.agentSummary && (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <span className="font-medium text-slate-900">Agent&apos;s report: </span>
          {c.agentSummary.replaceAll("**", "")}
        </p>
      )}
    </section>
  );
}

// --- Flight recorder ---

function Timeline({ events }: { events: CaseEvent[] }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Flight recorder</Eyebrow>
        <span className="text-xs text-slate-500">{events.length} events, in order</span>
      </div>
      <ol className="mt-3">
        {events.map((e, i) => {
          const actor = ACTOR[e.actor];
          const tone = EVENT_TONE[e.type];
          return (
            <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {i < events.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />}
              <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-white ${actor.dot}`} />
              <div className={`min-w-0 flex-1 rounded-md px-2 py-1 text-sm ${tone ? TONE[tone] : ""}`}>
                <span className={`mr-2 text-xs font-semibold ${actor.text}`}>{actor.label}</span>
                <span className="text-slate-800">{e.summary}</span>
                <span className="ml-2 whitespace-nowrap font-mono text-[11px] text-slate-400">{clock(e.at)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --- Trust ledger tab ---

function LedgerView({ ledger, sampleHistory, busy, onToggle }: { ledger: Ledger; sampleHistory: boolean; busy: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-slate-900">Trust ledger</h2>
          <p className="text-sm text-slate-600">A track record built from how cases ended. Each mark is a plain count, and each one changes what Recourse does next.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={sampleHistory} disabled={busy} onChange={(e) => onToggle(e.target.checked)} />
          Include sample history
        </label>
      </section>
      <div className="grid gap-5 md:grid-cols-3">
        <LedgerColumn title="Agents" hint="Do they stay inside the mandate?" entries={ledger.agents} />
        <LedgerColumn title="Buyers" hint="Do their complaints hold up?" entries={ledger.buyers} />
        <LedgerColumn title="Shops" hint="Do their listings and deliveries hold up?" entries={ledger.merchants} />
      </div>
      {sampleHistory && <p className="text-xs text-slate-500">Rows marked “sample” come from illustrative past cases, not from PayPal. Unmarked rows include cases run here.</p>}
    </div>
  );
}

function LedgerColumn({ title, hint, entries }: { title: string; hint: string; entries: LedgerEntry[] }) {
  return (
    <section className="card">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500">{hint}</p>
      {entries.length === 0 && <p className="mt-3 text-sm text-slate-500">Nothing on record yet.</p>}
      <ul className="mt-3 space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${DOT[LEVEL_TONE[e.level]]}`} />
              <span className="font-medium text-slate-900">{e.name}</span>
              <Tag tone={LEVEL_TONE[e.level]}>{e.level}</Tag>
              {e.sampleOnly && <Tag tone="neutral">sample</Tag>}
            </div>
            <p className="mt-1 text-xs text-slate-500">{e.facts.join(" · ")}</p>
            <p className="mt-2 text-slate-700">{e.reason}</p>
            {e.level !== "ok" && <p className={`mt-2 rounded-md px-2 py-1.5 text-xs ${TONE[LEVEL_TONE[e.level]]}`}><b>Effect: </b>{e.consequence}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Small pieces ---

function HowItWorks() {
  const steps = [
    { title: "Sign a mandate", text: "Say what you want in plain words. Recourse turns it into signed limits: item, price cap, quantity, shop." },
    { title: "An agent shops and pays", text: "The agent browses the store and pays through PayPal. Every step it takes is recorded." },
    { title: "Recourse settles disputes", text: "If something goes wrong, it checks the order against the mandate, then refunds the buyer or protects the shop." },
  ];
  return (
    <section className="card">
      <Eyebrow>How it works</Eyebrow>
      <h2 className="mt-2 text-xl font-medium text-slate-900">When an AI agent buys the wrong thing, who pays?</h2>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-slate-200 p-4">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-sm font-medium text-white">{i + 1}</span>
            <p className="mt-2 font-medium text-slate-900">{s.title}</p>
            <p className="mt-1 text-sm text-slate-600">{s.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-slate-600">Start on the left: click <b>Use demo</b>, then <b>Sign mandate</b>.</p>
    </section>
  );
}

function NextStep({ step, title, hint, children }: { step: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="card border-indigo-300 ring-1 ring-indigo-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Next · {step}</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mb-3 text-sm text-slate-600">{hint}</p>
      {children}
    </section>
  );
}

function AgentOption({ active, onClick, name, note }: { active: boolean; onClick: () => void; name: string; note: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-lg border p-3 text-left text-sm transition ${active ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : "border-slate-200 hover:bg-slate-50"}`}>
      <span className="flex items-center gap-2 font-medium text-slate-900">
        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? "border-slate-900" : "border-slate-300"}`}>{active && <span className="h-2 w-2 rounded-full bg-slate-900" />}</span>
        {name}
      </span>
      <span className="mt-1 block pl-6 text-xs text-slate-500">{note}</span>
    </button>
  );
}

function Banner({ tone, icon, title, text }: { tone: Tone; icon: IconName; title: string; text: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg p-4 ${TONE[tone]}`}>
      <span className="mt-0.5"><Icon name={icon} size={20} /></span>
      <div>
        <p className="text-lg font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 text-sm opacity-90">{text}</p>
      </div>
    </div>
  );
}

function CheckRow({ f }: { f: Finding }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-white ${f.pass ? "bg-emerald-500" : "bg-rose-500"}`}><Icon name={f.pass ? "check" : "cross"} size={10} /></span>
      <span>
        <span className="font-medium text-slate-900">{CHECK_LABEL[f.check] ?? f.check}</span>
        <span className="block text-xs text-slate-500">{f.detail}</span>
      </span>
    </li>
  );
}

function Fact({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{name}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</p>;
}

function Chip({ children, strong, tone }: { children: React.ReactNode; strong?: boolean; tone?: "bad" }) {
  const style = strong ? "bg-slate-900 text-white" : tone === "bad" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{children}</span>;
}

function Tag({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-md px-3 py-1.5 font-medium transition ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{children}</button>
  );
}

function Connection({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      {ok ? on : off}
    </span>
  );
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs font-medium text-slate-600">
      {name}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

type IconName = "shield" | "lock" | "check" | "cross" | "alert" | "arrow";
const ICON_PATHS: Record<IconName, string> = {
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z",
  lock: "M7 11V8a5 5 0 0110 0v3m-11 0h12v9H6v-9z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6L6 18",
  alert: "M12 9v4m0 3.5v.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  arrow: "M5 12h14m-6-6l6 6-6 6",
};

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "check" || name === "cross" ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
