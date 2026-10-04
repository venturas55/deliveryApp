import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import express from "express";
import {clientApiRoutes} from "../src/routes/clients.js";
import paymentRoutes from "../src/routes/payments.js";
import {pool} from "../src/db.js";
import {startCustomerOrderPayment} from "../src/controllers/clients.js";
import {canPayOrder,isCustomerAppScheme,orderPayment,paymentForm,verifyPaymentTicket} from "../src/services/customer-order-payment.js";

test("customer order payment: ownership, locked retries, signed amount and payment guards",async()=>{
  const env={JWT_SECRET:"customer-payment-test",PUBLIC_URL:"https://example.com",REDSYS_MERCHANT_CODE:"999008881",REDSYS_SECRET_KEY:"test-payment-key-123",REDSYS_ENV:"test"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  const original=pool.getConnection;
  let order={id:42,customer_id:"7",status:"delivered",payment_method:"cash",payment_status:"pending",total_cents:2345,redsys_order:null};
  let writes=0,commits=0,rollbacks=0;
  const connection={beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release:()=>{},
    query:async(sql,params)=>{
      if(sql.includes("FROM customers WHERE id=?"))return [{id:params[0]}];
      if(sql.startsWith("SELECT")){
        assert.match(sql,/customer_id=\?/);
        return String(params[1])===String(order.customer_id)?[{...order}]:[];
      }
      assert.match(sql,/payment_method='online',payment_status='pending'/);
      writes++;
      order={...order,redsys_order:params[0],payment_method:"online",payment_status:"pending"};
      return {affectedRows:1};
    }};
  pool.getConnection=async()=>connection;
  try{
    await assert.rejects(startCustomerOrderPayment({params:{id:42},customer:{sub:"8"}}),e=>e.status===404);
    assert.equal(writes,0);
    const req={params:{id:42},customer:{sub:"7"},body:{total_cents:1}};
    const {url}=await startCustomerOrderPayment(req);
    const ticket=new URL(url).searchParams.get("ticket");
    const verified=verifyPaymentTicket(ticket);
    assert.equal(verified.customerId,"7");assert.equal(verified.orderId,"42");
    assert.match(verified.reference,/^\d{12}$/);
    assert.equal(order.payment_method,"online");
    const payload=JSON.parse(Buffer.from(orderPayment(order).merchantParameters,"base64url"));
    assert.equal(payload.DS_MERCHANT_AMOUNT,"2345");
    assert.equal(payload.DS_MERCHANT_ORDER,order.redsys_order);
    assert.equal(payload.DS_MERCHANT_MERCHANTURL,"https://example.com/payment/redsys/notification");
    const reference=order.redsys_order;
    await startCustomerOrderPayment(req);
    assert.equal(order.redsys_order,reference);
    assert.equal(commits,2);
    const appPayment=await startCustomerOrderPayment({...req,body:{appScheme:"massaefuoco-dev"}});
    const appTicket=verifyPaymentTicket(new URL(appPayment.url).searchParams.get("ticket"));
    assert.equal(appTicket.appScheme,"massaefuoco-dev");
    const appPayload=JSON.parse(Buffer.from(orderPayment(order,appTicket.appScheme).merchantParameters,"base64url"));
    assert.equal(appPayload.DS_MERCHANT_URLOK,"https://example.com/payment/redsys/success?order=42&appScheme=massaefuoco-dev");
    assert.equal(isCustomerAppScheme("massaefuoco"),true);
    assert.equal(isCustomerAppScheme("https"),false);
    await assert.rejects(startCustomerOrderPayment({...req,body:{appScheme:"https"}}),e=>e.status===400);
    assert.throws(()=>verifyPaymentTicket(ticket+"tampered"),e=>e.status===401);
    assert.throws(()=>verifyPaymentTicket(jwt.sign({purpose:"order-payment",orderId:"42",customerId:"7",reference},env.JWT_SECRET,{expiresIn:-1})),e=>e.status===401);
    assert.throws(()=>verifyPaymentTicket(jwt.sign({purpose:"customer"},env.JWT_SECRET)),e=>e.status===401);
    for(const payment_status of ["paid","refunded","refund_pending","cancelled"]){
      order.payment_status=payment_status;
      await assert.rejects(startCustomerOrderPayment(req),e=>e.status===409);
    }
    order.payment_status="pending";order.status="cancelled";
    await assert.rejects(startCustomerOrderPayment(req),e=>e.status===409);
    order.status="new";order.payment_status="failed";
    assert.equal(canPayOrder(order),true);
    const before=writes;
    process.env.PUBLIC_URL="https://example.com/wrong-path";
    await assert.rejects(startCustomerOrderPayment(req),e=>e.status===503);
    assert.equal(writes,before);
    assert.ok(rollbacks>=7);
    assert.match(paymentForm({endpoint:'https://example.com/"<',signatureVersion:"v",merchantParameters:"p",signature:"s"}),/&quot;&lt;/);
    assert.equal(canPayOrder({...order,total_cents:0}),false);
    process.env.PUBLIC_URL=env.PUBLIC_URL;
    const app=express();app.use(express.json());app.use("/api",clientApiRoutes);app.use(paymentRoutes);
    app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
    const server=app.listen(0,"127.0.0.1");
    await new Promise(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    try{
      const endpoint=base+"/api/customer/orders/42/payment";
      assert.equal((await fetch(endpoint,{method:"POST"})).status,401);
      const response=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${jwt.sign({sub:"7",role:"customer"},env.JWT_SECRET)}`}});
      assert.equal(response.status,200);
      assert.equal(response.headers.get("cache-control"),"no-store");
      const link=new URL((await response.json()).url);
      const page=await fetch(base+link.pathname+link.search);
      assert.equal(page.status,200);
      assert.equal(page.headers.get("referrer-policy"),"no-referrer");
      const pageHtml=await page.text();
      assert.match(pageHtml,/name="Ds_Signature"/);
      const webMerchantParameters=pageHtml.match(/name="Ds_MerchantParameters" value="([^"]+)"/)[1];
      const webPayload=JSON.parse(Buffer.from(webMerchantParameters,"base64url"));
      assert.equal(webPayload.DS_MERCHANT_URLOK,"https://example.com/payment/redsys/success?order=42");
      const appResponse=await fetch(endpoint,{method:"POST",headers:{
        Authorization:`Bearer ${jwt.sign({sub:"7",role:"customer"},env.JWT_SECRET)}`,
        "Content-Type":"application/json"
      },body:JSON.stringify({appScheme:"massaefuoco-dev"})});
      assert.equal(appResponse.status,200);
      const appLink=new URL((await appResponse.json()).url);
      const appPage=await fetch(base+appLink.pathname+appLink.search);
      assert.equal(appPage.status,200);
      const appPageHtml=await appPage.text();
      const appMerchantParameters=appPageHtml.match(/name="Ds_MerchantParameters" value="([^"]+)"/)[1];
      const appGatewayPayload=JSON.parse(Buffer.from(appMerchantParameters,"base64url"));
      assert.equal(appGatewayPayload.DS_MERCHANT_URLOK,
        "https://example.com/payment/redsys/success?order=42&appScheme=massaefuoco-dev");
      const appSuccess=await fetch(`${base}/payment/redsys/success?order=42&appScheme=massaefuoco-dev`);
      const appSuccessHtml=await appSuccess.text();
      assert.match(appSuccessHtml,/massaefuoco-dev:\/\/payment\/return\?order=42/);
      assert.match(appSuccessHtml,/window\.location\.replace\("massaefuoco-dev:\/\/payment\/return\?order=42"\)/);
      assert.match(appSuccessHtml,/Volver a la app ahora/);
      const webSuccess=await fetch(`${base}/payment/redsys/success?order=42`);
      const webSuccessHtml=await webSuccess.text();
      assert.match(webSuccessHtml,/url=\/tracking\?id=42/);
      assert.doesNotMatch(webSuccessHtml,/massaefuoco:\/\/|window\.location\.replace/);
      order.payment_status="paid";
      assert.equal((await fetch(base+link.pathname+link.search)).status,409);
      assert.equal((await fetch(base+"/payment/redsys/order?ticket=invalid")).status,401);
    }finally{await new Promise(resolve=>server.close(resolve));}
  }finally{
    pool.getConnection=original;
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await pool.end();
  }
});
