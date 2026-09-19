import {readFile} from "node:fs/promises";
import {query,pool} from "../src/db.js";
try{
  for(const file of ["001-customers.sql","002-customer-profile.sql"]){
    const sql=await readFile(new URL("../migrations/"+file,import.meta.url),"utf8");
    for(const statement of sql.split(";").filter(s=>s.trim()))await query(statement);
  }
  console.log("Migración de clientes aplicada.");
}finally{await pool.end()}
