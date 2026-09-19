export function logEvent(c,id,type,payload={}){return c.query("INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,?,?)",[id,type,JSON.stringify(payload)])}

