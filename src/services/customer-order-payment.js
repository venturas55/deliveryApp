import jwt from "jsonwebtoken";
import {httpError} from "./http-error.js";
import {publicOrigin} from "./seo.js";
import {createRedsysPayment} from "./redsys.js";

export function canPayOrder(order) {
  return order.status !== "cancelled" &&
    ["pending", "failed"].includes(order.payment_status) && Number(order.total_cents) > 0;
}

export function orderPayment(order) {
  const origin = publicOrigin();
  if (!origin) throw httpError(503, "Pago online no disponible: PUBLIC_URL no configurado");
  return createRedsysPayment({
    order: order.redsys_order,
    amountCents: Number(order.total_cents),
    merchantUrl: `${origin}/payment/redsys/notification`,
    urlOk: `${origin}/payment/redsys/success?order=${order.id}`,
    urlKo: `${origin}/payment/redsys/error?order=${order.id}`,
  });
}

export function paymentLink(order, customerId) {
  const ticket = jwt.sign({purpose: "order-payment", orderId: String(order.id),
    customerId: String(customerId), reference: order.redsys_order}, process.env.JWT_SECRET,
    {algorithm: "HS256", expiresIn: "10m"});
  return `${publicOrigin()}/payment/redsys/order?ticket=${encodeURIComponent(ticket)}`;
}

export function verifyPaymentTicket(ticket) {
  try {
    const data = jwt.verify(ticket, process.env.JWT_SECRET, {algorithms: ["HS256"]});
    if (data.purpose !== "order-payment" || !data.orderId || !data.customerId || !data.reference) throw new Error();
    return data;
  } catch { throw httpError(401, "Enlace de pago caducado. Abre el pedido desde la app."); }
}

export function paymentForm(payment) {
  const escape = value => String(value).replace(/[&<>"']/g, char =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagar pedido</title>
    <style>body{font-family:system-ui;background:#f7f4ee;color:#392d27;padding:24px}main{max-width:420px;margin:15vh auto;background:white;padding:28px;border-radius:20px}button{background:#9d3d24;color:white;border:0;border-radius:12px;padding:16px;width:100%;font-size:16px}</style></head>
    <body><main><h1>Pagar pedido</h1><p>Completa el pago de forma segura en Redsys. Después vuelve a la app para consultar su estado.</p>
    <form method="POST" action="${escape(payment.endpoint)}">
    ${[["Ds_SignatureVersion",payment.signatureVersion],["Ds_MerchantParameters",payment.merchantParameters],["Ds_Signature",payment.signature]].map(([name,value])=>`<input type="hidden" name="${name}" value="${escape(value)}">`).join("")}
    <button type="submit">Continuar al pago seguro</button></form></main></body></html>`;
}
