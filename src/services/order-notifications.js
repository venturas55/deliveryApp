import {query} from "../db.js";

export async function orderNotificationSnapshot(restaurantId,cursor){
  if(!cursor){
    const [row]=await query("SELECT COALESCE(MAX(id),0) AS afterId,DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s') AS since FROM orders WHERE restaurant_id=?",[restaurantId]);
    cursor={afterId:String(row.afterId),since:row.since};
  }
  const rows=await query(`SELECT id,payment_method FROM orders
    WHERE restaurant_id=? AND status<>'cancelled' AND (
      (payment_method='cash' AND id>?) OR
      (payment_method IN ('online','card_on_delivery') AND payment_status='paid' AND paid_at>=?)
    ) ORDER BY COALESCE(paid_at,created_at),id`,[restaurantId,cursor.afterId,cursor.since]);
  return {cursor,events:rows.map(row=>({id:String(row.id),kind:row.payment_method==="cash"?"cash":"card"}))};
}
