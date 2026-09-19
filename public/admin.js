let token=localStorage.getItem("pizzeria_token");
const euro=c=>(c/100).toFixed(2)+" €";
const labels={new:"Recibido",accepted:"Aceptado",preparing:"En preparación",ready:"Listo para recoger",delivery_requested:"Buscando repartidor",courier_assigned:"Repartidor asignado",out_for_delivery:"En camino",delivered:"Entregado",cancelled:"Cancelado"};
const kitchen={new:["accepted","Aceptar pedido"],accepted:["preparing","Preparar pedido"],preparing:["ready","Marcar listo"]};
const simulation={delivery_requested:["courier_assigned","Simular asignación"],courier_assigned:["out_for_delivery","Simular recogida"],out_for_delivery:["delivered","Simular entrega"]};
const quotes=new Map();
let busy=false,loading=false,detailId=null;
let orderFilter="all";
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})}});
  if(response.status===401&&token){logout();throw new Error("La sesión ha caducado");}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"No se pudo completar la operación");
  return data;
}
document.querySelector("#login").onsubmit=async event=>{
  event.preventDefault();
  const button=event.target.querySelector("button");button.disabled=true;
  try{
    const data=await api("/api/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
    localStorage.setItem("pizzeria_token",data.token);location.reload();
  }catch(error){alert(error.message)}finally{button.disabled=false}
};
function button(action,id,label,status=""){
  return `<button data-action="${action}" data-id="${id}" data-status="${status}" ${busy?"disabled":""}>${label}</button>`;
}
async function loadOrders(){
  if(loading)return;
  loading=true;
  const requestedFilter=orderFilter;
  try{
    const orders=await api("/api/admin/orders?filter="+encodeURIComponent(requestedFilter));
    if(requestedFilter!==orderFilter)return;
    document.querySelector("#orderCount").textContent=`${orders.length} pedidos mostrados (máximo 200 por filtro)`;
    document.querySelector("#orders").innerHTML=orders.map(order=>{
      const id=order.id,next=kitchen[order.status],step=simulation[order.status];
      const quote=quotes.get(String(id));
      let actions=next?button("status",id,next[1],next[0]):"";
      if(["new","accepted","preparing","ready"].includes(order.status))actions+=button("status",id,"Cancelar","cancelled");
      if(order.status==="ready"){
        actions+=button("quote",id,"Consultar reparto");
        if(quote&&quote.expiresAt>Date.now())actions+=`<p>${escape(quote.provider==="mock"?"Reparto simulado":quote.provider)}: ${euro(quote.feeCents)} · ${quote.etaMinutes??"—"} min estimados. Oferta válida 5 minutos.</p>`+button("dispatch",id,"Confirmar reparto");
      }
      if(order.provider==="mock"&&step)actions+=button("simulate",id,step[1],step[0]);
      return `<article class="order-card"><h3>Pedido #${id} · ${escape(labels[order.status]||order.status)}</h3><p><strong>${escape(order.customer_name)}</strong> · ${escape(order.customer_phone)}<br>${escape(order.delivery_address)}</p>${order.delivery_notes?`<p>Notas: ${escape(order.delivery_notes)}</p>`:""}<p><strong>${euro(order.total_cents)}</strong> · ${escape(new Date(order.created_at).toLocaleString())}</p>${order.provider?`<p>${order.provider==="mock"?"Reparto simulado":escape(order.provider)} · ${escape(order.provider_status)}</p>`:""}<div class="order-actions">${actions}${button("detail",id,"Productos e historial")}</div></article>`;
    }).join("")||"<p>No hay pedidos para este filtro.</p>";
    document.querySelector("#adminError").textContent="";
  }catch(error){document.querySelector("#adminError").textContent=error.message}
  finally{loading=false;if(requestedFilter!==orderFilter)loadOrders()}
}
async function showDetail(id){
  const order=await api(`/api/admin/orders/${id}`);
  detailId=id;
  const events={"order.created":"Pedido recibido","status.changed":"Cambio de estado","delivery.quoted":"Precio de reparto consultado","delivery.requested":"Reparto solicitado","delivery.updated":"Actualización del reparto"};
  document.querySelector("#orderDetail").innerHTML=`<h2>Pedido #${order.id}</h2><ul>${order.items.map(item=>`<li>${item.quantity} × ${escape(item.product_name)} — ${euro(item.quantity*item.unit_price_cents)}</li>`).join("")}</ul><h3>Historial</h3><ol>${order.events.map(event=>{
    const payload=JSON.parse(event.payload_json||"{}");
    return `<li>${escape(new Date(event.created_at).toLocaleString())} — ${escape(events[event.event_type]||event.event_type)}${payload.status?": "+escape(labels[payload.status]||payload.status):""}${payload.feeCents!==undefined?" · "+euro(payload.feeCents):""}</li>`;
  }).join("")}</ol>`;
}
async function handleAction(event){
  const target=event.target.closest("button[data-action]");
  if(!target||busy)return;
  const {action,id,status}=target.dataset;
  if(status==="cancelled"&&!confirm(`¿Cancelar el pedido #${id}?`))return;
  busy=true;
  document.querySelectorAll("#orders button").forEach(button=>button.disabled=true);
  try{
    if(action==="detail")await showDetail(id);
    else{
      const base=`/api/admin/orders/${id}`;
      if(action==="status")await api(base+"/status",{method:"PATCH",body:JSON.stringify({status})});
      if(action==="quote")quotes.set(id,await api(base+"/delivery/quote",{method:"POST"}));
      if(action==="dispatch"){
        await api(base+"/delivery",{method:"POST",body:JSON.stringify({quote:{quoteId:quotes.get(id)?.quoteId}})});
        quotes.delete(id);
      }
      if(action==="simulate")await api(base+"/delivery/simulate",{method:"POST",body:JSON.stringify({status})});
      if(detailId===id)await showDetail(id);
    }
  }catch(error){alert(error.message)}
  finally{busy=false;await loadOrders()}
}
function logout(){localStorage.removeItem("pizzeria_token");location.reload()}
if(token){
  document.querySelector("#adminMain").replaceChildren(document.querySelector("#ordersView").content.cloneNode(true));
  document.querySelector("#orders").onclick=handleAction;
  const filterSelect=document.querySelector("#orderFilter");
  const savedFilter=sessionStorage.getItem("pizzeria_order_filter");
  if([...filterSelect.options].some(option=>option.value===savedFilter))orderFilter=savedFilter;
  filterSelect.value=orderFilter;
  filterSelect.onchange=()=>{
    orderFilter=filterSelect.value;
    sessionStorage.setItem("pizzeria_order_filter",orderFilter);
    document.querySelector("#orders").textContent="Cargando pedidos…";
    document.querySelector("#orderCount").textContent="";
    loadOrders();
  };
  loadOrders();
  setInterval(()=>{if(!busy)loadOrders()},5000);
}
