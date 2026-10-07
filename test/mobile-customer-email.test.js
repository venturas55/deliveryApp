import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { query, pool } from "../src/db.js";
import { signAdmin, signCustomer } from "../src/auth.js";
import apiRoutes from "../src/routes/api.js";

test("mobile customer email enforces scope and sends private text/flyer messages", { timeout: 60000 }, async () => {
  const restaurants = [], customers = [], messages = [], sockets = new Set();
  const envNames = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_AUTH_NEEDED", "EMAIL_ACCOUNT", "PUBLIC_URL"];
  const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  let server, smtp;
  try {
    // Local SMTP sink: captures MIME without delivering external email.
    smtp = net.createServer(socket => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
      socket.write("220 localhost ESMTP\r\n");
      let pending = "", data = null, recipient;
      socket.on("data", chunk => {
        pending += chunk.toString();
        while (pending.includes("\r\n")) {
          const index = pending.indexOf("\r\n"), line = pending.slice(0, index);
          pending = pending.slice(index + 2);
          if (data !== null) {
            if (line === ".") {
              messages.push({ recipient, mime: data.join("\r\n") });
              data = null; socket.write("250 queued\r\n");
            } else data.push(line);
          } else if (/^EHLO|^HELO/.test(line)) socket.write("250 localhost\r\n");
          else if (/^DATA/.test(line)) { data = []; socket.write("354 send data\r\n"); }
          else if (/^QUIT/.test(line)) socket.end("221 bye\r\n");
          else { if (/^RCPT TO:/.test(line)) recipient = line; socket.write("250 OK\r\n"); }
        }
      });
    });
    smtp.listen(0, "127.0.0.1"); await once(smtp, "listening");
    Object.assign(process.env, { EMAIL_HOST: "127.0.0.1", EMAIL_PORT: String(smtp.address().port),
      EMAIL_AUTH_NEEDED: "false", EMAIL_ACCOUNT: "sender@example.invalid", PUBLIC_URL: "https://restaurant.example" });
    const suffix = randomUUID();
    for (let i = 0; i < 2; i++) {
      const restaurant = await query("INSERT INTO restaurants(name,slug,phone,address,city) VALUES(?,?,?,?,?)",
        [`Email ${i}`, `email-${i}-${suffix}`, "+34900000000", "Test", "Madrid"]);
      restaurants.push(Number(restaurant.insertId));
      const customer = await query("INSERT INTO customers(name,email,phone) VALUES(?,?,?)",
        [`Email customer ${i}`, `${i}-${suffix}@example.invalid`, "900000000"]);
      customers.push(Number(customer.insertId));
      await query(`INSERT INTO orders(restaurant_id,customer_id,customer_name,customer_phone,delivery_address,
        payment_method,payment_status,delivery_method,status,subtotal_cents,total_cents)
        VALUES(?,?,?,?,?,'online','paid','pickup','delivered',100,100)`,
      [restaurants[i], customers[i], "Email test", "900000000", "Test"]);
    }
    const admin = await query("INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)",
      [restaurants[0], `${suffix}@example.invalid`, "not-used"]);
    const token = signAdmin({ id: Number(admin.insertId), restaurant_id: restaurants[0] });
    const app = express(); app.use(express.json()); app.use("/api", apiRoutes);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/admin/customers`;
    async function request(path, { body, auth = token, status = 200 } = {}) {
      const multipart = body instanceof FormData;
      const response = await fetch(base + path, { method: body ? "POST" : "GET",
        headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...(!multipart && body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result)); return result;
    }
    const content = { subject: "Oferta", message: "Pizza\nPromoción" };
    await request("/email/recipients", { auth: null, status: 401 });
    await request("/email", { auth: signCustomer({ id: customers[0] }), body: { ...content, confirm: "yes" }, status: 403 });
    assert.deepEqual(await request("/email/recipients"), { total: 1 });
    await request(`/${customers[1]}/email`, { body: content, status: 404 });
    await request(`/${customers[0]}/email`, { body: { ...content, subject: "bad\r\nsubject" }, status: 400 });
    await request("/email", { body: content, status: 400 });
    assert.equal(messages.length, 0);
    assert.deepEqual(await request(`/${customers[0]}/email`, { body: content }), { sent: 1, failed: 0, total: 1 });
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...content, confirm: "yes" })) form.append(key, value);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    form.append("image", new Blob([png], { type: "image/png" }), "offer.png");
    assert.deepEqual(await request("/email", { body: form }), { sent: 1, failed: 0, total: 1 });
    assert.equal(messages.length, 2);
    for (const message of messages) {
      assert.ok(message.recipient.includes(`0-${suffix}@example.invalid`));
      assert.ok(!message.mime.includes(`1-${suffix}@example.invalid`));
      assert.ok(!/^Bcc:/mi.test(message.mime));
    }
    assert.match(messages[1].mime, /Content-ID: <promotion-flyer@delivery>/);
    assert.match(messages[1].mime, /Content-Type: image\/png/);
    const invalid = new FormData();
    invalid.append("subject", "Oferta"); invalid.append("message", "Texto");
    invalid.append("image", new Blob(["fake"], { type: "image/png" }), "fake.png");
    await request(`/${customers[0]}/email`, { body: invalid, status: 400 });
    const oversized = new FormData();
    oversized.append("subject", "Oferta"); oversized.append("message", "Texto");
    oversized.append("image", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "big.png");
    await request(`/${customers[0]}/email`, { body: oversized, status: 400 });
    assert.equal(messages.length, 2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const socket of sockets) socket.destroy();
    if (smtp) await new Promise(resolve => smtp.close(resolve));
    for (const id of restaurants) await query("DELETE FROM restaurants WHERE id=?", [id]);
    for (const id of customers) await query("DELETE FROM customers WHERE id=?", [id]);
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await pool.end();
  }
});
