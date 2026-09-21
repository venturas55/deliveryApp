import crypto from "node:crypto";

const SECRET =
  "sq7HjrUOBfKmC576ILgskD5srU870gJ7";

const ORDER =
  "1234567890";

const EXPECTED_DERIVED =
  "RWt3/IPTzYRMXsQtkiGRKg==";

const MERCHANT_PARAMETERS =
  "eyJEU19NRVJDSEFOVF9BTU9VTlQiOiI5OTkiLCJEU19NRVJDSEFOVF9PUkRFUiI6IjEyMzQ1Njc4OTAiLCJEU19NRVJDSEFOVF9NRVJDSEFOVENPREUiOiI5OTkwMDg4ODEiLCJEU19NRVJDSEFOVF9DVVJSRU5DWSI6Ijk3OCIsIkRTX01FUkNIQU5UX1RSQU5TQUNUSU9OVFlQRSI6IjAiLCJEU19NRVJDSEFOVF9URVJNSU5BTCI6IjEiLCJEU19NRVJDSEFOVF9NRVJDSEFOVFVSTCI6Imh0dHA6XC9cL3d3dy5wcnVlYmEuY29tXC91cmxOb3RpZmljYWNpb24ucGhwIiwiRFNfTUVSQ0hBTlRfVVJMT0siOiJodHRwOlwvXC93d3cucHJ1ZWJhLmNvbVwvdXJsT0sucGhwIiwiRFNfTUVSQ0hBTlRfVVJMS08iOiJodHRwOlwvXC93d3cucHJ1ZWJhLmNvbVwvdXJMS08ucGhwIn0";

const EXPECTED_SIGNATURE =
  "Vjo02eSWq249IeZZp3R-ArFnGLhKY0OuzDDlx1BuVtZDC2yhczA7_11uZhsYzLZBCMFAz8u8uzGDX3AErHKmmw";


function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


// -----------------------------
// PASO 1: clave AES
// -----------------------------

const aesKey =
  Buffer.from(
    SECRET.substring(0, 16),
    "utf8"
  );

const iv =
  Buffer.alloc(16, 0);

const cipher =
  crypto.createCipheriv(
    "aes-128-cbc",
    aesKey,
    iv
  );

cipher.setAutoPadding(true);

const derivedBinary =
  Buffer.concat([
    cipher.update(ORDER, "utf8"),
    cipher.final()
  ]);

const derivedBase64 =
  derivedBinary.toString("base64");


console.log("");
console.log("=== PASO 1: AES ===");

console.log(
  "Obtenido :",
  derivedBase64
);

console.log(
  "Esperado :",
  EXPECTED_DERIVED
);

console.log(
  "AES OK   :",
  derivedBase64 === EXPECTED_DERIVED
);


// -----------------------------
// PASO 2A
// HMAC usando binario
// -----------------------------

const signatureBinary =
  base64Url(
    crypto
      .createHmac(
        "sha512",
        derivedBinary
      )
      .update(
        MERCHANT_PARAMETERS,
        "utf8"
      )
      .digest()
  );


// -----------------------------
// PASO 2B
// HMAC usando Base64
// -----------------------------

const signatureBase64 =
  base64Url(
    crypto
      .createHmac(
        "sha512",
        Buffer.from(
          derivedBase64,
          "utf8"
        )
      )
      .update(
        MERCHANT_PARAMETERS,
        "utf8"
      )
      .digest()
  );


console.log("");
console.log("=== PASO 2: HMAC ===");

console.log("");
console.log(
  "Esperada:"
);

console.log(
  EXPECTED_SIGNATURE
);

console.log("");
console.log(
  "Usando binario:"
);

console.log(
  signatureBinary
);

console.log(
  "Coincide:",
  signatureBinary === EXPECTED_SIGNATURE
);

console.log("");
console.log(
  "Usando Base64:"
);

console.log(
  signatureBase64
);

console.log(
  "Coincide:",
  signatureBase64 === EXPECTED_SIGNATURE
);