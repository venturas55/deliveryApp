import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { query, pool } from "../src/db.js";
import { signCustomer, signAdmin } from "../src/auth.js";
import customerRoutes from "../src/routes/customer-auth.js";
import { validateProfileImage } from "../src/services/customer-profile-image.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
test("profile photo checks type, signature, empty files and size", () => {
  assert.equal(validateProfileImage({ mimetype: "image/png", buffer: png }), ".png");
  assert.throws(() => validateProfileImage({ mimetype: "image/jpeg", buffer: png }), { status: 400 });
  assert.throws(() => validateProfileImage({ mimetype: "image/png", buffer: Buffer.from("fake") }), { status: 400 });
  assert.throws(() => validateProfileImage({ mimetype: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }), { status: 400 });
  assert.throws(() => validateProfileImage(), { status: 400 });
});

test("customer account API saves address and photo only for authenticated owner", { timeout: 45000 }, async () => {
  const ids = [];
  let server, uploadedFile;
  const originalFetch = globalThis.fetch;
  try {
    for (let index = 0; index < 2; index++) {
      const result = await query("INSERT INTO customers(name,email) VALUES(?,?)", ["Account fixture", `${randomUUID()}@example.invalid`]);
      ids.push(Number(result.insertId));
    }
    const app = express();
    app.set("json replacer", (key, value) => typeof value === "bigint" ? value.toString() : value);
    app.use(express.json());
    app.use("/api/customer-auth", customerRoutes);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}/api/customer-auth`;
    const token = signCustomer({ id: ids[0] });
    async function request(url, { status = 200, auth = token, ...options } = {}) {
      const response = await originalFetch(origin + url, { ...options, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...options.headers } });
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body;
    }
    await request("/address-search?q=Madrid", { auth: null, status: 401 });
    await request("/me/photo", { method: "POST", auth: null, status: 401 });
    await request("/me/photo", { method: "POST", auth: signAdmin({ id: 1, restaurant_id: 1 }), status: 403 });
    const address = { formatted_address: "Calle fixture 1, Madrid", street: "Calle fixture", number: "1", city: "Madrid", province: "Madrid", postal_code: "28001", country: "ES", latitude: 40.4, longitude: -3.7, place_id: "fixture-place" };
    await request("/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Updated fixture", phone: "600123456", delivery_apartment: "3 B", delivery_notes: "Call bell", delivery_address_data: address, email: "ignored@example.invalid", id: ids[1] }) });
    const originalKey = process.env.GEOAPIFY_API_KEY;
    process.env.GEOAPIFY_API_KEY = "fixture-key";
    globalThis.fetch = async () => new Response(JSON.stringify({results:[{
      formatted:address.formatted_address,street:address.street,housenumber:address.number,
      city:address.city,state:address.province,postcode:address.postal_code,country_code:"es",
      lat:address.latitude,lon:address.longitude,place_id:address.place_id,
    }]}),{status:200});
    try {
      const suggestions = await request("/address-search?q=Calle%20fixture%201");
      assert.equal(suggestions[0].place_id, address.place_id);
      assert.equal(suggestions[0].postal_code, "28001");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY;
      else process.env.GEOAPIFY_API_KEY = originalKey;
    }
    const profile = await request("/me");
    assert.equal(profile.name, "Updated fixture");
    assert.equal(profile.delivery_apartment, "3 B");
    assert.equal(profile.delivery_place_id, "fixture-place");
    assert.notEqual(profile.email, "ignored@example.invalid");
    const [other] = await query("SELECT name,profile_image_url FROM customers WHERE id=?", [ids[1]]);
    assert.equal(other.name, "Account fixture");
    await request("/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delivery_address_data: { formatted_address: "Manual invalid" } }), status: 400 });
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "test.png");
    form.append("customer_id", String(ids[1]));
    const saved = await request("/me/photo", { method: "POST", body: form });
    assert.match(saved.profile_image_url, /^\/uploads\/customers\/[a-f0-9-]+\.png$/);
    uploadedFile = path.join(process.cwd(), "public", saved.profile_image_url);
    assert.deepEqual(await readFile(uploadedFile), png);
    assert.equal((await request("/me")).profile_image_url, saved.profile_image_url);
    assert.equal((await query("SELECT profile_image_url FROM customers WHERE id=?", [ids[1]]))[0].profile_image_url, other.profile_image_url);
    const fake = new FormData();
    fake.append("image", new Blob(["not an image"], { type: "image/png" }), "fake.png");
    await request("/me/photo", { method: "POST", body: fake, status: 400 });
    await request("/me/photo", { method: "POST", status: 400 });
    const oversized = new FormData();
    oversized.append("image", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], {type:"image/png"}), "large.png");
    await request("/me/photo", { method:"POST", body:oversized, status:413 });
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    if (uploadedFile) await unlink(uploadedFile);
    for (const id of ids) await query("DELETE FROM customers WHERE id=?", [id]);
    await pool.end();
  }
});
