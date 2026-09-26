import dotenv from "dotenv";
dotenv.config();

const defaultBase = "https://nominatim.openstreetmap.org";
const geocoderUrl = "https://api.geoapify.com/v1/geocode/search";

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function comparable(value) {
  return text(value, 200)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function suggestionLabel(address) {
  const street = [address.street, address.number].filter(Boolean).join(" ");
  const locality = [address.city, address.province]
    .filter(
      (value, index, values) =>
        value && (!index || comparable(value) !== comparable(values[0])),
    )
    .join(", ");
  const location = [address.postal_code, locality].filter(Boolean).join(" ");
  return (
    [street, location].filter(Boolean).join(", ") || address.formatted_address
  );
}

function queryContext(value) {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const postal = value.match(/\b\d{5}\b/)?.[0] || "";
  const context =
    parts.length > 1
      ? parts
          .slice(1)
          .filter(
            (part) => !/^\d{5}$/.test(part) && !/^espa(?:n|ñ)a$/i.test(part),
          )
      : [];
  const cityHint = context[0] || "";
  const streetHint = parts.length > 1 ? parts[0] : value;
  return { streetHint, cityHint, postal };
}

function normalize(item) {
  const result = {
    formatted_address: text(item.formatted, 500),
    street: text(item.street, 180),
    number: text(item.housenumber, 40),
    city: text(
      item.city || item.town || item.village || item.municipality,
      120,
    ),
    province: text(item.state || item.county, 120),
    postal_code: text(item.postcode, 20),
    country: text(item.country_code, 2).toUpperCase(),
    latitude: Number(item.lat),
    longitude: Number(item.lon),
    place_id: text(String(item.place_id || ""), 255),
  };
  if (
    !result.formatted_address ||
    !result.place_id ||
    !Number.isFinite(result.latitude) ||
    !Number.isFinite(result.longitude)
  )
    return null;
  result.suggestion = suggestionLabel(result);
  return result;
}

export async function searchAddresses(query) {
  const value = text(query, 200);
  if (value.length < 3) return [];
  const apiKey = text(process.env.GEOAPIFY_API_KEY, 200);
  if (!apiKey) throw new Error("Falta configurar GEOAPIFY_API_KEY");
  const context = queryContext(value);
  const makeUrl = (limit, structured) => {
    const url = new URL(geocoderUrl);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("lang", "es");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("filter", "countrycode:es");
    if (structured) {
      const numberMatch = context.streetHint.match(
        /^(.*?)(?:\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?))$/,
      );
      url.searchParams.set(
        "street",
        numberMatch ? numberMatch[1].trim() : context.streetHint,
      );
      if (numberMatch) url.searchParams.set("housenumber", numberMatch[2]);
      url.searchParams.set("city", context.cityHint);
      if (context.postal) url.searchParams.set("postcode", context.postal);
    } else url.searchParams.set("text", value);
    return url;
  };
  let response = await fetch(makeUrl(5, Boolean(context.cityHint)), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Geocoder ${response.status}`);
  let data = await response.json();
  let results = Array.isArray(data.results)
    ? data.results.map(normalize).filter(Boolean)
    : [];
  if (!results.length && context.cityHint) {
    response = await fetch(makeUrl(10, false), {
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      data = await response.json();
      results = Array.isArray(data.results)
        ? data.results.map(normalize).filter(Boolean)
        : [];
    }
  }
  if (!context.cityHint) return results;
  const wanted = comparable(context.cityHint);
  return results.filter((result) => comparable(result.city) === wanted);
}

export function validateAddress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "Selecciona una dirección de la lista";
  const required = [
    "formatted_address",
    "street",
    "city",
    "postal_code",
    "country",
    "place_id",
  ];
  if (
    required.some((key) => typeof value[key] !== "string" || !value[key].trim())
  )
    return "Selecciona una dirección completa de la lista";
  if (
    !Number.isFinite(Number(value.latitude)) ||
    !Number.isFinite(Number(value.longitude))
  )
    return "La dirección seleccionada no tiene coordenadas válidas";
  if (
    Number(value.latitude) < -90 ||
    Number(value.latitude) > 90 ||
    Number(value.longitude) < -180 ||
    Number(value.longitude) > 180
  )
    return "Las coordenadas de la dirección no son válidas";
  return null;
}

export function cleanAddress(value) {
  return {
    formatted_address: text(value.formatted_address, 500),
    street: text(value.street, 180),
    number: text(value.number, 40),
    city: text(value.city, 120),
    province: text(value.province, 120),
    postal_code: text(value.postal_code, 20),
    country: text(value.country, 2).toUpperCase(),
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    place_id: text(value.place_id, 255),
  };
}
