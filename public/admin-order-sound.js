(() => {
  const panel=document.querySelector("[data-order-sound]");
  if(!panel)return;
  const button=panel.querySelector("[data-sound-toggle]");
  const status=panel.querySelector("[data-sound-status]");
  const initial=JSON.parse(panel.dataset.notificationSnapshot);
  const seen=new Set(initial.events.map(event=>event.kind+":"+event.id));
  const endpoint="/admin/order-notifications?"+new URLSearchParams(initial.cursor);
  let context,enabled=true,busy=false,stopped=false;
  const pending=[];
  function sync(){
    button.textContent=enabled?"Silenciar avisos":"Activar sonido";
    button.setAttribute("aria-pressed",String(enabled));
  }
  function chime(kind="cash",delay=0){
    if(context?.state!=="running")return false;
    (kind==="card"?[1100,880,1100,1320]:[660,880,1100]).forEach((frequency,index)=>{
      const oscillator=context.createOscillator(),gain=context.createGain();
      const start=context.currentTime+delay+index*0.2;
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
  async function unlock(){
    if(!enabled||stopped)return;
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw new Error("unsupported");
      context??=new Audio();
      if(context.state!=="running")status.textContent="Sonido activo. Haz clic en la página para permitir el audio.";
      await context.resume();
      if(!enabled||stopped||context.state!=="running")return;
      pending.splice(0).forEach((kind,index)=>chime(kind,index));
      status.textContent="Sonido activado. Esperando nuevos pedidos.";
    }catch{status.textContent="No se pudo activar el sonido. Revisa los permisos de audio del navegador.";}
  }
  button.addEventListener("click",()=>{
    enabled=!enabled;sync();
    if(!enabled){pending.length=0;status.textContent="Avisos silenciados.";return;}
    unlock();
  });
  for(const event of ["click","keydown"])document.addEventListener(event,()=>{
    if(enabled&&context?.state!=="running")unlock();
  });
  sync();
  unlock();
  async function poll(){
    if(busy||stopped)return;
    busy=true;
    try{
      const response=await fetch(endpoint,{cache:"no-store",signal:AbortSignal.timeout(10000)});
      if(response.redirected||response.status===401||response.status===403){
        stopped=true;enabled=false;pending.length=0;button.disabled=true;sync();
        status.textContent="Sesión caducada. Vuelve a iniciar sesión para recibir avisos.";return;
      }
      if(!response.ok)throw new Error("request");
      const data=await response.json();
      if(!Array.isArray(data.events)||data.events.some(event=>!/^\d+$/.test(event.id)||!["cash","card"].includes(event.kind)))throw new Error("invalid");
      let delay=0;
      for(const event of data.events){
        const key=event.kind+":"+event.id;
        if(seen.has(key))continue;
        seen.add(key);
        status.textContent=(event.kind==="cash"?"Nuevo pedido en efectivo: #":"Pago con tarjeta confirmado: #")+event.id+".";
        if(enabled&&!chime(event.kind,delay)){
          pending.push(event.kind);status.textContent+=" Haz clic en la página para permitir el audio.";
        }
        delay+=1;
      }
    }catch{status.textContent="Sin conexión con pedidos. Reintentando automáticamente…";}
    finally{busy=false;}
  }
  setInterval(poll,5000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll();});
})();
