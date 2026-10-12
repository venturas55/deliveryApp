import {query} from "../db.js";
import {httpError} from "./http-error.js";

export async function getRestaurant(id){
  if(id===undefined){
    const configured=process.env.DEFAULT_RESTAURANT_ID;
    if(configured!==undefined&&configured!=="") id=configured;
    else {
      const active=await query("SELECT id FROM restaurants WHERE active=1 ORDER BY id LIMIT 2");
      if(active.length>1)throw httpError(503,"Configura DEFAULT_RESTAURANT_ID para seleccionar el restaurante del sitio");
      if(!active.length)return null;
      id=active[0].id;
    }
  }
  if(!["string","number","bigint"].includes(typeof id)||!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<1||Number(id)>2147483647)
    throw httpError(400,"ID de restaurante no válido");
  const rows=await query("SELECT * FROM restaurants WHERE id=? AND active=1",[Number(id)]);
  return rows[0]||null;
}
