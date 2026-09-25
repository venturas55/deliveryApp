import {query} from "../db.js";
import {decryptSecret,encryptSecret} from "./delivery-credentials.js";

export const providers=["uber","glovo","just_eat_jet_go"];

const fields={
  uber:{credentials:["clientId","clientSecret"],settings:["customerId","pickupName","pickupPhone","pickupAddress","pickupLat","pickupLng","apiBaseUrl","dropoffVerification"]},
  glovo:{credentials:["clientId","clientSecret"],settings:["apiBaseUrl","addressBookId","vendorId","pickupName","pickupPhone","pickupAddress","pickupCity","pickupPostcode","quotePath","createPath"]},
  just_eat_jet_go:{credentials:["clientId","clientSecret","apiKey"],settings:["apiBaseUrl","accountId","pickupName","pickupPhone","pickupAddress","pickupLat","pickupLng","tokenPath","quotePath","createPath"]},
};

function parseJson(value,fallback={}){try{return value?JSON.parse(value):fallback}catch{return fallback}}
function allowedValues(source,names){
  return Object.fromEntries(names.filter(name=>source?.[name]!==undefined).map(name=>[name,String(source[name]).trim()]));
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
  const rows=await query("SELECT * FROM delivery_providers WHERE restaurant_id=? AND provider=?",[restaurantId,provider]);
  if(!rows.length)return {provider,enabled:false,credentials:{},settings:{}};
  const row=rows[0];
  return {
    ...safeRow(row),
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
  const credentials=allowedValues(input?.credentials,definition.credentials);
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