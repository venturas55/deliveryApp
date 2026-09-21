const tokenCache=new Map();

function required(settings,name){
  const value=settings?.[name];
  if(!value)throw new Error(`Falta configuración Uber: ${name}`);
  return value;
}

function addressObject(address,settings={}){
  if(address&&typeof address==="object")return JSON.stringify({street_address:[address.street,address.number].filter(Boolean).join(" "),city:address.city,state:address.province||address.city,zip_code:address.postal_code,country:address.country||"ES"});
  return JSON.stringify({street_address:[address],city:settings.city||"Valencia",state:settings.state||"Valencia",zip_code:settings.postcode||"",country:settings.country||"ES"});
}
function orderAddress(order){
  return {street:order.delivery_street,number:order.delivery_number,city:order.delivery_city,province:order.delivery_province,postal_code:order.delivery_postal_code,country:order.delivery_country||"ES"};
}
function apiBase(settings){return (settings.apiBaseUrl||"https://api.uber.com").replace(/\/$/,"")}

function phoneNumber(value,name){
  const phone=String(value||"").replace(/[\s().-]/g,"");
  if(/^34\d{9}$/.test(phone))return `+${phone}`;
  if(/^\d{9}$/.test(phone))return `+34${phone}`;
  if(/^\+\d{8,15}$/.test(phone))return phone;
  throw new Error(`Configuración Uber inválida: ${name} debe usar formato internacional, por ejemplo +34963510732`);
}

async function getToken(config){
  const {clientId,clientSecret}=config.credentials||{};
  if(!clientId||!clientSecret)throw new Error("Faltan credenciales Uber");
  const key=`${clientId}:${clientSecret}`,cached=tokenCache.get(key);
  if(cached&&Date.now()<cached.expiresAt)return cached.token;
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"client_credentials",scope:"eats.deliveries"});
  const response=await fetch("https://auth.uber.com/oauth/v2/token",{signal:AbortSignal.timeout(15000),method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  if(!response.ok)throw new Error(`Uber auth failed: ${response.status} ${await response.text()}`);
  const data=await response.json();
  if(!data.access_token)throw new Error("Uber no devolvió access_token");
  tokenCache.set(key,{token:data.access_token,expiresAt:Date.now()+Math.max(30,Number(data.expires_in||300)-60)*1000});
  return data.access_token;
}

async function uberFetch(config,path,options={}){
  const response=await fetch(`${apiBase(config.settings)}${path}`,{signal:AbortSignal.timeout(15000),...options,headers:{"Content-Type":"application/json",Authorization:`Bearer ${await getToken(config)}`,...(options.headers||{})}});
  const text=await response.text();let data;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw new Error(`Uber ${response.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);
  return data;
}

function pickup(config){
  const settings=config.settings||{};
  return {address:addressObject(required(settings,"pickupAddress"),settings),name:required(settings,"pickupName"),phone_number:phoneNumber(settings.pickupPhone,"pickupPhone"),...(settings.pickupLat?{latitude:Number(settings.pickupLat)}:{}),...(settings.pickupLng?{longitude:Number(settings.pickupLng)}:{})};
}

export function createUberDelivery(config){
  const customerId=required(config.settings,"customerId");
  return {
    name:"uber",
    async testConnection(){await getToken(config);return {provider:"uber",ok:true}},
    async quote(order){
      const settings=config.settings||{};
      const data=await uberFetch(config,`/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`,{method:"POST",body:JSON.stringify({pickup_address:pickup(config).address,dropoff_address:addressObject(orderAddress(order),settings),...(order.delivery_latitude!=null&&order.delivery_longitude!=null?{dropoff_latitude:Number(order.delivery_latitude),dropoff_longitude:Number(order.delivery_longitude)}:{}),...(settings.pickupLat&&settings.pickupLng?{pickup_latitude:Number(settings.pickupLat),pickup_longitude:Number(settings.pickupLng)}:{})})});
      return {provider:"uber",quoteId:data.id,feeCents:Number(data.fee||0),etaMinutes:data.duration?Math.round(Number(data.duration)/60):null,expiresAt:data.expires?Date.parse(data.expires):null,raw:data};
    },
    async get(providerOrderId){
      return uberFetch(config,`/v1/customers/${encodeURIComponent(customerId)}/deliveries/${encodeURIComponent(providerOrderId)}`);
    },
    async create(order,quote){
      const code=required(order,"pickup_verification_code");
      const settings=config.settings||{},dropoffNotes=[order.delivery_patio&&`Patio: ${order.delivery_patio}`,order.delivery_apartment&&`Piso/puerta: ${order.delivery_apartment}`,order.delivery_notes].filter(Boolean).join(". "),verification=settings.dropoffVerification==="qr"?{dropoff_verification:{barcodes:[{type:"QR",value:required(order,"delivery_verification_code")}]}}:{},data=await uberFetch(config,`/v1/customers/${encodeURIComponent(customerId)}/deliveries`,{method:"POST",body:JSON.stringify({quote_id:quote.quoteId,idempotency_key:code,external_id:String(order.id),pickup_verification:{barcodes:[{type:"QR",value:code}]},...verification,pickup_notes:"Escanea el QR del pedido que muestra el restaurante antes de recogerlo.",undeliverable_action:"return",pickup_address:pickup(config).address,pickup_name:required(settings,"pickupName"),pickup_phone_number:phoneNumber(settings.pickupPhone,"pickupPhone"),dropoff_address:addressObject(orderAddress(order),settings),dropoff_name:order.customer_name,dropoff_phone_number:phoneNumber(order.customer_phone,"customer_phone"),dropoff_notes:dropoffNotes,...(order.delivery_latitude!=null&&order.delivery_longitude!=null?{dropoff_latitude:Number(order.delivery_latitude),dropoff_longitude:Number(order.delivery_longitude)}:{}),manifest_items:order.items.map(item=>({name:item.product_name,quantity:item.quantity,size:"small"}))})});
      return {provider:"uber",providerOrderId:data.id,providerStatus:data.status||"pending",trackingUrl:data.tracking_url,raw:data};
    }
  };
}
