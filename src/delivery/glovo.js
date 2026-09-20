function required(settings,name){
  const value=settings?.[name];
  if(!value)throw new Error(`Falta configuración Glovo: ${name}`);
  return value;
}
function parseResponse(text){try{return text?JSON.parse(text):null}catch{return text}}
async function glovoFetch(config,path,options={}){
  const base=required(config.settings,"apiBaseUrl").replace(/\/$/,"");
  const response=await fetch(`${base}${path}`,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const data=parseResponse(await response.text());
  if(!response.ok)throw new Error(`Glovo ${response.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);
  return data;
}
async function getToken(config){
  const credentials=config.credentials||{};
  const data=await glovoFetch(config,"/oauth/token",{method:"POST",body:JSON.stringify({grantType:"client_credentials",clientId:required(credentials,"clientId"),clientSecret:required(credentials,"clientSecret")})});
  if(!data?.accessToken)throw new Error("Glovo no devolvió accessToken");
  return data.accessToken;
}
export function createGlovoDelivery(config){
  return {
    name:"glovo",
    async testConnection(){await getToken(config);return {provider:"glovo",ok:true}},
    async quote(order){
      const token=await getToken(config),settings=config.settings||{},path=settings.quotePath||"/v2/laas/quotes";
      const payload={pickupDetails:{...(settings.addressBookId?{addressBook:{id:settings.addressBookId}}:{}),pickupTime:new Date(Date.now()+15*60*1000).toISOString()},deliveryAddress:{rawAddress:order.delivery_address}};
      const data=await glovoFetch(config,path,{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
      return {provider:"glovo",quoteId:data.quoteId||data.id,feeCents:Number(data.quotePrice||data.fee||0),etaMinutes:data.estimatedTimeOfDelivery?Math.round((Date.parse(data.estimatedTimeOfDelivery)-Date.now())/60000):null,expiresAt:data.expiresAt?Date.parse(data.expiresAt):null,raw:data};
    },
    async create(order,quote){
      const settings=config.settings||{};
      if(!settings.createPath)throw new Error("Glovo no tiene ruta de creación configurada para este contrato");
      const token=await getToken(config),data=await glovoFetch(config,settings.createPath,{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({quoteId:quote.quoteId,deliveryAddress:{rawAddress:order.delivery_address},customer:{name:order.customer_name,phone:order.customer_phone},items:order.items.map(item=>({name:item.product_name,quantity:item.quantity}))})});
      return {provider:"glovo",providerOrderId:data.id||data.orderId,providerStatus:data.status||"created",trackingUrl:data.trackingUrl,raw:data};
    }
  };
}

function legacyConfig(){
  return {credentials:{clientId:process.env.GLOVO_CLIENT_ID,clientSecret:process.env.GLOVO_CLIENT_SECRET},settings:{apiBaseUrl:process.env.GLOVO_API_BASE_URL,addressBookId:process.env.GLOVO_ADDRESS_BOOK_ID}};
}

export async function glovoQuote({address,latitude,longitude,details=""}){
  const config=legacyConfig(),settings=config.settings;
  const token=await getToken(config);
  const payload={pickupDetails:{addressBook:{id:required(settings,"addressBookId")},pickupTime:new Date(Date.now()+15*60*1000).toISOString()},deliveryAddress:{rawAddress:address,details,...(latitude!=null&&longitude!=null?{coordinates:{latitude:Number(latitude),longitude:Number(longitude)}}:{})}};
  return glovoFetch(config,"/v2/laas/quotes",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
}

export async function listGlovoAddresses(){
  const config=legacyConfig(),token=await getToken(config);
  return glovoFetch(config,"/v2/laas/addresses",{headers:{Authorization:`Bearer ${token}`}});
}
