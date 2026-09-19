let loading=false;
async function load(){
  if(loading)return;loading=true;
  const filter=document.querySelector("#customerOrderFilter").value;
  try{
    const orders=await customer.api("/api/customer/orders?filter="+filter);
    if(filter!==document.querySelector("#customerOrderFilter").value)return;
    document.querySelector("#customerOrders").innerHTML=orders.map(o=>`<article class="order-card"><h3>Pedido #${o.id} · ${customer.escape(customer.labels[o.status])}</h3><p>${customer.escape(new Date(o.created_at).toLocaleString())} · ${(o.total_cents/100).toFixed(2)} €</p><a href="/tracking?id=${o.id}">Ver detalle y seguimiento</a></article>`).join("")||"<p>No tienes pedidos en esta sección.</p>";
    document.querySelector("#customerOrdersError").textContent="";
  }catch(error){document.querySelector("#customerOrdersError").textContent=error.message}
  finally{loading=false;if(filter!==document.querySelector("#customerOrderFilter").value)load()}
}
document.querySelector("#customerOrderFilter").onchange=load;
if(!customer.token())customer.login();else{load();setInterval(load,5000)}
