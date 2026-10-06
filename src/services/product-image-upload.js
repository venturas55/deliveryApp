import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
      return cb(null, true);
    const error = new Error("Formato de imagen no válido");
    error.status = 400;
    cb(error);
  },
}).single("image");

export async function saveProductImage(req, res, next) {
  if (!req.file) return next();
  const extension = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  }[req.file.mimetype];
  const filename = randomUUID() + extension;
  const directory = path.join(process.cwd(), "public", "uploads", "products");
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), req.file.buffer, {
      flag: "wx",
    });
    req.body.image_url = "/uploads/products/" + filename;
    next();
  } catch (error) {
    next(error);
  }
}
