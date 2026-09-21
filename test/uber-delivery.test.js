import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import {engine} from "express-handlebars";
import {query,pool} from "../src/db.js";
import {signAdmin,signCustomer} from "../src/auth.js";
import {encryptSecret} from "../src/services/delivery-credentials.js";
import {deliveryView,normalizeDelivery} from "../src/services/delivery-tracking.js";
import {presentOrder} from "../src/services/order-presenter.js";
import apiRoutes from "../src/routes/api.js";
import pageRoutes from "../src/routes/pages.js";

test("Uber: signed lifecycle, QR, isolation, replay, incidents and recovery",{timeout:60000},async()=>{
  const originalFetch=globalThis.fetch,secret="test-webhook-secret",slug="uber-test-"+randomUUID();
  process.env.DELIVERY_CREDENTIALS_KEY=Buffer.alloc(32,9).toString("base64");
  process.env.DELIVERY_PROVIDER="uber";
  let restaurantId,customerId,server,loseCreateResponse=true;
  const snapshots=new Map(),byKey=new Map(),createBodies=[];
  const reply=data=>new Response(JSON.stringify(data),{status:200});
  globalThis.fetch=async(url,options={})=>{
    if(String(url).startsWith("http://127.0.0.1:"))return originalFetch(url,options);
    if(url==="https://auth.uber.com/oauth/v2/token")return reply({access_token:"fixture-token",expires_in:300});
    if(url==="https://uber.invalid/v1/customers/test-customer/delivery_quotes")return reply({id:"quote-test",fee:450,expires:new Date(Date.now()+300000).toISOString()});
    if(url==="https://uber.invalid/v1/customers/test-customer/deliveries"){
      const body=JSON.parse(options.body);createBodies.push(body);
      if(!byKey.has(body.idempotency_key)){
        const data={id:"del_"+randomUUID(),status:"pending",updated:"2026-01-01T10:00:00Z",tracking_url:"https://www.ubereats.com/orders/test"};
        byKey.set(body.idempotency_key,data);snapshots.set(data.id,data);
      }
      if(loseCreateResponse){loseCreateResponse=false;throw new Error("Simulated lost create response")}
      return reply(byKey.get(body.idempotency_key));
    }
    if(String(url).startsWith("https://uber.invalid/v1/customers/test-customer/deliveries/"))return reply(snapshots.get(String(url).split("/").at(-1)));
    throw new Error("Unexpected external request: "+url);
  };
  try{
    // Additive migration can run twice without changing existing order data.
    const sql=await readFile(new URL("../migrations/005-delivery-tracking.sql",import.meta.url),"utf8");
    for(let attempt=0;attempt<2;attempt++)for(const statement of sql.split(";").filter(s=>s.trim()))await query(statement);
    restaurantId=Number((await query("INSERT INTO restaurants(name,slug) VALUES(?,?)",["Uber fixture",slug])).insertId);
    customerId=Number((await query("INSERT INTO customers(name,email) VALUES(?,?)",["Customer",slug+"@example.invalid"])).insertId);
    await query("INSERT INTO delivery_providers(restaurant_id,provider,enabled,credentials_ciphertext,settings_json,webhook_secret_ciphertext) VALUES(?,'uber',1,?,?,?)",[restaurantId,encryptSecret(JSON.stringify({clientId:slug,clientSecret:"fixture"})),JSON.stringify({customerId:"test-customer",apiBaseUrl:"https://uber.invalid",pickupName:"Store",pickupPhone:"+34963510732",pickupAddress:"Pickup",dropoffVerification:"qr"}),encryptSecret(secret)]);
    const app=express();
    app.engine("handlebars",engine({helpers:{eq:(a,b)=>String(a)===String(b),date:v=>String(v),money:v=>String(v),multiply:(a,b)=>a*b}}));
    app.set("view engine","handlebars");app.set("views","src/views");
    app.set("json replacer",(key,value)=>typeof value==="bigint"?value.toString():value);
    app.use(cookieParser());app.use("/api/webhooks/delivery",express.raw({type:"application/json"}));
    app.use(express.json());app.use(express.urlencoded({extended:false}));app.use("/api",apiRoutes);app.use(pageRoutes);
    app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
    server=app.listen(0,"127.0.0.1");await once(server,"listening");
    const root=`http://127.0.0.1:${server.address().port}`;
    const admin=signAdmin({id:1,restaurant_id:restaurantId}),other=signAdmin({id:1,restaurant_id:-1});
    const customer=signCustomer({id:customerId,name:"Customer",email:slug+"@example.invalid"});
    async function request(path,{method="GET",body,token=admin,status=200,headers={}}={}){
      const res=await fetch(root+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`} : {}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
    }
    async function newOrder(){
      return String((await query("INSERT INTO orders(restaurant_id,customer_id,customer_name,customer_phone,delivery_address,status,subtotal_cents,total_cents) VALUES(?,?,?,?,?,'ready',1000,1000)",[restaurantId,customerId,"Customer","+34612345678","Address"])).insertId);
    }
    const id=await newOrder(),base=`/api/admin/orders/${id}`;
    const quotes=await request(base+"/delivery/quote",{method:"POST",body:{}}),quote=quotes.quotes[0];
    await request(base+"/delivery",{method:"POST",body:{provider:"uber",quoteId:quote.quoteId},status:500});
    const prepared=await request(base);assert.ok(prepared.pickup_verification_code);assert.equal(prepared.provider_order_id,null);
    assert.ok(prepared.delivery_verification_code);
    const created=await request(base+"/delivery",{method:"POST",body:{provider:"uber",quoteId:quote.quoteId}});
    assert.equal(byKey.size,1);assert.deepEqual(createBodies[0],createBodies[1]);
    assert.deepEqual(createBodies[1].pickup_verification,{barcodes:[{type:"QR",value:prepared.pickup_verification_code}]});
    assert.deepEqual(createBodies[1].dropoff_verification,{barcodes:[{type:"QR",value:prepared.delivery_verification_code}]});
    await request(base+"/delivery",{method:"POST",body:{provider:"uber",quoteId:quote.quoteId},status:409});
    await request(base+"/delivery/qr",{token:other,status:404});
    await request(base+"/delivery/qr",{token:customer,status:403});
    const qr=await fetch(root+base+"/delivery/qr",{headers:{Authorization:`Bearer ${admin}`}});
    assert.equal(qr.status,200);assert.equal(qr.headers.get("cache-control"),"no-store");
    const png=Buffer.from(await qr.arrayBuffer());assert.equal(png.subarray(1,4).toString(),"PNG");
    const html=await (await fetch(root+`/admin/orders/${id}`,{headers:{Cookie:`admin_session=${admin}`}})).text();
    assert.match(html,/pickup-qr/);assert.match(html,/Consultar estado en Uber/);assert.doesNotMatch(html,/\{\{/);
    const csrf=html.match(/name="_csrf" value="([^"]+)"/)[1];
    const cookie=`admin_session=${admin}; web_csrf=${csrf}`;
    const denied=await fetch(root+`/admin/orders/${id}/sync`,{method:"POST",headers:{Cookie:cookie}});assert.equal(denied.status,403);await denied.text();
    const syncPage=await fetch(root+`/admin/orders/${id}/sync`,{method:"POST",redirect:"manual",headers:{Cookie:cookie,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({_csrf:csrf})});assert.equal(syncPage.status,303);await syncPage.text();
    function event(status,minute,data={},extra={}){
      return {id:"evt_"+randomUUID(),kind:"event.delivery_status",delivery_id:created.providerOrderId,status,created:`2026-01-01T10:${String(minute).padStart(2,"0")}:00Z`,data:{id:created.providerOrderId,status,...data},...extra};
    }
    async function send(payload,{header="x-uber-signature",key=secret,status=200,restaurant=restaurantId,raw=JSON.stringify(payload)}={}){
      const res=await fetch(root+`/api/webhooks/delivery/uber/${restaurant}`,{method:"POST",headers:{"Content-Type":"application/json",[header]:createHmac("sha256",key).update(raw).digest("hex")},body:raw});
      const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body;
    }
    const pickup=event("pickup",1,{courier:{name:"Courier <script>",public_phone_info:{formatted_phone_number:"+34900000000,123"}},pickup_eta:"2026-01-01T10:05:00Z",courier_imminent:true});
    await send(pickup,{key:"wrong",status:401});await send(pickup,{header:"x-signature",status:401});
    assert.equal((await request(base)).status,"delivery_requested");
    await send(pickup,{header:"x-postmates-signature"});
    assert.equal((await send(pickup)).duplicate,true);
    await send(event("pickup",2),{restaurant:-1,status:404});
    await send({...pickup,delivery_id:"del_unknown",id:"evt_unknown"},{status:503});
    await send({}, {raw:"{",status:400});await send(null,{status:202});await send({...pickup,kind:"event.refund"},{status:202});
    const courier=event("pickup",2,{courier:{name:"Ana",phone_number:"+34900000000"},dropoff_eta:"2026-01-01T10:30:00Z"},{kind:"event.courier_update"});
    await send(courier,{raw:JSON.stringify(courier).replace("Ana","An\\u0061")});
    let order=await request(base);assert.equal(deliveryView(order).courier.name,"Ana");
    const wrong=event("pickup",3,{pickup:{verification:{barcodes:[{type:"QR",value:"wrong",scan_result:{outcome:"SUCCESS"}}]}}});
    await send(wrong);order=await request(base);assert.equal(deliveryView(order).verificationProblem,true);assert.equal(order.status,"courier_assigned");
    const proof={verification:{barcodes:[{type:"QR",value:prepared.pickup_verification_code,scan_result:{outcome:"SUCCESS",timestamp:"2026-01-01T10:04:00Z"}}]}};
    const deliveryProof={verification:{barcodes:[{type:"QR",value:prepared.delivery_verification_code,scan_result:{outcome:"SUCCESS",timestamp:"2026-01-01T10:07:00Z"}}]}};
    const picked=event("pickup_complete",4,{pickup:proof});
    const repeated=await Promise.all([send(picked),send(picked)]);assert.equal(repeated.filter(r=>r.duplicate).length,1);
    order=await request(base);assert.equal(order.status,"out_for_delivery");assert.equal(deliveryView(order).verificationLabel,"Recogida verificada");
    const deliveryQr=await fetch(root+`/api/customer/orders/${id}/delivery/qr`,{headers:{Authorization:`Bearer ${customer}`}});assert.equal(deliveryQr.status,200);assert.equal(Buffer.from(await deliveryQr.arrayBuffer()).subarray(1,4).toString(),"PNG");
    assert.equal((await request(`/api/customer/orders/${id}`,{token:customer})).delivery_verification_code,undefined);
    await request(base+"/delivery/qr",{status:409});
    await send(event("dropoff",5,{dropoff:deliveryProof}));
    const old=await send(event("canceled",2));assert.equal(old.ignored,true);
    assert.equal((await send(event("pickup",6))).ignored,true);
    // Missing final webhook is repaired by an authenticated Get Delivery request.
    snapshots.set(created.providerOrderId,{id:created.providerOrderId,status:"delivered",updated:"2026-01-01T10:07:00Z",pickup:proof,dropoff:deliveryProof});
    await request(base+"/delivery/sync",{method:"POST",body:{},token:other,status:404});
    await request(base+"/delivery/sync",{method:"POST",body:{}});
    order=await request(base);assert.equal(order.status,"delivered");assert.equal(deliveryView(order).verificationProblem,false);
    assert.equal((await send(event("dropoff",8))).ignored,true);
    assert.equal((await send(event("canceled",9))).ignored,true);
    const customerOrder=await request(`/api/customer/orders/${id}`,{token:customer});
    assert.ok(customerOrder.trackingUrl);assert.equal(customerOrder.pickup_verification_code,undefined);assert.equal(customerOrder.delivery_details_json,undefined);
    assert.ok(!JSON.stringify(customerOrder).includes(prepared.pickup_verification_code));
    assert.ok(!JSON.stringify(customerOrder).includes(prepared.delivery_verification_code));
    // Cancel before pickup and return after pickup retain distinct operational labels.
    const cancelled=await newOrder(),returned=await newOrder();
    for(const [orderId,providerId] of [[cancelled,"del_cancel"],[returned,"del_return"]])await query("UPDATE orders SET provider='uber',provider_order_id=?,status='courier_assigned',provider_status='pickup' WHERE id=?",[providerId,orderId]);
    const cancel=event("canceled",10,{undeliverable_reason:"customer_unavailable",undeliverable_action:"return"},{delivery_id:"del_cancel"});
    await send(cancel);assert.equal((await request(`/api/admin/orders/${cancelled}`)).status,"cancelled");
    const returning=event("canceled",11,{pickup:{status:"completed"},undeliverable_action:"return",related_deliveries:[{id:"ret_fixture",relationship:"returned"}]},{delivery_id:"del_return"});
    await send(returning);assert.equal(presentOrder(await request(`/api/admin/orders/${returned}`)).finished,false);
    await send(event("returned",12,{}, {delivery_id:"del_return"}));
    const returnedOrder=presentOrder(await request(`/api/admin/orders/${returned}`));assert.equal(returnedOrder.statusLabel,"Devuelto al restaurante");assert.equal(returnedOrder.finished,true);
    assert.equal((await send({...returning,id:"evt_late_cancel",created:"2026-01-01T10:13:00Z"})).ignored,true);
    assert.equal(normalizeDelivery("uber",event("unknown",1)),null);
    assert.ok((await request(base)).events.some(e=>e.event_type==="delivery.synced"));
  }finally{
    globalThis.fetch=originalFetch;
    if(server)await new Promise(resolve=>server.close(resolve));
    if(restaurantId)await query("DELETE FROM restaurants WHERE id=?",[restaurantId]);
    if(customerId)await query("DELETE FROM customers WHERE id=?",[customerId]);
    await pool.end();
  }
});
