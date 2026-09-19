let data,cart=[];
try{cart=JSON.parse(sessionStorage.getItem("customer_cart")||"[]");if(!Array.isArray(cart))cart=[]}catch{cart=[]}
let profile=null;
async function fillCheckout(){
  const fields=document.querySelector("#checkout").elements;
  if(customer.token()){
    profile=await customer.api("/api/customer-auth/me");
    fields.customer_name.value=profile.name||"";
    fields.customer_phone.value=profile.phone||"";
    fields.delivery_address.value=profile.delivery_address||"";
    fields.delivery_notes.value=profile.delivery_notes||"";
  }
  try{const saved=JSON.parse(sessionStorage.getItem("customer_checkout")||"{}");for(const [key,value] of Object.entries(saved)){const field=fields.namedItem(key);if(field&&value)field.value=value}}catch{}
}


const euro=c=>(c/100).toFixed(2)+" €";
async function init(){await fillCheckout();data=await fetch("/api/public/menu?slug=demo").then(r=>r.json());document.querySelector("#brand").textContent="🍕 "+data.restaurant.name;cart=cart.filter(i=>i&&Number.isInteger(i.quantity)&&i.quantity>0&&data.products.some(p=>p.id===i.product_id));render();}
function render(){
 sessionStorage.setItem("customer_cart",JSON.stringify(cart));
 const groups=Object.create(null);data.products.forEach(p=>(groups[p.category]??=[]).push(p));
 document.querySelector("#menu").innerHTML=Object.entries(groups).map(([cat,ps])=>`<h2>${customer.escape(cat)}</h2>`+ps.map(p=>`<article><div><h3>${customer.escape(p.name)}</h3><p>${customer.escape(p.description||"")}</p></div><strong>${euro(p.price_cents)}</strong><button onclick="add(${p.id})">Añadir</button></article>`).join("")).join("");
 const subtotal=cart.reduce((s,i)=>s+data.products.find(p=>p.id===i.product_id).price_cents*i.quantity,0);
 const delivery=subtotal>=3000?0:399,total=subtotal+delivery;
 document.querySelector("#cart").innerHTML=cart.length?cart.map(i=>{let p=data.products.find(p=>p.id===i.product_id);return `<div class="line"><span>${customer.escape(p.name)} × ${i.quantity}</span><span><button onclick="dec(${p.id})">−</button><button onclick="add(${p.id})">+</button></span></div>`}).join("")+`<hr><div>Envío: ${euro(delivery)}</div><b>Total: ${euro(total)}</b>`:"<p>Tu carrito está vacío.</p>";
}
function add(id){let x=cart.find(i=>i.product_id===id);x?x.quantity++:cart.push({product_id:id,quantity:1});render()}
function dec(id){let x=cart.find(i=>i.product_id===id);if(!x)return;x.quantity--;if(x.quantity<=0)cart=cart.filter(i=>i.product_id!==id);render()}
checkout.onsubmit=async e=>{e.preventDefault();if(!cart.length)return alert("Añade productos");const body=Object.fromEntries(new FormData(e.target));body.items=cart;body.slug="demo";sessionStorage.setItem("customer_checkout",JSON.stringify(Object.fromEntries(new FormData(e.target))));
if(!customer.token()){customer.login();return;}
const button=e.target.querySelector("button");button.disabled=true;
try{
const d=await customer.api("/api/orders",{method:"POST",body:JSON.stringify(body)});document.querySelector("#result").innerHTML=`<div class="success">Pedido <b>#${d.id}</b> recibido.<br>Total: ${euro(d.total_cents)}<br><a href="/tracking.html?id=${d.id}">Seguir pedido</a></div>`;cart=[];sessionStorage.removeItem("customer_checkout");e.target.reset();await fillCheckout();render();
}catch(error){alert(error.message)}finally{button.disabled=false}};init().catch(error=>{document.querySelector("#menu").textContent="No se pudo cargar la carta"});