import { Router } from "express";
import { createRedsysPayment } from "../services/redsys.js";

const router = Router();


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


router.get("/payment/redsys/test", (req, res, next) => {
  try {
    const publicUrl = process.env.PUBLIC_URL;

    if (!publicUrl) {
      throw new Error("PUBLIC_URL no configurado");
    }

    /*
     * Número temporal para la prueba.
     * Empieza por cuatro dígitos.
     */
    const order =
      Date.now()
        .toString()
        .slice(-12);

    const payment = createRedsysPayment({
      order,
      amountCents: 100,

      merchantUrl:
        `${publicUrl}/payment/redsys/notification`,

      urlOk:
        `${publicUrl}/payment/redsys/success`,

      urlKo:
        `${publicUrl}/payment/redsys/error`
    });

    res.type("html").send(`
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Conectando con Redsys</title>
      </head>

      <body>

        <p>Conectando con la pasarela de pago...</p>

        <form
          id="redsysForm"
          action="${escapeHtml(payment.endpoint)}"
          method="POST"
        >
          <input
            type="hidden"
            name="Ds_SignatureVersion"
            value="${escapeHtml(payment.signatureVersion)}"
          >

          <input
            type="hidden"
            name="Ds_MerchantParameters"
            value="${escapeHtml(payment.merchantParameters)}"
          >

          <input
            type="hidden"
            name="Ds_Signature"
            value="${escapeHtml(payment.signature)}"
          >

          <noscript>
            <button type="submit">
              Continuar al pago
            </button>
          </noscript>
        </form>

        <script>
          document
            .getElementById("redsysForm")
            .submit();
        </script>

      </body>
      </html>
    `);

  } catch (error) {
    next(error);
  }
});


router.get("/payment/redsys/success", (req, res) => {
  res.send(`
    <h1>Pago completado</h1>
    <p>Redsys ha devuelto el navegador a la URL OK.</p>
  `);
});


router.get("/payment/redsys/error", (req, res) => {
  res.status(400).send(`
    <h1>Pago no completado</h1>
    <p>Redsys ha devuelto el navegador a la URL KO.</p>
  `);
});


router.post("/payment/redsys/notification", (req, res) => {
  /*
   * Lo implementaremos en la siguiente fase.
   *
   * NO marcamos ningún pedido como pagado todavía.
   */
  console.log("Notificacion Redsys TEST recibida");

  res.sendStatus(200);
});


export default router;