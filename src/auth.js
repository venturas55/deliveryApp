import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
export function signAdmin(admin){return jwt.sign({sub:admin.id,restaurant_id:admin.restaurant_id,email:admin.email},process.env.JWT_SECRET,{expiresIn:"12h"})}
export function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token)return res.status(401).json({error:"Autenticación requerida"});
  try{req.user=jwt.verify(token,process.env.JWT_SECRET);next()}
  catch{res.status(401).json({error:"Sesión no válida"})}
}
export const hashPassword=p=>bcrypt.hash(p,12);
export const checkPassword=(p,h)=>bcrypt.compare(p,h);