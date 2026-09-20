import {Router} from "express";
import rateLimit from "express-rate-limit";
import {query} from "../db.js";
import {signAdmin,hashPassword,checkPassword} from "../auth.js";
import {getRestaurant} from "../services/restaurants.js";
import {adminApiRoutes} from "./admin.js";
import {clientApiRoutes} from "./clients.js";

import customerAuthRoutes from "./customer-auth.js";

import {loginAdmin} from "../controllers/accounts.js";
import {deliveryWebhook} from "../controllers/webhooks.js";
const router=Router();
router.use((req,res,next)=>{
  if(req.is("application/x-www-form-urlencoded")&&req.path!=="/setup-admin")return res.status(415).json({error:"Use application/json"});
  next();
});
const apiLimit=rateLimit({windowMs:60*1000,max:120,standardHeaders:true,legacyHeaders:false});
const authLimit=rateLimit({windowMs:15*60*1000,max:20});
router.use(apiLimit);
router.post("/webhooks/delivery/:provider/:restaurantId",deliveryWebhook);
router.use("/customer-auth",customerAuthRoutes);

router.post("/auth/login",authLimit,async(req,res)=>{
  const admin=await loginAdmin(req.body);
  res.json({token:signAdmin(admin),admin:{id:admin.id,email:admin.email,restaurant_id:admin.restaurant_id}});
});

router.post("/setup-admin",authLimit,async(req,res)=>{
  // Intended only for first local setup. Disable by setting SETUP_DISABLED=true.
  if(process.env.SETUP_DISABLED==="true")return res.status(404).end();
  const r=await getRestaurant("demo"); if(!r)return res.status(500).json({error:"Restaurante no existe"});
  const email=process.env.ADMIN_EMAIL||"admin@pizzeria.local", password=process.env.ADMIN_PASSWORD||"change_me_now";
  const existing=await query("SELECT id FROM admins WHERE email=?",[email]);
  if(existing.length)return res.json({ok:true,message:"Admin ya creado"});
  await query("INSERT INTO admins(restaurant_id,email,password_hash) VALUES(?,?,?)",[r.id,email,await hashPassword(password)]);
  res.json({ok:true,email});
});

router.use("/admin",adminApiRoutes);
router.use(clientApiRoutes);

export default router;
