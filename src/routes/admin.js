import { restaurantLogoUpload } from "../services/restaurant-logo-upload.js";
import { searchAddresses } from "../services/geocoding.js";
import { rateLimit } from "express-rate-limit";
import {Router} from "express";
import {auth} from "../auth.js";
import {query} from "../db.js";
import * as operations from "../controllers/admin.js";
import * as mobile from "../controllers/admin-mobile.js";
import * as customerMail from "../controllers/admin-broadcast.js";
import multer from "multer";
import { orderNotificationSnapshot } from "../services/order-notifications.js";
import { httpError } from "../services/http-error.js";
import {
  productImageUpload,
  saveProductImage,
} from "../services/product-image-upload.js";
export const adminApiRoutes=Router();
adminApiRoutes.use(auth);
adminApiRoutes.use((req,res,next)=>{res.set("Cache-Control","no-store");next();});
adminApiRoutes.get("/dashboard",async(req,res)=>res.json(await mobile.summary(req)));
adminApiRoutes.get("/stats",async(req,res)=>res.json(await mobile.statistics(req)));
adminApiRoutes.get("/customers",async(req,res)=>res.json(await mobile.customers(req)));
const emailUpload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: 5 * 1024 * 1024, files: 1, fields: 3, fieldSize: 50 * 1024,
} }).single("image");
function parseEmailUpload(req, res, next) {
  emailUpload(req, res, error => next(error ? httpError(400,
    error.code === "LIMIT_FILE_SIZE" ? "La imagen no puede superar 5 MB." : "Adjunto o formulario no válido.") : undefined));
}
adminApiRoutes.get("/customers/email/recipients", async(req,res) =>
  res.json({ total: await customerMail.countBroadcastRecipients(req.user.restaurant_id) }));
adminApiRoutes.post("/customers/email", parseEmailUpload, async(req,res) =>
  res.json(await customerMail.sendCustomerBroadcast(req.body, req.file, req.user.restaurant_id)));
adminApiRoutes.post("/customers/:id/email", async(req,res,next) => {
  req.emailCustomer = await mobile.customers(req, true);
  next();
}, parseEmailUpload, async(req,res) =>
  res.json(await customerMail.sendCustomerEmail(req.emailCustomer, req.body, req.file)));
adminApiRoutes.get("/customers/:id",async(req,res)=>res.json(await mobile.customers(req,true)));
adminApiRoutes.get("/address-search", rateLimit({ windowMs: 60000, limit: 30 }), async(req,res) => {
  try { res.json(await searchAddresses(req.query.q)); }
  catch { throw httpError(502, "No se pudo consultar el buscador de direcciones"); }
});
adminApiRoutes.get("/restaurant",async(req,res)=>res.json(await mobile.restaurant(req)));
adminApiRoutes.patch("/restaurant",restaurantLogoUpload,async(req,res)=>res.json(await mobile.updateRestaurant(req)));
adminApiRoutes.get("/order-notifications",async(req,res)=>{
  const {afterId,since}=req.query;
  if ((afterId!==undefined||since!==undefined) &&
      (typeof afterId!=="string"||!/^\d{1,20}$/.test(afterId)||typeof since!=="string"||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)))
    throw httpError(400,"Cursor de avisos no válido");
  res.json(await orderNotificationSnapshot(req.user.restaurant_id,afterId===undefined?undefined:{afterId,since}));
});
adminApiRoutes.post("/orders",async(req,res)=>res.status(201).json(await mobile.createOrder(req)));
adminApiRoutes.post("/orders/:id/mark-paid",async(req,res)=>res.json(await operations.markOrderPaid(req)));
adminApiRoutes.get("/me",(req,res)=>res.json(req.user));
adminApiRoutes.get("/products",async(req,res)=>res.json(await operations.adminProducts(req)));
adminApiRoutes.get("/providers",async(req,res)=>res.json(await operations.adminDeliveryProviders(req)));
adminApiRoutes.put("/providers/:provider",async(req,res)=>res.status(200).json(await operations.saveAdminDeliveryProvider(req)));
adminApiRoutes.post("/providers/:provider/test",async(req,res)=>res.status(200).json(await operations.testAdminDeliveryProvider(req)));

adminApiRoutes.get("/orders",async(req,res)=>{const rows=await operations.adminOrders(req);res.json(req.query.view==="mobile"?rows.map(mobile.mobileOrder):rows);});
adminApiRoutes.get("/orders/:id",async(req,res)=>{const row=await operations.adminOrder(req);res.json(req.query.view==="mobile"?mobile.mobileOrder(row):row);});
adminApiRoutes.patch("/orders/:id/status",async(req,res)=>res.status(200).json(await operations.setOrderStatus(req)));
adminApiRoutes.post("/orders/:id/delivery/quote",async(req,res)=>res.status(200).json(await operations.deliveryQuote(req)));
adminApiRoutes.post("/orders/:id/delivery",async(req,res)=>res.status(200).json(await operations.dispatchDelivery(req)));
adminApiRoutes.post("/orders/:id/delivery/simulate",async(req,res)=>res.status(200).json(await operations.simulateDelivery(req)));
adminApiRoutes.post("/orders/:id/delivery/sync",async(req,res)=>res.json(await operations.syncDelivery(req)));
adminApiRoutes.get("/orders/:id/delivery/qr",async(req,res)=>res.set("Cache-Control","no-store").type("png").send(await operations.pickupQr(req)));
adminApiRoutes.post("/products",async(req,res)=>res.status(201).json(await operations.createProduct(req)));
async function ensureUploadedProductScope(req,res,next) {
  if (!req.is("multipart/form-data")) return next();
  const products = await query(
    "SELECT id FROM products WHERE id=? AND restaurant_id=?",
    [req.params.id, req.user.restaurant_id],
  );
  if (!products.length) throw httpError(404, "Producto no encontrado");
  next();
}
function parseProductUpload(req, res, next) {
  if (!req.is("multipart/form-data")) return next();
  try {
    const product = JSON.parse(req.body.product);
    if (!product || typeof product !== "object" || Array.isArray(product))
      throw httpError(400, "Datos de artículo inválidos");
    req.body = product;
    next();
  } catch (error) {
    next(
      error instanceof SyntaxError
        ? httpError(400, "Datos de artículo inválidos")
        : error,
    );
  }
}
adminApiRoutes.patch(
  "/products/:id",
  ensureUploadedProductScope,
  productImageUpload,
  parseProductUpload,
  saveProductImage,
  async (req,res)=>res.status(200).json(await operations.updateProduct(req)),
);
adminApiRoutes.delete("/products/:id",async(req,res)=>res.status(200).json(await operations.deleteProduct(req)));
