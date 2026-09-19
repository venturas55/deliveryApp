const id=new URLSearchParams(location.search).get("id");
const stages=["new","accepted","preparing","ready","delivery_requested","courier_assigned","out_for_delivery","delivered"];
const labels={new:"Pedido recibido",accepted:"Pedido aceptado",preparing:"En preparación",ready:"Listo para recoger",delivery_requested:"Buscando repartidor",courier_assigned:"Repartidor asignado",out_for_delivery:"En camino",delivered:"Entregado",cancelled:"Cancelado"};
let timer;
async function load(){
  try{
    if(!id||!/^\d+$/.test(id))throw new Error("Indica un número de pedido válido");
    const order=await customer.api(`/api/customer/orders/${id}`);
    document.querySelector("#title").textContent="Pedido #"+order.id;
    document.querySelector("#status").textContent=labels[order.status]||order.status;
    const progress=document.querySelector("#progress");
    progress.hidden=order.status==="cancelled";
    progress.value=Math.max(0,stages.indexOf(order.status));
    document.querySelector("#detail").textContent=`Total ${(order.total_cents/100).toFixed(2)} €${order.provider==="mock"?" · Reparto simulado":""}`;
    document.querySelector("#trackingError").textContent="";
    document.querySelector("#orderItems").innerHTML=order.items.map(i=>`<li>${i.quantity} x ${customer.escape(i.product_name)} - ${(i.quantity*i.unit_price_cents/100).toFixed(2)} EUR</li>`).join("");
    document.querySelector("#orderAddress").textContent=order.delivery_address;
    if(["delivered","cancelled"].includes(order.status))clearInterval(timer);
  }catch(error){document.querySelector("#trackingError").textContent=error.message}
}
if(!customer.token())customer.login();else{timer=setInterval(load,5000);load();}
