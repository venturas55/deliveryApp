import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

const algorithm="aes-256-gcm";
const version=1;

function masterKey(){
  const value=process.env.DELIVERY_CREDENTIALS_KEY;
  if(!value)throw new Error("Falta DELIVERY_CREDENTIALS_KEY");
  let key;
  try{key=Buffer.from(value,"base64")}catch{throw new Error("DELIVERY_CREDENTIALS_KEY no es base64 válida")}
  if(key.length!==32)throw new Error("DELIVERY_CREDENTIALS_KEY debe decodificar a 32 bytes");
  return key;
}

export function encryptSecret(value){
  if(typeof value!=="string"||!value)throw new Error("El secreto debe ser texto no vacío");
  const iv=randomBytes(12);
  const cipher=createCipheriv(algorithm,masterKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return JSON.stringify({version,iv:iv.toString("base64"),tag:tag.toString("base64"),data:ciphertext.toString("base64")});
}

export function decryptSecret(serialized){
  if(typeof serialized!=="string"||!serialized)throw new Error("Secreto cifrado ausente");
  let envelope;
  try{envelope=JSON.parse(serialized)}catch{throw new Error("Secreto cifrado inválido")}
  if(envelope.version!==version)throw new Error("Versión de secreto cifrado no compatible");
  const decipher=createDecipheriv(algorithm,masterKey(),Buffer.from(envelope.iv,"base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
  try{return Buffer.concat([decipher.update(Buffer.from(envelope.data,"base64")),decipher.final()]).toString("utf8")}
  catch{throw new Error("No se pudo descifrar el secreto")}
}