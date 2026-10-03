(() => {
  const panel=document.querySelector("[data-order-sound]");
  if(!panel)return;
  const button=panel.querySelector("[data-sound-toggle]");
  const status=panel.querySelector("[data-sound-status]");
  const badge=document.querySelector("[data-order-notification-count]");
  const initial=JSON.parse(panel.dataset.notificationSnapshot);
  const storageKey="delivery-admin-order-notifications:"+panel.dataset.restaurantId;
  let saved;
  try{saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");}catch{}
  const cursor=saved?.cursor&&/^\d{1,20}$/.test(saved.cursor.afterId||"")&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(saved.cursor.since||"")?saved.cursor:initial.cursor;
  const seen=new Set(Array.isArray(saved?.seen)?saved.seen:[]);
  const unread=new Set(Array.isArray(saved?.unread)?saved.unread:[]);
  for(const event of initial.events)seen.add(event.kind+":"+event.id);
  if(location.pathname==="/admin/orders"||location.pathname.startsWith("/admin/orders/"))unread.clear();
  let context,enabled=saved?.enabled!==false,busy=false,stopped=false;
  const pending=Array.isArray(saved?.pending)?saved.pending.filter(kind=>kind==="cash"||kind==="card"):[];
  function sync(){
    button.textContent=enabled?"Silenciar avisos":"Activar sonido";
    button.setAttribute("aria-pressed",String(enabled));
    if(badge){
      const count=unread.size;
      badge.hidden=count===0;
      badge.textContent=count>99?"99+":String(count);
      badge.setAttribute("aria-label",count+" pedidos con novedad");
    }
  }
  function save(){
    try{sessionStorage.setItem(storageKey,JSON.stringify({cursor,seen:[...seen],unread:[...unread],enabled,pending}));}catch{}
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
      save();
      status.textContent="Sonido activado. Esperando nuevos pedidos.";
    }catch{status.textContent="No se pudo activar el sonido. Revisa los permisos de audio del navegador.";}
  }
  button.addEventListener("click",()=>{
    enabled=!enabled;sync();
    if(!enabled){pending.length=0;save();status.textContent="Avisos silenciados.";return;}
    save();
    unlock();
  });
  for(const event of ["click","keydown"])document.addEventListener(event,()=>{
    if(enabled&&context?.state!=="running")unlock();
  });
  sync();
  save();
  unlock();
  async function poll(){
    if(busy||stopped)return;
    busy=true;
    try{
      const endpoint="/admin/order-notifications?"+new URLSearchParams(cursor);
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
        unread.add(event.id);
        status.textContent=(event.kind==="cash"?"Nuevo pedido en efectivo: #":"Pago con tarjeta confirmado: #")+event.id+".";
        if(enabled&&!chime(event.kind,delay)){
          pending.push(event.kind);status.textContent+=" Haz clic en la página para permitir el audio.";
        }
        delay+=1;
      }
      for(const event of data.events)if(BigInt(event.id)>BigInt(cursor.afterId))cursor.afterId=event.id;
      sync();
      save();
    }catch{status.textContent="Sin conexión con pedidos. Reintentando automáticamente…";}
    finally{busy=false;}
  }
  setInterval(poll,5000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll();});
})();
