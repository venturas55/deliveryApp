const tokenCache=new Map();

function required(settings,name){
  const value=settings?.[name];
  if(!value)throw new Error(`Falta configuración Uber: ${name}`);
  return value;
}

function addressObject(address,settings={}){
  return JSON.stringify({street_address:[address],city:settings.city||"Valencia",state:settings.state||"Valencia",zip_code:settings.postcode||"",country:settings.country||"ES"});
}
function apiBase(settings){return (settings.apiBaseUrl||"https://api.uber.com").replace(/\/$/,"")}

async function getToken(config){
  const {clientId,clientSecret}=config.credentials||{};
  if(!clientId||!clientSecret)throw new Error("Faltan credenciales Uber");
  const key=`${clientId}:${clientSecret}`,cached=tokenCache.get(key);
  if(cached&&Date.now()<cached.expiresAt)return cached.token;
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"client_credentials",scope:"eats.deliveries"});
  const response=await fetch("https://auth.uber.com/oauth/v2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  if(!response.ok)throw new Error(`Uber auth failed: ${response.status} ${await response.text()}`);
  const data=await response.json();
  if(!data.access_token)throw new Error("Uber no devolvió access_token");
  tokenCache.set(key,{token:data.access_token,expiresAt:Date.now()+Math.max(30,Number(data.expires_in||300)-60)*1000});
  return data.access_token;
}

async function uberFetch(config,path,options={}){
  const response=await fetch(`${apiBase(config.settings)}${path}`,{...options,headers:{"Content-Type":"application/json",Authorization:`Bearer ${await getToken(config)}`,...(options.headers||{})}});
  const text=await response.text();let data;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw new Error(`Uber ${response.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);
  return data;
}

function pickup(config){
  const settings=config.settings||{};
  return {address:addressObject(required(settings,"pickupAddress"),settings),name:required(settings,"pickupName"),phone_number:required(settings,"pickupPhone"),...(settings.pickupLat?{latitude:Number(settings.pickupLat)}:{}),...(settings.pickupLng?{longitude:Number(settings.pickupLng)}:{})};
}

export function createUberDelivery(config){
  const customerId=required(config.settings,"customerId");
  return {
    name:"uber",
    async testConnection(){await getToken(config);return {provider:"uber",ok:true}},
    async quote(order){
      const settings=config.settings||{};
      const data=await uberFetch(config,`/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`,{method:"POST",body:JSON.stringify({pickup_address:pickup(config).address,dropoff_address:addressObject(order.delivery_address,settings),...(settings.pickupLat&&settings.pickupLng?{pickup_latitude:Number(settings.pickupLat),pickup_longitude:Number(settings.pickupLng)}:{})})});
      return {provider:"uber",quoteId:data.id,feeCents:Number(data.fee||0),etaMinutes:data.duration?Math.round(Number(data.duration)/60):null,expiresAt:data.expires?Date.parse(data.expires):null,raw:data};
    },
    async create(order,quote){
      const settings=config.settings||{},data=await uberFetch(config,`/v1/customers/${encodeURIComponent(customerId)}/deliveries`,{method:"POST",body:JSON.stringify({quote_id:quote.quoteId,pickup_address:pickup(config).address,pickup_name:required(settings,"pickupName"),pickup_phone_number:required(settings,"pickupPhone"),dropoff_address:addressObject(order.delivery_address,settings),dropoff_name:order.customer_name,dropoff_phone_number:order.customer_phone,manifest_items:order.items.map(item=>({name:item.product_name,quantity:item.quantity,size:"small"}))})});
      return {provider:"uber",providerOrderId:data.id,providerStatus:data.status||"pending",trackingUrl:data.tracking_url,raw:data};
    }
  };
}
