import {query} from "../db.js";
import {hashPassword,checkPassword} from "../auth.js";
import {httpError} from "../services/http-error.js";

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
  const rows=await query("SELECT id,name,email,phone,delivery_address,delivery_notes FROM customers WHERE id=?",[id]);
  if(!rows.length)throw httpError(401,"Cuenta no disponible");
  return rows[0];
}
export async function updateProfile(id,body={}){
  const fields={name:120,phone:40,delivery_address:500,delivery_notes:500},data={};
  for(const [key,max] of Object.entries(fields)){
    const value=body[key];if(value===undefined)continue;
    if(typeof value!=="string"||value.trim().length>max||(key==="name"&&!value.trim()))throw httpError(400,`Revisa el campo ${key} (máximo ${max} caracteres)`);
    data[key]=value.trim();
  }
  if(!Object.keys(data).length)throw httpError(400,"No hay datos que guardar");
  await customerProfile(id);
  await query(`UPDATE customers SET ${Object.keys(data).map(key=>key+"=?").join(",")} WHERE id=?`,[...Object.values(data),id]);
  return {ok:true};
}
