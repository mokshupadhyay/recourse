import { callPayPal, firstCapture, type PayPalOrder } from "@/lib/paypal";
import { findCaseByOrder, record, updateCase } from "@/lib/store";

// PayPal sends the buyer back here after they approve the order in the sandbox.
// We capture the payment, then return to the dashboard.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("token");
  const current = orderId ? findCaseByOrder(orderId) : undefined;
  if (!current || !orderId) return Response.redirect(new URL("/?error=unknown_order", url.origin));

  try {
    if (current.status === "AWAITING_PAYER_APPROVAL") {
      record(current.id, "buyer", "payer_approved", "Buyer's PayPal wallet approved the payment.");
      const paid = await callPayPal<PayPalOrder>("pay_order", { id: orderId });
      // The capture response can omit payment details; the order itself always has them.
      const capture = firstCapture(paid) ?? firstCapture(await callPayPal<PayPalOrder>("get_order", { id: orderId }));
      updateCase(current.id, (c) => {
        c.captureId = capture?.id;
        c.status = "PAID";
      });
      record(current.id, "paypal", "payment_captured", `PayPal captured $${capture?.amount.value ?? "?"} (capture ${capture?.id ?? "unknown"}).`, {
        captureId: capture?.id,
        status: capture?.status,
      });
    }
  } catch (error) {
    record(current.id, "paypal", "capture_failed", error instanceof Error ? error.message.slice(0, 300) : String(error));
  }
  return Response.redirect(new URL(`/?case=${current.id}`, url.origin));
}
