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
  const nonce=randomBytes(32).toString("hex");
  const challenge=jwt.sign({nonce,purpose:"google-login"},process.env.JWT_SECRET,{expiresIn:"10m"});
  res.cookie("google_nonce",challenge,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:600000,path:"/api/customer-auth"});
  res.json({enabled:true,clientId:process.env.GOOGLE_CLIENT_ID,nonce,challenge});
});
function logGoogleAuthRejection(source,reason){
  console.warn("Google customer authentication rejected",{source,reason});
}
async function customerFromGoogleCredential(credential,challengeToken,source){
  let challenge;
  try{
    challenge=jwt.verify(challengeToken||"",process.env.JWT_SECRET,{algorithms:["HS256"]});
  }catch{
    logGoogleAuthRejection(source,"invalid_challenge");
    return null;
  }
  if(challenge.purpose!=="google-login"){
    logGoogleAuthRejection(source,"invalid_challenge_purpose");
    return null;
  }
  if(typeof credential!=="string"||!credential){
    logGoogleAuthRejection(source,"missing_credential");
    return null;
  }
  let ticket;
  try{
    ticket=await google.verifyIdToken({idToken:credential,audience:process.env.GOOGLE_CLIENT_ID});
  }catch(error){
    const message=typeof error?.message==="string"?error.message.toLowerCase():"";
    const reason=/audience|recipient/.test(message)?"audience_mismatch"
      :/expired|\bexp\b/.test(message)?"expired_id_token"
      :/signature|certificate|public key/.test(message)?"invalid_id_token_signature"
      :"id_token_verification_failed";
    logGoogleAuthRejection(source,reason);
    return null;
  }
  const payload=ticket.getPayload();
  if(!payload?.sub){
    logGoogleAuthRejection(source,"missing_google_subject");
    return null;
  }
  if(!payload.email_verified){
    logGoogleAuthRejection(source,"email_not_verified");
    return null;
  }
  if(payload.nonce!==challenge.nonce){
    logGoogleAuthRejection(source,"nonce_mismatch");
    return null;
  }
  if(!validEmail(emailValue(payload.email))){
    logGoogleAuthRejection(source,"invalid_email");
    return null;
  }
  let picture=null;
  try{
    const image=new URL(payload.picture);
    if(image.protocol==="https:"&&image.hostname.endsWith("googleusercontent.com"))picture=image.href.slice(0,2048);
  }catch{}
  const rows=await query("SELECT * FROM customers WHERE google_sub=?",[payload.sub]);
  if(rows.length){
    if(picture&&picture!==rows[0].profile_image_url){
      await query("UPDATE customers SET profile_image_url=? WHERE id=?",[picture,rows[0].id]);
      rows[0].profile_image_url=picture;
    }
    return {customer:rows[0],created:false};
  }
  // Never silently link a password account by email alone.
  const email=emailValue(payload.email),name=(payload.name||email).slice(0,120);
  try{
    const result=await query("INSERT INTO customers(name,email,google_sub,profile_image_url) VALUES(?,?,?,?)",[name,email,payload.sub,picture]);
    return {customer:{id:Number(result.insertId),name,email,profile_image_url:picture},created:true};
  }catch(error){if(error.code==="ER_DUP_ENTRY")return {conflict:true};throw error}
}
router.post("/google",limit,async(req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:"El acceso con Google todavía no está configurado"});
  const result=await customerFromGoogleCredential(req.body?.credential,req.cookies?.google_nonce,"web");
  res.clearCookie("google_nonce",{path:"/api/customer-auth"});
  if(!result)return res.status(401).json({error:"No se pudo verificar el acceso con Google. Recarga e inténtalo de nuevo."});
  if(result.conflict)return res.status(409).json({error:"Ya existe una cuenta con este correo. Usa su m?todo de acceso original."});
  return session(res,result.customer,result.created?201:200);
});
router.post("/google/native",limit,async(req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:"El acceso con Google todavía no está configurado (native)"});
  const result=await customerFromGoogleCredential(req.body?.credential,req.body?.challenge,"native");
  if(!result)return res.status(401).json({error:"No se pudo verificar el acceso con Google. Recarga e inténtalo de nuevo (native)."});
  if(result.conflict)return res.status(409).json({error:"Ya existe una cuenta con este correo. Usa su m?todo de acceso original. (native)"});
  return session(res,result.customer,result.created?201:200);
});
export default router;
