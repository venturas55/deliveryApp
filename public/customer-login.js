const message=document.querySelector("#loginMessage");
let submitting=false;
function finish(data){
  localStorage.setItem("pizzeria_customer_token",data.token);
  const next=new URLSearchParams(location.search).get("next")||"/client/orders";
  const destination=new URL(next,location.origin);
  location.assign(destination.origin===location.origin?destination.pathname+destination.search:"/client/orders");
}
async function submit(path,body){
  if(submitting)return;
  submitting=true;message.textContent="";
  document.querySelectorAll("form button").forEach(b=>b.disabled=true);
  try{
    const response=await fetch("/api/customer-auth/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error);finish(data);
  }catch(error){message.textContent=error.message}
  finally{submitting=false;document.querySelectorAll("form button").forEach(b=>b.disabled=false)}
}
for(const [id,path] of [["customerLogin","login"],["customerRegister","register"]])document.getElementById(id).onsubmit=event=>{
  event.preventDefault();submit(path,Object.fromEntries(new FormData(event.target)));
};
async function googleLogin(){
  try{
    const response=await fetch("/api/customer-auth/google/config");
    if(!response.ok)throw new Error();
    const config=await response.json();if(!config.enabled)return;
    const script=document.createElement("script");script.src="https://accounts.google.com/gsi/client";script.async=true;
    script.onload=()=>{
      google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,callback:result=>submit("google",{credential:result.credential})});
      google.accounts.id.renderButton(document.querySelector("#googleButton"),{theme:"outline",size:"large",text:"continue_with"});
    };
    script.onerror=()=>{document.querySelector("#googleMessage").textContent="Google no está disponible. Puedes usar email y contraseña."};
    document.head.append(script);
  }catch{document.querySelector("#googleMessage").textContent="No se pudo cargar el acceso con Google."}
}
googleLogin();
