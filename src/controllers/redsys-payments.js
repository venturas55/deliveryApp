import { query, transaction } from "../db.js";

/**
 * Asocia una referencia Redsys a un pedido que acaba
 * de iniciar un pago online.
 */
export async function setRedsysPaymentPending(orderId, redsysOrder) {

  const result = await query(
    `UPDATE orders
     SET redsys_order = ?,
         payment_status = 'pending'
     WHERE id = ?
       AND payment_method = 'online'`,
    [redsysOrder, orderId]
  );

  if (result.affectedRows !== 1) {
    throw new Error(
      `No se pudo asociar el pago Redsys al pedido ${orderId}`
    );
  }
}

export async function processRedsysNotification({
  redsysOrder,
  amountCents,
  currency,
  response,
  authorizationCode
}) {

  return transaction(async (connection) => {

    const rows = await connection.query(
      `SELECT
         id,
         payment_method,
         payment_status,
         redsys_order,
         total_cents
       FROM orders
       WHERE redsys_order = ?
       FOR UPDATE`,
      [redsysOrder]
    );

    const order = rows[0];

    if (!order) {
      throw new Error(
        `Pedido Redsys no encontrado: ${redsysOrder}`
      );
    }

    if (order.payment_method !== "online") {
      throw new Error(
        `El pedido ${order.id} no es de pago online`
      );
    }

    if (Number(order.total_cents) !== Number(amountCents)) {
      throw new Error(
        `Importe Redsys incorrecto para pedido ${order.id}`
      );
    }

    if (String(currency) !== "978") {
      throw new Error(
        `Moneda Redsys incorrecta para pedido ${order.id}`
      );
    }

    const responseNumber = Number(response);

    const authorized =
      Number.isInteger(responseNumber) &&
      responseNumber >= 0 &&
      responseNumber <= 99;

    if (!authorized) {

      await connection.query(
        `UPDATE orders
         SET payment_status = 'failed'
         WHERE id = ?
           AND payment_status = 'pending'`,
        [order.id]
      );

      return {
        orderId: order.id,
        paid: false,
        response
      };
    }

    /*
     * Idempotencia:
     * si Redsys repite la notificación y ya está
     * pagado, no hacemos nada perjudicial.
     */
    if (order.payment_status === "paid") {
      return {
        orderId: order.id,
        paid: true,
        alreadyPaid: true
      };
    }

    await connection.query(
      `UPDATE orders
       SET payment_status = 'paid',
           redsys_authorization_code = ?,
           paid_at = NOW()
       WHERE id = ?`,
      [
        authorizationCode || null,
        order.id
      ]
    );

    return {
      orderId: order.id,
      paid: true,
      alreadyPaid: false
    };
  });
}