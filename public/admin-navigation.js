(() => {
  const navigation=document.querySelector(".admin-navigation");
  if(localStorage.getItem("pizzeria_token"))navigation.hidden=false;
  document.querySelector("#adminLogout").onclick=()=>{
    localStorage.removeItem("pizzeria_token");
    location.assign("/admin.html");
  };
})();
