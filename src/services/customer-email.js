import { httpError } from "./http-error.js";
import { publicOrigin } from "./seo.js";

const imageTypes = new Map([
  [
    "image/jpeg",
    {
      extension: "jpg",
      matches: (b) =>
        b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
  ],
  [
    "image/png",
    {
      extension: "png",
      matches: (b) =>
        b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    },
  ],
  [
    "image/gif",
    {
      extension: "gif",
      matches: (b) =>
        ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")),
    },
  ],
]);

export function customerEmailContent(
  text,
  image,
  websiteUrl = process.env.PUBLIC_URL,
) {
  const escaped = text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
  const content = {
    text,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><p>${escaped.replace(/\r\n|\r|\n/g, "<br>")}</p>`,
  };
  if (image) {
    if (!Buffer.isBuffer(image.buffer)) {
      throw httpError(400, "La imagen recibida no es válida.");
    }

    const detected = [...imageTypes.entries()].find(([, config]) =>
      config.matches(image.buffer),
    );

    if (!detected) {
      throw httpError(400, "Selecciona una imagen JPEG, PNG o GIF válida.");
    }

    const [mimeType, type] = detected;

    console.log("Tipo declarado:", image.mimetype);
    console.log("Tipo detectado:", mimeType);

    // A partir de aquí usamos el tipo REAL detectado por los bytes
    image.mimetype = mimeType;
  }
  content.html += "</div>";
  return content;
}
