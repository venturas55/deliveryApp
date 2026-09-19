window.customer={
  token:()=>localStorage.getItem("pizzeria_customer_token"),
  escape:value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),
  labels:{new:"Recibido",accepted:"Aceptado",preparing:"En preparación",ready:"Listo",delivery_requested:"Buscando repartidor",courier_assigned:"Repartidor asignado",out_for_delivery:"En camino",delivered:"Entregado",cancelled:"Cancelado"},
  login(){location.assign("/client/login?next="+encodeURIComponent(location.pathname+location.search))},
  async api(url,options={}){
    const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(this.token()?{Authorization:"Bearer "+this.token()}:{})}});
    if(response.status===401){localStorage.removeItem("pizzeria_customer_token");this.login();throw new Error("Inicia sesión para continuar")}
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"No se pudo completar la operación");
    return data;
  }
};
document.querySelector("#customerLoginLink").hidden=!!customer.token();
document.querySelector("#customerLogout").hidden=!customer.token();
document.querySelector("#customerLogout").onclick=()=>{
  localStorage.removeItem("pizzeria_customer_token");
  sessionStorage.removeItem("customer_checkout");
  sessionStorage.removeItem("customer_cart");
  location.assign("/");
};
