import {Router} from "express";
import {customerAuth} from "../auth.js";
import {query,transaction} from "../db.js";
import {getRestaurant} from "../services/restaurants.js";
import {logEvent} from "../services/order-events.js";

export const clientPageRoutes=Router();
export const clientApiRoutes=Router();

clientPageRoutes.get(["/","/index.html"],(req,res)=>res.render("client/store",{
  clientArea:true,title:"Pizzería",heading:"🍕 Pizzería",headingId:"brand",
  navHref:"/client/account",navLabel:"Mi cuenta",script:"/app.js"
}));
clientPageRoutes.get(["/tracking","/tracking.html"],(req,res)=>res.render("client/tracking",{
  clientArea:true,title:"Seguimiento",heading:"Seguimiento",
  navHref:"/",navLabel:"Pizzería",script:"/tracking.js"
}));

clientApiRoutes.get("/public/menu",async(req,res)=>{
  const r=await getRestaurant(req.query.slug||"demo"); if(!r)return res.status(404).json({error:"Restaurante no encontrado"});
  const products=await query("SELECT id,category,name,description,price_cents FROM products WHERE restaurant_id=? AND active=1 ORDER BY category,sort_order,id",[r.id]);
  const zones=await query("SELECT id,name,postal_codes,min_order_cents,delivery_fee_cents FROM delivery_zones WHERE restaurant_id=? AND active=1",[r.id]);
  res.json({restaurant:r,products,zones});
});

clientApiRoutes.post("/orders",customerAuth,async(req,res)=>{
  const profiles=await query("SELECT name,phone,delivery_address,delivery_notes FROM customers WHERE id=?",[req.customer.sub]);
  if(!profiles.length)return res.status(401).json({error:"Cuenta no disponible"});
  const profile=profiles[0];
  const {slug="demo",customer_name=profile.name,customer_phone=profile.phone,delivery_address=profile.delivery_address,delivery_notes=profile.delivery_notes,payment_method="cash",items=[]}=req.body||{};
  for(const [value,max] of [[customer_name,120],[customer_phone,40],[delivery_address,500],[delivery_notes,500]]){
    if(typeof value!=="string"||value.length>max)return res.status(400).json({error:"Revisa los datos de entrega"});
  }
  if(!customer_name.trim()||!customer_phone.trim()||!delivery_address.trim())return res.status(400).json({error:"Completa tu nombre, telefono y direccion de entrega en Mi cuenta o en el pedido"});
  if(!customer_name||!customer_phone||!delivery_address||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Faltan datos del pedido"});
  const r=await getRestaurant(slug); if(!r)return res.status(404).json({error:"Restaurante no encontrado"});
  const ids=items.map(x=>Number(x?.product_id)).filter(id=>Number.isInteger(id)&&id>0);
  if(ids.length!==items.length)return res.status(400).json({error:"Productos no validos"});
  if(!["cash","card_on_delivery"].includes(payment_method))return res.status(400).json({error:"Forma de pago no valida"});
  const products=await query(`SELECT id,name,price_cents FROM products WHERE restaurant_id=? AND active=1 AND id IN (${ids.map(()=>"?").join(",")})`,[r.id,...ids]);
  const map=new Map(products.map(p=>[Number(p.id),p])); let subtotal=0; const normalized=[];
  for(const x of items){
    const p=map.get(Number(x.product_id)),q=Number(x.quantity);
    if(!p||!Number.isInteger(q)||q<1||q>50)return res.status(400).json({error:"Producto/cantidad inválidos"});
    subtotal+=p.price_cents*q;normalized.push({product_id:p.id,product_name:p.name,quantity:q,unit_price_cents:p.price_cents});
  }
  const delivery=subtotal>=Number(process.env.FREE_DELIVERY_FROM_CENTS||3000)?0:Number(process.env.DELIVERY_BASE_CENTS||399);
  const total=subtotal+delivery;
  const orderId=await transaction(async c=>{
    const result=await c.query(`INSERT INTO orders(customer_id,restaurant_id,customer_name,customer_phone,delivery_address,delivery_notes,payment_method,status,subtotal_cents,delivery_cents,total_cents) VALUES(?,?,?,?,?,?,?, 'new',?,?,?)`,
      [req.customer.sub,r.id,customer_name,customer_phone,delivery_address,delivery_notes,payment_method,subtotal,delivery,total]);
    const id=Number(result.insertId);
    for(const i of normalized)await c.query("INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents) VALUES(?,?,?,?,?)",[id,i.product_id,i.product_name,i.quantity,i.unit_price_cents]);
    await logEvent(c,id,"order.created",{status:"new"});
    return id;
  });
  res.status(201).json({id:orderId,total_cents:total,status:"new"});
});

clientApiRoutes.get("/customer/orders",customerAuth,async(req,res)=>{
  const filter=req.query.filter||"active";
  if(!["active","history","all"].includes(filter))return res.status(400).json({error:"Filtro no valido"});
  const clause=filter==="active"?" AND status NOT IN ('delivered','cancelled')":filter==="history"?" AND status IN ('delivered','cancelled')":"";
  res.json(await query(`SELECT id,status,total_cents,created_at FROM orders WHERE customer_id=?${clause} ORDER BY id DESC LIMIT 200`,[req.customer.sub]));
});
clientApiRoutes.get(["/customer/orders/:id","/orders/:id/public"],customerAuth,async(req,res)=>{
  const rows=await query("SELECT id,customer_name,delivery_address,status,subtotal_cents,delivery_cents,total_cents,provider,created_at,updated_at FROM orders WHERE id=? AND customer_id=?",[req.params.id,req.customer.sub]);
  if(!rows.length)return res.status(404).json({error:"Pedido no encontrado"});
  const items=await query("SELECT product_name,quantity,unit_price_cents FROM order_items WHERE order_id=?",[req.params.id]);
  res.json({...rows[0],items});
});
clientPageRoutes.get("/client/login",(req,res)=>res.render("client/login",{
  clientArea:true,title:"Acceso de clientes",heading:"Mi cuenta",navHref:"/",navLabel:"Carta",script:"/customer-login.js"
}));
clientPageRoutes.get("/client/orders",(req,res)=>res.render("client/orders",{
  clientArea:true,title:"Mis pedidos",heading:"Mis pedidos",navHref:"/",navLabel:"Carta",script:"/customer-orders.js"
}));

clientPageRoutes.get("/client/account",(req,res)=>res.render("client/account",{
  clientArea:true,title:"Mi cuenta",heading:"Mi cuenta",navHref:"/",navLabel:"Carta",script:"/customer-account.js"
}));
