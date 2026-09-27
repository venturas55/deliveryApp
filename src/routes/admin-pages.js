import {Router} from "express";
import multer from "multer";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import rateLimit from "express-rate-limit";
import {signAdmin} from "../auth.js";
import * as admin from "../controllers/admin.js";
import * as promotions from "../controllers/promotions.js";
import * as adminBroadcast from "../controllers/admin-broadcast.js";
import * as accounts from "../controllers/accounts.js";
import {httpError} from "../services/http-error.js";
import {presentOrder,labels,eventLabels} from "../services/order-presenter.js";
import {requireAdmin,setSession,clearSession,validateCsrf,readAdminOrderCart,writeAdminOrderCart} from "../services/web-session.js";
import {searchAddresses} from "../services/geocoding.js";
const router=Router();
const loginLimit=rateLimit({windowMs:15*60*1000,max:30});
const addressLimit=rateLimit({windowMs:60*1000,max:30});
const productImageUpload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024,files:1},
  fileFilter:(req,file,cb)=>{
    if(["image/jpeg","image/png","image/webp"].includes(file.mimetype))return cb(null,true);
    const error=new Error("Formato de imagen no válido");error.status=400;cb(error);
  }
});
async function saveProductImage(req,res,next){
  if(!req.file)return next();
  const extension={"image/jpeg":".jpg","image/png":".png","image/webp":".webp"}[req.file.mimetype];
  const filename=randomUUID()+extension;
  const directory=path.join(process.cwd(),"public","uploads","products");
  try{
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,filename),req.file.buffer,{flag:"wx"});
    req.body.image_url="/uploads/products/"+filename;
    next();
  }catch(error){next(error)}
}


router.get("/admin/login",(req,res)=>res.render("admin/login",{title:"Acceso del restaurante"}));
router.post("/admin/login",loginLimit,async(req,res)=>{
  const user=await accounts.loginAdmin(req.body);setSession(res,"admin",signAdmin(user));res.redirect(303,"/admin/orders");
});
router.post("/admin/logout",(req,res)=>{clearSession(res,"admin");res.redirect(303,"/")});
router.get(["/admin","/admin.html"],(req,res)=>res.redirect(303,req.user?"/admin/orders":"/admin/login"));
router.use("/admin",requireAdmin);
router.get("/admin/address-search",addressLimit,async(req,res)=>{
  try{return res.json(await searchAddresses(req.query.q))}
  catch{return res.status(502).json({error:"No se pudo consultar el buscador de direcciones"})}
});
router.get("/admin/orders",async(req,res)=>{
  const orders=await admin.adminOrders(req);
  res.render("admin/orders",{title:"Pedidos",ordersActive:true,filter:req.query.filter||"all",orders:orders.map(presentOrder),refresh:true});
});
router.get("/admin/pedidotelefonico",async(req,res)=>{
  const products=(await admin.adminProducts(req)).filter(item=>Number(item.active)===1);
  const customer=req.query.phone?await admin.telephoneCustomer(req.query.phone,req.user.restaurant_id):null;
  const phone=String(req.query.phone||"").slice(0,40);
  const cart=readAdminOrderCart(req),quantities=new Map(cart.map(item=>[Number(item.product_id),Number(item.quantity)]));
  const cartItems=products.filter(item=>quantities.has(Number(item.id))).map(item=>({...item,quantity:quantities.get(Number(item.id)),line_cents:item.price_cents*quantities.get(Number(item.id))}));
  res.render("admin/admin-order-create",{title:"Nuevo pedido",pedidotelefonicoActive:true,products,cartItems,cartTotal:cartItems.reduce((sum,item)=>sum+item.line_cents,0),phone,customer,created:req.query.created==="1",createError:typeof req.query.create_error==="string"?req.query.create_error:null,addressData:customer?.delivery_place_id?{formatted_address:customer.delivery_formatted_address,street:customer.delivery_street,number:customer.delivery_number,city:customer.delivery_city,province:customer.delivery_province,postal_code:customer.delivery_postal_code,country:customer.delivery_country,latitude:customer.delivery_latitude,longitude:customer.delivery_longitude,place_id:customer.delivery_place_id}:null});
});
  router.post("/admin/pedidotelefonico/cliente",validateCsrf,async(req,res)=>{
    try {
      await admin.createAdminCustomer(req);
      res.redirect(303,"/admin/pedidotelefonico?phone="+encodeURIComponent(req.body.phone)+"&created=1");
    } catch (error) {
      res.redirect(303,"/admin/pedidotelefonico?phone="+encodeURIComponent(req.body.phone||"")+"&create_error="+encodeURIComponent(error.status>=500?error.message:"No se pudo crear el usuario: "+error.message));
    }
});
router.post("/admin/pedidotelefonico/carrito/:action",validateCsrf,async(req,res)=>{
  req.body.action=req.params.action;const cart=await admin.updateAdminOrderCart(req);writeAdminOrderCart(res,cart);res.redirect(303,"/admin/pedidotelefonico?phone="+encodeURIComponent(req.body.phone||""));
});
router.post("/admin/pedidotelefonico",validateCsrf,async(req,res)=>{
  const id=await admin.createAdminOrder(req);writeAdminOrderCart(res,[]);res.redirect(303,"/admin/orders/"+id);
});
router.get("/admin/stats",async(req,res)=>{
  const stats=await admin.adminOrderStats(req);
  res.render("admin/order-stats",{title:"Estadísticas de pedidos",statsActive:true,stats});
});
router.get("/admin/orders/:id",async(req,res)=>{
  const order=presentOrder(await admin.adminOrder(req));
  order.canMarkPaid=["cash","card_on_delivery"].includes(order.payment_method)&&order.payment_status!=="paid"&&!['cancelled','refunded'].includes(order.payment_status)&&order.status!=="cancelled";
  const event=order.events.find(e=>e.event_type==="delivery.quoted");
  const payload=event?JSON.parse(event.payload_json):null;
  const quotes=order.canQuote?(payload?.quotes||((payload?.quoteId)?[payload]:[])).filter(item=>item.expiresAt>Date.now()):[];
  const quoteErrors=payload?.errors||[];
  const events=order.events.map(e=>{const p=JSON.parse(e.payload_json||"{}");return {...e,label:eventLabels[e.event_type]||e.event_type,statusLabel:p.ignored?null:labels[p.status],reason:p.reason,feeCents:p.feeCents}});
  for(const item of events)if(item.event_type==="payment.manual_paid")item.label="Pago marcado como recibido manualmente";
  res.render("admin/order",{title:"Pedido #"+order.id,ordersActive:true,order,events,quotes,quoteErrors,refresh:!order.finished});
});
router.get("/admin/orders/:id/pickup-qr",async(req,res)=>res.set("Cache-Control","no-store").type("png").send(await admin.pickupQr(req)));
router.post("/admin/orders/:id/mark-paid",validateCsrf,async(req,res)=>{
  await admin.markOrderPaid(req);
  res.redirect(303,"/admin/orders/"+req.params.id);
});
router.post("/admin/orders/:id/:action",async(req,res)=>{
  const operations={status:admin.setOrderStatus,quote:admin.deliveryQuote,dispatch:admin.dispatchDelivery,simulate:admin.simulateDelivery,sync:admin.syncDelivery};
  const operation=operations[req.params.action];
  if(!Object.hasOwn(operations,req.params.action))throw httpError(404,"Operación no encontrada");
  if(req.params.action==="dispatch")req.body={provider:req.body.provider,quoteId:req.body.quoteId};
  await operation(req);res.redirect(303,"/admin/orders/"+req.params.id);
});
router.get("/admin/products",async(req,res)=>{
  const products=await admin.adminProducts(req);
  const productCategories=[...new Set(products.map(product=>product.category).filter(Boolean))].sort();
  const promotionList=await promotions.adminPromotions(req.user.restaurant_id);
  res.locals.promotionList=promotionList;
  res.locals.productCategories=productCategories;
  res.locals.promotion=promotionList.find(item=>String(item.id)===String(req.query.promotion_edit))||null;
  const product=req.query.edit?products.find(p=>String(p.id)===req.query.edit):{category:"Pizzas",active:1,sort_order:0};
  if(!product)throw httpError(404,"Artículo no encontrado");
  res.render("admin/products",{title:"Gestionar artículos",productsActive:true,products,product,productCount:products.length,activeProductCount:products.filter(item=>Number(item.active)===1).length});
});
router.get("/admin/providers",async(req,res)=>{
  const deliveryProviders=await admin.adminDeliveryProviders(req);
  res.render("admin/providers",{title:"Proveedores de reparto",providersActive:true,deliveryProviders,restaurantId:req.user.restaurant_id});
});
router.post("/admin/providers/:provider",async(req,res)=>{
  await admin.saveAdminDeliveryProvider(req);res.redirect(303,"/admin/providers");
});
router.post("/admin/providers/:provider/test",async(req,res)=>{
  await admin.testAdminDeliveryProvider(req);res.redirect(303,"/admin/providers");
});
function productForm(req){
  const price=req.body.price;
  if(typeof price!=="string"||!/^\d+(\.\d{1,2})?$/.test(price))throw httpError(400,"Precio no válido");
  req.body={...req.body,price_cents:Math.round(Number(price)*100),sort_order:Number(req.body.sort_order),active:req.body.active==="1"?1:0};
}
router.post("/admin/products",productImageUpload.single("image"),validateCsrf,saveProductImage,async(req,res)=>{productForm(req);await admin.createProduct(req);res.redirect(303,"/admin/products")});
router.post("/admin/products/:id/edit",productImageUpload.single("image"),validateCsrf,saveProductImage,async(req,res)=>{productForm(req);await admin.updateProduct(req);res.redirect(303,"/admin/products")});
router.post("/admin/products/:id/toggle",async(req,res)=>{
  req.body={active:Number(req.body.active)};await admin.updateProduct(req);res.redirect(303,"/admin/products");
});
router.get("/admin/products/:id/delete",async(req,res)=>{
  const product=(await admin.adminProducts(req)).find(p=>String(p.id)===req.params.id);
  if(!product)throw httpError(404,"Artículo no encontrado");
  res.render("admin/delete-product",{title:"Eliminar artículo",productsActive:true,product});
});
router.post("/admin/products/:id/delete",async(req,res)=>{await admin.deleteProduct(req);res.redirect(303,"/admin/products")});
router.post("/admin/promotions",validateCsrf,async(req,res)=>{await promotions.savePromotion(req);res.redirect(303,"/admin/products#promotions")});
router.post("/admin/promotions/:id/edit",validateCsrf,async(req,res)=>{await promotions.savePromotion(req);res.redirect(303,"/admin/products#promotions")});
router.post("/admin/promotions/:id/toggle",validateCsrf,async(req,res)=>{await promotions.togglePromotion(req);res.redirect(303,"/admin/products#promotions")});
router.post("/admin/promotions/:id/delete",validateCsrf,async(req,res)=>{await promotions.deletePromotion(req);res.redirect(303,"/admin/products#promotions")});



router.get("/admin/configs",async(req,res)=>{
  const configs=await admin.adminConfigs(req);
  const addressData=configs.delivery_place_id?{
    formatted_address:configs.delivery_formatted_address,
    street:configs.delivery_street,
    number:configs.delivery_number,
    city:configs.delivery_city,
    province:configs.delivery_province,
    postal_code:configs.delivery_postal_code,
    country:configs.delivery_country,
    latitude:configs.delivery_latitude,
    longitude:configs.delivery_longitude,
    place_id:configs.delivery_place_id
  }:null;
  res.render("admin/configs",{title:"Configuración",configsActive:true,configs,addressData,refresh:true});
});
router.post("/admin/configs",async(req,res)=>{console.log(req.body);await admin.updateAdminConfigs(req);res.redirect(303,"/admin/configs?saved=1")});

router.get("/admin/clientes/difusion",async(req,res)=>{
  const total=await adminBroadcast.countBroadcastRecipients();
  res.render("admin/customer-broadcast",{
    title:"Correo a clientes",
    clientesActive:true,
    total,
    sent:req.query.sent==null?null:Number(req.query.sent),
    failed:req.query.failed==null?null:Number(req.query.failed),
    resultTotal:req.query.total==null?null:Number(req.query.total),
    hasResult:req.query.total!=null,
    problem:typeof req.query.problem==="string"?req.query.problem:null,
  });
});
router.post("/admin/clientes/difusion",validateCsrf,async(req,res)=>{
  try {
    const result=await adminBroadcast.sendCustomerBroadcast(req.body);
    res.redirect(303,"/admin/clientes/difusion?sent="+result.sent+"&failed="+result.failed+"&total="+result.total);
  } catch(error) {
    res.redirect(303,"/admin/clientes/difusion?problem="+encodeURIComponent(error.message));
  }
});
router.get("/admin/clientes",async(req,res)=>{
  const clientes= await admin.getClientes();
  //console.log(clientes);
  res.render("admin/clientes",{title:"Clientes",clientesActive:true,clientes,restaurantId:req.user.restaurant_id});
});
router.get("/admin/cliente/:id",async(req,res)=>{
  const customer= await admin.getClientes(req.params.id);
  //console.log(customer);
  res.render("admin/cliente",{title:"Cliente",clientesActive:true,customer,restaurantId:req.user.restaurant_id});
});



export default router;
