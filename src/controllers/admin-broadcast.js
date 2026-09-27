import { query } from "../db.js";

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
    throw broadcastError(400, "Indica un asunto válido (máximo 160 caracteres).");
  if (!text || text.length > 10000)
    throw broadcastError(400, "Escribe el mensaje (máximo 10.000 caracteres).");
  if (body.confirm !== "yes")
    throw broadcastError(400, "Confirma el envío a todos los clientes.");
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD)
    throw broadcastError(503, "Configura SMTP antes de enviar correos.");

  const recipients = await query(
    "SELECT DISTINCT LOWER(TRIM(email)) AS email FROM customers WHERE email IS NOT NULL AND TRIM(email) <> '' ORDER BY email",
  );
  if (!recipients.length) return { sent: 0, failed: 0, total: 0 };

  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  try {
    await transporter.verify();
  } catch (error) {
    console.error("Broadcast SMTP verify failed", {
      code: error.code,
      responseCode: error.responseCode,
      command: error.command,
    });
    throw broadcastError(503, "No se pudo conectar al servidor SMTP. Revisa su configuración.");
  }

  let sent = 0;
  let failed = 0;
  for (const { email } of recipients) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject,
        text,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Broadcast recipient send failed", {
        code: error.code,
        responseCode: error.responseCode,
        command: error.command,
      });
    }
  }
  return { sent, failed, total: recipients.length };
}
