// Progressive enhancement only: no data loading or HTML generation.
let submitting=false,dirty=false;
document.addEventListener("input",()=>{dirty=true});
document.addEventListener("change",()=>{dirty=true});
document.addEventListener("submit",event=>{
  const form=event.target;
  if(form.dataset.confirm&&!confirm(form.dataset.confirm)){event.preventDefault();return;}
  if(form.method.toLowerCase()!=="post")return;
  if(submitting){event.preventDefault();return;}
  submitting=true;
});
if(document.body.dataset.refresh)setInterval(()=>{
  if(!dirty&&!submitting&&!document.hidden&&!document.activeElement?.closest("form"))location.reload();
},Number(document.body.dataset.refresh));
window.addEventListener("pageshow",()=>{submitting=false});

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
