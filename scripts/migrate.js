import {readFile} from "node:fs/promises";
import {query,pool} from "../src/db.js";
function isAlreadyPresent(error){
  return ["ER_DUP_FIELDNAME","ER_DUP_KEYNAME"].includes(error.code)||[1060,1061].includes(Number(error.errno));
}
try{
  for(const file of ["001-customers.sql","002-customer-profile.sql","003-delivery-providers.sql","004-structured-delivery-addresses.sql","005-delivery-tracking.sql","006-delivery-verification.sql","007-delivery-method.sql","009-restaurant-address.sql","010-product-images.sql","011-order-sales-channel.sql","013-customer-password-setup.sql","014-sales-channel-telephone.sql","015-promotions.sql"]){
    const sql=await readFile(new URL("../migrations/"+file,import.meta.url),"utf8");
    for(const [index,statement] of sql.split(";").entries()){
      if(!statement.trim())continue;
      try{await query(statement)}
      catch(error){
        if(!isAlreadyPresent(error))throw error;
        console.warn(`Omitido objeto ya existente: ${file}, sentencia ${index+1} (${error.code||error.errno}).`);
      }
    }
  }
  console.log("Migraciones aplicadas.");
}finally{await pool.end()}
