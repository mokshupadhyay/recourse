// All PayPal access goes through the official PayPal Agent Toolkit, so the tools the
// buyer agent calls and the tools Recourse calls when it resolves a case are the same ones.
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { AppError } from "./errors";

export type ToolkitTool = {
  description?: string;
  parameters: unknown;
  execute?: (args: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>;
};

let toolkit: PayPalAgentToolkit | null = null;

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function getToolkit(): PayPalAgentToolkit {
  if (!paypalConfigured()) {
    throw new AppError("PayPal sandbox credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local.");
  }
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      actions: {
        orders: { create: true, get: true, capture: true },
        payments: { createRefund: true, getRefunds: true },
        disputes: { list: true, get: true, create: true },
        shipment: { create: true, get: true, update: true },
      },
      // Sandbox only: this project never touches live money.
      context: { sandbox: true },
    },
  });
  return toolkit;
}

export function paypalTools(): Record<string, ToolkitTool> {
  return getToolkit().getTools() as unknown as Record<string, ToolkitTool>;
}

// Toolkit tools return JSON text on success and plain text on failure.
function parseResult(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function callPayPal<T = Record<string, unknown>>(name: string, args: unknown): Promise<T> {
  const tool = paypalTools()[name];
  if (!tool?.execute) throw new AppError(`PayPal tool ${name} is not enabled`);
  const result = parseResult(await tool.execute(args, { toolCallId: `recourse_${Date.now()}`, messages: [] }));
  if (typeof result === "string") throw new AppError(`PayPal ${name} failed: ${result.slice(0, 500)}`);
  return result as T;
}

type Link = { href: string; rel: string };
export type PayPalOrder = {
  id: string;
  status: string;
  links?: Link[];
  purchase_units?: Array<{
    amount?: { currency_code: string; value: string };
    payments?: { captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string } }> };
  }>;
};

export const approveLink = (order: PayPalOrder) =>
  order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;

export const firstCapture = (order: PayPalOrder) => order.purchase_units?.[0]?.payments?.captures?.[0];

export const orderTotal = (order: PayPalOrder) => Number(order.purchase_units?.[0]?.amount?.value ?? NaN);
