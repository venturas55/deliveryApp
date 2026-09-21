import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {randomUUID} from "node:crypto";
import {query,pool} from "../src/db.js";
import {signAdmin,hashPassword} from "../src/auth.js";

// Integration test: requires the configured MariaDB and schema.sql.
// Only the temporary restaurant created here is removed afterwards.
test("mock delivery: full lifecycle, isolation, duplicates and cancellation",{timeout:60000},async()=>{
  let restaurantId,server;
  const customerIds=[];
  try{
    const slug="test-"+randomUUID();
    const restaurant=await query("INSERT INTO restaurants(name,slug) VALUES(?,?)",["Test mock delivery",slug]);
    restaurantId=Number(restaurant.insertId);
    const product=await query("INSERT INTO products(restaurant_id,name,price_cents) VALUES(?,?,?)",[restaurantId,"Test pizza",950]);
    const listener=net.createServer();listener.listen(0,"127.0.0.1");await once(listener,"listening");
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    server=spawn(process.execPath,["src/server.js"],{env:{...process.env,PORT:String(port),DELIVERY_PROVIDER:"mock",GOOGLE_CLIENT_ID:"test-client.apps.googleusercontent.com"},stdio:["ignore","pipe","pipe"]});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Server startup timeout")),8000);
      server.stdout.on("data",chunk=>{if(String(chunk).includes("Pizzeria v0.2")){clearTimeout(timer);resolve()}});
      server.once("error",error=>{clearTimeout(timer);reject(error)});
      server.once("exit",code=>{clearTimeout(timer);reject(new Error("Server exited: "+code))});
    });
    const adminEmail=`admin-${slug}@example.invalid`;
    await query("INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)",[restaurantId,adminEmail,await hashPassword("admin-test-password")]);
    const token=signAdmin({id:1,restaurant_id:restaurantId,email:"test@example.invalid"});
    for(const [route,element] of [["/","menu"],["/index.html","menu"],["/admin/login","login"],["/client/login","customerLogin"]]){
      const response=await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status,200);
      const html=await response.text();assert.ok(html.includes(`id="${element}"`));
      assert.equal((html.match(/<main\b/g)||[]).length,1);
      assert.equal((html.match(/<header>/g)||[]).length,1);
      assert.ok(!html.includes("{{"));
      if(!route.startsWith("/admin"))assert.doesNotMatch(html,/href="\/admin(?:[\/."])/);
    }
    for(const route of ["/admin/orders","/admin/products","/client/account","/client/orders","/tracking?id=1"]){
      const response=await fetch(`http://127.0.0.1:${port}${route}`,{redirect:"manual"});
      assert.equal(response.status,303);
      await response.text();
    }
    for(const asset of ["/style.css","/page-behavior.js","/google-login.js"]){
      const response=await fetch(`http://127.0.0.1:${port}${asset}`);assert.equal(response.status,200);await response.text();
    }
    for(const missing of ["/missing-page","/api/missing-route","/views/store.handlebars"]){
      const response=await fetch(`http://127.0.0.1:${port}${missing}`);
      assert.equal(response.status,404);
      await response.json();
    }
    const otherToken=signAdmin({id:1,restaurant_id:-1,email:"other@example.invalid"});
    async function request(path,method="GET",body,expected=200,auth=token){
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${auth}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const data=await response.json();
      assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    }
    const email=`${slug}@example.invalid`,password="test-password-123";
    const registered=await request("/api/customer-auth/register","POST",{name:"Test customer",email,password},201,null);
    customerIds.push(registered.customer.id);
    const clientToken=registered.token;
    await request("/api/customer-auth/me","PATCH",{phone:"000000000",delivery_address:"Test address",delivery_notes:"Ring bell"},200,clientToken);
    const profile=await request("/api/customer-auth/me","GET",undefined,200,clientToken);
    assert.equal(profile.phone,"000000000");
    assert.equal(profile.delivery_address,"Test address");
    await request("/api/customer-auth/me","PATCH",{name:" "},400,clientToken);
    await request("/api/customer-auth/me","PATCH",{delivery_address:"x".repeat(501)},400,clientToken);
    await request("/api/customer-auth/me","PATCH",{name:"Unauthorized"},401,null);
    const second=await request("/api/customer-auth/register","POST",{name:"Other",email:`other-${email}`,password},201,null);
    customerIds.push(second.customer.id);
    await request("/api/customer-auth/register","POST",{name:"Duplicate",email,password},409,null);
    await request("/api/customer-auth/login","POST",{email,password:"wrong"},401,null);
    assert.ok((await request("/api/customer-auth/login","POST",{email,password},200,null)).token);
    await request("/api/admin/orders","GET",undefined,403,clientToken);
    await request("/api/customer/orders","GET",undefined,403,token);
    await request("/api/customer-auth/google","POST",{credential:"forged"},401,null);
    await request("/api/orders","POST",{},401,null);
    const create=()=>request("/api/orders","POST",{slug,items:[{product_id:Number(product.insertId),quantity:2}]},201,clientToken);
    const order=await create();
    const pickupOrder=await request("/api/orders","POST",{slug,items:[{product_id:Number(product.insertId),quantity:1}],delivery_method:"pickup"},201,clientToken);
    assert.equal(pickupOrder.delivery_method,"pickup");
    assert.equal((await request(`/api/customer/orders/${pickupOrder.id}`,"GET",undefined,200,clientToken)).delivery_method,"pickup");
    await request("/api/customer-auth/me","PATCH",{delivery_address:"New address"},200,clientToken);
    assert.equal((await request(`/api/customer/orders/${order.id}`,"GET",undefined,200,clientToken)).delivery_address,"Test address");
    assert.equal((await request("/api/customer-auth/me","GET",undefined,200,second.token)).delivery_address,"");
    assert.deepEqual((await request("/api/admin/orders?filter=pending")).map(o=>Number(o.id)),[order.id]);
    assert.equal((await request("/api/admin/orders?filter=in_progress")).length,0);
    await request("/api/admin/orders?filter=invalid","GET",undefined,400);
    await request(`/api/customer/orders/${order.id}`,"GET",undefined,404,second.token);
    await request(`/api/orders/${order.id}/public`,"GET",undefined,401,null);
    assert.equal((await request("/api/customer/orders","GET",undefined,200,clientToken)).length,1);
    assert.equal((await request("/api/customer/orders","GET",undefined,200,second.token)).length,0);
    const base=`/api/admin/orders/${order.id}`;
    await request(base,"GET",undefined,401,null);
    await request(base,"GET",undefined,404,otherToken);
    await request(base+"/status","PATCH",{status:"accepted"},404,otherToken);
    await request(base+"/delivery/quote","POST",{},409);
    await request(base+"/status","PATCH",{status:"ready"},409);
    for(const status of ["accepted","preparing","ready"])await request(base+"/status","PATCH",{status});
    assert.deepEqual((await request("/api/admin/orders?filter=in_progress")).map(o=>Number(o.id)),[order.id]);
    assert.equal((await request("/api/admin/orders?filter=pending")).length,0);
    await request(base+"/delivery","POST",{quote:{quoteId:"invented"}},409);
    const stale=await request(base+"/delivery/quote","POST",{});
    const expired={...stale,expiresAt:Date.now()-1000};
    await query("UPDATE order_events SET payload_json=? WHERE order_id=? AND event_type='delivery.quoted'",[JSON.stringify(expired),order.id]);
    await request(base+"/delivery","POST",{quote:stale},409);
    const quote=await request(base+"/delivery/quote","POST",{});
    await request(base+"/delivery","POST",{quote:stale},409);
    const responses=await Promise.all([1,2].map(()=>fetch(`http://127.0.0.1:${port}${base}/delivery`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({quote:{...quote,feeCents:1}})})));
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    await Promise.all(responses.map(r=>r.json()));
    await request(base+"/status","PATCH",{status:"cancelled"},409);
    await request(base+"/delivery/simulate","POST",{status:"delivered"},409);
    await request(base+"/delivery/simulate","POST",{status:"courier_assigned"},404,otherToken);
    for(const status of ["courier_assigned","out_for_delivery","delivered"]){
      await request(base+"/delivery/simulate","POST",{status});
      await request(base+"/delivery/simulate","POST",{status},409);
      const tracking=await request(`/api/orders/${order.id}/public`,"GET",undefined,200,clientToken);
      assert.equal(tracking.status,status);
    }
    await request(base+"/status","PATCH",{status:"accepted"},409);
    await request(base+"/delivery/quote","POST",{},409);
    const detail=await request(base);
    assert.equal(detail.items[0].quantity,2);
    assert.equal(detail.provider_status,"DELIVERED");
    assert.equal(detail.events.filter(e=>e.event_type==="delivery.updated").length,3);
    const deliveries=detail.events.filter(e=>e.event_type==="delivery.requested");
    assert.equal(deliveries.length,1);
    assert.equal(JSON.parse(deliveries[0].payload_json).feeCents,quote.feeCents);
    const cancelled=await create();
    const cancelBase=`/api/admin/orders/${cancelled.id}`;
    await request(cancelBase+"/status","PATCH",{status:"cancelled"});
    await request(cancelBase+"/status","PATCH",{status:"accepted"},409);
    await request(cancelBase+"/delivery/quote","POST",{},409);
    await request(cancelBase+"/delivery/simulate","POST",{status:"courier_assigned"},409);
    assert.equal((await request(`/api/orders/${cancelled.id}/public`,"GET",undefined,200,clientToken)).status,"cancelled");
    assert.equal((await request("/api/admin/orders")).length,2);
    assert.equal((await request("/api/customer/orders?filter=history","GET",undefined,200,clientToken)).length,2);
    assert.equal((await request("/api/customer/orders?filter=active","GET",undefined,200,clientToken)).length,0);
    assert.deepEqual((await request("/api/admin/orders?filter=delivered")).map(o=>Number(o.id)),[order.id]);
    assert.deepEqual((await request("/api/admin/orders?filter=cancelled")).map(o=>Number(o.id)),[cancelled.id]);
    assert.equal((await request("/api/admin/orders?filter=in_progress")).length,0);
    assert.equal((await request("/api/admin/orders?filter=delivered","GET",undefined,200,otherToken)).length,0);
    // Product CRUD, validation, restaurant isolation and historic order snapshots.
    const productsPath="/api/admin/products";
    await request(productsPath,"GET",undefined,401,null);
    await request(productsPath,"POST",{name:"Invalid",price_cents:-1},400);
    await request(productsPath,"POST",{name:" ",price_cents:100},400);
    const article=await request(productsPath,"POST",{name:"New pizza",description:"Description",category:"Pizzas",price_cents:1250,active:1,sort_order:2},201);
    const articlePath=productsPath+"/"+article.id;
    assert.ok((await request(productsPath)).some(p=>Number(p.id)===article.id));
    assert.equal((await request(productsPath,"GET",undefined,200,otherToken)).length,0);
    await request(articlePath,"PATCH",{price_cents:100},404,otherToken);
    await request(articlePath,"DELETE",undefined,404,otherToken);
    await request(articlePath,"PATCH",{price_cents:1.5},400);
    await request(articlePath,"PATCH",{name:"x".repeat(121)},400);
    await request(articlePath,"PATCH",{active:"false"},400);
    await request(articlePath,"PATCH",{name:"Updated pizza",price_cents:1350,active:0});
    let menu=await request(`/api/public/menu?slug=${slug}`);
    assert.ok(!menu.products.some(p=>Number(p.id)===article.id));
    await request(articlePath,"PATCH",{active:1});
    menu=await request(`/api/public/menu?slug=${slug}`);
    assert.equal(menu.products.find(p=>Number(p.id)===article.id).price_cents,1350);
    await request(articlePath,"DELETE");
    await request(articlePath,"DELETE",undefined,404);
    assert.ok(!(await request(productsPath)).some(p=>Number(p.id)===article.id));
    await request(productsPath+"/"+Number(product.insertId),"DELETE");
    const historical=await request(base);
    assert.equal(historical.items[0].product_name,"Test pizza");
    assert.equal(historical.items[0].unit_price_cents,950);
    const adminCookies=`admin_session=${token}`;
    const productsPage=await fetch(`http://127.0.0.1:${port}/admin/products`,{headers:{Cookie:adminCookies}});
    assert.equal(productsPage.status,200);
    const productsHtml=await productsPage.text();assert.match(productsHtml,/id="productForm"/);
    assert.match(productsHtml,/href="\/admin\/products" aria-current="page"/);
    const ordersPage=await fetch(`http://127.0.0.1:${port}/admin/orders`,{headers:{Cookie:adminCookies}});
    const ordersHtml=await ordersPage.text();assert.match(ordersHtml,/href="\/admin\/orders" aria-current="page"/);
    assert.ok(ordersHtml.includes("Test customer"));

    // Browser flow uses cookies + native forms. No browser JavaScript is executed.
    const jar=new Map();
    async function page(path,body){
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{
        method:body?"POST":"GET",redirect:"manual",
        headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; "),...(body?{"Content-Type":"application/x-www-form-urlencoded"}:{})},
        ...(body?{body:new URLSearchParams(body)}:{})
      });
      for(const cookie of response.headers.getSetCookie()){
        const pair=cookie.split(";")[0],i=pair.indexOf("=");jar.set(pair.slice(0,i),pair.slice(i+1));
      }
      return {status:response.status,location:response.headers.get("location"),html:await response.text()};
    }
    const loginPage=await page("/client/login");
    const csrf=loginPage.html.match(/name="_csrf" value="([^"]+)"/)[1];
    assert.equal((await page("/client/login",{email,password})).status,403);
    assert.equal((await page("/client/login",{_csrf:csrf,email,password})).status,303);
    assert.ok(jar.has("customer_session"));
    assert.equal((await page("/client/account")).status,200);
    assert.equal((await page("/client/account",{_csrf:csrf,name:"<script>unsafe</script>",phone:"123456789",delivery_address:"Saved address",delivery_notes:"Bell"})).status,303);
    const accountHtml=(await page("/client/account")).html;
    assert.ok(accountHtml.includes("&lt;script&gt;unsafe&lt;/script&gt;"));assert.ok(!accountHtml.includes("<script>unsafe</script>"));
    const historyHtml=(await page("/client/orders?filter=history")).html;
    assert.ok(historyHtml.includes(String(order.id)));assert.ok(historyHtml.includes("Entregado"));
    assert.equal((await page("/admin/orders")).location,"/admin/login");
    const tracked=await page(`/tracking?id=${order.id}`);assert.equal(tracked.status,200);assert.ok(tracked.html.includes("Test pizza"));
    // Add a real storefront item, keep cart across login, and submit checkout without JS.
    const store=await page("/");
    const productMatch=store.html.match(/name="product_id" value="(\d+)"/);
    assert.ok(productMatch,"Demo restaurant must have an active product for the storefront test");
    const storefrontProduct=productMatch[1];
    assert.equal((await page("/cart",{_csrf:csrf,product_id:storefrontProduct,action:"add"})).status,303);
    const checkoutPage=await page("/");assert.ok(checkoutPage.html.includes('value="123456789"'));assert.ok(checkoutPage.html.includes("Saved address"));
    const checkout=await page("/checkout",{_csrf:csrf,payment_method:"cash"});assert.equal(checkout.status,303);
    const deliveryId=checkout.location.split("=")[1];
    assert.ok((await page(checkout.location)).html.includes("Saved address"));
    assert.ok(!(await page("/")).html.includes('id="checkout"'));
    // Admin session is independent and form mutations still enforce restaurant ownership.
    assert.equal((await page("/admin/login",{_csrf:csrf,email:adminEmail,password:"admin-test-password"})).status,303);
    assert.ok(jar.has("admin_session"));
    assert.equal((await page("/client/account")).status,200);
    assert.equal((await page(`/admin/orders/${deliveryId}`)).status,404);
    assert.equal((await page("/admin/products",{_csrf:csrf,name:"SSR article",description:"Server rendered",category:"Test",price:"12.50",sort_order:"0",active:"1"})).status,303);
    const created=await query("SELECT id FROM products WHERE restaurant_id=? AND name=?",[restaurantId,"SSR article"]);
    const productId=String(created[0].id);
    assert.ok((await page("/admin/products")).html.includes("SSR article"));
    assert.equal((await page(`/admin/products/${productId}/edit`,{_csrf:csrf,name:"Edited article",description:"Updated",category:"Test",price:"13.50",sort_order:"1",active:"1"})).status,303);
    assert.ok((await page("/admin/products")).html.includes("Edited article"));
    assert.equal((await page(`/admin/products/${productId}/toggle`,{_csrf:csrf,active:"0"})).status,303);
    assert.ok((await page(`/admin/products/${productId}/delete`)).html.includes("Confirmar eliminación"));
    assert.equal((await page(`/admin/products/${productId}/delete`,{_csrf:csrf})).status,303);
    assert.ok(!(await page("/admin/products")).html.includes("Edited article"));
    const webOrder=await query("INSERT INTO orders(restaurant_id,customer_id,customer_name,customer_phone,delivery_address,subtotal_cents,delivery_cents,total_cents) VALUES(?,?,?,?,?,?,?,?)",[restaurantId,registered.customer.id,"Form order","123456789","Form address",1250,399,1649]);
    const webOrderId=String(webOrder.insertId);
    for(const status of ["accepted","preparing","ready"])assert.equal((await page(`/admin/orders/${webOrderId}/status`,{_csrf:csrf,status})).status,303);
    assert.equal((await page(`/admin/orders/${webOrderId}/quote`,{_csrf:csrf})).status,303);
    const quotePage=await page(`/admin/orders/${webOrderId}`);
    const quoteId=quotePage.html.match(/name="quoteId" value="([^"]+)"/)[1];
    assert.equal((await page(`/admin/orders/${webOrderId}/dispatch`,{_csrf:csrf,quoteId})).status,303);
    for(const status of ["courier_assigned","out_for_delivery","delivered"])assert.equal((await page(`/admin/orders/${webOrderId}/simulate`,{_csrf:csrf,status})).status,303);
    assert.ok((await page(`/admin/orders/${webOrderId}`)).html.includes("Entregado"));
    assert.equal((await page(`/admin/orders/${webOrderId}/simulate`,{_csrf:csrf,status:"delivered"})).status,409);
    assert.equal((await page("/admin/logout",{_csrf:csrf})).status,303);
    assert.equal((await page("/client/account")).status,200);
    const logout=await page("/client/logout",{_csrf:csrf});assert.equal(logout.status,303);
    assert.equal((await page("/client/account")).status,303);
  }finally{
    if(server&&server.exitCode===null){const exited=once(server,"exit");server.kill();await exited;}
    for(const id of customerIds){await query("DELETE FROM orders WHERE customer_id=?",[id]);await query("DELETE FROM customers WHERE id=?",[id]);}
    if(restaurantId)await query("DELETE FROM restaurants WHERE id=?",[restaurantId]);
    await pool.end();
  }
});
