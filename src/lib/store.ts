// Case storage: one JSON file under .data/. Enough for a demo on a single long-running
// server; swap for a database before running more than one instance.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Finding, Mandate, PurchaseFacts } from "./mandate";
import type { SemanticReview, Shipment, Verdict } from "./verdict";
import { AppError } from "./errors";

export type Actor = "buyer" | "agent" | "recourse" | "paypal" | "merchant";

export type CaseEvent = {
  at: string;
  actor: Actor;
  type: string;
  summary: string;
  data?: unknown;
};

export type CaseStatus =
  | "MANDATE_SIGNED"
  | "BLOCKED_BY_GATE"
  | "AWAITING_PAYER_APPROVAL"
  | "PAID"
  | "REFUNDED"
  | "MERCHANT_PROTECTED"
  | "ESCALATED";

export type Resolution = {
  at: string;
  complaint: string;
  findings: Finding[];
  semantic: SemanticReview | null;
  shipment: Shipment;
  verdict: Verdict;
  refundId?: string;
  evidencePacket?: unknown;
};

export type Case = {
  id: string;
  createdAt: string;
  status: CaseStatus;
  mandate: Mandate;
  agentMode?: "claude" | "compromised";
  gate?: boolean;
  purchase?: PurchaseFacts;
  orderId?: string;
  approveUrl?: string;
  captureId?: string;
  disputeId?: string;
  agentSummary?: string;
  resolution?: Resolution;
  events: CaseEvent[];
};

const FILE = path.join(process.cwd(), ".data", "recourse.json");

function readAll(): Case[] {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Case[];
  } catch {
    return [];
  }
}

function writeAll(cases: Case[]) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cases, null, 2));
  renameSync(tmp, FILE);
}

export function listCases(): Case[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCase(id: string): Case | undefined {
  return readAll().find((c) => c.id === id);
}

export function findCaseByOrder(orderId: string): Case | undefined {
  return readAll().find((c) => c.orderId === orderId);
}

export function createCase(mandate: Mandate): Case {
  const created: Case = {
    id: `case_${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    status: "MANDATE_SIGNED",
    mandate,
    events: [],
  };
  writeAll([...readAll(), created]);
  return created;
}

// Re-reads the file on every write so parallel requests do not overwrite each other's events.
export function updateCase(id: string, change: (c: Case) => void): Case {
  const cases = readAll();
  const found = cases.find((c) => c.id === id);
  if (!found) throw new AppError(`Case ${id} not found`);
  change(found);
  writeAll(cases);
  return found;
}

export function record(id: string, actor: Actor, type: string, summary: string, data?: unknown): void {
  updateCase(id, (c) => {
    c.events.push({ at: new Date().toISOString(), actor, type, summary, data });
  });
}

export function resetAll() {
  writeAll([]);
}

// Whether the trust ledger includes the labelled sample history (see ledger.ts).
const SETTINGS = path.join(process.cwd(), ".data", "settings.json");

export function sampleHistoryOn(): boolean {
  try {
    return Boolean((JSON.parse(readFileSync(SETTINGS, "utf8")) as { sampleHistory?: boolean }).sampleHistory);
  } catch {
    return false;
  }
}

export function setSampleHistory(on: boolean) {
  mkdirSync(path.dirname(SETTINGS), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify({ sampleHistory: on }));
}
