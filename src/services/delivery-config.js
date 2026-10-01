import {query} from "../db.js";
import {decryptSecret,encryptSecret} from "./delivery-credentials.js";

export const providers=["uber","glovo","just_eat_jet_go"];

const fields={
  uber:{credentials:["clientId","clientSecret"],settings:["customerId","pickupName","pickupPhone","pickupAddress","pickupLat","pickupLng","apiBaseUrl","dropoffVerification"]},
  glovo:{credentials:["clientId","clientSecret"],settings:["apiBaseUrl","addressBookId","vendorId","pickupName","pickupPhone","pickupAddress","pickupCity","pickupPostcode","quotePath","createPath"]},
  just_eat_jet_go:{credentials:["clientId","clientSecret","apiKey"],settings:["apiBaseUrl","accountId","pickupName","pickupPhone","pickupAddress","pickupLat","pickupLng","tokenPath","quotePath","createPath"]},
};

function parseJson(value,fallback={}){try{return value?JSON.parse(value):fallback}catch{return fallback}}
function allowedValues(source,names,{ignoreEmpty=false}={}){
  return Object.fromEntries(names.filter(name=>source?.[name]!==undefined&&(!ignoreEmpty||String(source[name]).trim()!=="")).map(name=>[name,String(source[name]).trim()]));
}

function safeRow(row){
  const settings=parseJson(row.settings_json);
  return {
    provider:row.provider,
    enabled:Boolean(row.enabled),
    configured:Boolean(row.credentials_ciphertext),
    settings,
    lastTestStatus:row.last_test_status||null,
    lastTestError:row.last_test_error||null,
    lastTestedAt:row.last_tested_at||null
  };
}

export async function getDeliveryProviders(restaurantId){
  const rows=await query("SELECT * FROM delivery_providers WHERE restaurant_id=?",[restaurantId]);
  const byProvider=new Map(rows.map(row=>[row.provider,row]));
  return providers.map(provider=>safeRow(byProvider.get(provider)||{provider,enabled:0}));
}

export async function getDeliveryProviderConfig(restaurantId,provider){
  if(!providers.includes(provider))throw new Error("Proveedor no válido");
  const rows=await query(`SELECT dp.*,r.delivery_city AS restaurant_city,r.delivery_province AS restaurant_province,
    r.delivery_postal_code AS restaurant_postal_code,r.delivery_country AS restaurant_country,
    r.delivery_street AS restaurant_street,r.delivery_number AS restaurant_number,
    r.delivery_formatted_address AS restaurant_address,
    r.delivery_latitude AS restaurant_latitude,r.delivery_longitude AS restaurant_longitude
    FROM delivery_providers dp LEFT JOIN restaurants r ON r.id=dp.restaurant_id
    WHERE dp.restaurant_id=? AND dp.provider=?`,[restaurantId,provider]);
  if(!rows.length)return {provider,enabled:false,credentials:{},settings:{}};
  const row=rows[0];
  const settings=parseJson(row.settings_json);
  if(provider==="uber"){
    // The store address owns pickup; provider settings may contain an older address.
    if(row.restaurant_street||row.restaurant_address){
      settings.pickupAddress=row.restaurant_street?{
        street:row.restaurant_street,number:row.restaurant_number,
        city:row.restaurant_city,province:row.restaurant_province,
        postal_code:row.restaurant_postal_code,country:row.restaurant_country
      }:row.restaurant_address;
      settings.city=row.restaurant_city||"";
      settings.state=row.restaurant_province||row.restaurant_city||"";
      settings.postcode=row.restaurant_postal_code||"";
      settings.country=row.restaurant_country||"ES";
      settings.pickupLat=row.restaurant_latitude==null?"":String(row.restaurant_latitude);
      settings.pickupLng=row.restaurant_longitude==null?"":String(row.restaurant_longitude);
    }
    settings.city=settings.city||row.restaurant_city||"";
    settings.state=settings.state||row.restaurant_province||row.restaurant_city||"";
    settings.postcode=settings.postcode||row.restaurant_postal_code||"";
    settings.country=settings.country||row.restaurant_country||"ES";
    if(!settings.pickupLat&&row.restaurant_latitude!=null)settings.pickupLat=String(row.restaurant_latitude);
    if(!settings.pickupLng&&row.restaurant_longitude!=null)settings.pickupLng=String(row.restaurant_longitude);
  }
  return {
    ...safeRow(row),
    settings,
    credentials:row.credentials_ciphertext?parseJson(decryptSecret(row.credentials_ciphertext)):{}
  };
}

export async function getDeliveryWebhookSecret(restaurantId,provider){
  const rows=await query("SELECT webhook_secret_ciphertext FROM delivery_providers WHERE restaurant_id=? AND provider=?",[restaurantId,provider]);
  return rows[0]?.webhook_secret_ciphertext?decryptSecret(rows[0].webhook_secret_ciphertext):null;
}

export async function saveDeliveryProvider(restaurantId,provider,input){
  if(!providers.includes(provider))throw new Error("Proveedor no válido");
  const current=await query("SELECT * FROM delivery_providers WHERE restaurant_id=? AND provider=?",[restaurantId,provider]);
  const row=current[0];
  const definition=fields[provider];
  const credentials=allowedValues(input?.credentials,definition.credentials,{ignoreEmpty:true});
  const settings={...parseJson(row?.settings_json),...allowedValues(input?.settings,definition.settings)};
  const existingCredentials=row?.credentials_ciphertext?parseJson(decryptSecret(row.credentials_ciphertext)):{};
  const mergedCredentials={...existingCredentials,...credentials};
  const encrypted=Object.keys(mergedCredentials).length?encryptSecret(JSON.stringify(mergedCredentials)):null;
  const enabled=input?.enabled===true||input?.enabled===1||input?.enabled==="1";
  const webhookSecret=typeof input?.webhookSecret==="string"&&input.webhookSecret.trim()?encryptSecret(input.webhookSecret.trim()):row?.webhook_secret_ciphertext||null;
  await query(`INSERT INTO delivery_providers(restaurant_id,provider,enabled,credentials_ciphertext,settings_json,webhook_secret_ciphertext)
    VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),credentials_ciphertext=VALUES(credentials_ciphertext),settings_json=VALUES(settings_json),webhook_secret_ciphertext=VALUES(webhook_secret_ciphertext)`,
    [restaurantId,provider,enabled?1:0,encrypted,JSON.stringify(settings),webhookSecret]);
  return (await getDeliveryProviders(restaurantId)).find(item=>item.provider===provider);
}

export function providerFields(provider){return fields[provider]}
