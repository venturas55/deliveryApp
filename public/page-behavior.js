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
