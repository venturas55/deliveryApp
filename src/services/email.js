import { createTransport } from "nodemailer";
import { httpError } from "./http-error.js";

export async function createEmailTransport() {
  const host = process.env.EMAIL_HOST;
  const account = process.env.EMAIL_ACCOUNT;
  const password = process.env.EMAIL_PASS;
  const port = Number(process.env.EMAIL_PORT || 587);
  const authenticationRequired = process.env.EMAIL_AUTH_NEEDED === "true";
  if (!host || !account || (authenticationRequired && !password))
    throw httpError(503, "Configura el correo SMTP antes de enviar mensajes.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw httpError(503, "EMAIL_PORT no es válido.");

  const options = {
    host,
    port,
    secure: process.env.EMAIL_SECURITY === undefined
      ? port === 465
      : process.env.EMAIL_SECURITY === "true",
  };
  if (authenticationRequired) options.auth = { user: account, pass: password };

  const transporter = createTransport(options);
  try {
    await transporter.verify();
    return transporter;
  } catch (error) {
    transporter.close();
    console.error("SMTP connection failed", {
      code: error.code,
      responseCode: error.responseCode,
      command: error.command,
    });
    throw httpError(503, "No se pudo conectar al servidor SMTP.");
  }
}

export async function sendEmail(message, transporter = null) {
  const ownsTransport = !transporter;
  const activeTransport = transporter || await createEmailTransport();
  const account = process.env.EMAIL_ACCOUNT;
  const senderName = process.env.EMAIL_USER_NAME;
  try {
    return await activeTransport.sendMail({
      from: account
        ? { name: senderName || "Restaurante", address: account }
        : undefined,
      replyTo: account || undefined,
      ...message,
    });
  } catch (error) {
    console.error("SMTP message failed", {
      code: error.code,
      responseCode: error.responseCode,
      command: error.command,
    });
    throw error;
  } finally {
    if (ownsTransport) activeTransport.close();
  }
}
