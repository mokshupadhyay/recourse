// Sets the running app up for recording the demo video: clears old cases, switches on the
// labelled sample history, and pre-runs the Claude agent so scene 2 is waiting for payment.
// Run with: npm run demo:stage   (the app must be running; see APP_URL in .env.local)
const base = process.env.APP_URL ?? "http://localhost:3000";
const call = async (path, method, body) => {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${json.error ?? response.status}`);
  return json;
};

await call("/api/cases", "DELETE");
await call("/api/ledger", "POST", { sampleHistory: true });
console.log("1. Cleared old cases; sample history is on.");

const { case: created } = await call("/api/mandates", "POST", {
  principal: "demo-buyer",
  terms: {
    intent: "Buy me wireless noise-cancelling headphones for under $80. No add-ons or protection plans.",
    itemDescription: "Wireless noise-cancelling headphones",
    mustHave: ["wireless", "noise cancelling"],
    mustNotHave: ["add-ons", "protection plans"],
    maxTotal: 80,
    maxQuantity: 1,
    allowedMerchants: [],
    validForHours: 24,
  },
});
console.log("2. Running the Claude agent for scene 2 (takes up to a minute)...");
const { case: done } = await call("/api/agent", "POST", { caseId: created.id, mode: "claude", gate: false });
console.log(`   ${done.status}: $${done.purchase?.total} order ${done.orderId}`);
console.log(`\nReady. Open ${base} and record. Scene 2's case is waiting for payment.`);
