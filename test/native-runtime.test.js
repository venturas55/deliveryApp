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

function loadSound(requireModule) {
  let effect, cleanup, error = "";
  const source = readFileSync(resolve(nativeRoot, "src/admin/useOrderSound.js"), "utf8")
    .replace(/^import .*from "react";\r?\n/m, "")
    .replace("export default function", "function");
  const context = {
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

test("native sound queues alerts and releases player on unmount", async () => {
  let status, plays = 0, removed = 0, paused = 0, unsubscribed = 0;
  const player = {
    isLoaded: true,
    async seekTo(position) { assert.equal(position, 0); },
    play() { plays++; },
    pause() { paused++; },
    remove() { removed++; },
    addListener(event, listener) {
      assert.equal(event, "playbackStatusUpdate");
      status = listener;
      return { remove() { unsubscribed++; } };
    },
  };
  const sound = loadSound(name => name === "expo-audio" ? {
    createAudioPlayer: () => player,
    setAudioModeAsync: async () => {},
  } : 1);
  const { notify } = sound.mount(true);
  notify(2);
  await new Promise(setImmediate);
  assert.equal(plays, 1);
  status({ didJustFinish: true });
  await new Promise(setImmediate);
  assert.equal(plays, 2);
  sound.unmount();
  notify(1);
  assert.equal(plays, 2);
  assert.equal(paused, 1);
  assert.equal(removed, 1);
  assert.equal(unsubscribed, 1);
});
