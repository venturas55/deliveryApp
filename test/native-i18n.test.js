import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const root = path.resolve("react-native");
const { parse } = createRequire(path.join(root, "package.json"))("@babel/parser");
const catalogSource = fs.readFileSync(path.join(root, "src/i18n/en.js"), "utf8");
const en = vm.runInNewContext(`(${catalogSource.replace("export default", "").trim().replace(/;$/, "")})`);
function localization() {
  const source = fs.readFileSync(path.join(root, "src/i18n/index.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const context = vm.createContext({ en, Intl });
  vm.runInContext(source + "\nglobalThis.i18n={t,setDeviceLocales,selectLocale,formatMoney,formatDate,getLocale};", context);
  return context.i18n;
}

test("device preferences choose regional English, Spanish and supported fallback", () => {
  const i = localization();
  assert.equal(i.selectLocale([{ languageTag: "en-GB" }]).language, "en");
  assert.equal(i.selectLocale(["es_MX"]).language, "es");
  assert.equal(i.selectLocale(["fr-FR", "en-US"]).language, "en");
  assert.equal(i.selectLocale(["ja-JP"]).language, "es");
  assert.equal(i.selectLocale([]).locale, "es-ES");
  assert.equal(i.selectLocale(["invalid_tag!"]).locale, "es-ES");
});

test("client, admin, payment, validation and accessibility text translate", () => {
  const i = localization();
  i.setDeviceLocales(["en-US"]);
  for (const [source, expected] of [["Mi cuenta","My account"],["Clientes","Customers"],["Tarjeta online","Online card payment"],["Credenciales incorrectas","Incorrect credentials"],["Tema oscuro","Dark theme"],["Marcar pago recibido","Mark paid"]]) assert.equal(i.t(source), expected);
  assert.equal(i.t("Foto de perfil de {{v0}}", { v0: "José Pérez" }), "Profile photo of José Pérez");
  assert.equal(i.t("Carrito (3)"), "Cart (3)");
  assert.equal(i.t("Revisa el campo phone (máximo 40 caracteres)"), "Check phone (up to 40 characters)");
  assert.equal(i.t("Unknown provider error"), "Unknown provider error");
  assert.equal(i.t("Pizza José"), "Pizza José");
  assert.equal(i.t("  Clientes "), "  Customers ");
  assert.equal(i.t(" "), " ");
  assert.equal(i.t(42), 42);
});

test("locale switches translate immediately and preserve interpolated data", () => {
  const i = localization();
  i.setDeviceLocales(["en-GB"]);
  assert.equal(i.t("Pedido #{{v0}}", { v0: "9007199254740995" }), "Order #9007199254740995");
  assert.equal(i.t("{{v0}} avisos de pedidos · Ver pedidos", { v0: 1 }), "1 order alert · View orders");
  assert.equal(i.t("{{v0}} avisos de pedidos · Ver pedidos", { v0: 2 }), "2 order alerts · View orders");
  i.setDeviceLocales(["es-ES"]);
  assert.equal(i.t("Mi cuenta"), "Mi cuenta");
  assert.equal(i.t("Pedido #{{v0}}", { v0: "9007199254740995" }), "Pedido #9007199254740995");
});

test("prices keep EUR and dates use device regional format", () => {
  const i = localization();
  i.setDeviceLocales(["en-US"]);
  assert.match(i.formatMoney(1234), /12\.34/);
  assert.match(i.formatMoney(1234), /€/);
  assert.match(i.formatDate(new Date(2026, 9, 8), { month: "long" }), /October/);
  i.setDeviceLocales(["es-ES"]);
  assert.match(i.formatMoney(1234), /12,34/);
  assert.match(i.formatDate(new Date(2026, 9, 8), { month: "long" }), /octubre/);
});

test("catalog keys are unique and placeholders remain complete", () => {
  const object = parse(catalogSource, { sourceType: "module" }).program.body[0].declaration;
  const names = object.properties.map(property => property.key.value);
  assert.equal(new Set(names).size, names.length);
  const placeholders = text => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
  for (const [key, translated] of Object.entries(en)) assert.deepEqual(placeholders(translated), placeholders(key), key);
});

test("CLIENT and ADMIN visible literals are localized and static keys covered", () => {
  const files = [path.join(root, "App.js")];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "i18n") scan(filename); }
      else if (filename.endsWith(".js")) files.push(filename);
    }
  }
  scan(path.join(root, "src"));
  function walk(node, filename) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") assert.ok(!/[a-záéíóúñ]/i.test(node.value), `Unlocalized JSX text: ${filename}: ${node.value}`);
    if (node.type === "JSXAttribute" && ["title","label","placeholder","accessibilityLabel"].includes(node.name.name)) assert.notEqual(node.value?.type, "StringLiteral", `${filename}: ${node.name.name}`);
    if (node.type === "CallExpression" && node.callee.name === "t" && node.arguments[0]?.type === "StringLiteral") {
      const key = node.arguments[0].value;
      if (/[a-záéíóúñ]/i.test(key.replace(/\{\{.*?\}\}/g, ""))) assert.ok(key.trim() in en, `Missing translation: ${filename}: ${key}`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, filename));
      else if (value && typeof value === "object") walk(value, filename);
    }
  }
  for (const filename of files) walk(parse(fs.readFileSync(filename, "utf8"), { sourceType: "module", plugins: ["jsx"] }), filename);
});
function languageProvider(saved = null) {
  const i = localization();
  const storage = new Map(saved ? [["delivery-language", saved]] : []);
  const source = fs.readFileSync(path.join(root, "src/i18n/LocaleProvider.js"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const provider = ast.program.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "LocaleProvider").declaration;
  const result = provider.body.body.find(node => node.type === "ReturnStatement");
  let executable = source.slice(0, result.start) + "return { ...current, preference, setPreference, ready, saving, error };" + source.slice(result.end);
  executable = executable.replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const states = [], refs = [], listeners = {};
  let stateIndex, refIndex, effect, cleanup, initialized = false, writes = 0;
  const context = {
    locales: ["en-US"], failWrite: false, writeGate: null,
    NativeModules: {}, Intl, Alert: { alert() {} },
    createContext: () => ({}), useContext: () => null,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useCallback: callback => callback,
    useEffect(callback) { if (!initialized) effect = callback; },
    supportedLanguages: ["es", "en"], setDeviceLocales: i.setDeviceLocales, t: i.t,
    AppState: { addEventListener(event, callback) { listeners[event] = callback; return { remove() { delete listeners[event]; } }; } },
    require() { return { getLocales: () => context.locales, addLocaleListener: callback => { listeners.locale = callback; return { remove() { delete listeners.locale; } }; } }; },
    AsyncStorage: {
      async getItem(key) { return storage.get(key) || null; },
      async setItem(key, value) {
        writes++;
        if (context.writeGate) await context.writeGate;
        if (context.failWrite) throw new Error("Storage offline");
        storage.set(key, value);
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(executable, context);
  function render() {
    stateIndex = 0; refIndex = 0;
    const value = context.LocaleProvider({ children: null });
    if (!initialized) { initialized = true; cleanup = effect(); }
    return value;
  }
  render();
  return { render, context, listeners, storage, writes: () => writes, unmount: () => cleanup() };
}

test("language preference restores on launch, overrides device changes and can return to automatic", async () => {
  const p = languageProvider("es");
  await new Promise(setImmediate);
  assert.equal(p.render().ready, true);
  assert.equal(p.render().language, "es");
  assert.equal(p.render().preference, "es");
  p.context.locales = ["en-GB"];
  p.listeners.change("active");
  assert.equal(p.render().language, "es");
  assert.equal(p.render().locale, "en-GB");
  await p.render().setPreference("en");
  assert.equal(p.storage.get("delivery-language"), "en");
  assert.equal(p.render().language, "en");
  p.context.locales = ["es-ES"];
  p.listeners.locale();
  assert.equal(p.render().language, "en");
  await p.render().setPreference("system");
  assert.equal(p.render().language, "es");
  assert.equal(p.storage.get("delivery-language"), "system");
  p.context.locales = ["en-US"];
  p.listeners.change("active");
  assert.equal(p.render().language, "en");
  p.unmount();
  assert.equal(Object.keys(p.listeners).length, 0);
});

test("language write failure preserves selection and simultaneous writes are guarded", async () => {
  const p = languageProvider("es");
  await new Promise(setImmediate);
  p.context.failWrite = true;
  await p.render().setPreference("en");
  assert.equal(p.render().preference, "es");
  assert.equal(p.render().language, "es");
  assert.match(p.render().error, /No se pudo guardar/);
  p.context.failWrite = false;
  let release;
  p.context.writeGate = new Promise(resolve => { release = resolve; });
  const first = p.render().setPreference("en");
  await p.render().setPreference("system");
  assert.equal(p.writes(), 2); // failed write plus exactly one new write
  release(); await first;
  assert.equal(p.render().preference, "en");
  assert.equal(p.render().saving, false);
  p.unmount();
});
