import crypto from "crypto";

const TEST_URL = "https://sis-t.redsys.es:25443/sis/realizarPago";

const LIVE_URL = "https://sis.redsys.es/sis/realizarPago";

function base64UrlEncode(data) {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getConfig() {
  const merchantCode = process.env.REDSYS_MERCHANT_CODE;

  const terminal = process.env.REDSYS_TERMINAL || "001";

  const secretKey = process.env.REDSYS_SECRET_KEY;

  if (!merchantCode) {
    throw new Error("REDSYS_MERCHANT_CODE no configurado");
  }

  if (!secretKey) {
    throw new Error("REDSYS_SECRET_KEY no configurado");
  }

  return {
    merchantCode,
    terminal,
    secretKey,
  };
}

/*
 * HMAC_SHA512_V2
 *
 * Redsys:
 * 1. Decodificar clave comercio desde Base64
 * 2. Diversificarla con Ds_Order usando AES-CBC
 * 3. HMAC-SHA512 sobre Ds_MerchantParameters
 * 4. Resultado en Base64URL
 */
function diversifyKey(order, secretKey) {

  const normalizedKey =
    secretKey.length >= 16
      ? secretKey.substring(0, 16)
      : secretKey.padEnd(16, "0");

  const key = Buffer.from(
    normalizedKey,
    "utf8"
  );

  const iv = Buffer.alloc(16, 0);

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    key,
    iv
  );

  cipher.setAutoPadding(true);

  return Buffer.concat([
    cipher.update(
      String(order),
      "utf8"
    ),
    cipher.final()
  ]);
}

function createSignature(
  merchantParameters,
  order,
  secretKey
) {
  const diversifiedKeyBinary =
    diversifyKey(
      order,
      secretKey
    );

  /*
   * Redsys HMAC_SHA512_V2:
   *
   * El resultado AES se codifica en Base64
   * y esa cadena Base64 se utiliza como
   * clave para HMAC-SHA512.
   */
  const diversifiedKeyBase64 =
    diversifiedKeyBinary.toString("base64");

  return crypto
    .createHmac(
      "sha512",
      diversifiedKeyBase64
    )
    .update(
      merchantParameters,
      "utf8"
    )
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createRedsysPayment({
  order,
  amountCents,
  merchantUrl,
  urlOk,
  urlKo,
}) {
  const { merchantCode, terminal, secretKey } = getConfig();

  const parameters = {
    DS_MERCHANT_AMOUNT: String(amountCents),

    DS_MERCHANT_ORDER: String(order),

    DS_MERCHANT_MERCHANTCODE: merchantCode,

    DS_MERCHANT_CURRENCY: "978",

    DS_MERCHANT_TRANSACTIONTYPE: "0",

    DS_MERCHANT_TERMINAL: terminal,

    DS_MERCHANT_MERCHANTURL: merchantUrl,

    DS_MERCHANT_URLOK: urlOk,

    DS_MERCHANT_URLKO: urlKo,
  };

  const merchantParameters = base64UrlEncode(JSON.stringify(parameters));

  const signature = createSignature(
    merchantParameters,
    String(order),
    secretKey,
  );

  const endpoint = process.env.REDSYS_ENV === "live" ? LIVE_URL : TEST_URL;

  return {
    endpoint,

    signatureVersion: "HMAC_SHA512_V2",

    merchantParameters,

    signature,
  };
}

function base64UrlDecode(value) {
  let base64 = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (base64.length % 4) {
    base64 += "=";
  }

  return Buffer.from(base64, "base64");
}

function signaturesEqual(a, b) {
  try {
    const aBuffer = base64UrlDecode(a);
    const bBuffer = base64UrlDecode(b);

    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(aBuffer, bBuffer);
  } catch {
    return false;
  }
}

export function verifyRedsysNotification({
  merchantParameters,
  signature,
  signatureVersion,
}) {

  if (signatureVersion !== "HMAC_SHA512_V2") {
    throw new Error(
      `Versión de firma Redsys no soportada: ${signatureVersion}`
    );
  }

  if (!merchantParameters || !signature) {
    throw new Error("Notificación Redsys incompleta");
  }

  // Decodificamos los parámetros para obtener Ds_Order.
  const decoded = base64UrlDecode(
    merchantParameters
  ).toString("utf8");

  const parameters = JSON.parse(decoded);

  const order =
    parameters.Ds_Order ??
    parameters.DS_ORDER;

  if (!order) {
    throw new Error(
      "Ds_Order no encontrado en la notificación Redsys"
    );
  }

  const { secretKey } = getConfig();

  /*
   * IMPORTANTE:
   * Se firma merchantParameters EXACTAMENTE
   * como Redsys lo ha enviado.
   */
  const expectedSignature = createSignature(
    merchantParameters,
    String(order),
    secretKey
  );

  const valid = signaturesEqual(
    expectedSignature,
    signature
  );

  return {
    valid,
    parameters
  };
}