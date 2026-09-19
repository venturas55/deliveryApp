import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
export function signAdmin(admin){return jwt.sign({sub:admin.id,role:"admin",restaurant_id:admin.restaurant_id,email:admin.email},process.env.JWT_SECRET,{expiresIn:"12h"})}
export function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token)return res.status(401).json({error:"Autenticación requerida"});
  try{req.user=jwt.verify(token,process.env.JWT_SECRET,{algorithms:["HS256"]});
    if(req.user.role!=="admin"&&!(req.user.role===undefined&&req.user.restaurant_id))return res.status(403).json({error:"Acceso exclusivo de administradores"});
    next()}
  catch{res.status(401).json({error:"Sesión no válida"})}
}
export const hashPassword=p=>bcrypt.hash(p,12);
export const checkPassword=(p,h)=>bcrypt.compare(p,h);
export function signCustomer(customer){return jwt.sign({sub:String(customer.id),role:"customer"},process.env.JWT_SECRET,{expiresIn:"12h"})}
export function customerAuth(req,res,next){
  const header=req.headers.authorization||"";
  try{
    const user=jwt.verify(header.startsWith("Bearer ")?header.slice(7):"",process.env.JWT_SECRET,{algorithms:["HS256"]});
    if(user.role!=="customer")return res.status(403).json({error:"Inicia sesión como cliente"});
    req.customer=user;next();
  }catch{res.status(401).json({error:"Inicia sesión para continuar"})}
}
