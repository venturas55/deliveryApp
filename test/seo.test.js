import test from "node:test";
import assert from "node:assert/strict";
import {publicOrigin,absoluteUrl,jsonLd,restaurantSchema,pageSeo,sitemapXml,defaultRobots} from "../src/services/seo.js";

test("SEO: canonical origin rejects unsafe or ambiguous configuration",()=>{
  assert.equal(publicOrigin("https://example.com/"),"https://example.com");
  for(const value of ["invalid","javascript:alert(1)","https://user:pass@example.com","https://example.com/subpath","https://example.com/?token=x"]){
    assert.equal(publicOrigin(value),null);
  }
  assert.equal(absoluteUrl("javascript:alert(1)","https://example.com"),null);
  assert.equal(absoluteUrl("/uploads/a b.jpg","https://example.com"),"https://example.com/uploads/a%20b.jpg");
});

test("SEO: JSON-LD preserves content without allowing script injection",()=>{
  const value={name:'</script><script>alert("x")</script>&'};
  const encoded=jsonLd(value);
  assert.ok(!encoded.includes("<"));
  assert.deepEqual(JSON.parse(encoded),value);
  const schema=restaurantSchema({name:"Restaurante",delivery_street:"Doctor Herrero",delivery_number:"28",delivery_city:"Picanya",delivery_latitude:null,delivery_longitude:null});
  assert.equal(schema.address.streetAddress,"Doctor Herrero 28");
  assert.equal(schema.geo,undefined);
  assert.equal(schema.aggregateRating,undefined);
});

test("SEO: private defaults and public metadata agree with headers",()=>{
  const previous=process.env.PUBLIC_URL;
  const headers={};const res={set:(name,value)=>{headers[name]=value;}};
  try{
    defaultRobots({},res,()=>{});
    assert.equal(headers["X-Robots-Tag"],"noindex, follow");
    process.env.PUBLIC_URL="https://example.com";
    const seo=pageSeo(res,{title:"Carta",description:"Carta  del\nrestaurante",path:"/product/1"});
    assert.equal(seo.canonical,"https://example.com/product/1");
    assert.equal(seo.description,"Carta del restaurante");
    assert.equal(headers["X-Robots-Tag"],seo.robots);
    process.env.PUBLIC_URL="";
    assert.equal(pageSeo(res,{title:"Carta",path:"/"}).robots,"noindex, follow");
  }finally{if(previous===undefined)delete process.env.PUBLIC_URL;else process.env.PUBLIC_URL=previous;}
});

test("SEO: sitemap uses absolute escaped URLs",()=>{
  const xml=sitemapXml(["/","/product/1","/?a=1&b=2"],"https://example.com");
  assert.match(xml,/<loc>https:\/\/example.com\/product\/1<\/loc>/);
  assert.match(xml,/a=1&amp;b=2/);
  assert.ok(!xml.includes("lastmod"));
});
