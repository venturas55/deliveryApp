function required(value,name){
  if(!value)throw new Error(`Falta configuración JET Go: ${name}`);
  return value;
}

function parseResponse(text){try{return text?JSON.parse(text):null}catch{return text}}

async function request(config,path,options={}){
  const base=required(config.settings?.apiBaseUrl,"apiBaseUrl").replace(/\/$/,"");
  const response=await fetch(`${base}${path}`,{...options,headers:{Accept:"application/json","Content-Type":"application/json",...(options.headers||{})}});
  const data=parseResponse(await response.text());
  if(!response.ok)throw new Error(`JET Go ${response.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);
  return data;
}

async function getToken(config){
  const credentials=config.credentials||{},settings=config.settings||{};
  if(credentials.apiKey)return credentials.apiKey;
    const cacheKey=`${credentials.clientId}:${credentials.clientSecret}:${settings.apiBaseUrl}:${settings.tokenPath||"/oauth/token"}`;
    const cached=tokenCache.get(cacheKey);
    if(cached&&Date.now()<cached.expiresAt)return cached.token;
  const body=new URLSearchParams({client_id:required(credentials.clientId,"clientId"),client_secret:required(credentials.clientSecret,"clientSecret"),grant_type:"client_credentials"});
  const data=await request(config,settings.tokenPath||"/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    const token=required(data?.access_token||data?.accessToken,"access token");
    tokenCache.set(cacheKey,{token,expiresAt:Date.now()+Math.max(30,Number(data.expires_in||300)-60)*1000});
    return token;
}
  const tokenCache=new Map();

function headers(token){return {Authorization:`Bearer ${token}`}}

export function createJustEatJetGoDelivery(config){
  return {
    name:"just_eat_jet_go",
    async testConnection(){await getToken(config);return {provider:"just_eat_jet_go",ok:true}},
    async quote(order){
      const settings=config.settings||{},token=await getToken(config);
      const data=await request(config,required(settings.quotePath,"quotePath"),{method:"POST",headers:headers(token),body:JSON.stringify({accountId:settings.accountId,pickup:{name:settings.pickupName,phone:settings.pickupPhone,address:settings.pickupAddress,latitude:settings.pickupLat?Number(settings.pickupLat):undefined,longitude:settings.pickupLng?Number(settings.pickupLng):undefined},dropoff:{address:order.delivery_formatted_address,latitude:Number(order.delivery_latitude),longitude:Number(order.delivery_longitude),name:order.customer_name,phone:order.customer_phone}})});
      return {provider:"just_eat_jet_go",quoteId:data.quoteId||data.id,feeCents:Number(data.feeCents??data.fee??0),etaMinutes:Number(data.etaMinutes??data.durationMinutes??0)||null,expiresAt:data.expiresAt?Date.parse(data.expiresAt):null,raw:data};
    },
    async create(order,quote){
      const settings=config.settings||{},token=await getToken(config);
      const data=await request(config,required(settings.createPath,"createPath"),{method:"POST",headers:headers(token),body:JSON.stringify({accountId:settings.accountId,quoteId:quote.quoteId,pickup:{name:settings.pickupName,phone:settings.pickupPhone,address:settings.pickupAddress},dropoff:{address:order.delivery_formatted_address,latitude:Number(order.delivery_latitude),longitude:Number(order.delivery_longitude),name:order.customer_name,phone:order.customer_phone,apartment:order.delivery_apartment, instructions:order.delivery_notes},items:order.items.map(item=>({name:item.product_name,quantity:item.quantity}))})});
      return {provider:"just_eat_jet_go",providerOrderId:data.deliveryId||data.orderId||data.id,providerStatus:data.status||"created",trackingUrl:data.trackingUrl,raw:data};
    }
  };
}