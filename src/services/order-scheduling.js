import { httpError } from "./http-error.js";

export const orderTimezone = "Europe/Madrid";
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: orderTimezone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function parts(date) {
  return Object.fromEntries(formatter.formatToParts(date).map(({type,value}) => [type,value]));
}
function day(date) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
export function orderTimeSlots(now = new Date()) {
  const today = day(now), slots = [];
  const interval = 15 * 60 * 1000;
  for (let time = (Math.floor(now.getTime() / interval) + 1) * interval;
    day(new Date(time)) === today; time += interval) {
    const date = new Date(time), p = parts(date);
    slots.push({ value: date.toISOString(), label: `${p.hour}:${p.minute}` });
  }
  return slots;
}
export function parseOrderSchedule(body, now = new Date()) {
  const mode = body.timing_mode ?? (body.scheduled_for ? "scheduled" : "asap");
  if (mode === "asap") return null;
  if (mode !== "scheduled" || typeof body.scheduled_for !== "string" ||
    !orderTimeSlots(now).some(slot => slot.value === body.scheduled_for))
    throw httpError(400, "Selecciona una hora futura de hoy en intervalos de 15 minutos.");
  // Store UTC without depending on the database session or host timezone.
  return body.scheduled_for.slice(0, 19).replace("T", " ");
}
export function scheduleLabel(value) {
  if (!value) return "Lo antes posible";
  const date = new Date(value);
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
