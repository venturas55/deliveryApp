import { query, transaction } from "../db.js";
import {
  refundRedsysPayment
} from "../services/redsys.js";
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

export async function refundOrderPayment(orderId) {

  /*
   * PASO 1
   *
   * Marcamos la devolución como iniciada.
   * Esta transacción es corta: NO hacemos
   * la llamada HTTP a Redsys dentro de ella.
   */
  const order = await transaction(
    async (connection) => {

      const rows = await connection.query(
        `SELECT
           id,
           payment_method,
           payment_status,
           total_cents,
           redsys_order
         FROM orders
         WHERE id = ?
         FOR UPDATE`,
        [orderId]
      );

      const order = rows[0];

      if (!order) {
        throw new Error(
          `Pedido ${orderId} no encontrado`
        );
      }

      if (order.payment_method !== "online") {
        return {
          requiresRefund: false,
          order
        };
      }

      /*
       * Si todavía no se había pagado,
       * no hay dinero que devolver.
       */
      if (order.payment_status === "pending") {
        return {
          requiresRefund: false,
          order
        };
      }

      /*
       * Protección frente a doble devolución.
       */
      if (
        order.payment_status === "refund_pending"
      ) {
        throw new Error(
          "La devolución de este pedido ya está en curso"
        );
      }

      if (
        order.payment_status === "refunded"
      ) {
        return {
          requiresRefund: false,
          alreadyRefunded: true,
          order
        };
      }

      if (order.payment_status !== "paid") {
        throw new Error(
          `El pago está en estado ${order.payment_status} y no puede devolverse`
        );
      }

      if (!order.redsys_order) {
        throw new Error(
          "El pedido no tiene referencia Redsys"
        );
      }

      await connection.query(
        `UPDATE orders
         SET payment_status = 'refund_pending'
         WHERE id = ?`,
        [order.id]
      );

      return {
        requiresRefund: true,
        order
      };
    }
  );

  if (!order.requiresRefund) {
    return order;
  }

  /*
   * PASO 2
   *
   * Aquí ya estamos FUERA de la transacción.
   * Llamamos a Redsys.
   */
  let refund;

  try {

    refund = await refundRedsysPayment({
      order: order.order.redsys_order,
      amountCents: order.order.total_cents
    });

  } catch (error) {

    /*
     * La petición ha fallado.
     *
     * Volvemos a "paid" porque NO tenemos
     * confirmación de que el dinero haya
     * sido devuelto.
     */
    await query(
      `UPDATE orders
       SET payment_status = 'paid'
       WHERE id = ?
         AND payment_status = 'refund_pending'`,
      [order.order.id]
    );

    throw error;
  }

  /*
   * Redsys respondió, pero rechazó
   * la devolución.
   */
  if (!refund.success) {
    console.log("=== REDSYS DEVOLUCION ===");
    console.log(
      "Pedido Redsys:",
      order.order.redsys_order
    );
    console.log(
      "Pedido DB:",
      String(order.order.id)
    );
    console.log(
      "Importe:",
      order.order.total_cents
    );
    console.log(
      "Respuesta:",
      refund.responseCode
    );
    console.log(
      "Devolucion: AUTORIZADA"
    );
    await query(
      `UPDATE orders
       SET payment_status = 'paid'
       WHERE id = ?
         AND payment_status = 'refund_pending'`,
      [order.order.id]
    );

    throw new Error(
      `Redsys rechazó la devolución. Código: ${refund.responseCode}`
    );
  }

  /*
   * PASO 3
   *
   * Redsys confirma la devolución.
   */
  await query(
    `UPDATE orders
     SET payment_status = 'refunded',
         refund_amount_cents = ?,
         refunded_at = NOW()
     WHERE id = ?
       AND payment_status = 'refund_pending'`,
    [
      order.order.total_cents,
      order.order.id
    ]
  );

  return {
    requiresRefund: true,
    refunded: true,
    orderId: order.order.id,
    amountCents: order.order.total_cents
  };
}