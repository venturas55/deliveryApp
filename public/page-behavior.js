// Progressive enhancement only: no data loading or HTML generation.
let submitting=false,dirty=false;
document.querySelectorAll("[data-theme-toggle]").forEach(button=>{
  const sync=()=>{
    const dark=document.documentElement.dataset.theme==="dark";
    button.textContent=dark?"Usar tema claro":"Usar tema oscuro";
    button.setAttribute("aria-pressed",String(dark));
  };
  sync();
  button.addEventListener("click",()=>{
    const theme=document.documentElement.dataset.theme==="dark"?"light":"dark";
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem("delivery-theme",theme)}catch{}
    sync();
  });
});
document.addEventListener("input",()=>{dirty=true});
document.addEventListener("change",()=>{dirty=true});
document.addEventListener("submit",event=>{
  const form=event.target;
  if(form.dataset.confirm&&!confirm(form.dataset.confirm)){event.preventDefault();return;}
  if(form.method.toLowerCase()!=="post")return;
  if(submitting){event.preventDefault();return;}
  submitting=true;
});
let refreshingOrders=false;
if(document.body.dataset.refresh)setInterval(async()=>{
  if(dirty||submitting||document.hidden||document.activeElement?.closest("form"))return;
  if(document.querySelector("[data-order-sound]")){
    if(refreshingOrders)return;
    refreshingOrders=true;
    try{
      const response=await fetch(location.href,{cache:"no-store",signal:AbortSignal.timeout(10000)});
      if(!response.ok||response.redirected)return;
      const page=new DOMParser().parseFromString(await response.text(),"text/html");
      const updated=page.querySelector("#adminMain");
      if(updated&&!dirty&&!submitting&&!document.activeElement?.closest("form"))document.querySelector("#adminMain")?.replaceWith(updated);
    }catch{}finally{refreshingOrders=false;}
  }else location.reload();
},Number(document.body.dataset.refresh));
window.addEventListener("pageshow",()=>{submitting=false});

const externalConsent=document.querySelector("[data-external-consent]");
const googleMaps=[...document.querySelectorAll("[data-google-map]")];
const googleLoginEnabled=document.body.dataset.googleEnabled==="true";
const consentKey="delivery-google-services-consent";
const googleConsentNote=document.querySelector("[data-google-consent-note]");

function activateGoogleMaps(){
  googleMaps.forEach(map=>{
    if(map.querySelector("iframe"))return;
    const iframe=document.createElement("iframe");
    iframe.src=map.dataset.mapUrl;
    iframe.title=map.dataset.mapTitle;
    iframe.loading="lazy";
    iframe.referrerPolicy="strict-origin-when-cross-origin";
    iframe.allowFullscreen=true;
    map.replaceChildren(iframe);
  });
}

function activateGoogleLogin(){
  if(!googleLoginEnabled||document.querySelector("[data-google-login-loader]"))return;
  const script=document.createElement("script");
  script.src="/google-login.js";
  script.dataset.googleLoginLoader="true";
  document.body.append(script);
}

function applyGoogleConsent(accepted){
  if(googleConsentNote)googleConsentNote.hidden=accepted;
  if(accepted){
    activateGoogleMaps();
    activateGoogleLogin();
  }else{
    googleMaps.forEach(map=>{
      const message=document.createElement("p");
      message.textContent="El mapa externo está desactivado.";
      const button=document.createElement("button");
      button.type="button";
      button.textContent="Configurar cookies";
      button.dataset.cookieSettings="true";
      map.replaceChildren(message,button);
    });
  }
}

if(externalConsent){
  let choice="";
  try{choice=localStorage.getItem(consentKey)||""}catch{}
  if(choice==="accepted")applyGoogleConsent(true);
  else if(choice==="rejected")applyGoogleConsent(false);
  else if(googleMaps.length||googleLoginEnabled)externalConsent.hidden=false;

  externalConsent.querySelectorAll("[data-consent-choice]").forEach(button=>{
    button.addEventListener("click",()=>{
      const accepted=button.dataset.consentChoice==="accept";
      let previousChoice="";
      try{previousChoice=localStorage.getItem(consentKey)||""}catch{}
      try{localStorage.setItem(consentKey,accepted?"accepted":"rejected")}catch{}
      externalConsent.hidden=true;
      if(!accepted&&previousChoice==="accepted"){
        location.reload();
        return;
      }
      applyGoogleConsent(accepted);
    });
  });
}

document.addEventListener("click",event=>{
  if(!event.target.closest("[data-cookie-settings]"))return;
  event.preventDefault();
  if(externalConsent)externalConsent.hidden=false;
});

document.querySelectorAll("[data-delivery-method]").forEach(select=>{
  const addressBlock=select.closest("form")?.querySelector("[data-delivery-address]");
  const fields=addressBlock?.querySelectorAll("input,select,textarea");
  const sync=()=>{
    const pickup=select.value==="pickup";
    if(addressBlock)addressBlock.hidden=pickup;
    fields?.forEach(field=>{if(!field.dataset.keepRequired)field.required=!pickup;});
  };
  select.addEventListener("change",sync);
  sync();
});

document.querySelectorAll("[data-provider-tabs]").forEach(container=>{
  const tabs=[...container.querySelectorAll("[data-provider-tab]")],panels=[...container.querySelectorAll("[data-provider-panel]")];
  function activate(provider){
    tabs.forEach(tab=>{const active=tab.dataset.providerTab===provider;tab.classList.toggle("is-active",active);tab.setAttribute("aria-selected",String(active))});
    panels.forEach(panel=>{const active=panel.dataset.providerPanel===provider;panel.classList.toggle("is-active",active);panel.hidden=!active});
  }
  tabs.forEach((tab,index)=>tab.addEventListener("click",()=>activate(tab.dataset.providerTab)));
  container.addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    const current=tabs.findIndex(tab=>tab.getAttribute("aria-selected")==="true");
    const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(current+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    event.preventDefault();tabs[next].focus();activate(tabs[next].dataset.providerTab);
  });
});

document.querySelectorAll("[data-print-pickup]").forEach(button=>button.addEventListener("click",()=>window.print()));
