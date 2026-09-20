import {query} from "../db.js";
import {hashPassword,checkPassword} from "../auth.js";
import {httpError} from "../services/http-error.js";
import {cleanAddress,validateAddress} from "../services/geocoding.js";

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
  const rows=await query("SELECT id,name,email,phone,delivery_address,delivery_notes,delivery_formatted_address,delivery_street,delivery_number,delivery_city,delivery_province,delivery_postal_code,delivery_country,delivery_latitude,delivery_longitude,delivery_place_id,delivery_apartment,delivery_patio FROM customers WHERE id=?",[id]);
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
