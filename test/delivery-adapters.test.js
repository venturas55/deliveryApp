import test from "node:test";
import assert from "node:assert/strict";
import {createUberDelivery} from "../src/delivery/uber.js";
import {createJustEatJetGoDelivery} from "../src/delivery/just-eat-jet-go.js";
import {createStuartDelivery} from "../src/delivery/stuart.js";

test("Uber Direct adapter uses current OAuth and delivery endpoints",async()=>{
  const calls=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url==="https://auth.uber.com/oauth/v2/token")return new Response(JSON.stringify({access_token:"token",expires_in:300}),{status:200});
    if(url.endsWith("/delivery_quotes"))return new Response(JSON.stringify({id:"quote-1",fee:550,duration:600}),{status:200});
    return new Response(JSON.stringify({id:"delivery-1",status:"pending",tracking_url:"https://track.example/1"}),{status:200});
  };
  try{
    const provider=createUberDelivery({credentials:{clientId:"client",clientSecret:"secret"},settings:{customerId:"customer",pickupName:"Store",pickupPhone:"+34963510732",pickupAddress:"Pickup",dropoffVerification:"qr"}});
    const order={id:42,pickup_verification_code:"123e4567-e89b-42d3-a456-426614174000",delivery_verification_code:"223e4567-e89b-42d3-a456-426614174000",delivery_address:"Dropoff",customer_name:"Customer",customer_phone:"612345678",items:[{product_name:"Pizza",quantity:1}]};
    const quote=await provider.quote(order);
    const delivery=await provider.create(order,quote);
    assert.equal(quote.feeCents,550);
    assert.equal(delivery.providerOrderId,"delivery-1");
    const body=JSON.parse(calls[2].options.body);
    assert.deepEqual(body.pickup_verification,{barcodes:[{type:"QR",value:order.pickup_verification_code}]});
    assert.deepEqual(body.dropoff_verification,{barcodes:[{type:"QR",value:order.delivery_verification_code}]});
    assert.equal(body.idempotency_key,order.pickup_verification_code);
    assert.equal(body.external_id,"42");
    await provider.get("delivery-1");
    assert.equal(calls[3].url,"https://api.uber.com/v1/customers/customer/deliveries/delivery-1");
    assert.equal(calls[1].url,"https://api.uber.com/v1/customers/customer/delivery_quotes");
    assert.equal(calls[2].url,"https://api.uber.com/v1/customers/customer/deliveries");
    assert.match(calls[0].options.body.toString(),/grant_type=client_credentials/);
  }finally{globalThis.fetch=originalFetch}
});

test("JET Go adapter uses the configured contract paths",async()=>{
  const originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith("/token"))return new Response(JSON.stringify({access_token:"jet-token"}),{status:200});
    if(url.endsWith("/quotes"))return new Response(JSON.stringify({id:"jet-quote",feeCents:420,etaMinutes:25}),{status:200});
    return new Response(JSON.stringify({id:"jet-delivery",status:"created"}),{status:200});
  };
  try{
    const provider=createJustEatJetGoDelivery({credentials:{clientId:"client",clientSecret:"secret"},settings:{apiBaseUrl:"https://jet.example",tokenPath:"/token",quotePath:"/quotes",createPath:"/deliveries",pickupName:"Store",pickupPhone:"+34123",pickupAddress:"Pickup"}});
    const order={delivery_address:"Dropoff",customer_name:"Customer",customer_phone:"+34456",items:[]};
    const quote=await provider.quote(order),delivery=await provider.create(order,quote);
    assert.equal(quote.provider,"just_eat_jet_go");
    assert.equal(delivery.providerOrderId,"jet-delivery");
    assert.deepEqual(calls.map(call=>call.url),["https://jet.example/token","https://jet.example/quotes","https://jet.example/deliveries"]);
  }finally{globalThis.fetch=originalFetch}
});

test("Stuart adapter uses the configured contract paths",async()=>{
  const originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith("/token"))return new Response(JSON.stringify({access_token:"stuart-token"}),{status:200});
    if(url.endsWith("/quotes"))return new Response(JSON.stringify({id:"stuart-quote",feeCents:510,etaMinutes:18}),{status:200});
    return new Response(JSON.stringify({id:"stuart-delivery",status:"created"}),{status:200});
  };
  try{
    const provider=createStuartDelivery({credentials:{clientId:"client",clientSecret:"secret"},settings:{apiBaseUrl:"https://stuart.example",tokenPath:"/token",quotePath:"/quotes",createPath:"/deliveries",pickupName:"Store",pickupPhone:"+34123",pickupAddress:"Pickup"}});
    const order={delivery_address:"Dropoff",customer_name:"Customer",customer_phone:"+34456",items:[]};
    const quote=await provider.quote(order),delivery=await provider.create(order,quote);
    assert.equal(quote.provider,"stuart");
    assert.equal(delivery.providerOrderId,"stuart-delivery");
    assert.deepEqual(calls.map(call=>call.url),["https://stuart.example/token","https://stuart.example/quotes","https://stuart.example/deliveries"]);
  }finally{globalThis.fetch=originalFetch}
});