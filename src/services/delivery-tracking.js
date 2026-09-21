const states={pending:"delivery_requested",created:"delivery_requested",accepted:"delivery_requested",pickup:"courier_assigned",courier_assigned:"courier_assigned",assigned:"courier_assigned",pickup_complete:"out_for_delivery",dropoff:"out_for_delivery",picked_up:"out_for_delivery",out_for_delivery:"out_for_delivery",delivered:"delivered",completed:"delivered",cancelled:"cancelled",canceled:"cancelled",failed:"cancelled",returned:"cancelled"};
const ranks={delivery_requested:0,courier_assigned:1,out_for_delivery:2,delivered:3,cancelled:3};
const uberStates=new Set(["pending","pickup","pickup_complete","dropoff","delivered","canceled","returned"]);
export function parseDetails(value){try{return JSON.parse(value||"{}")||{}}catch{return {}}}
export function safeTrackingUrl(value){
  try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password?url.href:null}catch{return null}
}
function date(value){const ms=typeof value==="string"?Date.parse(value):NaN;return Number.isFinite(ms)?ms:0}

export function normalizeDelivery(provider,payload,{snapshot=false}={}){
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return null;
  const uber=provider==="uber",data=uber?(snapshot?payload:payload.data||{}):payload;
  if(uber&&!snapshot&&!["event.delivery_status","event.courier_update"].includes(payload.kind))return null;
  const providerStatus=String((uber?(snapshot?data.status:payload.status||data.status):payload.status||payload.state||payload.event_type)||"").toLowerCase();
  const status=states[providerStatus];
  const providerOrderId=String(uber?(snapshot?data.id:payload.delivery_id||data.id||""):payload.delivery_id||payload.deliveryId||payload.order_id||payload.orderId||payload.id||"");
  const eventId=snapshot?null:String(payload.event_id||payload.eventId||payload.id||"");
  if(!providerOrderId||providerOrderId.length>160||!status||(uber&&!uberStates.has(providerStatus))||(!snapshot&&uber&&!eventId)||eventId?.length>191)return null;
  return {providerOrderId,eventId:eventId||null,providerStatus,status,eventMs:date(snapshot?data.updated:payload.created||data.updated),data,raw:payload};
}

function detailsFrom(update,previous,pickupCode,deliveryCode){
  const data=update.data,details={...previous};
  if(data.tracking_url!==undefined)details.trackingUrl=safeTrackingUrl(data.tracking_url);
  if(data.courier!==undefined){
    const courier=data.courier;
    details.courier=courier?{name:courier.name||"",phone:courier.public_phone_info?.formatted_phone_number||courier.phone_number||"",vehicle:courier.vehicle_type||"",plate:courier.vehicle_license_plate||""}:null;
  }
  for(const [field,key] of [["pickup_eta","pickupEta"],["dropoff_eta","dropoffEta"]]){
    if(data[field]!==undefined)details[key]=date(data[field])?data[field]:null;
  }
  if(data.courier_imminent!==undefined)details.courierImminent=data.courier_imminent===true;
  const barcodes=data.pickup?.verification?.barcodes;
  if(Array.isArray(barcodes)&&barcodes.length){
    const barcode=barcodes.find(item=>item.type==="QR"&&item.value===pickupCode),result=barcode?.scan_result;
    details.pickupVerification={outcome:result?.outcome==="SUCCESS"?"SUCCESS":result?.outcome||"MISMATCH",timestamp:date(result?.timestamp)?result.timestamp:null};
  }
  const dropoffBarcodes=data.dropoff?.verification?.barcodes;
  if(Array.isArray(dropoffBarcodes)&&dropoffBarcodes.length){
    const barcode=dropoffBarcodes.find(item=>item.type==="QR"&&item.value===deliveryCode),result=barcode?.scan_result;
    details.dropoffVerification={outcome:result?.outcome==="SUCCESS"?"SUCCESS":result?.outcome||"MISMATCH",timestamp:date(result?.timestamp)?result.timestamp:null};
  }
  const reason=data.undeliverable_reason||data.cancellation_reason||data.cancelation_reason;
  if(reason)details.incident=typeof reason==="string"?reason:reason.secondary_reason||reason.primary_reason||"Incidencia de reparto";
  if(data.undeliverable_action!==undefined)details.undeliverableAction=data.undeliverable_action;
  if(Array.isArray(data.related_deliveries))details.returnDeliveryId=data.related_deliveries.find(item=>item.relationship==="returned")?.id||details.returnDeliveryId;
  if(update.providerStatus==="returned")details.returnPending=false;
  else if(update.providerStatus==="canceled")details.returnPending=!!details.returnDeliveryId||((data.pickup?.status==="completed"||["pickup_complete","dropoff"].includes(previous.providerStatus))&&details.undeliverableAction==="return");
  details.providerStatus=update.providerStatus;
  details.updatedAt=new Date(update.eventMs||Date.now()).toISOString();
  return details;
}

// Caller holds the order row lock. Receipt and state update share its transaction.
export async function applyDeliveryUpdate(connection,order,update,{source="webhook"}={}){
  if(update.providerOrderId!==order.provider_order_id)throw new Error("El reparto recibido no coincide con el pedido");
  if(update.eventId){
    const duplicate=await connection.query("SELECT id FROM order_events WHERE order_id=? AND provider_event_id=? LIMIT 1",[order.id,update.eventId]);
    if(duplicate.length)return {ok:true,duplicate:true};
  }
  const previous=parseDetails(order.delivery_details_json),oldMs=Number(order.delivery_event_ms||0);
  const terminal=["delivered","cancelled"].includes(order.status);
  const backwards=(ranks[update.status]??0)<(ranks[order.status]??0)||(terminal&&order.status!==update.status)||(order.provider_status==="returned"&&update.providerStatus!=="returned")||(order.provider_status==="dropoff"&&update.providerStatus==="pickup_complete");
  const stale=update.eventMs>0&&update.eventMs<oldMs,ignored=backwards||stale;
  if(!ignored){
    const details=detailsFrom(update,previous,order.pickup_verification_code,order.delivery_verification_code);
    if(source==="sync")details.syncedAt=new Date().toISOString();
    await connection.query("UPDATE orders SET status=?,provider_status=?,delivery_details_json=?,delivery_event_ms=? WHERE id=?",[update.status,update.providerStatus,JSON.stringify(details),Math.max(oldMs,update.eventMs),order.id]);
  }
  await connection.query("INSERT INTO order_events(order_id,event_type,payload_json,provider_event_id) VALUES(?,?,?,?)",[order.id,ignored?"delivery.ignored":source==="sync"?"delivery.synced":"delivery.updated",JSON.stringify({provider:order.provider,providerOrderId:update.providerOrderId,eventId:update.eventId,status:update.status,ignored,reason:stale?"Evento antiguo":backwards?"Transición no permitida":undefined,raw:update.raw}),update.eventId]);
  return {ok:true,ignored};
}

export function deliveryView(order){
  const details=parseDetails(order.delivery_details_json),uber=order.provider==="uber",dropoffResult=details.dropoffVerification;
  const pickupOpen=uber&&!!order.provider_order_id&&["delivery_requested","courier_assigned"].includes(order.status),result=details.pickupVerification;
  return {...details,trackingUrl:safeTrackingUrl(details.trackingUrl),canSync:uber&&!!order.provider_order_id,showPickupQr:pickupOpen&&!!order.pickup_verification_code,showDeliveryQr:uber&&!!order.delivery_verification_code&&order.status==="out_for_delivery",
    verificationLabel:result?.outcome==="SUCCESS"?"Recogida verificada":result?"Verificación fallida: "+result.outcome:order.pickup_verification_code?"Sin confirmación de escaneo":"Verificación QR no solicitada",
    deliveryVerificationLabel:dropoffResult?.outcome==="SUCCESS"?"Entrega verificada":dropoffResult?"Verificación de entrega fallida: "+dropoffResult.outcome:order.delivery_verification_code?"Sin confirmación de entrega":"Verificación de entrega no solicitada",
    verificationProblem:!!result&&result.outcome!=="SUCCESS"||!!order.pickup_verification_code&&["out_for_delivery","delivered"].includes(order.status)&&result?.outcome!=="SUCCESS",
    deliveryVerificationProblem:!!dropoffResult&&dropoffResult.outcome!=="SUCCESS"||!!order.delivery_verification_code&&order.status==="delivered"&&dropoffResult?.outcome!=="SUCCESS"};
}
