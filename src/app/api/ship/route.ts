import { handle } from "@/lib/http";
import { callPayPal } from "@/lib/paypal";
import { getCase, record } from "@/lib/store";

// The merchant registers shipment tracking with PayPal for a paid order.
export const POST = handle(async (request) => {
  const { caseId, status } = (await request.json()) as { caseId?: string; status?: string };
  const current = caseId ? getCase(caseId) : undefined;
  if (!current?.orderId || !current.captureId) {
    return Response.json({ error: "Only a paid order can be shipped." }, { status: 400 });
  }
  if (current.events.some((e) => e.type === "shipment_registered" && e.summary.includes("(DELIVERED)"))) {
    return Response.json({ error: "This order is already registered as delivered." }, { status: 409 });
  }
  const trackingNumber = `RC${Date.now()}`;
  const shipmentStatus = status === "DELIVERED" ? "DELIVERED" : "SHIPPED";
  const result = await callPayPal("create_shipment_tracking", {
    order_id: current.orderId,
    transaction_id: current.captureId,
    tracking_number: trackingNumber,
    carrier: "UPS",
    status: shipmentStatus,
  });
  record(current.id, "merchant", "shipment_registered", `Merchant registered tracking ${trackingNumber} (${shipmentStatus}) with PayPal.`, result);
  return Response.json({ case: getCase(current.id) });
});
