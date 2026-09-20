// Google Identity Services requires its browser SDK. All app views remain server-rendered.
(async()=>{
  const container=document.querySelector("#googleButton"),message=document.querySelector("#googleMessage");
  if(!container)return;
  try{
    const response=await fetch("/api/customer-auth/google/config");
    const config=await response.json();if(!response.ok||!config.enabled)throw new Error("Google no está disponible.");
    const script=document.createElement("script");script.src="https://accounts.google.com/gsi/client";script.async=true;
    script.onerror=()=>{message.textContent="No se pudo cargar Google. Usa email y contraseña."};
    script.onload=()=>{
      google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,callback:async result=>{
        try{
          const response=await fetch("/api/customer-auth/google",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential:result.credential})});
          const data=await response.json();if(!response.ok)throw new Error(data.error);
          const next=new URL(container.dataset.next||"/client/orders",location.origin);
          location.assign(next.origin===location.origin?next.pathname+next.search:"/client/orders");
        }catch(error){message.textContent=error.message}
      }});
      google.accounts.id.renderButton(container,{theme:"outline",size:"large",text:"continue_with"});
    };
    document.head.append(script);
  }catch(error){message.textContent=error.message}
})();
