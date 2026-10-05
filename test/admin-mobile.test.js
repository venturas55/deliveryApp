import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
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
  let server;
  try {
    const suffix = randomUUID();
    for (let index = 0; index < 2; index++) {
      const result = await query("INSERT INTO restaurants(name,slug,phone,address,city) VALUES(?,?,?,?,?)", [`Mobile ${index}`, `mobile-${index}-${suffix}`, "+34900000000", "Test address", "Valencia"]);
      restaurants.push(Number(result.insertId));
    }
    const admin = await query("INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)", [restaurants[0], `${suffix}@example.invalid`, "not-used"]);
    const token = signAdmin({ id: Number(admin.insertId), restaurant_id: restaurants[1] }); // DB, not claimed restaurant, owns scope.
    for (let index = 0; index < 2; index++) {
      const result = await query("INSERT INTO customers(name,email,phone) VALUES(?,?,?)", [`Customer ${index}`, `${index}-${suffix}@example.invalid`, `90000000${index}`]);
      customers.push(Number(result.insertId));
    }
    const product = await query("INSERT INTO products(restaurant_id,name,price_cents) VALUES(?,?,?)", [restaurants[0], "Mobile product", 1234]);
    const productId = Number(product.insertId);
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
    const customerList = await request("/customers"); assert.equal(customerList.length, 1); assert.equal(customerList[0].id, customers[0]);
    assert.equal((await request("/customers?q=missing")).length, 0);
    await request(`/customers/${customers[1]}`, { status: 404 });
    const detail = await request(`/customers/${customers[0]}`); assert.equal(detail.orders.length, 1); assert.equal(detail.password_hash, undefined);
    const restaurant = await request("/restaurant"); assert.deepEqual(Object.keys(restaurant).sort(), ["address", "city", "id", "name", "phone"]);
    await request("/restaurant", { method: "PATCH", body: { restaurant_id: restaurants[1], name: "intrusion" }, status: 400 });
    assert.equal((await request("/restaurant", { method: "PATCH", body: { name: "Mobile updated", phone: "900000000" } })).name, "Mobile updated");
    const [other] = await query("SELECT name FROM restaurants WHERE id=?", [restaurants[1]]); assert.equal(other.name, "Mobile 1");
    const order = await request("/orders", { method: "POST", status: 201, body: { restaurant_id: restaurants[1], customer_id: customers[0], channel: "telephone", delivery_method: "pickup", payment_method: "cash", total_cents: 1, items: [{ product_id: productId, quantity: 2 }] } });
    assert.equal(order.total_cents, 2468); assert.equal(order.items[0].quantity, 2);
    await request("/orders", { method: "POST", status: 404, body: { customer_id: customers[1], channel: "telephone", delivery_method: "pickup", payment_method: "cash", items: [{ product_id: productId, quantity: 1 }] } });
    for (const status of ["accepted", "preparing", "ready", "delivered"]) await request(`/orders/${order.id}/status`, { method: "PATCH", body: { status } });
    await request(`/orders/${order.id}/status`, { method: "PATCH", body: { status: "accepted" }, status: 409 });
    await request(`/orders/${order.id}/mark-paid`, { method: "POST", body: {} });
    await request(`/orders/${order.id}/mark-paid`, { method: "POST", body: {}, status: 409 });
    const stats = await request("/stats"); assert.equal(stats.totals.orders, 1); assert.equal(stats.totals.sales_cents, 2468); assert.equal(stats.totals.average_cents, 2468); assert.equal(stats.daily.length, 14);
    await request(`/products/${productId}`, { method: "PATCH", body: { active: 0 } });
    await request("/orders", { method: "POST", status: 400, body: { customer_id: customers[0], channel: "telephone", delivery_method: "pickup", payment_method: "cash", items: [{ product_id: productId, quantity: 1 }] } });
    const [unavailable] = await query("SELECT active FROM products WHERE id=?", [productId]); assert.equal(unavailable.active, 0);
    const cursor = await request("/order-notifications");
    await request(`/order-notifications?afterId=${cursor.cursor.afterId}&since=${encodeURIComponent(cursor.cursor.since)}`);
    await request("/order-notifications?afterId=bad&since=bad", { status: 400 });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const id of restaurants) await query("DELETE FROM restaurants WHERE id=?", [id]);
    for (const id of customers) await query("DELETE FROM customers WHERE id=?", [id]);
    await pool.end();
  }
});
