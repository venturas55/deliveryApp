import {Router} from "express";
import rateLimit from "express-rate-limit";
import {randomBytes} from "node:crypto";
import jwt from "jsonwebtoken";
import {OAuth2Client} from "google-auth-library";
import {query} from "../db.js";
import {hashPassword,checkPassword,signCustomer,customerAuth} from "../auth.js";

const router=Router();
const google=new OAuth2Client();
const limit=rateLimit({windowMs:15*60*1000,max:30});
const emailValue=value=>typeof value==="string"?value.trim().toLowerCase():"";
const validEmail=value=>value.length<=190&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const session=(res,customer,status=200)=>res.status(status).json({token:signCustomer(customer),customer:{id:customer.id,name:customer.name,email:customer.email}});
router.post("/register",limit,async(req,res)=>{
  const {name,password}=req.body||{},email=emailValue(req.body?.email);
  if(typeof name!=="string"||!name.trim()||name.trim().length>120||!validEmail(email)||typeof password!=="string"||password.length<8||Buffer.byteLength(password)>72)
    return res.status(400).json({error:"Indica un nombre, un email válido y una contraseña de al menos 8 caracteres (máximo 72 bytes)"});
  try{
    const result=await query("INSERT INTO customers(name,email,password_hash) VALUES(?,?,?)",[name.trim(),email,await hashPassword(password)]);
    session(res,{id:Number(result.insertId),name:name.trim(),email},201);
  }catch(error){if(error.code==="ER_DUP_ENTRY")return res.status(409).json({error:"Este correo ya tiene una cuenta. Inicia sesión."});throw error}
});
router.post("/login",limit,async(req,res)=>{
  const email=emailValue(req.body?.email),password=req.body?.password;
  if(!validEmail(email)||typeof password!=="string"||Buffer.byteLength(password)>72)return res.status(400).json({error:"Email o contraseña no válidos"});
  const rows=await query("SELECT * FROM customers WHERE email=?",[email]);
  if(!rows[0]?.password_hash||!await checkPassword(password,rows[0].password_hash))return res.status(401).json({error:"Credenciales incorrectas"});
  session(res,rows[0]);
});
router.get("/me",customerAuth,async(req,res)=>{
  const rows=await query("SELECT id,name,email,phone,delivery_address,delivery_notes FROM customers WHERE id=?",[req.customer.sub]);
  if(!rows.length)return res.status(401).json({error:"Cuenta no disponible"});
  res.json(rows[0]);
});
router.patch("/me",customerAuth,async(req,res)=>{
  const fields={name:120,phone:40,delivery_address:500,delivery_notes:500},data={};
  for(const [key,max] of Object.entries(fields)){
    const value=req.body?.[key];
    if(value===undefined)continue;
    if(typeof value!=="string"||value.trim().length>max||(key==="name"&&!value.trim()))return res.status(400).json({error:`Revisa el campo ${key} (máximo ${max} caracteres)`});
    data[key]=value.trim();
  }
  if(!Object.keys(data).length)return res.status(400).json({error:"No hay datos que guardar"});
  const existing=await query("SELECT id FROM customers WHERE id=?",[req.customer.sub]);
  if(!existing.length)return res.status(401).json({error:"Cuenta no disponible"});
  await query(`UPDATE customers SET ${Object.keys(data).map(key=>key+"=?").join(",")} WHERE id=?`,[...Object.values(data),req.customer.sub]);
  res.json({ok:true});
});
router.get("/google/config",limit,(req,res)=>{
  res.set("Cache-Control","no-store");
  if(!process.env.GOOGLE_CLIENT_ID)return res.json({enabled:false});
  const nonce=randomBytes(24).toString("hex");
  res.cookie("google_nonce",jwt.sign({nonce,purpose:"google-login"},process.env.JWT_SECRET,{expiresIn:"10m"}),{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:600000,path:"/api/customer-auth"});
  res.json({enabled:true,clientId:process.env.GOOGLE_CLIENT_ID,nonce});
});
router.post("/google",limit,async(req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:"El acceso con Google todavía no está configurado"});
  let payload;
  try{
    const challenge=jwt.verify(req.cookies?.google_nonce||"",process.env.JWT_SECRET,{algorithms:["HS256"]});
    if(challenge.purpose!=="google-login"||typeof req.body?.credential!=="string")throw new Error();
    const ticket=await google.verifyIdToken({idToken:req.body.credential,audience:process.env.GOOGLE_CLIENT_ID});
    payload=ticket.getPayload();
    if(!payload?.sub||!payload.email_verified||payload.nonce!==challenge.nonce||!validEmail(emailValue(payload.email)))throw new Error();
  }catch{return res.status(401).json({error:"No se pudo verificar el acceso con Google. Recarga e inténtalo de nuevo."})}
  res.clearCookie("google_nonce",{path:"/api/customer-auth"});
  const rows=await query("SELECT * FROM customers WHERE google_sub=?",[payload.sub]);
  if(rows.length)return session(res,rows[0]);
  // Never silently link a password account by email alone.
  const email=emailValue(payload.email),name=(payload.name||email).slice(0,120);
  try{
    const result=await query("INSERT INTO customers(name,email,google_sub) VALUES(?,?,?)",[name,email,payload.sub]);
    session(res,{id:Number(result.insertId),name,email},201);
  }catch(error){if(error.code==="ER_DUP_ENTRY")return res.status(409).json({error:"Ya existe una cuenta con este correo. Usa su método de acceso original."});throw error}
});
export default router;
