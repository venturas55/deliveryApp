import {query} from "../db.js";

export async function getRestaurant(slug="demo"){
  const rows=await query("SELECT * FROM restaurants WHERE slug=? AND active=1",[slug]);
  return rows[0]||null;
}
