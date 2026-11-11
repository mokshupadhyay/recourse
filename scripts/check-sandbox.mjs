// Hour-one check: do the PayPal sandbox keys work, and can we create an order?
// Run with: npm run check:sandbox
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env.local");
  process.exit(1);
}

const toolkit = new PayPalAgentToolkit({
  clientId: PAYPAL_CLIENT_ID,
  clientSecret: PAYPAL_CLIENT_SECRET,
  configuration: {
    actions: { orders: { create: true, get: true }, disputes: { list: true } },
    context: { sandbox: true },
  },
});
const tools = toolkit.getTools();
const call = async (name, args) => {
  const raw = await tools[name].execute(args, { toolCallId: "check", messages: [] });
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const order = await call("create_order", {
  currencyCode: "USD",
  items: [{ name: "Recourse sandbox check", quantity: 1, itemCost: 1, itemTotal: 1 }],
  returnUrl: "http://localhost:3000/api/paypal/return",
  cancelUrl: "http://localhost:3000/",
});
if (typeof order === "string" || !order.id) {
  console.error("create_order failed:", order);
  process.exit(1);
}
console.log("1. create_order OK:", order.id, order.status);
console.log("   approve link:", order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href);

const disputes = await call("list_disputes", {});
console.log("2. list_disputes:", typeof disputes === "string" ? `FAILED: ${disputes.slice(0, 300)}` : `OK (${disputes.items?.length ?? 0} disputes)`);
console.log("\nNext: start the app (npm run dev), run a purchase, approve it as the sandbox buyer,");
console.log("then check whether that buyer can open a dispute at https://www.sandbox.paypal.com/resolutioncenter");
