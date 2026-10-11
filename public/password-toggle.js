document.querySelectorAll(".password-toggle").forEach((button) => {
  const input = document.getElementById(button.getAttribute("aria-controls"));
  if (!input) return;
  button.addEventListener("click", () => {
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    const label = visible ? "Ocultar contraseña" : "Mostrar contraseña";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-pressed", String(visible));
  });
});
