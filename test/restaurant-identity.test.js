import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { engine } from "express-handlebars";
import { query, pool } from "../src/db.js";
import { getRestaurant } from "../src/services/restaurants.js";
import apiRoutes from "../src/routes/api.js";
import pageRoutes from "../src/routes/pages.js";

test("restaurant ID survives slug changes across menu, web, authentication and checkout", async () => {
  const previous = process.env.DEFAULT_RESTAURANT_ID;
  const ids = [], customers = [];
  let server;
  try {
    const suffix = randomUUID();
    for (let i = 0; i < 2; i++) {
      const row = await query("INSERT INTO restaurants(name,slug,address,phone) VALUES(?,?,?,?)", [`Stable ${i} ${suffix}`, `identity-${i}-${suffix}`, "Pickup address", "900000000"]);
      ids.push(Number(row.insertId));
    }
    process.env.DEFAULT_RESTAURANT_ID = String(ids[0]);
    const product = await query("INSERT INTO products(restaurant_id,name,price_cents) VALUES(?,?,?)", [ids[0], "Identity pizza", 1000]);
    const productId = Number(product.insertId);
    const app = express();
    const views = path.join(process.cwd(), "src/views");
    app.engine("handlebars", engine({ defaultLayout: "main", layoutsDir: path.join(views, "layouts"), partialsDir: path.join(views, "partials"), helpers: {
      eq: (a,b)=>String(a)===String(b), money: v=>String(Number(v||0)/100), decimal: v=>String(Number(v||0)/100), multiply: (a,b)=>a*b, date: v=>String(v), json: v=>JSON.stringify(v||{}),
    } }));
    app.set("views", views); app.set("view engine", "handlebars");
    app.set("json replacer", (_,v)=>typeof v==="bigint"?v.toString():v);
    app.use(cookieParser()); app.use(express.json()); app.use(express.urlencoded({extended:false}));
    app.use("/api", apiRoutes); app.use(pageRoutes);
    app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, body, token, status=200) {
      const response = await fetch(base+url, {method:body?"POST":"GET", headers:{"Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{})}, ...(body?{body:JSON.stringify(body)}:{})});
      assert.equal(response.status,status,await response.clone().text());
      return response.headers.get("content-type")?.includes("application/json")?response.json():response.text();
    }
    assert.equal((await request("/api/public/menu")).restaurant.id,ids[0]);
    await query("UPDATE restaurants SET slug=? WHERE id=?", [`changed-${suffix}`,ids[0]]);
    assert.equal((await getRestaurant(ids[0])).slug,`changed-${suffix}`);
    assert.equal((await request("/api/public/menu")).restaurant.id,ids[0]);
    assert.equal((await request(`/api/public/menu?restaurant_id=${ids[1]}`)).restaurant.id,ids[1]);
    await request("/api/public/menu?restaurant_id=demo",undefined,undefined,400);
    await request("/api/public/menu?restaurant_id=2147483647",undefined,undefined,404);
    for (const url of ["/",`/product/${productId}`,"/aviso-legal","/client/login"]) {
      assert.ok((await request(url)).includes(`Stable 0 ${suffix}`));
    }
    const account = {name:"ID customer",email:`id-${suffix}@example.invalid`,password:"identity-password-123",restaurant_id:ids[0]};
    const registered = await request("/api/customer-auth/register",account,undefined,201);
    customers.push(Number(registered.customer.id));
    const logged = await request("/api/customer-auth/login",account);
    await query("UPDATE customers SET phone='900000000' WHERE id=?",[registered.customer.id]);
    const order = await request("/api/orders",{restaurant_id:ids[0],delivery_method:"pickup",payment_method:"cash",items:[{product_id:productId,quantity:1}]},logged.token,201);
    const [stored] = await query("SELECT restaurant_id FROM orders WHERE id=?",[order.id]);
    assert.equal(stored.restaurant_id,ids[0]);
    await request("/api/orders",{restaurant_id:ids[1],delivery_method:"pickup",payment_method:"cash",items:[{product_id:productId,quantity:1}]},logged.token,400);
    await query("UPDATE restaurants SET active=0 WHERE id=?",[ids[1]]);
    await request(`/api/public/menu?restaurant_id=${ids[1]}`,undefined,undefined,404);
    await query("UPDATE restaurants SET active=1 WHERE id=?",[ids[1]]);
    delete process.env.DEFAULT_RESTAURANT_ID;
    await request("/api/public/menu",undefined,undefined,503);
    await request("/",undefined,undefined,503);
  } finally {
    if(previous===undefined)delete process.env.DEFAULT_RESTAURANT_ID; else process.env.DEFAULT_RESTAURANT_ID=previous;
    if(server)await new Promise(resolve=>server.close(resolve));
    for(const id of ids)await query("DELETE FROM restaurants WHERE id=?",[id]);
    for(const id of customers)await query("DELETE FROM customers WHERE id=?",[id]);
    await pool.end();
  }
});
