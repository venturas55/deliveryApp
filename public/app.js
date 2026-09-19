let data,cart=[];
const euro=c=>(c/100).toFixed(2)+" €";
async function init(){data=await fetch("/api/public/menu?slug=demo").then(r=>r.json());document.querySelector("#brand").textContent="🍕 "+data.restaurant.name;render();}
function render(){
 const groups={};data.products.forEach(p=>(groups[p.category]??=[]).push(p));
 document.querySelector("#menu").innerHTML=Object.entries(groups).map(([cat,ps])=>`<h2>${cat}</h2>`+ps.map(p=>`<article><div><h3>${p.name}</h3><p>${p.description||""}</p></div><strong>${euro(p.price_cents)}</strong><button onclick="add(${p.id})">Añadir</button></article>`).join("")).join("");
 const subtotal=cart.reduce((s,i)=>s+data.products.find(p=>p.id===i.product_id).price_cents*i.quantity,0);
 const delivery=subtotal>=3000?0:399,total=subtotal+delivery;
 document.querySelector("#cart").innerHTML=cart.length?cart.map(i=>{let p=data.products.find(p=>p.id===i.product_id);return `<div class="line"><span>${p.name} × ${i.quantity}</span><span><button onclick="dec(${p.id})">−</button><button onclick="add(${p.id})">+</button></span></div>`}).join("")+`<hr><div>Envío: ${euro(delivery)}</div><b>Total: ${euro(total)}</b>`:"<p>Tu carrito está vacío.</p>";
}
function add(id){let x=cart.find(i=>i.product_id===id);x?x.quantity++:cart.push({product_id:id,quantity:1});render()}
function dec(id){let x=cart.find(i=>i.product_id===id);if(!x)return;x.quantity--;if(x.quantity<=0)cart=cart.filter(i=>i.product_id!==id);render()}
checkout.onsubmit=async e=>{e.preventDefault();if(!cart.length)return alert("Añade productos");const body=Object.fromEntries(new FormData(e.target));body.items=cart;body.slug="demo";const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)return alert(d.error);document.querySelector("#result").innerHTML=`<div class="success">Pedido <b>#${d.id}</b> recibido.<br>Total: ${euro(d.total_cents)}<br><a href="/tracking.html?id=${d.id}">Seguir pedido</a></div>`;cart=[];e.target.reset();render()};init();