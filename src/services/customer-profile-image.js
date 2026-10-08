import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { updateProfileImage } from "../controllers/accounts.js";
import { httpError } from "./http-error.js";

const types = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
export const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    callback(types[file.mimetype] ? null : httpError(400, "Selecciona una imagen JPG, PNG o WebP."), !!types[file.mimetype]);
  },
});

export function validateProfileImage(file) {
  const b = file?.buffer;
  if (!Buffer.isBuffer(b) || !b.length) throw httpError(400, "Selecciona una foto de perfil.");
  if (b.length > 5 * 1024 * 1024) throw httpError(400, "La imagen no puede superar 5 MB.");
  const valid = file.mimetype === "image/jpeg" ? b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
    : file.mimetype === "image/png" ? b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : file.mimetype === "image/webp" ? b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"
    : false;
  if (!valid) throw httpError(400, "El archivo no es una imagen JPG, PNG o WebP válida.");
  return types[file.mimetype];
}

export async function saveProfileImage(customerId, file) {
  const extension = validateProfileImage(file);
  const filename = randomUUID() + extension;
  const directory = path.join(process.cwd(), "public", "uploads", "customers");
  const destination = path.join(directory, filename);
  await mkdir(directory, { recursive: true });
  await writeFile(destination, file.buffer, { flag: "wx" });
  const url = "/uploads/customers/" + filename;
  try { await updateProfileImage(customerId, url); }
  catch (failure) { await unlink(destination).catch(() => {}); throw failure; }
  return { ok: true, profile_image_url: url };
}
