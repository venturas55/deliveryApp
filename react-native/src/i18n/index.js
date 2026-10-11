import en from "./en";

export const supportedLanguages = ["es", "en"];
let language = "es", locale = "es-ES";

export function selectLocale(locales = []) {
  const tags = locales.map(item => typeof item === "string" ? item : item.languageTag || item.languageCode || "")
    .map(tag => tag.replace(/_/g, "-"));
  const selected = tags.find(tag => supportedLanguages.includes(tag.split("-")[0].toLowerCase()));
  let formatLocale = tags[0] || "es-ES";
  try { new Intl.DateTimeFormat(formatLocale); } catch { formatLocale = "es-ES"; }
  return { language: selected?.split("-")[0].toLowerCase() || "es", locale: formatLocale };
}
export function setDeviceLocales(locales, preference = "system") {
  const selected = selectLocale(locales);
  if (supportedLanguages.includes(preference)) selected.language = preference;
  language = selected.language;
  locale = selected.locale;
  return selected;
}
export const getLocale = () => locale;
export const getLanguage = () => language;

const singular = {
  "{{v0}} avisos de pedidos · Ver pedidos": { es: "{{v0}} aviso de pedido · Ver pedidos", en: "{{v0}} order alert · View orders" },
  "{{v0}} pedidos {{v1}}": { es: "{{v0}} pedido {{v1}}", en: "{{v0}} order {{v1}}" },
  "{{v0}} pedidos · {{v1}} entregados": { es: "{{v0}} pedido · {{v1}} entregados", en: "{{v0}} order · {{v1}} delivered" },
  "{{v0}} pedidos · importe no cancelado ni reembolsado; puede incluir pagos pendientes": { es: "{{v0}} pedido · importe no cancelado ni reembolsado; puede incluir pagos pendientes", en: "{{v0}} order · excludes cancelled and refunded amounts; may include pending payments" },
};

const patterns = Object.keys(en).filter(key => key.includes("{{") && /[a-záéíóúñ]/i.test(key.replace(/\{\{.*?\}\}/g, "")))
  .map(key => {
    const names = [];
    const escaped = key.split(/(\{\{\w+\}\})/g).map(part => {
      const match = part.match(/^\{\{(\w+)\}\}$/);
      if (match) { names.push(match[1]); return "(.+?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    return { key, names, regex: new RegExp(`^${escaped}$`) };
  });

export function t(source, values = {}) {
  if (typeof source !== "string") return source;
  const key = source.trim();
  if (!key) return source;
  let template = language === "en" ? en[key] : key;
  if (template === undefined) {
    const pattern = patterns.find(item => item.regex.test(key));
    if (pattern) {
      const match = key.match(pattern.regex);
      values = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
      template = en[pattern.key];
    } else template = key;
  }
  if (Number(values.v0) === 1 && singular[key]) template = singular[key][language];
  const translated = template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : match);
  return source.slice(0, source.length - source.trimStart().length) + translated +
    source.slice(source.trimEnd().length);
}

export const formatMoney = cents => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(cents || 0) / 100);
export const formatDate = (value, options) => new Date(value).toLocaleString(locale, options);
