import dotenv from "dotenv";
dotenv.config();

const defaultBase="https://nominatim.openstreetmap.org";

function geocoderBase(){return (process.env.GEOCODER_BASE_URL||defaultBase).replace(/\/$/,"")}
function geocoderHeaders(){return {Accept:"application/json", "User-Agent":process.env.GEOCODER_USER_AGENT||"delivery-app/1.0 (configure GEOCODER_USER_AGENT)"}}
function text(value,max){return typeof value==="string"?value.trim().slice(0,max):""}
function comparable(value){return text(value,200).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}

function queryContext(value){
  const parts=value.split(",").map(part=>part.trim()).filter(Boolean);
  const postal=value.match(/\b\d{5}\b/)?.[0]||"";
  const context=parts.length>1?parts.slice(1).filter(part=>!/^\d{5}$/.test(part)&&!/^espa(?:n|ñ)a$/i.test(part)):[];
  const cityHint=context[0]||"";
  const streetHint=parts.length>1?parts[0]:value;
  return {streetHint,cityHint,postal};
}

function normalize(item){
  const address=item.address||{};
  const country=text(address.country_code,2).toUpperCase();
  const result={
    formatted_address:text(item.display_name,500),
    street:text(address.road||address.pedestrian||address.street,180),
    number:text(address.house_number,40),
    city:text(address.city||address.town||address.village||address.municipality,120),
    province:text(address.state||address.county,120),
    postal_code:text(address.postcode,20),
    country,
    latitude:Number(item.lat),
    longitude:Number(item.lon),
    place_id:text(String(item.place_id||item.osm_id||""),255)
  };
  if(!result.formatted_address||!result.place_id||!Number.isFinite(result.latitude)||!Number.isFinite(result.longitude))return null;
  return result;
}

export async function searchAddresses(query){
  const value=text(query,200);
  if(value.length<3)return [];
  const context=queryContext(value);
  const url=new URL(`${geocoderBase()}/search`);
    url.searchParams.set("q",value);url.searchParams.set("format","jsonv2");url.searchParams.set("addressdetails","1");url.searchParams.set("limit","5");url.searchParams.set("countrycodes","es");url.searchParams.set("accept-language","es");
  if(context.cityHint){url.searchParams.set("street",context.streetHint);url.searchParams.set("city",context.cityHint);url.searchParams.delete("q")}
  if(context.postal)url.searchParams.set("postalcode",context.postal);
  let response=await fetch(url,{headers:geocoderHeaders()});
  if(!response.ok)throw new Error(`Geocoder ${response.status}`);
  let data=await response.json();
  let results=Array.isArray(data)?data.map(normalize).filter(Boolean):[];
  if(!results.length&&context.cityHint){
    const fallback=new URL(`${geocoderBase()}/search`);
    fallback.searchParams.set("q",value);fallback.searchParams.set("format","jsonv2");fallback.searchParams.set("addressdetails","1");fallback.searchParams.set("limit","10");fallback.searchParams.set("countrycodes","es");fallback.searchParams.set("accept-language","es");
    response=await fetch(fallback,{headers:geocoderHeaders()});
    if(response.ok){data=await response.json();results=Array.isArray(data)?data.map(normalize).filter(Boolean):[]}
  }
  if(!context.cityHint)return results;
  const wanted=comparable(context.cityHint);
  return results.filter(result=>comparable(result.city)===wanted);
}

export function validateAddress(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return "Selecciona una dirección de la lista";
  const required=["formatted_address","street","city","postal_code","country","place_id"];
  if(required.some(key=>typeof value[key]!=="string"||!value[key].trim()))return "Selecciona una dirección completa de la lista";
  if(!Number.isFinite(Number(value.latitude))||!Number.isFinite(Number(value.longitude)))return "La dirección seleccionada no tiene coordenadas válidas";
  if(Number(value.latitude)<-90||Number(value.latitude)>90||Number(value.longitude)<-180||Number(value.longitude)>180)return "Las coordenadas de la dirección no son válidas";
  return null;
}

export function cleanAddress(value){
  return {formatted_address:text(value.formatted_address,500),street:text(value.street,180),number:text(value.number,40),city:text(value.city,120),province:text(value.province,120),postal_code:text(value.postal_code,20),country:text(value.country,2).toUpperCase(),latitude:Number(value.latitude),longitude:Number(value.longitude),place_id:text(value.place_id,255)};
}