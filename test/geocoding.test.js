import test from "node:test";
import assert from "node:assert/strict";
import {searchAddresses,validateAddress} from "../src/services/geocoding.js";

test("geocoder normalizes a selected address and rejects manual text",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify([{place_id:123,display_name:"Calle Alcalá 123, 28009 Madrid, España",lat:"40.4212",lon:"-3.6800",address:{road:"Calle Alcalá",house_number:"123",city:"Madrid",postcode:"28009",country_code:"es"}}]),{status:200});
  try{
    const result=await searchAddresses("Calle Alcalá 123 Madrid");
    assert.equal(result[0].street,"Calle Alcalá");
    assert.equal(result[0].place_id,"123");
    assert.equal(result[0].city,"Madrid");
    assert.equal(validateAddress(result[0]),null);
    assert.match(validateAddress({formatted_address:"Calle escrita a mano"}),/Selecciona/);
  }finally{globalThis.fetch=originalFetch}
});

test("geocoder keeps the requested municipality context",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.equal(new URL(url).searchParams.get("city"),"Villanueva del Pardillo");
    return new Response(JSON.stringify([
      {place_id:1,display_name:"Calle Mayor, Madrid",lat:"40.4",lon:"-3.7",address:{road:"Calle Mayor",city:"Madrid",postcode:"28001",country_code:"es"}},
      {place_id:2,display_name:"Calle Mayor 12, Villanueva del Pardillo",lat:"40.49",lon:"-3.96",address:{road:"Calle Mayor",house_number:"12",municipality:"Villanueva del Pardillo",postcode:"28229",state:"Madrid",country_code:"es"}}
    ]),{status:200});
  };
  try{
    const results=await searchAddresses("Calle Mayor, Villanueva del Pardillo");
    assert.equal(results.length,1);
    assert.equal(results[0].city,"Villanueva del Pardillo");
  }finally{globalThis.fetch=originalFetch}
});