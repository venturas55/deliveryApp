const form=document.querySelector("#accountForm"),fields=document.querySelector("#accountFields"),message=document.querySelector("#accountMessage");
async function load(){
  try{
    const profile=await customer.api("/api/customer-auth/me");
    document.querySelector("#accountEmail").value=profile.email;
    for(const name of ["name","phone","delivery_address","delivery_notes"])form.elements[name].value=profile[name]||"";
    fields.disabled=false;
  }catch(error){message.textContent=error.message}
}
form.onsubmit=async event=>{
  event.preventDefault();const body=Object.fromEntries(new FormData(form));fields.disabled=true;
  try{
    await customer.api("/api/customer-auth/me",{method:"PATCH",body:JSON.stringify(body)});
    sessionStorage.removeItem("customer_checkout");
    message.textContent="Datos guardados. Se usarán en tus próximos pedidos.";
  }catch(error){message.textContent=error.message}finally{fields.disabled=false}
};
if(!customer.token())customer.login();else load();
