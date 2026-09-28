const dialog = document.querySelector(".stats-day-dialog");
if (dialog) {
  const title = dialog.querySelector("#stats-day-dialog-title");
  const content = dialog.querySelector(".stats-day-dialog-content");
  const close = dialog.querySelector(".stats-day-dialog-close");

  document.querySelectorAll(".stats-day-button").forEach((button) => {
    button.addEventListener("click", () => {
      const template = document.getElementById(`hours-${button.dataset.day}`);
      if (!template) return;
      title.textContent = `Pedidos por hora · ${button.querySelector(".stats-bar-label").textContent}`;
      content.replaceChildren(template.content.cloneNode(true));
      dialog.showModal();
    });
  });

  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
