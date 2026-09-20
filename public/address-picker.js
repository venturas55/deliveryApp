document.querySelectorAll("[data-address-picker]").forEach(picker=>{
  const search=picker.querySelector("[data-address-search]"),suggestions=picker.querySelector("[data-address-suggestions]"),dataInput=picker.querySelector("[data-address-data]"),confirmation=picker.querySelector("[data-address-confirmation]"),street=picker.querySelector("[data-address-street]"),formatted=picker.querySelector("[data-address-formatted]"),location=picker.querySelector("[data-address-location]"),confirmButton=picker.querySelector("[data-address-confirm]");
  let timer,request;
  function showAddress(address){
    const selected={...address,formatted_address:address.formatted_address||"",street:address.street||"",number:address.number||"",city:address.city||"",province:address.province||"",postal_code:address.postal_code||"",country:address.country||"",place_id:address.place_id||""};
    if(!selected.formatted_address||!selected.place_id)return;
    dataInput.value=JSON.stringify(selected);picker.dataset.selected="true";search.setCustomValidity("");search.value=selected.formatted_address;street.textContent=[selected.street,selected.number].filter(Boolean).join(" ");formatted.textContent=selected.formatted_address;location.textContent=[selected.city,selected.province,selected.postal_code,selected.country].filter(Boolean).join(" · ");confirmButton.textContent="Dirección seleccionada";confirmation.hidden=false;suggestions.hidden=true;
  }
  function render(items){
    suggestions.replaceChildren();
    const validItems=(Array.isArray(items)?items:[]).filter(item=>item&&item.formatted_address&&item.place_id);
    validItems.forEach((item,index)=>{const button=document.createElement("button");button.type="button";button.className="address-suggestion";button.dataset.addressIndex=String(index);button.textContent=item.formatted_address;suggestions.append(button)});
    suggestions.hidden=!validItems.length;
    suggestions._items=validItems;
  }
  suggestions.addEventListener("click",event=>{const button=event.target.closest("[data-address-index]");if(!button)return;const item=suggestions._items?.[Number(button.dataset.addressIndex)];if(item)showAddress(item)});
  search.addEventListener("input",()=>{
    dataInput.value="";picker.dataset.selected="false";confirmation.hidden=true;clearTimeout(timer);if(request)request.abort();
    if(search.value.trim().length<3){suggestions.hidden=true;return}
    timer=setTimeout(async()=>{request=new AbortController();try{const response=await fetch(`${picker.dataset.searchUrl}?q=${encodeURIComponent(search.value)}`,{signal:request.signal});if(!response.ok)throw new Error();render(await response.json())}catch(error){if(error.name!=="AbortError")render([])}},250);
  });
  const form=picker.closest("form");
  form?.addEventListener("submit",event=>{
    let selected=false;try{const value=JSON.parse(dataInput.value||"null");selected=!!value?.formatted_address&&!!value?.place_id&&Number.isFinite(Number(value.latitude))&&Number.isFinite(Number(value.longitude))}catch{}
    if(!selected){event.preventDefault();picker.dataset.selected="false";search.setCustomValidity("Selecciona una dirección de las sugerencias");search.reportValidity()}else{picker.dataset.selected="true";search.setCustomValidity("")}
  });
  confirmButton?.addEventListener("click",()=>{if(dataInput.value)picker.dataset.selected="true"});
  if(dataInput.value&&dataInput.value!=="{}"){try{showAddress(JSON.parse(dataInput.value))}catch{dataInput.value="";picker.dataset.selected="false"}}
});