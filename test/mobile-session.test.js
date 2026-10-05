import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("shared native session restores administrator, rotates once, revokes and clears role", async () => {
  const storage = new Map(), calls = [], legacyRemoved = [];
  const context = vm.createContext({
    AsyncStorage: { removeItem: async key => legacyRemoved.push(key) },
    SecureStore: { getItemAsync: async key => storage.get(key), setItemAsync: async (key,value) => storage.set(key,value), deleteItemAsync: async key => storage.delete(key) },
    API_BASE_URL: "https://example.invalid/api",
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/auth/refresh")) return response(200, { accessToken: "renewed-admin", refreshToken: "rotated" });
      if (url.endsWith("/auth/logout")) return response(204);
      return options.headers.Authorization === "Bearer renewed-admin" ? response(200, { role: "admin" }) : response(401);
    },
  });
  function response(status, data) { return { status, ok: status >= 200 && status < 300, headers: { get: () => data ? "application/json" : "" }, json: async () => data }; }
  const source = readFileSync(new URL("../react-native/src/api.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  vm.runInContext(source + "\nglobalThis.session={saveSession,getSessionRole,restoreSession,logoutSession,api};", context);
  const session = context.session;
  assert.equal(await session.getSessionRole(), "customer");
  await session.saveSession({ accessToken: "expired-admin", refreshToken: "initial", admin: { id: 1 } });
  assert.equal(await session.getSessionRole(), "admin");
  assert.equal(storage.get("refreshToken"), "initial");
  assert.ok(![...storage.values()].includes("expired-admin"));
  const [first, second] = await Promise.all([session.api("/admin/me"), session.api("/admin/me")]);
  assert.equal(first.role, "admin"); assert.equal(second.role, "admin");
  assert.equal(calls.filter(call => call.url.endsWith("/auth/refresh")).length, 1);
  assert.equal(storage.get("refreshToken"), "rotated");
  assert.equal(await session.restoreSession(), "renewed-admin");
  assert.deepEqual(legacyRemoved, ["customerToken"]);
  await session.logoutSession();
  assert.equal(storage.size, 0); assert.equal(await session.getSessionRole(), "customer");
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith("/auth/logout")).options.body).refreshToken, "rotated");
  await session.saveSession({ accessToken: "customer", refreshToken: "customer-refresh", customer: { id: 1 } });
  assert.equal(await session.getSessionRole(), "customer");
});
