import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const nativeRoot = resolve("react-native");
const nativeRequire = createRequire(resolve(nativeRoot, "package.json"));
const { parse } = nativeRequire("@babel/parser");

test("native local imports contain no cycles", () => {
  const graph = new Map();
  function visitDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(path);
      else if (extname(path) === ".js") addModule(path);
    }
  }
  function addModule(path) {
    const ast = parse(readFileSync(path, "utf8"), { sourceType: "module", plugins: ["jsx"] });
    const dependencies = ast.program.body.flatMap(node => {
      if (!node.source?.value.startsWith(".")) return [];
      const base = resolve(dirname(path), node.source.value);
      return [base, `${base}.js`, resolve(base, "index.js")].filter(existsSync).slice(0, 1);
    });
    graph.set(path, dependencies);
  }
  visitDirectory(resolve(nativeRoot, "src"));
  addModule(resolve(nativeRoot, "App.js"));
  const completed = new Set();
  function walk(path, stack = []) {
    assert.ok(!stack.includes(path), `Require cycle: ${[...stack, path].join(" -> ")}`);
    if (completed.has(path)) return;
    for (const dependency of graph.get(path) || []) walk(dependency, [...stack, path]);
    completed.add(path);
  }
  for (const path of graph.keys()) walk(path);
});

function loadSound(requireModule, timers = { setTimeout, clearTimeout }, appState = { currentState: "active", addEventListener: () => ({ remove() {} }) }) {
  let effect, cleanup, error = "";
  const source = readFileSync(resolve(nativeRoot, "src/admin/useOrderSound.js"), "utf8")
    .replace(/^import .*from "(?:react|react-native)";\r?\n/gm, "")
    .replace("export default function", "function");
  const context = {
    ...timers,
    AppState: appState,
    require: requireModule,
    useCallback: callback => callback,
    useRef: value => ({ current: value }),
    useState: () => [error, value => { error = value; }],
    useEffect: callback => { effect = callback; },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    mount(enabled) { const result = context.useOrderSound(enabled); cleanup = effect(); return result; },
    unmount() { cleanup?.(); },
    error: () => error,
  };
}

test("missing ExpoAudio does not crash module evaluation or ADMIN", () => {
  let loads = 0;
  const sound = loadSound(() => { loads++; throw new Error("Cannot find native module 'ExpoAudio'"); });
  assert.equal(loads, 0);
  const result = sound.mount(true);
  assert.equal(loads, 1);
  assert.match(sound.error(), /Reconstruye e instala/);
  assert.doesNotThrow(() => result.notify(1));
  sound.unmount();
});

test("muted ADMIN does not load native audio", () => {
  const sound = loadSound(() => { throw new Error("Audio should not load"); });
  sound.mount(false).notify(1);
  assert.equal(sound.error(), "");
});

const flush = () => new Promise(setImmediate);

function soundHarness({ unloaded = false, playFailures = 0, modeFailures = 0 } = {}) {
  const timers = new Map(), players = [];
  let nextTimer = 0, appStateListener, plays = 0, attempts = 0, modeCalls = 0;
  const appState = {
    currentState: "active",
    addEventListener(event, listener) { appStateListener = listener; return { remove() { appStateListener = null; } }; },
  };
  const sound = loadSound(name => name === "expo-audio" ? {
    async setAudioModeAsync(options) {
      assert.equal(options.playsInSilentMode, true);
      modeCalls++;
      if (modeFailures-- > 0) throw new Error("Audio session interrupted");
    },
    createAudioPlayer() {
      const player = {
        isLoaded: !unloaded, duration: 1, currentTime: 0, playing: false,
        removed: false, listener: null,
        play() {
          assert.equal(this.removed, false);
          attempts++;
          if (playFailures-- > 0) throw new Error("Playback failed");
          this.playing = true;
          plays++;
        },
        pause() { this.playing = false; },
        remove() { this.removed = true; },
        addListener(event, callback) {
          this.listener = callback;
          return { remove() {} };
        },
        finish() {
          this.currentTime = 1;
          this.playing = false;
          this.listener({ didJustFinish: true, playing: false, duration: 1, currentTime: 1 });
        },
      };
      players.push(player);
      return player;
    },
  } : 1, {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, appState);
  const { notify } = sound.mount(true);
  return {
    sound, notify, players, timers,
    plays: () => plays, attempts: () => attempts, modeCalls: () => modeCalls,
    async tick(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `No timer at ${delay} ms`);
      timers.delete(entry[0]);
      entry[1].callback();
      await flush();
    },
    async state(value) { appState.currentState = value; appStateListener(value); await flush(); },
  };
}

test("20 successive new orders each play a fresh sound", async () => {
  const h = soundHarness();
  for (let index = 0; index < 20; index++) {
    h.notify(1);
    await flush();
    assert.equal(h.plays(), index + 1);
    h.players.at(-1).finish();
    await flush();
    assert.equal(h.players.at(-1).removed, true);
  }
  assert.equal(h.modeCalls(), 20);
  h.sound.unmount();
  assert.equal(h.timers.size, 0);
});

test("10 simultaneous orders all sound sequentially without overlap", async () => {
  const h = soundHarness();
  h.notify(10);
  await flush();
  for (let index = 0; index < 10; index++) {
    assert.equal(h.plays(), index + 1);
    assert.equal(h.players.filter(player => player.playing).length, 1);
    h.players.at(-1).finish();
    await flush();
  }
  assert.equal(h.plays(), 10);
  h.sound.unmount();
});

test("lost completion event releases queue using actual playback position", async () => {
  const h = soundHarness();
  h.notify(2);
  await flush();
  h.players[0].currentTime = 1;
  h.players[0].playing = false;
  await h.tick(2500);
  assert.equal(h.plays(), 2);
  h.sound.unmount();
});

test("interrupted playback retries same order instead of dropping it", async () => {
  const h = soundHarness();
  h.notify(2);
  await flush();
  await h.tick(2500);
  assert.match(h.sound.error(), /interrumpido/);
  await h.tick(1000);
  assert.equal(h.plays(), 2);
  h.players.at(-1).finish();
  await flush();
  assert.equal(h.plays(), 3);
  h.sound.unmount();
});

test("playback failure preserves all orders and recreates player", async () => {
  const h = soundHarness({ playFailures: 1 });
  h.notify(3);
  await flush();
  assert.equal(h.plays(), 0);
  assert.equal(h.players[0].removed, true);
  await h.tick(1000);
  for (let index = 0; index < 3; index++) {
    assert.equal(h.plays(), index + 1);
    h.players.at(-1).finish();
    await flush();
  }
  assert.equal(h.attempts(), 4);
  h.sound.unmount();
});

test("audio session failure retries without losing queued orders", async () => {
  const h = soundHarness({ modeFailures: 1 });
  h.notify(2);
  await flush();
  await h.tick(1000);
  assert.equal(h.plays(), 1);
  h.players.at(-1).finish();
  await flush();
  assert.equal(h.plays(), 2);
  h.sound.unmount();
});

test("slow native loading starts on ready event and loading timeout retries", async () => {
  const h = soundHarness({ unloaded: true });
  h.notify(1);
  await flush();
  assert.equal(h.plays(), 0);
  await h.tick(10000);
  await h.tick(1000);
  h.players.at(-1).isLoaded = true;
  h.players.at(-1).listener({ isLoaded: true });
  assert.equal(h.plays(), 1);
  h.sound.unmount();
});

test("background interruptions preserve queue and resume audio on foreground", async () => {
  const h = soundHarness();
  h.notify(2);
  await flush();
  await h.state("background");
  assert.equal(h.players[0].removed, true);
  assert.equal(h.timers.size, 0);
  h.notify(1);
  assert.equal(h.plays(), 1);
  await h.state("active");
  for (let index = 0; index < 3; index++) {
    h.players.at(-1).finish();
    await flush();
  }
  assert.equal(h.plays(), 4);
  h.sound.unmount();
});

test("exhausted retries keep pending orders for next alert", async () => {
  const h = soundHarness({ playFailures: 3 });
  h.notify(2);
  await flush();
  await h.tick(1000);
  await h.tick(1000);
  assert.equal(h.attempts(), 3);
  assert.equal(h.timers.size, 0);
  h.notify(1);
  await flush();
  for (let index = 0; index < 3; index++) {
    h.players.at(-1).finish();
    await flush();
  }
  assert.equal(h.plays(), 3);
  h.sound.unmount();
});

test("stale completion events cannot skip a new order; unmount cancels everything", async () => {
  const h = soundHarness();
  h.notify(3);
  await flush();
  const first = h.players[0];
  first.finish();
  await flush();
  first.finish();
  await flush();
  assert.equal(h.plays(), 2);
  h.sound.unmount();
  h.notify(1);
  h.players.at(-1).finish();
  await flush();
  assert.equal(h.plays(), 2);
  assert.equal(h.timers.size, 0);
  assert.ok(h.players.every(player => player.removed));
});

test("native notice detects every paid order across repeated snapshots without duplicates", async () => {
  const source = readFileSync(resolve(nativeRoot, "src/admin/AdminNavigator.js"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const notice = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "OrderNotice");
  const call = notice.body.body.find(node => node.type === "ExpressionStatement" && node.expression.callee?.name === "useEffect").expression;
  const effect = call.arguments[0];
  const h = soundHarness();
  let count = 0, vibrations = 0;
  const context = {
    data: null, cursor: null, seen: { current: new Set() }, notify: h.notify,
    setCursor(value) { context.cursor = value; },
    setCount(update) { count = update(count); },
    Vibration: { vibrate() { vibrations++; } },
  };
  vm.createContext(context);
  const apply = vm.runInContext(`(${source.slice(effect.start, effect.end)})`, context);
  const baseline = [{ id: "100", kind: "card" }];
  context.data = { cursor: { afterId: "100", since: "2026-10-08 10:00:00" }, events: [...baseline] };
  apply();
  assert.equal(h.plays(), 0);
  for (const id of ["101", "102", "99", "103", "104"]) {
    context.data.events.push({ id, kind: "card" });
    apply();
    apply(); // repeated HTTP snapshot must not duplicate sound
    await flush();
    assert.equal(h.plays(), count);
    h.players.at(-1).finish();
    await flush();
  }
  assert.equal(count, 5);
  assert.equal(vibrations, 5);
  assert.equal(h.plays(), 5);
  h.sound.unmount();
});
function accountAction(name, context) {
  const source = readFileSync(resolve(nativeRoot, "src/CustomerAccount.js"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const component = ast.program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
  const action = component.body.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  vm.createContext(context);
  return vm.runInContext(`(${source.slice(action.start, action.end)})`, context);
}

test("native account requires selected address and submits all editable fields", async () => {
  let body, updates = 0;
  const context = {
    operation: { current: false }, dirty: { current: true },
    name: "Customer", phone: "600123456", apartment: "3 B", notes: "Ring bell",
    search: "Manual address", address: null, token: "customer-token",
    setError(value) { context.error = value; }, setSaved() {}, setBusy() {}, setSearch() {},
    async onUpdated() { updates++; },
    async api(url, options, token) {
      assert.equal(url, "/customer-auth/me");
      assert.equal(token, "customer-token");
      assert.equal(options.method, "PATCH");
      body = JSON.parse(options.body);
    },
  };
  const save = accountAction("save", context);
  await save();
  assert.match(context.error, /Selecciona/);
  assert.equal(body, undefined);
  context.search = "";
  context.address = { place_id: "selected", formatted_address: "Validated address" };
  await save();
  assert.deepEqual(body, { name: "Customer", phone: "600123456", delivery_apartment: "3 B", delivery_notes: "Ring bell", delivery_address_data: context.address });
  assert.equal(body.email, undefined);
  assert.equal(context.dirty.current, false);
  assert.equal(updates, 1);
});

test("native photo sends multipart image with authenticated API and refreshes avatar", async () => {
  let file, updates = 0;
  class NativeFormData { append(name, value) { assert.equal(name, "image"); file = value; } }
  const context = {
    image: { uri: "file:///photo.png", name: "photo.png", mimeType: "image/png" },
    token: "customer-token", operation: { current: false }, FormData: NativeFormData,
    setBusy() {}, setError() {}, setSaved() {}, setImage(value) { context.image = value; },
    async onUpdated() { updates++; },
    async api(url, options, token) {
      assert.equal(url, "/customer-auth/me/photo");
      assert.equal(options.method, "POST");
      assert.ok(options.body instanceof NativeFormData);
      assert.equal(token, "customer-token");
    },
  };
  await accountAction("uploadPhoto", context)();
  assert.equal(file.uri, "file:///photo.png");
  assert.equal(file.type, "image/png");
  assert.equal(updates, 1);
  assert.equal(context.image, null);
  assert.equal(context.operation.current, false);
});
