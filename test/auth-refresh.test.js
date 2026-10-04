import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import jwt from "jsonwebtoken";
import { query, pool } from "../src/db.js";
import { hashPassword, signAdmin } from "../src/auth.js";

test("mobile auth issues, rotates, revokes and scopes refresh sessions", { timeout: 60000 }, async (t) => {
  let restaurantId;
  let otherRestaurantId;
  let server;
  const customerIds = [];
  let adminId;
  const sessionsTable = `CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role ENUM('customer','admin') NOT NULL,
    subject_id INT NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    INDEX idx_auth_refresh_family (family_id, revoked_at),
    INDEX idx_auth_refresh_subject (role, subject_id)
  )`;

  try {
    await query(sessionsTable);
    const slug = `auth-${randomUUID()}`;
    const restaurant = await query(
      "INSERT INTO restaurants(name,slug) VALUES(?,?)",
      ["Auth refresh test", slug],
    );
    restaurantId = Number(restaurant.insertId);

    const listener = net.createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    server = spawn(process.execPath, ["src/server.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        DELIVERY_PROVIDER: "mock",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server startup timeout")),
        8000,
      );
      server.stdout.on("data", (chunk) => {
        if (String(chunk).includes("Pizzeria v0.2")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited: ${code}`));
      });
    });

    async function post(path, body, expectedStatus) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);
      return response.status === 204 ? null : response.json();
    }

    const email = `${slug}@example.invalid`;
    const password = "customer-test-password";
    await post("/api/auth/refresh", { refreshToken: "invalid" }, 400);
    const registered = await post(
      "/api/customer-auth/register",
      { name: "Auth test customer", email, password },
      201,
    );
    customerIds.push(Number(registered.customer.id));
    assert.equal(registered.token, registered.accessToken);
    const claims = jwt.decode(registered.accessToken);
    assert.equal(claims.role, "customer");
    assert.deepEqual(Object.keys(claims).filter((key) => !["iat", "exp"].includes(key)).sort(), ["role", "sub"]);
    assert.ok(claims.exp - claims.iat >= 1799 && claims.exp - claims.iat <= 1800);
    const profile = await fetch(
      `http://127.0.0.1:${port}/api/customer-auth/me`,
      { headers: { Authorization: `Bearer ${registered.accessToken}` } },
    );
    assert.equal(profile.status, 200);

    const customerRefresh = registered.refreshToken;
    const refreshHash = createHash("sha256")
      .update(customerRefresh)
      .digest("hex");
    const lifetime = await query(
      `SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds_left
       FROM auth_refresh_tokens WHERE token_hash=?`,
      [refreshHash],
    );
    assert.ok(
      Number(lifetime[0].seconds_left) >= 30 * 24 * 60 * 60 - 30 &&
        Number(lifetime[0].seconds_left) <= 30 * 24 * 60 * 60,
    );
    const rotated = await post(
      "/api/auth/refresh",
      { refreshToken: customerRefresh },
      200,
    );
    assert.notEqual(rotated.refreshToken, customerRefresh);
    const stored = await query(
      "SELECT token_hash, revoked_at FROM auth_refresh_tokens WHERE role='customer' AND subject_id=? ORDER BY id DESC LIMIT 2",
      [registered.customer.id],
    );
    assert.equal(
      stored[0].token_hash,
      createHash("sha256").update(rotated.refreshToken).digest("hex"),
    );
    assert.notEqual(stored[0].token_hash, rotated.refreshToken);
    assert.ok(stored[1].revoked_at);

    await post(
      "/api/auth/refresh",
      { refreshToken: customerRefresh },
      401,
    );
    await post(
      "/api/auth/refresh",
      { refreshToken: rotated.refreshToken },
      401,
    );

    const logoutSession = await post(
      "/api/customer-auth/login",
      { email, password },
      200,
    );
    await post(
      "/api/auth/logout",
      { refreshToken: logoutSession.refreshToken },
      204,
    );
    await post(
      "/api/auth/logout",
      { refreshToken: logoutSession.refreshToken },
      204,
    );
    await post(
      "/api/auth/refresh",
      { refreshToken: logoutSession.refreshToken },
      401,
    );
    await post(
      "/api/auth/logout",
      { refreshToken: "invalid" },
      400,
    );

    const expiredSession = await post(
      "/api/customer-auth/login",
      { email, password },
      200,
    );
    const expiredHash = createHash("sha256")
      .update(expiredSession.refreshToken)
      .digest("hex");
    await query(
      "UPDATE auth_refresh_tokens SET expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE token_hash=?",
      [expiredHash],
    );
    await post(
      "/api/auth/refresh",
      { refreshToken: expiredSession.refreshToken },
      401,
    );

    const concurrentSession = await post(
      "/api/customer-auth/login",
      { email, password },
      200,
    );
    const concurrent = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: concurrentSession.refreshToken }),
      }),
      fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: concurrentSession.refreshToken }),
      }),
    ]);
    assert.deepEqual(
      concurrent.map((response) => response.status).sort(),
      [200, 401],
    );
    const successfulRotation = await concurrent.find(
      (response) => response.status === 200,
    ).json();
    await post(
      "/api/auth/refresh",
      { refreshToken: successfulRotation.refreshToken },
      401,
    );

    const adminEmail = `admin-${slug}@example.invalid`;
    const admin = await query(
      "INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)",
      [restaurantId, adminEmail, await hashPassword("admin-test-password")],
    );
    adminId = Number(admin.insertId);
    const adminLogin = await post(
      "/api/auth/login",
      { email: adminEmail, password: "admin-test-password" },
      200,
    );
    const adminClaims = jwt.decode(adminLogin.accessToken);
    assert.equal(adminClaims.role, "admin");
    assert.equal(Number(adminClaims.restaurant_id), restaurantId);
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/admin/me`, {
        headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
      })).status,
      200,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/admin/me`, {
        headers: { Authorization: `Bearer ${registered.accessToken}` },
      })).status,
      403,
    );
    const missingAdminToken = signAdmin({
      id: -1,
      restaurant_id: restaurantId,
      email: "missing@example.invalid",
    });
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/admin/me`, {
        headers: { Authorization: `Bearer ${missingAdminToken}` },
      })).status,
      401,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/customer/orders`, {
        headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
      })).status,
      403,
    );
    otherRestaurantId = Number(
      (
        await query("INSERT INTO restaurants(name,slug) VALUES(?,?)", [
          "Refreshed admin restaurant",
          `${slug}-new`,
        ])
      ).insertId,
    );
    await query("UPDATE admins SET restaurant_id=? WHERE id=?", [
      otherRestaurantId,
      adminId,
    ]);
    const reauthorized = await fetch(
      `http://127.0.0.1:${port}/api/admin/me`,
      { headers: { Authorization: `Bearer ${adminLogin.accessToken}` } },
    );
    assert.equal(reauthorized.status, 200);
    assert.equal(
      Number((await reauthorized.json()).restaurant_id),
      otherRestaurantId,
    );
    const adminRefresh = await post(
      "/api/auth/refresh",
      { refreshToken: adminLogin.refreshToken },
      200,
    );
    assert.equal(jwt.decode(adminRefresh.accessToken).role, "admin");
    assert.equal(
      Number(jwt.decode(adminRefresh.accessToken).restaurant_id),
      otherRestaurantId,
    );
    await query("UPDATE restaurants SET active=0 WHERE id=?", [
      otherRestaurantId,
    ]);
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/admin/me`, {
        headers: { Authorization: `Bearer ${adminRefresh.accessToken}` },
      })).status,
      401,
    );
    await post(
      "/api/auth/refresh",
      { refreshToken: adminRefresh.refreshToken },
      401,
    );
  } finally {
    if (server?.pid) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    if (customerIds.length) {
      await query(
        "DELETE FROM auth_refresh_tokens WHERE role='customer' AND subject_id IN (?)",
        [customerIds],
      );
      await query("DELETE FROM customers WHERE id IN (?)", [customerIds]);
    }
    if (adminId) {
      await query(
        "DELETE FROM auth_refresh_tokens WHERE role='admin' AND subject_id=?",
        [adminId],
      );
      await query("DELETE FROM admins WHERE id=?", [adminId]);
    }
    if (restaurantId) await query("DELETE FROM restaurants WHERE id=?", [restaurantId]);
    if (otherRestaurantId)
      await query("DELETE FROM restaurants WHERE id=?", [otherRestaurantId]);
    await pool.end();
  }
});
