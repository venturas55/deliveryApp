import test from "node:test";
import assert from "node:assert/strict";
import {createUberDelivery} from "../src/delivery/uber.js";
import {createJustEatJetGoDelivery} from "../src/delivery/just-eat-jet-go.js";

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
    const provider=createUberDelivery({credentials:{clientId:"client",clientSecret:"secret"},settings:{customerId:"customer",pickupName:"Store",pickupPhone:"+34963510732",pickupAddress:"Pickup"}});
    const order={delivery_address:"Dropoff",customer_name:"Customer",customer_phone:"612345678",items:[{product_name:"Pizza",quantity:1}]};
    const quote=await provider.quote(order);
    const delivery=await provider.create(order,quote);
    assert.equal(quote.feeCents,550);
    assert.equal(delivery.providerOrderId,"delivery-1");
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