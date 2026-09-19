import {Router} from "express";
import {query,transaction} from "../db.js";
import {auth} from "../auth.js";
import {getDeliveryProvider} from "../delivery/index.js";
import {mockDelivery} from "../delivery/mock.js";
import {logEvent} from "../services/order-events.js";

export const adminPageRoutes=Router();
export const adminApiRoutes=Router();
// Every management endpoint requires an authenticated restaurant administrator.
adminApiRoutes.use(auth);

adminPageRoutes.get(["/admin","/admin.html","/admin/orders"],(req,res)=>res.render("admin/orders",{
  adminArea:true,ordersActive:true,
  title:"Administración",heading:"⚙️ Administración",mainId:"adminMain",
  navHref:"/",navLabel:"Tienda",script:"/admin.js"
}));
adminApiRoutes.get("/me",(req,res)=>res.json(req.user));

adminApiRoutes.get("/orders",async(req,res)=>{
  const groups=new Map([
    ["all",[]],["pending",["new"]],
    ["in_progress",["accepted","preparing","ready","delivery_requested","courier_assigned","out_for_delivery"]],
    ["delivered",["delivered"]],["cancelled",["cancelled"]]
  ]);
  const filter=req.query.filter??"all";
  if(!groups.has(filter))return res.status(400).json({error:"Filtro de pedidos no válido"});
  const states=groups.get(filter);
  const clause=states.length?` AND status IN (${states.map(()=>"?").join(",")})`:"";
  const orders=await query(`SELECT id,customer_name,customer_phone,delivery_address,delivery_notes,status,subtotal_cents,delivery_cents,total_cents,provider,provider_order_id,provider_status,created_at,updated_at FROM orders WHERE restaurant_id=?${clause} ORDER BY id DESC LIMIT 200`,[req.user.restaurant_id,...states]);
  res.json(orders);
});

adminApiRoutes.get("/orders/:id",async(req,res)=>{
  const rows=await query("SELECT * FROM orders WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
  if(!rows.length)return res.status(404).json({error:"Pedido no encontrado"});
  const items=await query("SELECT * FROM order_items WHERE order_id=?",[req.params.id]);
  const events=await query("SELECT event_type,payload_json,created_at FROM order_events WHERE order_id=? ORDER BY id DESC",[req.params.id]);
  res.json({...rows[0],items,events});
});

// Lock the order so each state change and its event are committed together.
function orderError(status,message){return Object.assign(new Error(message),{status})}
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

adminApiRoutes.patch("/orders/:id/status",async(req,res)=>{
  const transitions={new:["accepted","cancelled"],accepted:["preparing","cancelled"],preparing:["ready","cancelled"],ready:["cancelled"]};
  const status=req.body?.status;
  if(!["accepted","preparing","ready","cancelled"].includes(status))throw orderError(400,"Estado no permitido");
  await changeOrder(req,async(c,order)=>{
    if(!transitions[order.status]?.includes(status))throw orderError(409,"El pedido ya ha cambiado o no permite esta transición");
    await c.query("UPDATE orders SET status=? WHERE id=?",[status,order.id]);
    await logEvent(c,order.id,"status.changed",{from:order.status,status});
  });
  res.json({ok:true});
});

adminApiRoutes.post("/orders/:id/delivery/quote",async(req,res)=>{
  const quote=await changeOrder(req,async(c,order)=>{
    deliveryReady(order);
    const items=await c.query("SELECT * FROM order_items WHERE order_id=?",[order.id]);
    const quote=await getDeliveryProvider().quote({...order,items});
    // Keep the accepted price and provider on the server, not in client input.
    quote.expiresAt=Date.now()+5*60*1000;
    await logEvent(c,order.id,"delivery.quoted",quote);
    return quote;
  });
  res.json(quote);
});

adminApiRoutes.post("/orders/:id/delivery",async(req,res)=>{
  if(!req.body?.quote?.quoteId)throw orderError(400,"quoteId requerido");
  const delivery=await changeOrder(req,async(c,order)=>{
    deliveryReady(order);
    const events=await c.query("SELECT payload_json FROM order_events WHERE order_id=? AND event_type='delivery.quoted' ORDER BY id DESC LIMIT 1",[order.id]);
    const quote=events.length?JSON.parse(events[0].payload_json):null;
    const provider=getDeliveryProvider();
    if(!quote||quote.quoteId!==req.body.quote.quoteId||quote.expiresAt<=Date.now()||quote.provider!==provider.name)
      throw orderError(409,"Consulta de nuevo el precio: la oferta ha caducado o no es válida");
    const items=await c.query("SELECT * FROM order_items WHERE order_id=?",[order.id]);
    const delivery=await provider.create({...order,items},quote);
    await c.query("UPDATE orders SET status='delivery_requested',provider=?,provider_order_id=?,provider_status=? WHERE id=?",[delivery.provider,delivery.providerOrderId,delivery.providerStatus,order.id]);
    await logEvent(c,order.id,"delivery.requested",{...delivery,status:"delivery_requested",feeCents:quote.feeCents});
    return delivery;
  });
  res.json(delivery);
});

adminApiRoutes.post("/orders/:id/delivery/simulate",async(req,res)=>{
  const result=await changeOrder(req,async(c,order)=>{
    if(order.provider!=="mock"||!order.provider_order_id)throw orderError(409,"Este pedido no tiene un reparto simulado");
    const next=mockDelivery.next(order.status);
    if(!next||req.body?.status!==next.status)throw orderError(409,"El pedido ya ha cambiado o no permite este paso");
    await c.query("UPDATE orders SET status=?,provider_status=? WHERE id=?",[next.status,next.providerStatus,order.id]);
    await logEvent(c,order.id,"delivery.updated",{from:order.status,...next,provider:"mock"});
    return next;
  });
  res.json(result);
});

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

adminPageRoutes.get("/admin/products",(req,res)=>res.render("admin/products",{
  adminArea:true,productsActive:true,
  title:"Artículos",heading:"Gestión de artículos",
  navHref:"/",navLabel:"Tienda",script:"/products.js"
}));

adminApiRoutes.get("/products",async(req,res)=>res.json(await query("SELECT * FROM products WHERE restaurant_id=? ORDER BY category,sort_order,id",[req.user.restaurant_id])));
adminApiRoutes.post("/products",async(req,res)=>{
  const {name,description,category,price_cents,active,sort_order}=productData(req.body);
  const result=await query("INSERT INTO products(restaurant_id,category,name,description,price_cents,active,sort_order) VALUES(?,?,?,?,?,?,?)",[req.user.restaurant_id,category,name,description,price_cents,active,sort_order]);
  res.status(201).json({id:Number(result.insertId)});
});
adminApiRoutes.patch("/products/:id",async(req,res)=>{
  const data=productData(req.body,true);
  // Column names come exclusively from productData's allowlist.
  const fields=Object.keys(data);
  const result=await query(`UPDATE products SET ${fields.map(field=>field+"=?").join(",")} WHERE id=? AND restaurant_id=?`,[...Object.values(data),req.params.id,req.user.restaurant_id]);
  if(!result.affectedRows){
    const existing=await query("SELECT id FROM products WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
    if(!existing.length)throw orderError(404,"Producto no encontrado");
  }
  res.json({ok:true});
});
adminApiRoutes.delete("/products/:id",async(req,res)=>{
  // Existing orders retain their product name, quantity and price snapshots.
  const result=await query("DELETE FROM products WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
  if(!result.affectedRows)throw orderError(404,"Producto no encontrado");
  res.json({ok:true});
});
