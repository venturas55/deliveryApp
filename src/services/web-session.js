import jwt from "jsonwebtoken";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {httpError} from "./http-error.js";

export const cookieOptions=()=>({httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/"});
export function setSession(res,role,token){res.cookie(role+"_session",token,{...cookieOptions(),maxAge:12*60*60*1000})}
export function clearSession(res,role){res.clearCookie(role+"_session",cookieOptions())}
export function readToken(value){
  try{return jwt.verify(value||"",process.env.JWT_SECRET,{algorithms:["HS256"]})}catch{return null}
}
export function webSession(req, res, next) {
  const customer = readToken(req.cookies.customer_session);
  const admin = readToken(req.cookies.admin_session);

  req.customer = customer?.role === "customer" ? customer : null;
  req.user = admin?.role === "admin" ? admin : null;

  res.locals.customerLoggedIn = !!req.customer;
  res.locals.adminLoggedIn = !!req.user;

  let csrf = req.cookies.web_csrf;

  if (!/^[a-f0-9]{64}$/.test(csrf || "")) {
    csrf = randomBytes(32).toString("hex");
    res.cookie("web_csrf", csrf, cookieOptions());
  }

  req.csrf = csrf;
  res.locals.csrf = csrf;

  res.set("Cache-Control", "no-store");

  next();
}
export function requireCustomer(req,res,next){
  if(!req.customer)return res.redirect(303,"/client/login?next="+encodeURIComponent(req.originalUrl));
  next();
}
export function requireAdmin(req,res,next){
  if(!req.user)return res.redirect(303,"/admin/login");
  next();
}
export function safeNext(value,fallback="/"){
  if(typeof value!=="string"||!value.startsWith("/")||value.startsWith("//")||value.includes("\\")||/[\r\n]/.test(value))return fallback;
  return value;
}
export function readCart(req){
  const value=readToken(req.cookies.customer_cart);
  return value?.purpose==="cart"&&Array.isArray(value.items)?value.items:[];
}
export function writeCart(res,items){
  if(!items.length)return res.clearCookie("customer_cart",cookieOptions());
  res.cookie("customer_cart",jwt.sign({purpose:"cart",items},process.env.JWT_SECRET,{expiresIn:"7d"}),{...cookieOptions(),maxAge:7*24*60*60*1000});
}

export function validateCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const supplied =
    req.body?._csrf ||
    req.get("x-csrf-token");

  const csrf = req.csrf;

  if (
    typeof supplied !== "string" ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    typeof csrf !== "string" ||
    !/^[a-f0-9]{64}$/.test(csrf)
  ) {
    return next(
      httpError(
        403,
        "Formulario caducado. Recarga la página e inténtalo de nuevo."
      )
    );
  }

  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const csrfBuffer = Buffer.from(csrf, "utf8");

  if (
    suppliedBuffer.length !== csrfBuffer.length ||
    !timingSafeEqual(suppliedBuffer, csrfBuffer)
  ) {
    return next(
      httpError(
        403,
        "Formulario caducado. Recarga la página e inténtalo de nuevo."
      )
    );
  }

  next();
}
