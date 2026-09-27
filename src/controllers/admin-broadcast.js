import { query } from "../db.js";
import { createEmailTransport, sendEmail } from "../services/email.js";

function broadcastError(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function countBroadcastRecipients() {
  const rows = await query(
    "SELECT COUNT(DISTINCT LOWER(TRIM(email))) AS total FROM customers WHERE email IS NOT NULL AND TRIM(email) <> ''",
  );
  return Number(rows[0]?.total || 0);
}

export async function sendCustomerBroadcast(body = {}) {
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!subject || subject.length > 160 || /[\r\n]/.test(subject))
    throw broadcastError(
      400,
      "Indica un asunto válido (máximo 160 caracteres).",
    );
  if (!text || text.length > 10000)
    throw broadcastError(400, "Escribe el mensaje (máximo 10.000 caracteres).");
  if (body.confirm !== "yes")
    throw broadcastError(400, "Confirma el envío a todos los clientes.");
  const recipients = await query(
    "SELECT DISTINCT LOWER(TRIM(email)) AS email FROM customers WHERE email IS NOT NULL AND TRIM(email) <> '' ORDER BY email",
  );
  if (!recipients.length) return { sent: 0, failed: 0, total: 0 };

  const transporter = await createEmailTransport();
  let sent = 0;
  let failed = 0;
  try {
    for (const { email } of recipients) {
      try {
        await sendEmail({ to: email, subject, text }, transporter);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
  } finally {
    transporter.close();
  }
  return { sent, failed, total: recipients.length };
}
