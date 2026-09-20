import {Router} from "express";
import {registerCustomer,loginCustomer,customerProfile,updateProfile,emailValue,validEmail} from "../controllers/accounts.js";
import {setSession} from "../services/web-session.js";
import rateLimit from "express-rate-limit";
import {randomBytes} from "node:crypto";
import jwt from "jsonwebtoken";
import {OAuth2Client} from "google-auth-library";
import {query} from "../db.js";
import {signCustomer,customerAuth} from "../auth.js";

const router=Router();
const google=new OAuth2Client();
const limit=rateLimit({windowMs:15*60*1000,max:30});
const session=(res,customer,status=200)=>{
  const token=signCustomer(customer);setSession(res,"customer",token);
  return res.status(status).json({token,customer:{id:customer.id,name:customer.name,email:customer.email}});
};
router.post("/register",limit,async(req,res)=>session(res,await registerCustomer(req.body),201));
router.post("/login",limit,async(req,res)=>session(res,await loginCustomer(req.body)));
router.get("/me",customerAuth,async(req,res)=>res.json(await customerProfile(req.customer.sub)));
router.patch("/me",customerAuth,async(req,res)=>res.json(await updateProfile(req.customer.sub,req.body)));
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
