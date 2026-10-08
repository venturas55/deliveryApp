import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { query, pool } from "../src/db.js";
import { signAdmin, signCustomer } from "../src/auth.js";
import apiRoutes from "../src/routes/api.js";
import { mobileOrder } from "../src/controllers/admin-mobile.js";

test("mobile order projection excludes provider payloads and payment references", () => {
  const dto = mobileOrder({ id: 1, status: "ready", delivery_method: "pickup", redsys_order: "secret", delivery_details_json: JSON.stringify({ secret: "private" }), events: [{ event_type: "delivery.requested", payload_json: '{"token":"secret"}' }], items: [] });
  assert.equal(dto.canCompletePickup, true);
  assert.equal(dto.canQuote, false);
  assert.equal(dto.redsys_order, undefined);
  assert.equal(dto.delivery.secret, undefined);
  assert.equal(dto.events[0].payload_json, undefined);
});

test("admin mobile uses real database, enforces restaurant scope and shares order operations", { timeout: 60000 }, async () => {
  const restaurants = [], customers = [];
  let server, productId;
  try {
    const suffix = randomUUID();
    for (let index = 0; index < 2; index++) {
      const result = await query("INSERT INTO restaurants(name,slug,phone,address,city) VALUES(?,?,?,?,?)", [`Mobile ${index}`, `mobile-${index}-${suffix}`, "+34900000000", "Test address", "Valencia"]);
      restaurants.push(Number(result.insertId));
    }
    const admin = await query("INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)", [restaurants[0], `${suffix}@example.invalid`, "not-used"]);
    const token = signAdmin({ id: Number(admin.insertId), restaurant_id: restaurants[1] }); // DB, not claimed restaurant, owns scope.
    for (let index = 0; index < 2; index++) {
      const result = await query("INSERT INTO customers(name,email,phone,delivery_address,delivery_formatted_address) VALUES(?,?,?,?,?)", [`Customer ${index}`, `${index}-${suffix}@example.invalid`, `90000000${index}`, `Address ${index}`, `Formatted address ${index}`]);
      customers.push(Number(result.insertId));
    }
    await query("UPDATE customers SET profile_image_url=? WHERE id=?", ["/uploads/customers/test-avatar.png", customers[0]]);
    const product = await query("INSERT INTO products(restaurant_id,name,price_cents) VALUES(?,?,?)", [restaurants[0], "Mobile product", 1234]);
    productId = Number(product.insertId);
    const orderIds = [];
    for (let index = 0; index < 2; index++) {
      const result = await query(`INSERT INTO orders(restaurant_id,customer_id,customer_name,customer_phone,delivery_address,payment_method,payment_status,delivery_method,status,subtotal_cents,total_cents)
        VALUES(?,?,?,?,?,'online','paid','pickup','new',1234,1234)`, [restaurants[index], customers[index], `Customer ${index}`, "900000000", "Recogida"]);
      orderIds.push(String(result.insertId));
    }
    const app = express();
    app.set("json replacer", (key,value) => typeof value === "bigint" ? value.toString() : value);
    app.use(express.json()); app.use("/api", apiRoutes);
    app.use((error,req,res,next) => res.status(error.status || 500).json({ error: error.message }));
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/admin`;
    async function request(path, { method = "GET", body, auth = token, status = 200 } = {}) {
      const response = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    }
    await request("/dashboard", { auth: null, status: 401 });
    await request("/dashboard", { auth: signCustomer({ id: customers[0] }), status: 403 });
    assert.equal((await request("/me")).restaurant_id, restaurants[0]);
    const dashboard = await request("/dashboard"); assert.equal(dashboard.today.orders, 1); assert.equal(dashboard.today.sales_cents, 1234);
    const list = await request("/orders?view=mobile&status=new"); assert.equal(list.length, 1); assert.equal(String(list[0].id), orderIds[0]); assert.equal(list[0].redsys_order, undefined);
    await request("/orders?status=wrong", { status: 400 });
    await request("/orders?before_id=invalid", { status: 400 });
    assert.equal((await request(`/orders?before_id=${orderIds[0]}`)).length, 0);
    await request(`/orders/${orderIds[1]}?view=mobile`, { status: 404 });
    await request(`/orders/${orderIds[1]}/status`, { method: "PATCH", body: { status: "cancelled" }, status: 404 });
    const [untouched] = await query("SELECT status,payment_status FROM orders WHERE id=?", [orderIds[1]]);
    assert.equal(untouched.status, "new"); assert.equal(untouched.payment_status, "paid");
    const customerList = await request("/customers"); assert.equal(customerList.length, 1); assert.equal(customerList[0].id, customers[0]); assert.equal(customerList[0].delivery_address, "Address 0"); assert.equal(customerList[0].delivery_formatted_address, "Formatted address 0");
    assert.equal((await request("/customers?q=missing")).length, 0);
    await request(`/customers/${customers[1]}`, { status: 404 });
    const detail = await request(`/customers/${customers[0]}`); assert.equal(detail.orders.length, 1); assert.equal(detail.delivery_address, "Address 0"); assert.equal(detail.delivery_formatted_address, "Formatted address 0"); assert.equal(detail.password_hash, undefined);
    const restaurant = await request("/restaurant"); assert.ok(restaurant.slug); assert.ok("legal_email" in restaurant); assert.ok("delivery_base_cents" in restaurant);
    await request("/restaurant", { method: "PATCH", body: { restaurant_id: restaurants[1], name: "intrusion" }, status: 400 });
    assert.equal((await request("/restaurant", { method: "PATCH", body: { name: "Mobile updated", phone: "900000000" } })).name, "Mobile updated");
    const settings = await request("/restaurant", { method: "PATCH", body: { legal_name: "Legal owner", legal_email: "legal@example.invalid", tax_id: "B12345678", legal_address: "", legal_registration: "", delivery_base_cents: "3,25", free_delivery_from_cents: "30.00" } });
    assert.equal(settings.delivery_base_cents, 325); assert.equal(settings.free_delivery_from_cents, 3000); assert.equal(settings.legal_name, "Legal owner");
    await request("/restaurant", { method: "PATCH", body: { legal_email: "bad-email" }, status: 400 });
    await request("/restaurant", { method: "PATCH", body: { delivery_base_cents: "-1" }, status: 400 });
    await request("/restaurant", { method: "PATCH", body: { address: "unverified" }, status: 400 });
    await request("/restaurant", { method: "PATCH", body: { delivery_address_data: { formatted_address: "Invalid" } }, status: 400 });
    const logoForm = new FormData();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    logoForm.append("logo", new Blob([png], { type: "image/png" }), "logo.png");
    const logoResponse = await fetch(`${base}/restaurant`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: logoForm });
    assert.equal(logoResponse.status, 200);
    const savedLogo = await logoResponse.json();
    assert.match(savedLogo.logo_url, /^\/uploads\/restaurants\/[0-9a-f-]+\.png$/);
    assert.equal((await request("/restaurant")).logo_url, savedLogo.logo_url);
    // This test app has no public static middleware; verify actual bytes on disk.
    const { readFile } = await import("node:fs/promises");
    assert.deepEqual(await readFile(path.join(process.cwd(), "public", savedLogo.logo_url.slice(1))), png);
    const badLogo = new FormData();
    badLogo.append("logo", new Blob(["invalid"], { type: "image/png" }), "bad.png");
    assert.equal((await fetch(`${base}/restaurant`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: badLogo })).status, 400);
    assert.equal((await request("/restaurant")).logo_url, savedLogo.logo_url);
    await request("/restaurant", { method: "PATCH", body: { logo_url: "https://example.invalid/logo.png" }, status: 400 });
    const [otherLogo] = await query("SELECT logo_url FROM restaurants WHERE id=?", [restaurants[1]]);
    assert.equal(otherLogo.logo_url, null);
    const [other] = await query("SELECT name FROM restaurants WHERE id=?", [restaurants[1]]); assert.equal(other.name, "Mobile 1");
    const customerCards = await request("/customers");
    assert.equal(customerCards.find(customer => Number(customer.id) === customers[0]).profile_image_url, "/uploads/customers/test-avatar.png");
    assert.ok(!customerCards.some(customer => Number(customer.id) === customers[1]));
    const order = await request("/orders", { method: "POST", status: 201, body: { restaurant_id: restaurants[1], customer_id: customers[0], channel: "telephone", delivery_method: "pickup", payment_method: "cash", total_cents: 1, items: [{ product_id: productId, quantity: 2 }] } });
    assert.equal(order.total_cents, 2468); assert.equal(order.items[0].quantity, 2);
    await request("/orders", { method: "POST", status: 404, body: { customer_id: customers[1], channel: "telephone", delivery_method: "pickup", payment_method: "cash", items: [{ product_id: productId, quantity: 1 }] } });
    for (const status of ["accepted", "preparing", "ready", "delivered"]) await request(`/orders/${order.id}/status`, { method: "PATCH", body: { status } });
    await request(`/orders/${order.id}/status`, { method: "PATCH", body: { status: "accepted" }, status: 409 });
    await request(`/orders/${order.id}/mark-paid`, { method: "POST", body: {} });
    await request(`/orders/${order.id}/mark-paid`, { method: "POST", body: {}, status: 409 });
    await query("UPDATE orders SET created_at=CONCAT(CURRENT_DATE,' 14:35:00') WHERE id=?", [order.id]);
    const stats = await request("/stats"); assert.equal(stats.totals.orders, 1); assert.equal(stats.totals.sales_cents, 2468); assert.equal(stats.totals.average_cents, 2468); assert.equal(stats.daily.length, 14);
    assert.ok(stats.daily.every(day => day.hourly.length === 24));
    const [today] = await query("SELECT DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') AS today");
    const todayStats = stats.daily.find(day => day.day === today.today);
    assert.equal(todayStats.hourly.find(hour => hour.label === "14:00").total, 1);
    assert.equal(stats.historicalHourly.length, 24);
    assert.equal(stats.historicalHourly.find(hour => hour.label === "14:00").total, 1);
    assert.equal(stats.customerSpending[0].id, customers[0]);
    assert.equal(stats.customerSpending[0].total_spent_cents, 2468);
    const imageForm = new FormData();
    imageForm.append("product", JSON.stringify({ name: "Mobile product", price_cents: 1234 }));
    imageForm.append("image", new Blob(["test image"], { type: "image/png" }), "product.png");
    const imageResponse = await fetch(`${base}/products/${productId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: imageForm,
    });
    assert.equal(imageResponse.status, 200, await imageResponse.text());
    const [withImage] = await query("SELECT image_url FROM products WHERE id=?", [productId]);
    assert.match(withImage.image_url, /^\/uploads\/products\/[0-9a-f-]+\.png$/);
    await request(`/products/${productId}`, { method: "PATCH", body: { image_url: "" } });
    const [withoutImage] = await query("SELECT image_url FROM products WHERE id=?", [productId]);
    assert.equal(withoutImage.image_url, "");
    await request(`/products/${productId}`, { method: "PATCH", body: { active: 0 } });
    await request("/orders", { method: "POST", status: 400, body: { customer_id: customers[0], channel: "telephone", delivery_method: "pickup", payment_method: "cash", items: [{ product_id: productId, quantity: 1 }] } });
    const [unavailable] = await query("SELECT active FROM products WHERE id=?", [productId]); assert.equal(unavailable.active, 0);
    const cursor = await request("/order-notifications");
    await request(`/order-notifications?afterId=${cursor.cursor.afterId}&since=${encodeURIComponent(cursor.cursor.since)}`);
    await request("/order-notifications?afterId=bad&since=bad", { status: 400 });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (productId) {
      const [product] = await query("SELECT image_url FROM products WHERE id=?", [productId]);
      if (product?.image_url?.startsWith("/uploads/products/"))
        await rm(path.join(process.cwd(), "public", product.image_url.slice(1)), { force: true });
    }
    for (const id of restaurants) {
      const [restaurant] = await query("SELECT logo_url FROM restaurants WHERE id=?", [id]);
      if (restaurant?.logo_url?.startsWith("/uploads/restaurants/")) await rm(path.join(process.cwd(), "public", restaurant.logo_url.slice(1)), { force: true });
      await query("DELETE FROM restaurants WHERE id=?", [id]);
    }
    for (const id of customers) await query("DELETE FROM customers WHERE id=?", [id]);
    await pool.end();
  }
});
