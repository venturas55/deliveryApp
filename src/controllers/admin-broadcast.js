import { query } from "../db.js";
import { createEmailTransport, sendEmail } from "../services/email.js";
import { customerEmailContent } from "../services/customer-email.js";

function broadcastError(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function countBroadcastRecipients(restaurantId = null) {
  const rows = await query(
    `SELECT COUNT(DISTINCT LOWER(TRIM(email))) AS total FROM customers WHERE email IS NOT NULL AND TRIM(email) <> ''
      ${restaurantId == null ? "" : "AND EXISTS (SELECT 1 FROM orders WHERE customer_id=customers.id AND restaurant_id=?)"}`,
    restaurantId == null ? [] : [restaurantId],
  );
  return Number(rows[0]?.total || 0);
}

/**
 * Valida asunto y mensaje.
 */
function validateCustomerEmail(body = {}) {
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";

  const text = typeof body.message === "string" ? body.message.trim() : "";

  if (!subject || subject.length > 160 || /[\r\n]/.test(subject)) {
    throw broadcastError(
      400,
      "Indica un asunto válido (máximo 160 caracteres).",
    );
  }

  if (!text || text.length > 10000) {
    throw broadcastError(400, "Escribe el mensaje (máximo 10.000 caracteres).");
  }

  return {
    subject,
    text,
  };
}

/**
 * Envía un correo a UN cliente.
 */
export async function sendCustomerEmail(customer, body = {}, image = null) {
  if (!customer?.email) {
    throw broadcastError(
      400,
      "El cliente no tiene una dirección de correo electrónico.",
    );
  }
  const email = customer.email.trim().toLowerCase();
  if (!email) {
    throw broadcastError(
      400,
      "El cliente no tiene una dirección de correo electrónico.",
    );
  }
  
  const { subject, text } = validateCustomerEmail(body);
  const content = customerEmailContent(text, image);
  const transporter = await createEmailTransport();
  try {
    await sendEmail(
      {
        to: email,
        subject,
        ...content,
      },
      transporter,
    );

    return {
      sent: 1,
      failed: 0,
      total: 1,
    };
  } finally {
    transporter.close();
  }
}
/**
 * Envía un correo a TODOS los clientes.
 */
export async function sendCustomerBroadcast(body = {}, image = null, restaurantId = null) {
  const { subject, text } = validateCustomerEmail(body);
  const content = customerEmailContent(text, image);

  if (body.confirm !== "yes") {
    throw broadcastError(400, "Confirma el envío a todos los clientes.");
  }

  const recipients = await query(`
    SELECT DISTINCT
      LOWER(TRIM(email)) AS email
    FROM customers
    WHERE email IS NOT NULL
      AND TRIM(email) <> ''
      ${restaurantId == null ? "" : "AND EXISTS (SELECT 1 FROM orders WHERE customer_id=customers.id AND restaurant_id=?)"}
    ORDER BY email
  `, restaurantId == null ? [] : [restaurantId]);

  if (!recipients.length) {
    return {
      sent: 0,
      failed: 0,
      total: 0,
    };
  }

  const transporter = await createEmailTransport();

  let sent = 0;
  let failed = 0;

  try {
    for (const { email } of recipients) {
      try {
        await sendEmail(
          {
            to: email,
            subject,
            ...content,
          },
          transporter,
        );

        sent++;
      } catch (error) {
        failed++;

        console.error(`Error enviando email a ${email}:`, error.message);
      }
    }
  } finally {
    transporter.close();
  }
  return {
    sent,
    failed,
    total: recipients.length,
  };
}
