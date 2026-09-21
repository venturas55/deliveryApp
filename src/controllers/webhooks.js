import {createHmac,timingSafeEqual} from "node:crypto";
import {transaction} from "../db.js";
import {getDeliveryWebhookSecret} from "../services/delivery-config.js";
import {normalizeDelivery,applyDeliveryUpdate} from "../services/delivery-tracking.js";

export function validSignature(raw,secret,header){
  if(!Buffer.isBuffer(raw)||typeof header!=="string")return false;
  const supplied=header.replace(/^sha256=/,"").trim();
  if(!/^[a-f0-9]{64}$/i.test(supplied))return false;
  const expected=createHmac("sha256",secret).update(raw).digest();
  return timingSafeEqual(expected,Buffer.from(supplied,"hex"));
}

export async function deliveryWebhook(req,res){
  const provider=req.params.provider,restaurantId=Number(req.params.restaurantId);
  if(!["uber","glovo","just_eat_jet_go","stuart"].includes(provider)||!Number.isInteger(restaurantId)||restaurantId<1)return res.status(404).json({error:"Webhook no encontrado"});
  const secret=await getDeliveryWebhookSecret(restaurantId,provider);
  const signature=provider==="uber"?req.get("x-uber-signature")||req.get("x-postmates-signature"):req.get("x-delivery-signature")||req.get("x-signature");
  if(!secret||!validSignature(req.body,secret,signature))return res.status(401).json({error:"Firma inválida"});
  let payload;try{payload=JSON.parse(req.body.toString("utf8"))}catch{return res.status(400).json({error:"JSON inválido"})}
  const update=normalizeDelivery(provider,payload);
  if(!update)return res.status(202).json({ok:true,ignored:true});
  const result=await transaction(async connection=>{
    const orders=await connection.query("SELECT * FROM orders WHERE restaurant_id=? AND provider=? AND provider_order_id=? FOR UPDATE",[restaurantId,provider,update.providerOrderId]);
    // A notification can beat the create-delivery commit. Ask Uber to retry.
    if(!orders.length)return null;
    return applyDeliveryUpdate(connection,orders[0],update);
  });
  if(!result)return res.status(503).json({error:"Reparto todavía no disponible"});
  return res.json(result);
}
