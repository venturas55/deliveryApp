import test from "node:test";
import assert from "node:assert/strict";
import {searchAddresses,validateAddress} from "../src/services/geocoding.js";

test("geocoder normalizes a selected address and rejects manual text",async()=>{
  const originalFetch=globalThis.fetch;
  const originalApiKey=process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY="test-key";
  globalThis.fetch=async url=>{
    const params=new URL(url).searchParams;
    assert.equal(params.get("text"),"Calle Alcalá 123 Madrid");
    assert.equal(params.get("filter"),"countrycode:es");
    assert.equal(params.get("apiKey"),"test-key");
    return new Response(JSON.stringify({results:[{place_id:"geo-123",formatted:"Calle Alcalá 123, 28009 Madrid, España",lat:40.4212,lon:-3.68,street:"Calle Alcalá",housenumber:"123",city:"Madrid",state:"Madrid",postcode:"28009",country_code:"es"}]}),{status:200});
  };
  try{
    const result=await searchAddresses("Calle Alcalá 123 Madrid");
    assert.equal(result[0].street,"Calle Alcalá");
    assert.equal(result[0].suggestion,"Calle Alcalá 123, 28009 Madrid");
    assert.equal(result[0].place_id,"geo-123");
    assert.equal(result[0].city,"Madrid");
    assert.equal(validateAddress(result[0]),null);
    assert.match(validateAddress({formatted_address:"Calle escrita a mano"}),/Selecciona/);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalApiKey===undefined)delete process.env.GEOAPIFY_API_KEY;else process.env.GEOAPIFY_API_KEY=originalApiKey;
  }
});

test("geocoder keeps the requested municipality context",async()=>{
  const originalFetch=globalThis.fetch;
  const originalApiKey=process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY="test-key";
  globalThis.fetch=async url=>{
    const params=new URL(url).searchParams;
    assert.equal(params.get("city"),"Villanueva del Pardillo");
    assert.equal(params.get("street"),"Calle Mayor");
    assert.equal(params.get("housenumber"),"12");
    return new Response(JSON.stringify({results:[
      {place_id:"geo-1",formatted:"Calle Mayor, Madrid",lat:40.4,lon:-3.7,street:"Calle Mayor",city:"Madrid",postcode:"28001",country_code:"es"},
      {place_id:"geo-2",formatted:"Calle Mayor 12, Villanueva del Pardillo",lat:40.49,lon:-3.96,street:"Calle Mayor",housenumber:"12",city:"Villanueva del Pardillo",postcode:"28229",state:"Madrid",country_code:"es"}
    ]}),{status:200});
  };
  try{
    const results=await searchAddresses("Calle Mayor 12, Villanueva del Pardillo");
    assert.equal(results.length,1);
    assert.equal(results[0].city,"Villanueva del Pardillo");
  }finally{
    globalThis.fetch=originalFetch;
    if(originalApiKey===undefined)delete process.env.GEOAPIFY_API_KEY;else process.env.GEOAPIFY_API_KEY=originalApiKey;
  }
});