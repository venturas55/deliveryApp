(() => {
  const panel=document.querySelector("[data-order-sound]");
  if(!panel)return;
  const button=panel.querySelector("[data-sound-toggle]");
  const status=panel.querySelector("[data-sound-status]");
  let latest=BigInt(panel.dataset.latestOrder||"0"),context,enabled=false,busy=false,stopped=false;
  function sync(){
    button.textContent=enabled?"Silenciar avisos":"Activar sonido";
    button.setAttribute("aria-pressed",String(enabled));
  }
  function chime(){
    if(context?.state!=="running")return false;
    [660,880,1100].forEach((frequency,index)=>{
      const oscillator=context.createOscillator(),gain=context.createGain();
      const start=context.currentTime+index*0.2;
      oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime(0.15,start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,start+0.18);
      oscillator.connect(gain);gain.connect(context.destination);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      oscillator.start(start);oscillator.stop(start+0.2);
    });
    return true;
  }
  button.addEventListener("click",async()=>{
    if(enabled){enabled=false;sync();status.textContent="Avisos silenciados.";return;}
    button.disabled=true;
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw new Error("unsupported");
      context??=new Audio();
      await context.resume();
      if(!chime())throw new Error("blocked");
      enabled=true;sync();status.textContent="Sonido activado. Esperando nuevos pedidos.";
    }catch{status.textContent="No se pudo activar el sonido. Revisa los permisos de audio del navegador.";}
    finally{button.disabled=false;}
  });
  async function poll(){
    if(busy||stopped)return;
    busy=true;
    try{
      const response=await fetch("/admin/order-notifications",{cache:"no-store",signal:AbortSignal.timeout(10000)});
      if(response.redirected||response.status===401||response.status===403){
        stopped=true;enabled=false;button.disabled=true;sync();
        status.textContent="Sesión caducada. Vuelve a iniciar sesión para recibir avisos.";return;
      }
      if(!response.ok)throw new Error("request");
      const data=await response.json();
      if(!/^\d+$/.test(data.latestOrderId))throw new Error("invalid");
      const current=BigInt(data.latestOrderId);
      if(current>latest){
        latest=current;
        status.textContent="Nuevo pedido recibido: #"+current+".";
        if(enabled&&!chime()){
          enabled=false;sync();status.textContent+=" Pulsa Activar sonido para reanudar los avisos.";
        }
      }
    }catch{status.textContent="Sin conexión con pedidos. Reintentando automáticamente…";}
    finally{busy=false;}
  }
  setInterval(poll,5000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll();});
})();
