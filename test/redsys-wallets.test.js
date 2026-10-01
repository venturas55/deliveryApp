import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {readFile} from "node:fs/promises";
import Handlebars from "handlebars";
import {createRedsysPayment,resolveRedsysCheckoutMethod} from "../src/services/redsys.js";

test("Redsys wallets: gated checkout, signed xpay and ordinary card fallback",async()=>{
  const env={REDSYS_ENV:"test",REDSYS_WALLETS_ENABLED:"true",REDSYS_MERCHANT_CODE:"999008881",REDSYS_TERMINAL:"001",REDSYS_SECRET_KEY:"wallet-test-key-123456"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  try{
    assert.deepEqual(resolveRedsysCheckoutMethod("wallet"),{paymentMethod:"online",wallet:true});
    for(const method of ["online","cash","card_on_delivery"]){
      assert.deepEqual(resolveRedsysCheckoutMethod(method),{paymentMethod:method,wallet:false});
    }
    const input={order:"123456789012",amountCents:1234,merchantUrl:"https://example.com/payment/redsys/notification",urlOk:"https://example.com/payment/redsys/success",urlKo:"https://example.com/payment/redsys/error"};
    const payment=createRedsysPayment({...input,wallet:true});
    const payload=JSON.parse(Buffer.from(payment.merchantParameters,"base64url").toString());
    assert.equal(payload.DS_MERCHANT_PAYMETHODS,"xpay");
    assert.equal(payload.DS_MERCHANT_AMOUNT,"1234");
    assert.equal(payload.DS_MERCHANT_TRANSACTIONTYPE,"0");
    assert.equal(payload.DS_MERCHANT_MERCHANTURL,input.merchantUrl);
    assert.equal(payment.endpoint,"https://sis-t.redsys.es:25443/sis/realizarPago");
    const aes=crypto.createCipheriv("aes-128-cbc",Buffer.from(env.REDSYS_SECRET_KEY.slice(0,16)),Buffer.alloc(16));
    const key=Buffer.concat([aes.update(input.order),aes.final()]).toString("base64");
    assert.equal(payment.signature,crypto.createHmac("sha512",key).update(payment.merchantParameters).digest("base64url"));
    const card=createRedsysPayment(input);
    assert.equal(JSON.parse(Buffer.from(card.merchantParameters,"base64url").toString()).DS_MERCHANT_PAYMETHODS,undefined);
    assert.notEqual(card.signature,payment.signature);
    process.env.REDSYS_ENV="live";
    assert.equal(createRedsysPayment({...input,wallet:true}).endpoint,"https://sis.redsys.es/sis/realizarPago");
    process.env.REDSYS_WALLETS_ENABLED="false";
    assert.throws(()=>resolveRedsysCheckoutMethod("wallet"),error=>error.status===422);
    assert.throws(()=>createRedsysPayment({...input,wallet:true}),error=>error.status===422);
    assert.doesNotThrow(()=>createRedsysPayment(input));

    const h=Handlebars.create();h.registerPartial("csrf","");h.registerPartial("client/address-picker","");h.registerHelper("money",value=>String(value));h.registerHelper("eq",(a,b)=>a===b);
    const template=h.compile(await readFile(new URL("../src/views/client/store.handlebars",import.meta.url),"utf8"));
    const data={customerLoggedIn:true,cart:[{name:"Fixture",quantity:1}],profile:{},configsData:{}};
    assert.match(template({...data,walletsEnabled:true}),/<option value="wallet">Google Pay \/ Apple Pay<\/option>/);
    assert.doesNotMatch(template({...data,walletsEnabled:false}),/value="wallet"/);
  }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
