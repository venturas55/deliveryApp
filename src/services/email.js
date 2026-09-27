import { createTransport } from "nodemailer";
import { httpError } from "./http-error.js";

export async function createEmailTransport() {
  try {
    var transporter;
    console.log("EMAIL_AUTH_NEEDED: " + process.env.EMAIL_AUTH_NEEDED);
    if (process.env.EMAIL_AUTH_NEEDED == "true") {
      console.log("IF con AUTH");

      transporter = createTransport({
        //service: config.EMAIL_SERVICE,
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: process.env.EMAIL_SECURITY,
        auth: {
          user: process.env.EMAIL_ACCOUNT,
          pass: process.env.EMAIL_PASS,
        },
        secureConnection: false // TLS requires secureConnection to be false
/*         attachments: [
          {
            filename: "ccby.png",
            path: join(__dirname, "../public/img/ccby.png"),
            cid: "ccby",
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
  //const activeTransport = transporter || (await createEmailTransport());
  const activeTransport = await createEmailTransport();
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
