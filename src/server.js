import express from "express";
import dotenv from "dotenv";
import path from "path";
import {fileURLToPath} from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {query,transaction} from "./db.js";
import {auth,signAdmin,hashPassword,checkPassword} from "./auth.js";
import {getDeliveryProvider} from "./delivery/index.js";
dotenv.config();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"../public")));
const apiLimit=rateLimit({windowMs:60*1000,max:120,standardHeaders:true,legacyHeaders:false});
const authLimit=rateLimit({windowMs:15*60*1000,max:20});
app.use("/api",apiLimit);

async function getRestaurant(slug="demo"){
  const rows=await query("SELECT * FROM restaurants WHERE slug=? AND active=1",[slug]);
  return rows[0]||null;
}
function logEvent(c,id,type,payload={}){return c.query("INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,?,?)",[id,type,JSON.stringify(payload)])}

app.post("/api/auth/login",authLimit,async(req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password)return res.status(400).json({error:"Email y contraseña requeridos"});
  const rows=await query("SELECT * FROM admins WHERE email=?",[email]);
  if(!rows.length||!(await checkPassword(password,rows[0].password_hash)))return res.status(401).json({error:"Credenciales incorrectas"});
  res.json({token:signAdmin(rows[0]),admin:{id:rows[0].id,email:rows[0].email,restaurant_id:rows[0].restaurant_id}});
});

app.post("/api/setup-admin",authLimit,async(req,res)=>{
  // Intended only for first local setup. Disable by setting SETUP_DISABLED=true.
  if(process.env.SETUP_DISABLED==="true")return res.status(404).end();
  const r=await getRestaurant("demo"); if(!r)return res.status(500).json({error:"Restaurante no existe"});
  const email=process.env.ADMIN_EMAIL||"admin@pizzeria.local", password=process.env.ADMIN_PASSWORD||"change_me_now";
  const existing=await query("SELECT id FROM admins WHERE email=?",[email]);
  if(existing.length)return res.json({ok:true,message:"Admin ya creado"});
  await query("INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)",[r.id,email,await hashPassword(password)]);
  res.json({ok:true,email});
});

app.get("/api/public/menu",async(req,res)=>{
  const r=await getRestaurant(req.query.slug||"demo"); if(!r)return res.status(404).json({error:"Restaurante no encontrado"});
  const products=await query("SELECT id,category,name,description,price_cents FROM products WHERE restaurant_id=? AND active=1 ORDER BY category,sort_order,id",[r.id]);
  const zones=await query("SELECT id,name,postal_codes,min_order_cents,delivery_fee_cents FROM delivery_zones WHERE restaurant_id=? AND active=1",[r.id]);
  res.json({restaurant:r,products,zones});
});

app.post("/api/orders",async(req,res)=>{
  const {slug="demo",customer_name,customer_phone,delivery_address,delivery_notes="",payment_method="cash",items=[]}=req.body||{};
  if(!customer_name||!customer_phone||!delivery_address||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Faltan datos del pedido"});
  const r=await getRestaurant(slug); if(!r)return res.status(404).json({error:"Restaurante no encontrado"});
  const ids=items.map(x=>Number(x.product_id)).filter(Boolean);
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
    const result=await c.query(`INSERT INTO orders(restaurant_id,customer_name,customer_phone,delivery_address,delivery_notes,payment_method,status,subtotal_cents,delivery_cents,total_cents) VALUES(?,?,?,?,?,?, 'new',?,?,?)`,
      [r.id,customer_name,customer_phone,delivery_address,delivery_notes,payment_method,subtotal,delivery,total]);
    const id=Number(result.insertId);
    for(const i of normalized)await c.query("INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents) VALUES(?,?,?,?,?)",[id,i.product_id,i.product_name,i.quantity,i.unit_price_cents]);
    await logEvent(c,id,"order.created",{status:"new"});
    return id;
  });
  res.status(201).json({id:orderId,total_cents:total,status:"new"});
});

app.get("/api/orders/:id/public",async(req,res)=>{
  const rows=await query("SELECT id,customer_name,status,subtotal_cents,delivery_cents,total_cents,provider,provider_status,created_at,updated_at FROM orders WHERE id=?",[req.params.id]);
  if(!rows.length)return res.status(404).json({error:"Pedido no encontrado"});
  res.json(rows[0]);
});

app.get("/api/admin/me",auth,(req,res)=>res.json(req.user));

app.get("/api/admin/orders",auth,async(req,res)=>{
  const orders=await query("SELECT id,customer_name,customer_phone,delivery_address,delivery_notes,status,subtotal_cents,delivery_cents,total_cents,provider,provider_order_id,provider_status,created_at,updated_at FROM orders WHERE restaurant_id=? ORDER BY id DESC LIMIT 200",[req.user.restaurant_id]);
  res.json(orders);
});

app.get("/api/admin/orders/:id",auth,async(req,res)=>{
  const rows=await query("SELECT * FROM orders WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
  if(!rows.length)return res.status(404).json({error:"Pedido no encontrado"});
  const items=await query("SELECT * FROM order_items WHERE order_id=?",[req.params.id]);
  const events=await query("SELECT event_type,payload_json,created_at FROM order_events WHERE order_id=? ORDER BY id DESC",[req.params.id]);
  res.json({...rows[0],items,events});
});

app.patch("/api/admin/orders/:id/status",auth,async(req,res)=>{
  const allowed=["new","accepted","preparing","ready","cancelled"];
  if(!allowed.includes(req.body.status))return res.status(400).json({error:"Estado no permitido"});
  const result=await query("UPDATE orders SET status=? WHERE id=? AND restaurant_id=?",[req.body.status,req.params.id,req.user.restaurant_id]);
  if(!result.affectedRows)return res.status(404).json({error:"Pedido no encontrado"});
  await query("INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,?,?)",[req.params.id,"status.changed",JSON.stringify({status:req.body.status})]);
  res.json({ok:true});
});

app.post("/api/admin/orders/:id/delivery/quote",auth,async(req,res)=>{
  try{
    const rows=await query("SELECT * FROM orders WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
    if(!rows.length)return res.status(404).json({error:"Pedido no encontrado"});
    const items=await query("SELECT * FROM order_items WHERE order_id=?",[req.params.id]);
    const q=await getDeliveryProvider().quote({...rows[0],items});
    res.json(q);
  }catch(e){res.status(502).json({error:e.message})}
});

app.post("/api/admin/orders/:id/delivery",auth,async(req,res)=>{
  try{
    const rows=await query("SELECT * FROM orders WHERE id=? AND restaurant_id=?",[req.params.id,req.user.restaurant_id]);
    if(!rows.length)return res.status(404).json({error:"Pedido no encontrado"});
    if(!req.body?.quote?.quoteId)return res.status(400).json({error:"quoteId requerido"});
    const items=await query("SELECT * FROM order_items WHERE order_id=?",[req.params.id]);
    const d=await getDeliveryProvider().create({...rows[0],items},req.body.quote);
    await query("UPDATE orders SET status='delivery_requested',provider=?,provider_order_id=?,provider_status=? WHERE id=? AND restaurant_id=?",[d.provider,d.providerOrderId,d.providerStatus,req.params.id,req.user.restaurant_id]);
    await query("INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,?,?)",[req.params.id,"delivery.requested",JSON.stringify(d)]);
    res.json(d);
  }catch(e){res.status(502).json({error:e.message})}
});

app.get("/api/admin/products",auth,async(req,res)=>res.json(await query("SELECT * FROM products WHERE restaurant_id=? ORDER BY category,sort_order,id",[req.user.restaurant_id])));
app.post("/api/admin/products",auth,async(req,res)=>{
  const {name,description="",category="Pizzas",price_cents,active=1,sort_order=0}=req.body||{};
  if(!name||!Number.isInteger(Number(price_cents))||Number(price_cents)<0)return res.status(400).json({error:"Datos inválidos"});
  const x=await query("INSERT INTO products(restaurant_id,category,name,description,price_cents,active,sort_order) VALUES(?,?,?,?,?,?,?)",[req.user.restaurant_id,category,name,description,price_cents,active?1:0,sort_order]);
  res.status(201).json({id:Number(x.insertId)});
});
app.patch("/api/admin/products/:id",auth,async(req,res)=>{
  const {name,description="",category="Pizzas",price_cents,active=1,sort_order=0}=req.body||{};
  const x=await query("UPDATE products SET name=?,description=?,category=?,price_cents=?,active=?,sort_order=? WHERE id=? AND restaurant_id=?",[name,description,category,price_cents,active?1:0,sort_order,req.params.id,req.user.restaurant_id]);
  if(!x.affectedRows)return res.status(404).json({error:"Producto no encontrado"});res.json({ok:true});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../public/index.html")));
app.listen(Number(process.env.PORT||3000),()=>console.log(`Pizzeria v0.2: http://localhost:${process.env.PORT||3000}`));