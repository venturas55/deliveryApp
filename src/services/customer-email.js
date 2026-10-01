import { httpError } from "./http-error.js";
import { publicOrigin } from "./seo.js";

const imageTypes = new Map([
  ["image/jpeg", { extension: "jpg", matches: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/png", { extension: "png", matches: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ["image/gif", { extension: "gif", matches: b => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")) }],
]);

export function customerEmailContent(text, image, websiteUrl = process.env.PUBLIC_URL) {
  const escaped = text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const content = { text, html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><p>${escaped.replace(/\r\n|\r|\n/g, "<br>")}</p>` };
  if (image) {
    const type = imageTypes.get(image.mimetype);
    if (!type || !Buffer.isBuffer(image.buffer) || !type.matches(image.buffer)) {
      throw httpError(400, "Selecciona una imagen JPEG, PNG o GIF válida.");
    }
    if (image.buffer.length > 5 * 1024 * 1024) {
      throw httpError(400, "La imagen no puede superar 5 MB.");
    }
    content.attachments = [{ filename: `promocion.${type.extension}`, content: image.buffer, contentType: image.mimetype, cid: "promotion-flyer@delivery", contentDisposition: "inline" }];
    const origin = publicOrigin(websiteUrl);
    if (!origin) throw httpError(503, "Configura PUBLIC_URL con el origen público de la web para enlazar la imagen.");
    content.html += `<a href="${origin}/" target="_blank" rel="noopener noreferrer"><img src="cid:promotion-flyer@delivery" alt="Flyer de promoción: visitar la web" style="display:block;width:100%;max-width:640px;height:auto;border:0"></a>`;
  }
  content.html += "</div>";
  return content;
}
