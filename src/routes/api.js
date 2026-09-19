import {Router} from "express";
import rateLimit from "express-rate-limit";
import {query} from "../db.js";
import {signAdmin,hashPassword,checkPassword} from "../auth.js";
import {getRestaurant} from "../services/restaurants.js";
import {adminApiRoutes} from "./admin.js";
import {clientApiRoutes} from "./clients.js";

import customerAuthRoutes from "./customer-auth.js";

const router=Router();
const apiLimit=rateLimit({windowMs:60*1000,max:120,standardHeaders:true,legacyHeaders:false});
const authLimit=rateLimit({windowMs:15*60*1000,max:20});
router.use(apiLimit);
router.use("/customer-auth",customerAuthRoutes);

router.post("/auth/login",authLimit,async(req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password)return res.status(400).json({error:"Email y contraseña requeridos"});
  const rows=await query("SELECT * FROM admins WHERE email=?",[email]);
  if(!rows.length||!(await checkPassword(password,rows[0].password_hash)))return res.status(401).json({error:"Credenciales incorrectas"});
  res.json({token:signAdmin(rows[0]),admin:{id:rows[0].id,email:rows[0].email,restaurant_id:rows[0].restaurant_id}});
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
