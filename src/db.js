import mariadb from "mariadb";
import dotenv from "dotenv";
dotenv.config();
export const pool=mariadb.createPool({
  host:process.env.DB_HOST, port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME,connectionLimit:10
});
export async function query(sql,params=[]){
  let c; try{c=await pool.getConnection();return await c.query(sql,params)}
  finally{if(c)c.release()}
}
export async function transaction(fn){
  let c; try{c=await pool.getConnection();await c.beginTransaction();
    const result=await fn(c);await c.commit();return result;
  }catch(e){if(c)await c.rollback();throw e}finally{if(c)c.release()}
}