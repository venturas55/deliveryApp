import {query} from "../db.js";
import {createHash,randomBytes} from "node:crypto";
import {hashPassword,checkPassword} from "../auth.js";
import {httpError} from "../services/http-error.js";
import {cleanAddress,validateAddress} from "../services/geocoding.js";
import {sendEmail} from "../services/email.js";

export const emailValue=value=>typeof value==="string"?value.trim().toLowerCase():"";
export const validEmail=value=>value.length<=190&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export async function registerCustomer(body={}){
  const {name,password}=body,email=emailValue(body.email);
  if(typeof name!=="string"||!name.trim()||name.trim().length>120||!validEmail(email)||typeof password!=="string"||password.length<8||Buffer.byteLength(password)>72)
    throw httpError(400,"Indica un nombre, un email válido y una contraseña de al menos 8 caracteres (máximo 72 bytes)");
  try{
    const result=await query("INSERT INTO customers(name,email,password_hash) VALUES(?,?,?)",[name.trim(),email,await hashPassword(password)]);
    return {id:Number(result.insertId),name:name.trim(),email};
  }catch(error){if(error.code==="ER_DUP_ENTRY")throw httpError(409,"Este correo ya tiene una cuenta. Inicia sesión.");throw error}
}
export async function loginCustomer(body={}){
  const email=emailValue(body.email),password=body.password;
  if(!validEmail(email)||typeof password!=="string"||Buffer.byteLength(password)>72)throw httpError(400,"Email o contraseña no válidos");
  const rows=await query("SELECT * FROM customers WHERE email=?",[email]);
  if(!rows[0]?.password_hash||!await checkPassword(password,rows[0].password_hash))throw httpError(401,"Credenciales incorrectas");
  return rows[0];
}
export async function loginAdmin(body={}){
  const {email,password}=body;
  if(typeof email!=="string"||typeof password!=="string"||!email||!password)throw httpError(400,"Email y contraseña requeridos");
  const rows=await query("SELECT * FROM admins WHERE email=?",[email]);
  if(!rows.length||!await checkPassword(password,rows[0].password_hash))throw httpError(401,"Credenciales incorrectas");
  return rows[0];
}
export async function customerProfile(id){
  const rows=await query("SELECT * FROM customers WHERE id=?",[id]);
  if(!rows.length)throw httpError(401,"Cuenta no disponible");
  return rows[0];
}
export async function updateProfile(id,body={}){
  const fields={name:120,phone:40,delivery_notes:500,delivery_apartment:120,delivery_patio:120},data={};
  for(const [key,max] of Object.entries(fields)){
    const value=body[key];if(value===undefined)continue;
    if(typeof value!=="string"||value.trim().length>max||(key==="name"&&!value.trim()))throw httpError(400,`Revisa el campo ${key} (máximo ${max} caracteres)`);
    data[key]=value.trim();
  }
  const rawAddress=body.delivery_address_data??body.delivery_address;
  if(rawAddress!==undefined&&String(rawAddress).trim()!==""&&String(rawAddress).trim()!=="{}"){
    if(typeof rawAddress==="string"&&rawAddress.trim().startsWith("{")){
      try{body.delivery_address_data=JSON.parse(rawAddress)}catch{throw httpError(400,"Dirección seleccionada inválida")}
    }
    if(body.delivery_address_data&&typeof body.delivery_address_data==="object"){
      const error=validateAddress(body.delivery_address_data);if(error)throw httpError(400,error);
      const address=cleanAddress(body.delivery_address_data);
      Object.assign(data,{delivery_address:address.formatted_address,delivery_formatted_address:address.formatted_address,delivery_street:address.street,delivery_number:address.number,delivery_city:address.city,delivery_province:address.province,delivery_postal_code:address.postal_code,delivery_country:address.country,delivery_latitude:address.latitude,delivery_longitude:address.longitude,delivery_place_id:address.place_id});
    }else throw httpError(400,"Selecciona una dirección de las sugerencias");
  }
  if(!Object.keys(data).length)throw httpError(400,"No hay datos que guardar");
  await customerProfile(id);
  await query(`UPDATE customers SET ${Object.keys(data).map(key=>key+"=?").join(",")} WHERE id=?`,[...Object.values(data),id]);
  return {ok:true};
}

export async function passwordSetupAvailable(token){
  if(typeof token!=="string"||token.length<32||token.length>100) return false;
  const hash=createHash("sha256").update(token).digest("hex");
  return (await query("SELECT id FROM customers WHERE password_setup_token_hash=? AND password_setup_expires_at>NOW()",[hash])).length>0;
}
export async function setPasswordFromSetup(token,password,confirmation){
  if(typeof token!=="string"||token.length<32||token.length>100||typeof password!=="string"||password.length<8||Buffer.byteLength(password)>72)throw httpError(400,"El enlace o la contraseña no son válidos");
  if(password!==confirmation)throw httpError(400,"Las contraseñas no coinciden.");
  const hash=createHash("sha256").update(token).digest("hex"),passwordHash=await hashPassword(password);
  const result=await query("UPDATE customers SET password_hash=?,password_setup_token_hash=NULL,password_setup_expires_at=NULL,password_reset_token_hash=NULL,password_reset_expires_at=NULL WHERE password_setup_token_hash=? AND password_setup_expires_at>NOW()",[passwordHash,hash]);
  if(!result.affectedRows)throw httpError(400,"El enlace ha caducado o ya se utilizó. Solicita otro al restaurante.");
}

export async function requestPasswordReset(rawEmail){
  const email=emailValue(rawEmail);
  if(!validEmail(email))return;
  const rows=await query("SELECT id,name,email FROM customers WHERE email=? AND password_hash IS NOT NULL",[email]);
  if(!rows.length)return;
  let base;
  try{base=new URL(process.env.PUBLIC_URL)}catch{throw httpError(503,"PUBLIC_URL no está configurada para enviar el enlace.")}
  const customer=rows[0];
  const token=randomBytes(32).toString("base64url");
  const tokenHash=createHash("sha256").update(token).digest("hex");
  await query("UPDATE customers SET password_reset_token_hash=?,password_reset_expires_at=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE id=?",[tokenHash,customer.id]);
  const resetUrl=new URL("/client/reset-password?token="+encodeURIComponent(token),base).toString();
  try{
    await sendEmail({
      to:customer.email,
      subject:"Restablece la contraseña de tu cuenta",
      text:`Hola ${customer.name},\n\nRecibimos una solicitud para cambiar la contraseña de tu cuenta. Usa este enlace durante la próxima hora:\n${resetUrl}\n\nSi no solicitaste el cambio, ignora este mensaje.`,
    });
  }catch(error){
    await query("UPDATE customers SET password_reset_token_hash=NULL,password_reset_expires_at=NULL WHERE id=? AND password_reset_token_hash=?",[customer.id,tokenHash]);
    throw error;
  }
}

export async function passwordResetAvailable(token){
  if(typeof token!=="string"||token.length<32||token.length>100)return false;
  const hash=createHash("sha256").update(token).digest("hex");
  return (await query("SELECT id FROM customers WHERE password_reset_token_hash=? AND password_reset_expires_at>NOW()",[hash])).length>0;
}

export async function resetCustomerPassword(token,password,confirmation){
  if(typeof token!=="string"||token.length<32||token.length>100||typeof password!=="string"||password.length<8||Buffer.byteLength(password)>72)
    throw httpError(400,"El enlace o la contraseña no son válidos.");
  if(password!==confirmation)throw httpError(400,"Las contraseñas no coinciden.");
  const hash=createHash("sha256").update(token).digest("hex");
  const passwordHash=await hashPassword(password);
  const result=await query("UPDATE customers SET password_hash=?,password_setup_token_hash=NULL,password_setup_expires_at=NULL,password_reset_token_hash=NULL,password_reset_expires_at=NULL WHERE password_reset_token_hash=? AND password_reset_expires_at>NOW()",[passwordHash,hash]);
  if(!result.affectedRows)throw httpError(400,"El enlace ha caducado o ya se utilizó. Solicita otro.");
}
