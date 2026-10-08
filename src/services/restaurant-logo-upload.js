import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { query } from "../db.js";
import { httpError } from "./http-error.js";

const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: 5 * 1024 * 1024, files: 1, fields: 20, fieldSize: 16384,
} }).single("logo");

export function restaurantLogoUpload(req, res, next) {
  upload(req, res, error => {
    if (error) return next(httpError(400, error.code === "LIMIT_FILE_SIZE"
      ? "El logo no puede superar 5 MB." : "Archivo o formulario no válido."));
    if (req.file) {
      const bytes = req.file.buffer;
      const mime = req.file.mimetype;
      const valid = (mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
        (mime === "image/jpeg" && bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
        (mime === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
      if (!valid) return next(httpError(400, "Selecciona un logo JPEG, PNG o WebP válido."));
    }
    next();
  });
}

export async function saveRestaurantLogo(req) {
  if (!req.file) return;
  const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[req.file.mimetype];
  const filename = randomUUID() + extension;
  const directory = path.join(process.cwd(), "public", "uploads", "restaurants");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  await writeFile(target, req.file.buffer, { flag: "wx" });
  try {
    const result = await query("UPDATE restaurants SET logo_url=? WHERE id=?", ["/uploads/restaurants/" + filename, req.user.restaurant_id]);
    if (!result.affectedRows) throw httpError(404, "Restaurante no encontrado");
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
}
