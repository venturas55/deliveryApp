export function publicOrigin(value=process.env.PUBLIC_URL){
  try{
    const url=new URL(value);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)return null;
    return url.origin;
  }catch{return null}
}

export function absoluteUrl(value,origin=publicOrigin()){
  if(!value||!origin)return null;
  try{const url=new URL(value,origin);return ["http:","https:"].includes(url.protocol)?url.href:null}catch{return null}
}

export function jsonLd(value){
  return JSON.stringify(value).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026");
}

export function pageSeo(res,{title,description,path,image,structuredData}){
  const canonical=absoluteUrl(path);
  const seo={title,description:String(description||"").replace(/\s+/g," ").trim().slice(0,160),canonical,
    image:absoluteUrl(image),robots:canonical?"index, follow":"noindex, follow",
    structuredData:canonical&&structuredData?jsonLd(structuredData):null};
  res.set("X-Robots-Tag",seo.robots);
  return seo;
}

export function restaurantSchema(restaurant,image){
  const url=absoluteUrl("/");
  const street=[restaurant.delivery_street,restaurant.delivery_number].filter(Boolean).join(" ")||restaurant.delivery_formatted_address||restaurant.address;
  const schema={"@context":"https://schema.org","@type":"Restaurant",name:restaurant.name,
    ...(url?{"@id":url+"#restaurant",url,hasMenu:url+"#menu"}:{}),
    ...(restaurant.phone?{telephone:restaurant.phone}:{}),
    ...(absoluteUrl(image)?{image:absoluteUrl(image)}:{}),
    ...(street?{address:{"@type":"PostalAddress",streetAddress:street,
      addressLocality:restaurant.delivery_city||restaurant.city||undefined,
      addressRegion:restaurant.delivery_province||undefined,
      postalCode:restaurant.delivery_postal_code||undefined,
      addressCountry:restaurant.delivery_country||undefined}}:{})};
  const lat=restaurant.delivery_latitude,lng=restaurant.delivery_longitude;
  if(lat!=null&&lng!=null&&lat!==""&&lng!==""&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180){
    schema.geo={"@type":"GeoCoordinates",latitude:Number(lat),longitude:Number(lng)};
  }
  return schema;
}

export function sitemapXml(paths,origin=publicOrigin()){
  const escape=value=>value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
    paths.map(path=>`<url><loc>${escape(absoluteUrl(path,origin))}</loc></url>`).join("")+"</urlset>";
}

// Private pages remain crawlable so search engines can read their noindex header.
export function defaultRobots(req,res,next){
  res.set("X-Robots-Tag","noindex, follow");
  next();
}
