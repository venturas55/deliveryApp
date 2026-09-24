import {query,transaction} from "../db.js";
import {randomUUID} from "node:crypto";
import QRCode from "qrcode";
import {normalizeDelivery,applyDeliveryUpdate,deliveryView} from "../services/delivery-tracking.js";
import {getConfiguredDeliveryProvider,getConfiguredDeliveryProviders} from "../delivery/index.js";
import {mockDelivery} from "../delivery/mock.js";
import {logEvent} from "../services/order-events.js";
import {httpError} from "../services/http-error.js";
import {cleanAddress,validateAddress} from "../services/geocoding.js";
import {getDeliveryProviders,providerFields,saveDeliveryProvider} from "../services/delivery-config.js";
import {  refundOrderPayment} from "./redsys-payments.js";
// Lock the order so each state change and its event are committed together.
function orderError(status,message){return Object.assign(new Error(message),{status})}

function eurosToCents(value) {
  const normalized = String(value)
    .trim()
    .replace(",", ".");

  const euros = Number(normalized);

  if (!Number.isFinite(euros) || euros < 0) {
    throw orderError(
      400,
      "El importe introducido no es válido"
    );
  }

  return Math.round(euros * 100);
}
async function changeOrder(req,fn){
  return transaction(async c=>{
    const rows=await c.query("SELECT * FROM orders WHERE id=? AND restaurant_id=? FOR UPDATE",[req.params.id,req.user.restaurant_id]);
    if(!rows.length)throw orderError(404,"Pedido no encontrado");
    return fn(c,rows[0]);
  });
}
function deliveryReady(order){
  if(order.status!=="ready"||order.provider_order_id)throw orderError(409,"El pedido debe estar listo y sin reparto solicitado");
}

function productData(body,partial=false){
  if(!body||typeof body!=="object"||Array.isArray(body))throw orderError(400,"Datos de artículo inválidos");
  const data={};
  const defaults={description:"",category:"Pizzas",active:1,sort_order:0};
  for(const [field,max] of [["name",120],["description",255],["category",80]]){
    if(partial&&body[field]===undefined)continue;
    const value=body[field]??defaults[field];
    if(typeof value!=="string"||value.trim().length>max||(field!=="description"&&!value.trim()))throw orderError(400,`Campo ${field} inválido (máximo ${max} caracteres)`);
    data[field]=value.trim();
  }
  for(const field of ["price_cents","sort_order"]){
    if(partial&&body[field]===undefined)continue;
    const value=body[field]??defaults[field];
    if(typeof value!=="number"||!Number.isInteger(value)||value<0||value>2147483647)throw orderError(400,`Campo ${field} debe ser un entero positivo o cero`);
    data[field]=value;
  }
  if(!partial||body.active!==undefined){
    const value=body.active??1;
    if(![0,1,true,false].includes(value))throw orderError(400,"Disponibilidad inválida");
    data.active=Number(value);
  }
  if(!Object.keys(data).length)throw orderError(400,"No hay cambios que guardar");
  return data;
}

function configsData(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw orderError(400, "Datos de configuración inválidos");
  }

  const data = {};

  // Campos de texto
  const textFields = [
    ["name", 150],
    ["slug", 80],
    ["phone", 40],
    ["address", 500],
    ["city", 100]
  ];

  for (const [field, max] of textFields) {
    if (partial && body[field] === undefined) continue;

    const value = body[field] ?? "";

    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > max
    ) {
      throw orderError(
        400,
        `Campo ${field} inválido (máximo ${max} caracteres)`
      );
    }

    data[field] = value.trim();
  }

  for (const [field, max] of [
    ["delivery_formatted_address", 500],
    ["delivery_street", 180],
    ["delivery_number", 40],
    ["delivery_city", 120],
    ["delivery_province", 120],
    ["delivery_postal_code", 20],
    ["delivery_country", 2],
    ["delivery_place_id", 255],
    ["delivery_patio", 120]
  ]) {
    if (partial && body[field] === undefined) continue;
    const value = body[field] ?? "";
    if (typeof value !== "string" || value.length > max) {
      throw orderError(400, `Campo ${field} inválido (máximo ${max} caracteres)`);
    }
    data[field] = value.trim();
  }

  for (const field of [
  "delivery_base_cents",
  "free_delivery_from_cents"
]) {
  if (partial && body[field] === undefined) continue;

  const euros = Number(
    String(body[field]).replace(",", ".")
  );

  if (!Number.isFinite(euros) || euros < 0) {
    throw orderError(
      400,
      `Campo ${field} inválido`
    );
  }

  for (const field of ["delivery_latitude", "delivery_longitude"]) {
    if (partial && body[field] === undefined) continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value)) throw orderError(400, `Campo ${field} inválido`);
    data[field] = value;
  }

  // Euros → céntimos
  data[field] = Math.round(euros * 100);
}

  // Restaurante activo/inactivo
  if (!partial || body.active !== undefined) {
    const value = body.active ?? 1;

    if (![0, 1, true, false, "0", "1"].includes(value)) {
      throw orderError(
        400,
        "Disponibilidad inválida"
      );
    }

    data.active = Number(value);
  }

  if (!Object.keys(data).length) {
    throw orderError(
      400,
      "No hay cambios que guardar"
    );
  }

  return data;
}


export async function adminOrders(req){
  const groups=new Map([
    ["all",[]],["pending",["new"]],
    ["in_progress",["accepted","preparing","ready","delivery_requested","courier_assigned","out_for_delivery"]],
    ["delivered",["delivered"]],["cancelled",["cancelled"]]
  ]);
  const filter=req.query.filter??"all";
  if(!groups.has(filter))throw httpError(400,"Filtro de pedidos no válido");
  const states=groups.get(filter);
  const clause=states.length?` AND status IN (${states.map(()=>"?").join(",")})`:"";
  const orders=await query(`SELECT * FROM orders WHERE restaurant_id=?${clause} ORDER BY id DESC LIMIT 200`,[req.user.restaurant_id,...states]);
  return (orders);
}

export async function adminOrder(req){
  const rows=await query("SELECT * FROM orders WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
  if(!rows.length)throw httpError(404,"Pedido no encontrado");
  const items=await query("SELECT * FROM order_items WHERE order_id=?",[req.params.id]);
  const events=await query("SELECT event_type,payload_json,created_at FROM order_events WHERE order_id=? ORDER BY id DESC",[req.params.id]);
  return ({...rows[0],items,events});
}

export async function setOrderStatus(req) {

  const transitions = {
    new: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["cancelled"]
  };

  const status = req.body?.status;

  if (
    ![
      "accepted",
      "preparing",
      "ready",
      "cancelled"
    ].includes(status)
  ) {
    throw orderError(
      400,
      "Estado no permitido"
    );
  }

  /*
   * Si el administrador está rechazando
   * el pedido, comprobamos primero si
   * tenemos que devolver un pago Redsys.
   */
  if (status === "cancelled") {

    await refundOrderPayment(
      req.params.id
    );
  }

  /*
   * Solo llegamos aquí si:
   *
   * - no necesitaba devolución, o
   * - Redsys confirmó la devolución.
   */
  await changeOrder(
    req,
    async (c, order) => {

      if (
        !transitions[order.status]?.includes(status)
      ) {
        throw orderError(
          409,
          "El pedido ya ha cambiado o no permite esta transición"
        );
      }

      await c.query(
        `UPDATE orders
         SET status = ?
         WHERE id = ?`,
        [
          status,
          order.id
        ]
      );

      await logEvent(
        c,
        order.id,
        "status.changed",
        {
          from: order.status,
          status
        }
      );

      /*
       * Dejamos además constancia
       * explícita de la devolución.
       */
      if (
        status === "cancelled" &&
        order.payment_method === "online" &&
        order.payment_status === "refunded"
      ) {

        await logEvent(
          c,
          order.id,
          "payment.refunded",
          {
            amountCents:
              order.refund_amount_cents
          }
        );
      }
    }
  );

  return {
    ok: true
  };
}
export async function deliveryQuote(req){
  const quote=await changeOrder(req,async(c,order)=>{
    deliveryReady(order);
    const items=await c.query("SELECT * FROM order_items WHERE order_id=?",[order.id]);
    const providers=await getConfiguredDeliveryProviders(order.restaurant_id);
    const results=await Promise.all(providers.map(async provider=>{
      try{
        const result=await provider.quote({...order,items});
        return {...result,expiresAt:result.expiresAt||Date.now()+5*60*1000};
      }catch(error){return {provider:provider.name,error:error.message}}
    }));
    const quotes=results.filter(result=>!result.error),errors=results.filter(result=>result.error);
    if(!quotes.length){
      const details=errors.map(item=>`${item.provider}: ${item.error}`).join(" | ");
      throw orderError(422,`Ningún proveedor pudo cotizar el reparto. Revisa la configuración: ${details}`);
    }
    const payload={quotes,errors};
    await logEvent(c,order.id,"delivery.quoted",payload);
    return process.env.DELIVERY_PROVIDER==="mock"?quotes[0]:payload;
  });
  return (quote);
}

export async function dispatchDelivery(req){
  const requestedProvider=req.body?.provider||req.body?.quote?.provider||(process.env.DELIVERY_PROVIDER==="mock"?"mock":null);
  const requestedQuoteId=req.body?.quoteId||req.body?.quote?.quoteId;
  if(!requestedProvider||!requestedQuoteId)throw orderError(400,"Proveedor y quoteId requeridos");
  // Commit the stable QR/idempotency key before any external create request.
  if(requestedProvider==="uber")await changeOrder(req,async(c,order)=>{
    deliveryReady(order);
    if(!order.pickup_verification_code)await c.query("UPDATE orders SET pickup_verification_code=? WHERE id=?",[randomUUID(),order.id]);
    if(!order.delivery_verification_code)await c.query("UPDATE orders SET delivery_verification_code=? WHERE id=?",[randomUUID(),order.id]);
  });
  const delivery=await changeOrder(req,async(c,order)=>{
    deliveryReady(order);
    const events=await c.query("SELECT payload_json FROM order_events WHERE order_id=? AND event_type='delivery.quoted' ORDER BY id DESC LIMIT 1",[order.id]);
    const stored=events.length?JSON.parse(events[0].payload_json):null;
    const quote=stored?.quotes?stored.quotes.find(item=>item.provider===requestedProvider&&item.quoteId===requestedQuoteId):stored;
    const provider=await getConfiguredDeliveryProvider(order.restaurant_id,requestedProvider);
    if(!quote||quote.expiresAt<=Date.now()||quote.provider!==provider.name)
      throw orderError(409,"Consulta de nuevo el precio: la oferta ha caducado o no es válida");
    const items=await c.query("SELECT * FROM order_items WHERE order_id=?",[order.id]);
    const delivery=await provider.create({...order,items},quote);
    await c.query("UPDATE orders SET status='delivery_requested',provider=?,provider_order_id=?,provider_status=? WHERE id=?",[delivery.provider,delivery.providerOrderId,delivery.providerStatus,order.id]);
    await logEvent(c,order.id,"delivery.requested",{...delivery,status:"delivery_requested",feeCents:quote.feeCents});
    if(delivery.provider==="uber"){
      const update=normalizeDelivery("uber",delivery.raw,{snapshot:true});
      if(!update)throw orderError(502,"Uber devolvió un reparto no válido; reintenta la solicitud");
      await applyDeliveryUpdate(c,{...order,status:"delivery_requested",provider:"uber",provider_order_id:delivery.providerOrderId,provider_status:delivery.providerStatus},update,{source:"create"});
    }
    return delivery;
  });
  return (delivery);
}

export async function syncDelivery(req){
  return changeOrder(req,async(c,order)=>{
    if(order.provider!=="uber"||!order.provider_order_id)throw orderError(409,"Este pedido no tiene reparto Uber");
    const provider=await getConfiguredDeliveryProvider(order.restaurant_id,"uber",true);
    const data=await provider.get(order.provider_order_id);
    const update=normalizeDelivery("uber",data,{snapshot:true});
    if(!update)throw orderError(502,"Uber devolvió un estado no reconocido");
    return applyDeliveryUpdate(c,order,update,{source:"sync"});
  });
}

export async function pickupQr(req){
  const order=await adminOrder(req);
  if(!deliveryView(order).showPickupQr)throw orderError(409,"QR no disponible: comprueba el estado de recogida");
  return QRCode.toBuffer(order.pickup_verification_code,{type:"png",width:320,margin:4,errorCorrectionLevel:"M"});
}

export async function simulateDelivery(req){
  const result=await changeOrder(req,async(c,order)=>{
    const uberSimulation=process.env.DELIVERY_SIMULATION==="true"&&order.provider==="uber";
    if((order.provider!=="mock"&&!uberSimulation)||!order.provider_order_id)throw orderError(409,"Este pedido no tiene un reparto simulado");
    const next=mockDelivery.next(order.status);
    if(!next||req.body?.status!==next.status)throw orderError(409,"El pedido ya ha cambiado o no permite este paso");
    if(uberSimulation){
      const update={providerOrderId:order.provider_order_id,eventId:`simulation-${next.providerStatus}-${Date.now()}`,providerStatus:next.providerStatus,status:next.status,eventMs:Date.now(),data:{id:order.provider_order_id,status:next.providerStatus,...next.status==="courier_assigned"?{courier:{name:"Repartidor simulado",public_phone_info:{formatted_phone_number:"+34900000000"}}}:next.status==="out_for_delivery"?{pickup:{verification:{barcodes:[{type:"QR",value:order.pickup_verification_code,scan_result:{outcome:"SUCCESS",timestamp:new Date().toISOString()}}]}}}:next.status==="delivered"?{dropoff:{verification:{barcodes:[{type:"QR",value:order.delivery_verification_code,scan_result:{outcome:"SUCCESS",timestamp:new Date().toISOString()}}]}}}:{}},raw:{simulation:true,status:next.providerStatus}};
      await applyDeliveryUpdate(c,order,update,{source:"simulation"});
      return next;
    }
    await c.query("UPDATE orders SET status=?,provider_status=? WHERE id=?",[next.status,next.providerStatus,order.id]);
    await logEvent(c,order.id,"delivery.updated",{from:order.status,...next,provider:"mock"});
    return next;
  });
  return (result);
}

export async function createProduct(req){
  const {name,description,category,price_cents,active,sort_order}=productData(req.body);
  const result=await query("INSERT INTO products(restaurant_id,category,name,description,price_cents,active,sort_order) VALUES(?,?,?,?,?,?,?)",[req.user.restaurant_id,category,name,description,price_cents,active,sort_order]);
  return ({id:Number(result.insertId)});
}

export async function updateProduct(req){
  const data=productData(req.body,true);
  // Column names come exclusively from productData's allowlist.
  const fields=Object.keys(data);
  const result=await query(`UPDATE products SET ${fields.map(field=>field+"=?").join(",")} WHERE id=? AND restaurant_id=?`,[...Object.values(data),req.params.id,req.user.restaurant_id]);
  if(!result.affectedRows){
    const existing=await query("SELECT id FROM products WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
    if(!existing.length)throw orderError(404,"Producto no encontrado");
  }
  return ({ok:true});
}

export async function deleteProduct(req){
  // Existing orders retain their product name, quantity and price snapshots.
  const result=await query("DELETE FROM products WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
  if(!result.affectedRows)throw orderError(404,"Producto no encontrado");
  return ({ok:true});
}

export async function adminProducts(req){return query("SELECT * FROM products WHERE restaurant_id=? ORDER BY category,sort_order,id",[req.user.restaurant_id])}

export async function adminDeliveryProviders(req){return getDeliveryProviders(req.user.restaurant_id)}

export async function saveAdminDeliveryProvider(req){
  const provider=req.params.provider;
  if(!req.body||typeof req.body!=="object")throw orderError(400,"Configuración inválida");
  const names=providerFields(provider);
  if(!names)throw orderError(400,"Proveedor no válido");
  const credentials=req.body.credentials||Object.fromEntries(names.credentials.map(name=>[name,req.body[`credentials[${name}]`]]).filter(([,value])=>value!==undefined));
  const settings=req.body.settings||Object.fromEntries(names.settings.map(name=>[name,req.body[`settings[${name}]`]]).filter(([,value])=>value!==undefined));
  try{return await saveDeliveryProvider(req.user.restaurant_id,provider,{...req.body,credentials,settings})}
  catch(error){
    if(error.message.includes("DELIVERY_CREDENTIALS_KEY"))throw orderError(400,"Configura DELIVERY_CREDENTIALS_KEY en el archivo .env antes de guardar credenciales");
    throw error;
  }
}

export async function testAdminDeliveryProvider(req){
  const providerName=req.params.provider;
  const provider=await getConfiguredDeliveryProvider(req.user.restaurant_id,providerName,true);
  try{
    const result=await provider.testConnection();
    await query("UPDATE delivery_providers SET last_test_status='ok',last_test_error=NULL,last_tested_at=CURRENT_TIMESTAMP WHERE restaurant_id=? AND provider=?",[req.user.restaurant_id,providerName]);
    return result;
  }catch(error){
    await query("UPDATE delivery_providers SET last_test_status='error',last_test_error=?,last_tested_at=CURRENT_TIMESTAMP WHERE restaurant_id=? AND provider=?",[error.message.slice(0,500),req.user.restaurant_id,providerName]);
    throw error;
  }
}

export async function adminConfigs(req){
  console.log("Restaurant:",req.client._httpMessage.locals.restaurantName);
  const configs=await query(`SELECT * FROM restaurants WHERE name like ?`,`%${req.client._httpMessage.locals.restaurantName}%`);
  //const configs=await query(`SELECT * FROM restaurants WHERE id=?`,1);
  return (configs[0]);
}
export async function updateAdminConfigs(req) {
  const body = {
    ...req.body
  };

  const rawAddress = body.delivery_address_data;
  if (rawAddress && String(rawAddress).trim() !== "{}") {
    let addressData = rawAddress;
    if (typeof addressData === "string") {
      try { addressData = JSON.parse(addressData); }
      catch { throw orderError(400, "Dirección seleccionada inválida"); }
    }
    const addressError = validateAddress(addressData);
    if (addressError) throw orderError(400, addressError);
    const address = cleanAddress(addressData);
    Object.assign(body, {
      address: address.formatted_address,
      city: address.city,
      delivery_formatted_address: address.formatted_address,
      delivery_street: address.street,
      delivery_number: address.number,
      delivery_city: address.city,
      delivery_province: address.province,
      delivery_postal_code: address.postal_code,
      delivery_country: address.country,
      delivery_latitude: address.latitude,
      delivery_longitude: address.longitude,
      delivery_place_id: address.place_id
    });
  }
  delete body.delivery_address_data;

  // Euros del formulario → céntimos
  if (body.delivery_base_euros !== undefined) {
    body.delivery_base_cents = eurosToCents(
      body.delivery_base_euros
    );

    delete body.delivery_base_euros;
  }

  if (body.free_delivery_from_euros !== undefined) {
    body.free_delivery_from_cents = eurosToCents(
      body.free_delivery_from_euros
    );

    delete body.free_delivery_from_euros;
  }

  const data = configsData(body, true);

  console.log("CONFIG ACTUALIZADA:", data);

  const fields = Object.keys(data);

  const result = await query(
    `UPDATE restaurants
     SET ${fields.map(field => `${field}=?`).join(", ")}
     WHERE id=?`,
    [
      ...Object.values(data),
      req.user.restaurant_id
    ]
  );

  console.log("FILAS MODIFICADAS:", result.affectedRows);

  return { ok: true };
}

