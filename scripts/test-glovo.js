import dotenv from "dotenv";
import { glovoQuote, listGlovoAddresses } from "../src/delivery/glovo.js";
dotenv.config();

const address = process.argv.slice(2).join(" ") || process.env.GLOVO_TEST_ADDRESS;
const lat = process.env.GLOVO_TEST_LAT;
const lng = process.env.GLOVO_TEST_LNG;
const details = process.env.GLOVO_TEST_DETAILS || "Prueba API";

if (!process.env.GLOVO_CLIENT_ID || !process.env.GLOVO_CLIENT_SECRET) {
  console.error("Faltan GLOVO_CLIENT_ID y/o GLOVO_CLIENT_SECRET");
  process.exit(1);
}
if (!process.env.GLOVO_API_BASE_URL) {
  console.error("Falta GLOVO_API_BASE_URL. Usa exactamente la URL de staging/prod que te haya proporcionado Glovo.");
  process.exit(1);
}

try {
  console.log("\n=== GLOVO LaaS API - prueba de autenticación ===");
  const addresses = await listGlovoAddresses();
  console.log("OK. Direcciones disponibles:", JSON.stringify(addresses, null, 2));

  const addressBookId = process.env.GLOVO_ADDRESS_BOOK_ID;
  if (!addressBookId) {
    console.log("\nNo se hace la cotización: falta GLOVO_ADDRESS_BOOK_ID.");
    console.log("Crea/consulta una dirección en Glovo y guarda su id en .env.");
    process.exit(0);
  }
  if (!address) {
    console.log("\nNo se hace la cotización: falta dirección de prueba.");
    console.log("Ejemplo: npm run glovo:test -- \"Carrer de Colón 20, Valencia, Spain\"");
    process.exit(0);
  }

  console.log("\n=== GLOVO LaaS API - prueba de quote ===");
  const quote = await glovoQuote({ address, latitude: lat, longitude: lng, details });
  console.log("Quote OK:");
  console.log(JSON.stringify({
    quoteId: quote.quoteId,
    quotePrice: quote.quotePrice,
    currencyCode: quote.currencyCode,
    distanceInMeters: quote.distanceInMeters,
    estimatedTimeOfDelivery: quote.estimatedTimeOfDelivery,
    expiresAt: quote.expiresAt
  }, null, 2));
} catch (error) {
  console.error("\nERROR GLOVO:");
  console.error(error.message);
  process.exit(1);
}
