import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { query } from "./db.js";
export function signAdmin(admin) {
  return jwt.sign(
    {
      sub: admin.id,
      role: "admin",
      restaurant_id: admin.restaurant_id,
      email: admin.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" },
  );
}
export function signAdminAccessToken(admin) {
  return jwt.sign(
    {
      sub: String(admin.id),
      role: "admin",
      restaurant_id: admin.restaurant_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30m", algorithm: "HS256" },
  );
}
export async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Autenticación requerida" });
  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch {
    return res.status(401).json({ error: "Sesión no válida" });
  }
  if (user.role !== "admin" && !(user.role === undefined && user.restaurant_id))
    return res
      .status(403)
      .json({ error: "Acceso exclusivo de administradores" });

  const admins = await query(
    `SELECT admins.id, admins.restaurant_id
     FROM admins
     JOIN restaurants ON restaurants.id=admins.restaurant_id
     WHERE admins.id=? AND restaurants.active=1`,
    [user.sub],
  );
  if (!admins[0]) return res.status(401).json({ error: "Sesión no válida" });
  req.user = {
    ...user,
    sub: String(admins[0].id),
    role: "admin",
    restaurant_id: admins[0].restaurant_id,
  };
  return next();
}
export const hashPassword = (p) => bcrypt.hash(p, 12);
export const checkPassword = (p, h) => bcrypt.compare(p, h);
export function signCustomer(customer) {
  return jwt.sign(
    { sub: String(customer.id), role: "customer" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" },
  );
}
export function signCustomerAccessToken(customer) {
  return jwt.sign(
    { sub: String(customer.id), role: "customer" },
    process.env.JWT_SECRET,
    { expiresIn: "30m", algorithm: "HS256" },
  );
}
export async function customerAuth(req, res, next) {
  const header = req.headers.authorization || "";
  let user;
  try {
    user = jwt.verify(
      header.startsWith("Bearer ") ? header.slice(7) : "",
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] },
    );
  } catch {
    return res.status(401).json({ error: "Inicia sesión para continuar" });
  }
  if (user.role !== "customer")
    return res.status(403).json({ error: "Inicia sesión como cliente" });
  const rows = await query("SELECT id FROM customers WHERE id=?", [user.sub]);
  if (!rows[0])
    return res.status(401).json({ error: "Inicia sesión para continuar" });
  req.customer = { ...user, sub: String(rows[0].id) };
  return next();
}
