import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {randomUUID} from "node:crypto";
import {query,pool} from "../src/db.js";
import {signAdmin} from "../src/auth.js";

// Integration test: requires the configured MariaDB and schema.sql.
// Only the temporary restaurant created here is removed afterwards.
test("mock delivery: full lifecycle, isolation, duplicates and cancellation",{timeout:30000},async()=>{
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
    const token=signAdmin({id:1,restaurant_id:restaurantId,email:"test@example.invalid"});
    for(const [route,element,script] of [
      ["/","checkout","app"],["/index.html","checkout","app"],
      ["/admin.html","adminMain","admin"],["/admin","adminMain","admin"],
      ["/admin/orders","adminMain","admin"],
      ["/client/login","customerLogin","customer-login"],["/client/orders","customerOrders","customer-orders"],
      ["/client/account","accountForm","customer-account"],
      ["/tracking.html?id=1","progress","tracking"],["/tracking?id=1","progress","tracking"]
    ]){
      const response=await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status,200);
      assert.match(response.headers.get("content-type"),/text\/html/);
      const html=await response.text();
      assert.ok(html.includes(`id="${element}"`));
      assert.ok(html.includes(`src="/${script}.js"`));
      assert.equal((html.match(/<main\b/g)||[]).length,1);
      assert.equal((html.match(/<header>/g)||[]).length,1);
      assert.ok(!html.includes("{{"));
      if(!route.startsWith("/admin"))assert.doesNotMatch(html,/href="\/admin(?:[\/."])/);
    }
    for(const asset of ["/style.css","/app.js","/admin.js","/tracking.js"]){
      const response=await fetch(`http://127.0.0.1:${port}${asset}`);
      assert.equal(response.status,200);
      assert.ok((await response.text()).length>0);
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
    const productsPage=await fetch(`http://127.0.0.1:${port}/admin/products`);
    assert.equal(productsPage.status,200);
    const productsHtml=await productsPage.text();
    assert.match(productsHtml,/id="productForm"/);
    assert.match(productsHtml,/href="\/admin\/products" aria-current="page"/);
    assert.match(productsHtml,/href="\/admin\/orders"/);
    const ordersPage=await fetch(`http://127.0.0.1:${port}/admin/orders`);
    const ordersHtml=await ordersPage.text();
    assert.match(ordersHtml,/href="\/admin\/orders" aria-current="page"/);
    assert.match(ordersHtml,/<template id="ordersView">/);
  }finally{
    if(server&&server.exitCode===null){const exited=once(server,"exit");server.kill();await exited;}
    for(const id of customerIds)await query("DELETE FROM customers WHERE id=?",[id]);
    if(restaurantId)await query("DELETE FROM restaurants WHERE id=?",[restaurantId]);
    await pool.end();
  }
});
