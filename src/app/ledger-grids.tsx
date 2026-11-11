"use client";

// The trust ledger and the case log as AG Grid tables: sortable, filterable, searchable.
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import type { Case } from "@/lib/store";
import { AGENTS, type Ledger, type Level } from "@/lib/ledger";
import { MERCHANTS } from "@/lib/catalog";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  accentColor: "#4f46e5",
  headerBackgroundColor: "#f8fafc",
  headerFontWeight: 600,
  wrapperBorderRadius: 8,
  rowHoverColor: "#f1f5f9",
});

const PILL = {
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-rose-50 text-rose-700",
  info: "bg-indigo-50 text-indigo-700",
  neutral: "bg-slate-100 text-slate-700",
} as const;
type Tone = keyof typeof PILL;

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PILL[tone]}`}>{children}</span>;
}

const LEVEL_TONE: Record<Level, Tone> = { ok: "good", watch: "warn", flagged: "bad" };
const LEVEL_RANK: Record<Level, number> = { flagged: 0, watch: 1, ok: 2 };
const STATUS: Record<Case["status"], { label: string; tone: Tone }> = {
  MANDATE_SIGNED: { label: "Ready for the agent", tone: "neutral" },
  BLOCKED_BY_GATE: { label: "Blocked before payment", tone: "warn" },
  AWAITING_PAYER_APPROVAL: { label: "Waiting for payment", tone: "info" },
  PAID: { label: "Paid", tone: "info" },
  REFUNDED: { label: "Buyer refunded", tone: "good" },
  MERCHANT_PROTECTED: { label: "Merchant protected", tone: "good" },
  ESCALATED: { label: "Needs a person", tone: "warn" },
};
const FAULT = { agent: "Agent", merchant: "Shop", buyer: "Buyer", undetermined: "Not determined" } as const;
const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

type PartyRow = {
  key: string;
  kind: "Agent" | "Buyer" | "Shop";
  name: string;
  id: string;
  level: Level;
  orders: number;
  problems: number;
  reason: string;
  effect: string;
  source: "Live cases" | "Sample history";
};

type CaseRow = {
  id: string;
  opened: string;
  buyer: string;
  agent: string;
  shop: string;
  item: string;
  total: number | null;
  cap: number;
  status: Case["status"];
  fault: string;
  complaint: string;
  orderId: string;
  refundId: string;
};

const WRAPPED = { lineHeight: "1.45", paddingTop: "9px", paddingBottom: "9px", whiteSpace: "normal" };
const defaultColDef: ColDef = { sortable: true, filter: true, resizable: true, suppressMovable: true };

export function PartiesGrid({ ledger, search }: { ledger: Ledger; search: string }) {
  const rows = useMemo<PartyRow[]>(() => {
    const of = (kind: PartyRow["kind"], entries: Ledger["agents"]) =>
      entries.map((e) => ({
        key: `${kind}:${e.id}`,
        kind,
        name: e.name,
        id: e.id,
        level: e.level,
        orders: e.orders,
        problems: e.problems,
        reason: e.reason,
        effect: e.level === "ok" ? "No restrictions" : e.consequence,
        source: e.sampleOnly ? ("Sample history" as const) : ("Live cases" as const),
      }));
    return [...of("Agent", ledger.agents), ...of("Buyer", ledger.buyers), ...of("Shop", ledger.merchants)];
  }, [ledger]);

  const columns = useMemo<ColDef<PartyRow>[]>(
    () => [
      { field: "kind", headerName: "Type", width: 95 },
      { field: "name", headerName: "Name", flex: 1.2, minWidth: 170, wrapText: true, autoHeight: true, cellStyle: WRAPPED, tooltipField: "id" },
      {
        field: "level",
        headerName: "Standing",
        width: 135,
        sort: "asc",
        comparator: (a: Level, b: Level) => LEVEL_RANK[a] - LEVEL_RANK[b],
        cellRenderer: (p: ICellRendererParams<PartyRow, Level>) => (p.value ? <Pill tone={LEVEL_TONE[p.value]}>{p.value}</Pill> : null),
      },
      { field: "orders", headerName: "Orders", width: 105, filter: "agNumberColumnFilter" },
      { field: "problems", headerName: "Problems", width: 120, filter: "agNumberColumnFilter" },
      { field: "reason", headerName: "Why", flex: 2, minWidth: 230, wrapText: true, autoHeight: true, cellStyle: WRAPPED },
      { field: "effect", headerName: "What Recourse does", flex: 2, minWidth: 230, wrapText: true, autoHeight: true, cellStyle: WRAPPED },
      {
        field: "source",
        headerName: "Source",
        width: 140,
        cellRenderer: (p: ICellRendererParams<PartyRow, string>) => <Pill tone={p.value === "Sample history" ? "neutral" : "info"}>{p.value}</Pill>,
      },
    ],
    [],
  );

  return (
    <AgGridReact<PartyRow>
      theme={theme}
      rowData={rows}
      columnDefs={columns}
      defaultColDef={defaultColDef}
      getRowId={(p) => p.data.key}
      quickFilterText={search}
      domLayout="autoHeight"
      suppressCellFocus
      rowClassRules={{ "!bg-rose-50/40": (p) => p.data?.level === "flagged" }}
    />
  );
}

export function CasesGrid({ cases, search, onOpen }: { cases: Case[]; search: string; onOpen: (id: string) => void }) {
  const rows = useMemo<CaseRow[]>(
    () =>
      cases.map((c) => ({
        id: c.id,
        opened: c.createdAt,
        buyer: c.mandate.principal,
        agent: c.agentMode ? AGENTS[c.agentMode].name : "",
        shop: c.purchase ? (MERCHANTS[c.purchase.merchantId as keyof typeof MERCHANTS] ?? c.purchase.merchantId) : "",
        item: c.purchase?.items.map((i) => i.name).join(", ") ?? "",
        total: c.purchase?.total ?? null,
        cap: c.mandate.maxTotal,
        status: c.status,
        fault: c.status === "BLOCKED_BY_GATE" ? "Agent" : c.resolution ? FAULT[c.resolution.verdict.liableParty] : "",
        complaint: c.resolution?.complaint ?? "",
        orderId: c.orderId ?? "",
        refundId: c.resolution?.refundId ?? "",
      })),
    [cases],
  );

  const columns = useMemo<ColDef<CaseRow>[]>(
    () => [
      {
        field: "opened",
        headerName: "Opened",
        width: 150,
        sort: "desc",
        valueFormatter: (p) => new Date(p.value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      },
      {
        field: "status",
        headerName: "Outcome",
        width: 190,
        valueGetter: (p) => (p.data ? STATUS[p.data.status].label : ""),
        cellRenderer: (p: ICellRendererParams<CaseRow>) => (p.data ? <Pill tone={STATUS[p.data.status].tone}>{STATUS[p.data.status].label}</Pill> : null),
      },
      { field: "fault", headerName: "At fault", width: 115 },
      { field: "buyer", headerName: "Buyer", width: 125 },
      { field: "agent", headerName: "Agent", flex: 1, minWidth: 170 },
      { field: "shop", headerName: "Shop", width: 160 },
      { field: "item", headerName: "Item ordered", flex: 1.6, minWidth: 220, tooltipField: "item" },
      {
        field: "total",
        headerName: "Order total",
        width: 125,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => usd(p.value),
        cellClassRules: { "text-rose-600 font-semibold": (p) => typeof p.value === "number" && !!p.data && p.value > p.data.cap },
      },
      { field: "cap", headerName: "Mandate cap", width: 130, filter: "agNumberColumnFilter", valueFormatter: (p) => usd(p.value) },
      { field: "complaint", headerName: "Complaint", flex: 1.4, minWidth: 200, tooltipField: "complaint" },
      { field: "orderId", headerName: "PayPal order", width: 180, cellClass: "font-mono text-xs" },
      { field: "refundId", headerName: "PayPal refund", width: 180, cellClass: "font-mono text-xs" },
    ],
    [],
  );

  return (
    <AgGridReact<CaseRow>
      theme={theme}
      rowData={rows}
      columnDefs={columns}
      defaultColDef={defaultColDef}
      getRowId={(p) => p.data.id}
      quickFilterText={search}
      domLayout="autoHeight"
      suppressCellFocus
      onRowClicked={(e) => e.data && onOpen(e.data.id)}
      rowClass="cursor-pointer"
      overlayNoRowsTemplate="No cases yet. Sign a mandate to open one."
    />
  );
}

export function LedgerSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="input max-w-xs" placeholder="Search both tables…" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function useLedgerSearch() {
  return useState("");
}
