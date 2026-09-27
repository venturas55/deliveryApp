import { query } from "../db.js";
import { createTransport } from "nodemailer";

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
  if (
    !process.env.EMAIL_HOST ||
    !process.env.EMAIL_ACCOUNT ||
    !process.env.EMAIL_PASS
  )
    throw broadcastError(503, "Configura SMTP antes de enviar correos.");

  const recipients = await query(
    "SELECT DISTINCT LOWER(TRIM(email)) AS email FROM customers WHERE email IS NOT NULL AND TRIM(email) <> '' ORDER BY email",
  );
  console.log(recipients.toString());
  if (!recipients.length) return { sent: 0, failed: 0, total: 0 };

  var transporter;
  console.log("EMAIL_AUTH_NEEDED: " + process.env.EMAIL_AUTH_NEEDED);
  if (process.env.EMAIL_AUTH_NEEDED == "true") {
    console.log("IF con AUTH");
    transporter = createTransport({
      //service: process.env.EMAIL_SERVICE,
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURITY,
      auth: {
        user: process.env.EMAIL_ACCOUNT,
        pass: process.env.EMAIL_PASS,
      },
      secureConnection: false, // TLS requires secureConnection to be false
/*       attachments: [
        {
         
        },
      ], */
    });
  } else {
    let seguridad;
    if (process.env.EMAIL_PORT == 465) seguridad = true;
    else seguridad = false;
    console.log(
      `Intentando enviar email con la siguiente configuracion \n \t host: ${process.env.EMAIL_HOST} \n \t port:  ${process.env.EMAIL_PORT} \n \t secure:  ${process.env.EMAIL_SECURITY}`,
    );
    transporter = createTransport({
      //service: process.env.EMAIL_SERVICE,
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: seguridad,
      /*    tls: {
                   rejectUnauthorized: false // (opcional) si es un servidor que usa TLS autofirmado
                         ciphers: 'SSLv3'
               } */
      //secureConnection: false, // TLS requires secureConnection to be false
    });
  }
  transporter.verify(function (error, success) {
    if (error) {
      console.log(">", error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });

  let sent = 0;
  let failed = 0;
  for (const { email } of recipients) {
    try {
      console.log(`Sending broadcast to ${email}...`);
      await transporter.sendMail({
        from: process.env.RESTAURANT_NAME,
        to: email,
        subject,
        replyTo: `${process.env.EMAIL_ACCOUNT}`,
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
