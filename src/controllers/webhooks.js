import {createHmac,timingSafeEqual} from "node:crypto";
import {query,transaction} from "../db.js";
import {getDeliveryWebhookSecret} from "../services/delivery-config.js";
import {logEvent} from "../services/order-events.js";

const statusMap={
  pending:"delivery_requested",created:"delivery_requested",accepted:"delivery_requested",
  courier_assigned:"courier_assigned",assigned:"courier_assigned",picked_up:"out_for_delivery",out_for_delivery:"out_for_delivery",
  delivered:"delivered",completed:"delivered",cancelled:"cancelled",canceled:"cancelled",failed:"cancelled"
};

function validSignature(raw,secret,header){
  if(typeof header!=="string")return false;
  const supplied=header.replace(/^sha256=/,"").trim();
  if(!/^[a-f0-9]{64}$/i.test(supplied))return false;
  const expected=createHmac("sha256",secret).update(raw).digest("hex");
  return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(supplied,"hex"));
}

export async function deliveryWebhook(req,res){
  const provider=req.params.provider,restaurantId=Number(req.params.restaurantId);
  if(!["uber","glovo"].includes(provider)||!Number.isInteger(restaurantId)||restaurantId<1)return res.status(404).json({error:"Webhook no encontrado"});
  const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from(JSON.stringify(req.body||{}));
  const secret=await getDeliveryWebhookSecret(restaurantId,provider);
  if(!secret||!validSignature(raw,secret,req.get("x-delivery-signature")||req.get("x-signature")))return res.status(401).json({error:"Firma inválida"});
  let payload;try{payload=JSON.parse(raw.toString("utf8"))}catch{return res.status(400).json({error:"JSON inválido"})}
  const eventId=String(payload.event_id||payload.eventId||payload.id||"");
  const providerOrderId=String(payload.delivery_id||payload.deliveryId||payload.order_id||payload.orderId||payload.id||"");
  const status=statusMap[String(payload.status||payload.state||payload.event_type||"").toLowerCase()];
  if(!providerOrderId||!status)return res.status(202).json({ok:true,ignored:true});
  await transaction(async connection=>{
    const orders=await connection.query("SELECT id,status FROM orders WHERE restaurant_id=? AND provider=? AND provider_order_id=? FOR UPDATE",[restaurantId,provider,providerOrderId]);
    if(!orders.length)return;
    if(eventId){
      const duplicate=await connection.query("SELECT id FROM order_events WHERE order_id=? AND event_type='delivery.updated' AND payload_json LIKE ? LIMIT 1",[orders[0].id,`%\\\"eventId\\\":\\\"${eventId.replace(/[%_]/g,"\\$&")}\\\"%`]);
      if(duplicate.length)return;
    }
    await connection.query("UPDATE orders SET status=?,provider_status=? WHERE id=?",[status,String(payload.status||payload.state||status).slice(0,80),orders[0].id]);
    await logEvent(connection,orders[0].id,"delivery.updated",{provider,providerOrderId,eventId,status,raw:payload});
  });
  return res.json({ok:true});
}