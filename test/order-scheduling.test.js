import test, {after} from "node:test";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {orderTimeSlots,parseOrderSchedule,scheduleLabel} from "../src/services/order-scheduling.js";
import {createOrder,customerOrders,customerOrder} from "../src/controllers/clients.js";
import {mobileOrder} from "../src/controllers/admin-mobile.js";
import {pool,query} from "../src/db.js";
import {adminOrder,adminOrders} from "../src/controllers/admin.js";

after(()=>pool.end());

test("today slots use Madrid time, quarter hours, midnight and DST", () => {
  const now = new Date("2026-10-14T10:07:00Z");
  const slots = orderTimeSlots(now);
  assert.deepEqual(slots[0], {value:"2026-10-14T10:15:00.000Z",label:"12:15"});
  assert.equal(slots.at(-1).label,"23:45");
  assert.equal(parseOrderSchedule({},now),null);
  assert.equal(parseOrderSchedule({timing_mode:"asap",scheduled_for:"invalid"},now),null);
  assert.equal(parseOrderSchedule({timing_mode:"scheduled",scheduled_for:slots[0].value},now),"2026-10-14 10:15:00");
  for (const scheduled_for of ["",null,[],"invalid","2026-10-14T10:00:00.000Z","2026-10-14T10:16:00.000Z","2026-10-15T10:15:00.000Z"])
    assert.throws(()=>parseOrderSchedule({timing_mode:"scheduled",scheduled_for},now),e=>e.status===400);
  assert.throws(()=>parseOrderSchedule({timing_mode:"unknown"},now),e=>e.status===400);
  assert.deepEqual(orderTimeSlots(new Date("2026-10-14T21:46:00Z")),[]);
  assert.equal(scheduleLabel(null),"Lo antes posible");
  assert.equal(scheduleLabel(slots[0].value),"14/10/2026 12:15");
  const dst = orderTimeSlots(new Date("2026-10-25T00:00:00Z"));
  assert.equal(dst[0].label,"02:15");
  assert.equal(dst.find(slot=>slot.value==="2026-10-25T01:00:00.000Z").label,"02:00");
});

test("checkout persists optional schedule; customer and ADMIN retain it without changing actions", async () => {
  const original = pool.getConnection;
  let stored, inserts = 0;
  const connection = {release(){},async beginTransaction(){},async commit(){},async rollback(){},
    async query(sql,params) {
      if(sql.includes("FROM customers WHERE id=?")) return [{name:"Cliente",phone:"600000000",delivery_notes:""}];
      if(sql.includes("FROM restaurants")) return [{id:1,address:"Local"}];
      if(sql.includes("FROM products")) return [{id:2,name:"Pizza",price_cents:1000}];
      if(sql.includes("FROM order_items")) return [];
      if(sql.startsWith("INSERT INTO orders(")) {
        const columns=sql.match(/orders\(([^)]+)\)/)[1].split(",");
        assert.equal(columns.length,params.length);
        stored=Object.fromEntries(columns.map((key,i)=>[key,params[i]]));
        inserts++;
        return {insertId:42};
      }
      if(sql.startsWith("SELECT") && sql.includes("FROM orders")) {
        assert.match(sql,/customer_id=\?/);
        return [{...stored,id:42,status:"new",scheduled_for:stored.scheduled_for ? stored.scheduled_for.replace(" ","T")+"Z" : null}];
      }
      return {affectedRows:1};
    }};
  pool.getConnection=async()=>connection;
  try {
    const req={customer:{sub:7},body:{restaurant_id:1,delivery_method:"pickup",items:[{product_id:2,quantity:1}]}};
    await createOrder(req);
    assert.equal(stored.scheduled_for,null);
    assert.equal(stored.total_cents,1000);
    const slot=orderTimeSlots()[0];
    // At the end of the local day only ASAP remains available.
    if(slot) {
      await createOrder({...req,body:{...req.body,timing_mode:"scheduled",scheduled_for:slot.value}});
      assert.equal(stored.scheduled_for,slot.value.slice(0,19).replace("T"," "));
      const orders=await customerOrders({customer:req.customer,query:{}});
      assert.equal(orders[0].scheduled_for,slot.value.replace(".000Z","Z"));
      const detail=await customerOrder({customer:req.customer,params:{id:42}});
      assert.equal(detail.scheduleLabel,scheduleLabel(slot.value));
      const dto=mobileOrder({...detail,provider_order_id:null});
      assert.equal(dto.scheduleLabel,detail.scheduleLabel);
      assert.equal(dto.nextStatus,"accepted");
    }
    const before=inserts;
    await assert.rejects(createOrder({...req,body:{...req.body,timing_mode:"scheduled",scheduled_for:"2000-01-01T12:00:00.000Z"}}),e=>e.status===400);
    assert.equal(inserts,before);
    assert.equal(mobileOrder({status:"new"}).scheduleLabel,"Lo antes posible");
  } finally {pool.getConnection=original;}
});

test("MariaDB preserves UTC schedule and legacy orders; ADMIN scope stays isolated", async () => {
  let restaurantId,customerId;
  try {
    const suffix=randomUUID();
    restaurantId=Number((await query("INSERT INTO restaurants(name,slug,address) VALUES(?,?,?)",["Schedule test",suffix,"Local"])).insertId);
    customerId=Number((await query("INSERT INTO customers(name,email,phone) VALUES(?,?,?)",["Schedule test",`${suffix}@example.invalid`,"600000000"])).insertId);
    const productId=Number((await query("INSERT INTO products(restaurant_id,name,price_cents) VALUES(?,?,?)",[restaurantId,"Pizza",1200])).insertId);
    const req={customer:{sub:customerId},body:{restaurant_id:restaurantId,delivery_method:"pickup",items:[{product_id:productId,quantity:1}]}};
    const asap=await createOrder(req);
    const legacy=await adminOrder({user:{restaurant_id:restaurantId},params:{id:asap.id}});
    assert.equal(legacy.scheduled_for,null);
    assert.equal(mobileOrder(legacy).scheduleLabel,"Lo antes posible");
    const slot=orderTimeSlots()[0];
    if(slot) {
      const scheduled=await createOrder({...req,body:{...req.body,scheduled_for:slot.value,timing_mode:"scheduled"}});
      const adminReq={user:{restaurant_id:restaurantId},params:{id:scheduled.id},query:{filter:"all"}};
      const detail=await adminOrder(adminReq);
      assert.equal(detail.scheduled_for,slot.value.replace(".000Z","Z"));
      assert.equal(mobileOrder(detail).scheduleLabel,scheduleLabel(slot.value));
      const list=await adminOrders(adminReq);
      assert.equal(list.find(order=>Number(order.id)===scheduled.id).scheduled_for,detail.scheduled_for);
      const customer=await customerOrder({customer:req.customer,params:{id:scheduled.id}});
      assert.equal(customer.scheduled_for,detail.scheduled_for);
      assert.equal(customer.scheduleLabel,scheduleLabel(slot.value));
      await assert.rejects(adminOrder({...adminReq,user:{restaurant_id:0}}),e=>e.status===404);
      await assert.rejects(customerOrder({customer:{sub:0},params:{id:scheduled.id}}),e=>e.status===404);
    }
    // An older writer omits the new column and still receives its NULL default.
    const old=await query("INSERT INTO orders(restaurant_id,customer_name,customer_phone,delivery_address,subtotal_cents,total_cents) VALUES(?,?,?,?,?,?)",[restaurantId,"Legacy","600000000","Local",100,100]);
    const [row]=await query("SELECT scheduled_for FROM orders WHERE id=?",[old.insertId]);
    assert.equal(row.scheduled_for,null);
  } finally {
    if(restaurantId)await query("DELETE FROM restaurants WHERE id=?",[restaurantId]);
    if(customerId)await query("DELETE FROM customers WHERE id=?",[customerId]);
  }
});
