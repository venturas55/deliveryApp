const token=localStorage.getItem("pizzeria_token");
const form=document.querySelector("#productForm");
const message=document.querySelector("#productMessage");
let products=[],editingId=null,busy=false;
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const euro=value=>(value/100).toFixed(2)+" €";
async function api(path="",options={}){
  const response=await fetch("/api/admin/products"+path,{...options,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token}});
  if(response.status===401){localStorage.removeItem("pizzeria_token");location.replace("/admin.html");throw new Error("Inicia sesión para gestionar la carta");}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"No se pudo completar la operación");
  return data;
}
async function load(){
  products=await api();
  document.querySelector("#products").innerHTML=products.map(p=>`<article class="order-card"><h3>${escape(p.name)} · ${euro(p.price_cents)}</h3><p>${escape(p.category)} · ${p.active?"Disponible":"Oculto"} · Orden: ${p.sort_order}</p><p>${escape(p.description)}</p><div class="order-actions"><button data-action="edit" data-id="${p.id}">Editar</button><button data-action="toggle" data-id="${p.id}">${p.active?"Ocultar":"Publicar"}</button><button data-action="delete" data-id="${p.id}">Eliminar</button></div></article>`).join("")||"<p>No hay artículos. Crea el primero con el formulario.</p>";
}
function reset(){editingId=null;form.reset();document.querySelector("#editorTitle").textContent="Nuevo artículo";}
async function operation(fn){
  if(busy)return;
  busy=true;message.textContent="";
  document.querySelector("#productFields").disabled=true;
  document.querySelectorAll("button").forEach(b=>b.disabled=true);
  try{await fn()}catch(error){message.textContent=error.message}
  finally{busy=false;document.querySelector("#productFields").disabled=false;document.querySelectorAll("button").forEach(b=>b.disabled=false)}
}
document.querySelector("#newProduct").onclick=()=>{if(!busy){reset();form.elements.name.focus()}};
document.querySelector("#cancelEdit").onclick=()=>{if(!busy)reset()};
document.querySelector("#products").onclick=event=>{
  const button=event.target.closest("button[data-action]");
  if(!button||busy)return;
  const product=products.find(p=>String(p.id)===button.dataset.id);
  if(!product)return;
  const action=button.dataset.action;
  if(action==="edit"){
    editingId=product.id;
    for(const key of ["name","description","category","sort_order"])form.elements[key].value=product[key]??"";
    form.elements.price.value=(product.price_cents/100).toFixed(2);
    form.elements.active.checked=!!product.active;
    document.querySelector("#editorTitle").textContent="Editar artículo";
    form.elements.name.focus();return;
  }
  if(action==="delete"&&!confirm(`¿Eliminar «${product.name}» de la carta? Los pedidos anteriores conservarán sus datos.`))return;
  operation(async()=>{
    await api("/"+product.id,action==="delete"?{method:"DELETE"}:{method:"PATCH",body:JSON.stringify({active:product.active?0:1})});
    if(editingId===product.id)reset();
    await load();message.textContent=action==="delete"?"Artículo eliminado.":"Disponibilidad actualizada.";
  });
};
form.onsubmit=event=>{
  event.preventDefault();
  const fields=form.elements;
  const payload={name:fields.name.value.trim(),description:fields.description.value.trim(),category:fields.category.value.trim(),price_cents:Math.round(Number(fields.price.value)*100),sort_order:Number(fields.sort_order.value),active:fields.active.checked?1:0};
  operation(async()=>{
    await api(editingId===null?"":"/"+editingId,{method:editingId===null?"POST":"PATCH",body:JSON.stringify(payload)});
    reset();await load();message.textContent="Artículo guardado.";
  });
};
if(!token)location.replace("/admin.html");else operation(load);
