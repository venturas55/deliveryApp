const chart = document.getElementById("stats-hourly-chart");
const mode = document.getElementById("stats-hourly-mode");
const description = document.getElementById("stats-hourly-description");

if (chart && mode && description) {
  const accumulated = chart.cloneNode(true);
  const buttons = [...document.querySelectorAll(".stats-day-button")];
  const modeButtons = [...mode.querySelectorAll("button[data-mode]")];
  const dayOption = mode.querySelector('button[data-mode="day"]');
  let selectedButton = null;

  function renderChart() {
    const showDay = mode.dataset.mode === "day" && selectedButton;
    const template = showDay
      ? document.getElementById(`hours-${selectedButton.dataset.day}`)
      : null;
    if (showDay && !template) return;
    chart.replaceChildren(
      ...(template ? template.content : accumulated).cloneNode(true).childNodes,
    );
    description.textContent = showDay
      ? `Día ${selectedButton.dataset.day} · Intervalos de 1 hora`
      : "Totales acumulados · Intervalos de 1 hora";
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(Boolean(showDay && button === selectedButton)));
    });
    modeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode.dataset.mode));
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!document.getElementById(`hours-${button.dataset.day}`)) return;
      selectedButton = button;
      dayOption.disabled = false;
      dayOption.setAttribute("aria-label", `Día seleccionado (${button.dataset.day})`);
      mode.dataset.mode = "day";
      renderChart();
    });
  });
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode.dataset.mode = button.dataset.mode;
      renderChart();
    });
  });
}
