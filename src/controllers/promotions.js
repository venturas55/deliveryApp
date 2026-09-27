import { query } from "../db.js";
import { httpError } from "../services/http-error.js";

const fail = (status, message) => { throw httpError(status, message); };

function selectorMatches(item, productId, category) {
  return productId
    ? Number(item.product_id ?? item.id) === Number(productId)
    : Boolean(category) && item.category === category;
}

export async function quotePromotion(restaurantId, rawCode, cartItems) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { code: "", discount_cents: 0, description: "" };
  const rows = await query(
    "SELECT * FROM promotions WHERE restaurant_id=? AND code=? AND active=1",
    [restaurantId, code],
  );
  if (!rows.length) fail(400, "Código de descuento no válido o inactivo.");
  const promotion = rows[0];
  const subtotal = cartItems.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);

  if (promotion.promotion_type === "percentage") {
    return {
      code: promotion.code,
      discount_cents: Math.min(subtotal, Math.round(subtotal * Number(promotion.percentage) / 100)),
      description: `${promotion.percentage}% de descuento`,
    };
  }

  const qualifying = cartItems.filter(item => selectorMatches(
    item, promotion.trigger_product_id, promotion.trigger_category,
  ));
  const bundles = Math.floor(
    qualifying.reduce((sum, item) => sum + item.quantity, 0) / Number(promotion.trigger_quantity),
  );
  let freeUnits = bundles * Number(promotion.reward_quantity);
  const rewards = cartItems
    .filter(item => selectorMatches(item, promotion.reward_product_id, promotion.reward_category))
    .sort((a, b) => Number(a.price_cents) - Number(b.price_cents));
  let discount = 0;
  for (const item of rewards) {
    const quantity = Math.min(freeUnits, Number(item.quantity));
    discount += quantity * Number(item.price_cents);
    freeUnits -= quantity;
    if (!freeUnits) break;
  }
  const description = bundles && discount
    ? `${promotion.name}: ${bundles} promoción${bundles === 1 ? "" : "es"} aplicada${bundles === 1 ? "" : "s"}`
    : "Añade los productos requeridos para aplicar esta promoción.";
  return { code: promotion.code, discount_cents: discount, description };
}

export async function adminPromotions(restaurantId) {
  return query(
    `SELECT p.*, trigger_product.name AS trigger_product_name, reward_product.name AS reward_product_name
       FROM promotions p
       LEFT JOIN products trigger_product ON trigger_product.id=p.trigger_product_id AND trigger_product.restaurant_id=p.restaurant_id
       LEFT JOIN products reward_product ON reward_product.id=p.reward_product_id AND reward_product.restaurant_id=p.restaurant_id
      WHERE p.restaurant_id=? ORDER BY p.created_at DESC,p.id DESC`,
    [restaurantId],
  );
}

function parsePromotion(body = {}) {
  const code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) fail(400, "El código admite 3-32 letras, números, guion y guion bajo.");
  if (!name || name.length > 120) fail(400, "Indica un nombre de promoción (máximo 120 caracteres).");

  if (body.promotion_type === "percentage") {
    const percentage = Number(body.percentage);
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100)
      fail(400, "El porcentaje debe estar entre 1 y 100.");
    return { code, name, promotion_type: "percentage", percentage, trigger_category: null,
      trigger_product_id: null, trigger_quantity: null, reward_category: null,
      reward_product_id: null, reward_quantity: 1 };
  }

  if (body.promotion_type !== "buy_get") fail(400, "Tipo de promoción no válido.");
  const trigger_product_id = body.trigger_product_id ? Number(body.trigger_product_id) : null;
  const reward_product_id = body.reward_product_id ? Number(body.reward_product_id) : null;
  const trigger_category = trigger_product_id ? null : String(body.trigger_category || "").trim();
  const reward_category = reward_product_id ? null : String(body.reward_category || "").trim();
  const trigger_quantity = Number(body.trigger_quantity);
  const reward_quantity = Number(body.reward_quantity);
  if ((!trigger_product_id && !trigger_category) || (!reward_product_id && !reward_category))
    fail(400, "Selecciona la categoría o el producto que activa y el que se regala.");
  if ((trigger_product_id && (!Number.isInteger(trigger_product_id) || trigger_product_id < 1)) ||
      (reward_product_id && (!Number.isInteger(reward_product_id) || reward_product_id < 1)))
    fail(400, "Producto de promoción no válido.");
  if (!Number.isInteger(trigger_quantity) || trigger_quantity < 1 || trigger_quantity > 50 ||
      !Number.isInteger(reward_quantity) || reward_quantity < 1 || reward_quantity > 50)
    fail(400, "Las cantidades deben estar entre 1 y 50.");
  return { code, name, promotion_type: "buy_get", percentage: null, trigger_category,
    trigger_product_id, trigger_quantity, reward_category, reward_product_id, reward_quantity };
}

export async function savePromotion(req) {
  const data = parsePromotion(req.body);
  for (const id of [data.trigger_product_id, data.reward_product_id].filter(Boolean)) {
    const found = await query("SELECT id FROM products WHERE id=? AND restaurant_id=?", [id, req.user.restaurant_id]);
    if (!found.length) fail(400, "El producto de la promoción no pertenece a este restaurante.");
  }
  try {
    const fields = Object.keys(data);
    if (req.params.id) {
      const result = await query(
        `UPDATE promotions SET ${fields.map(field => `${field}=?`).join(",")} WHERE id=? AND restaurant_id=?`,
        [...Object.values(data), req.params.id, req.user.restaurant_id],
      );
      if (!result.affectedRows) {
        const exists = await query("SELECT id FROM promotions WHERE id=? AND restaurant_id=?", [req.params.id, req.user.restaurant_id]);
        if (!exists.length) fail(404, "Promoción no encontrada.");
      }
      return;
    }
    await query(
      `INSERT INTO promotions(restaurant_id,${fields.join(",")}) VALUES(?,${fields.map(() => "?").join(",")})`,
      [req.user.restaurant_id, ...Object.values(data)],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") fail(409, "Ya existe una promoción con ese código.");
    throw error;
  }
}

export async function togglePromotion(req) {
  const active = req.body.active === "1" ? 1 : 0;
  const result = await query(
    "UPDATE promotions SET active=? WHERE id=? AND restaurant_id=?",
    [active, req.params.id, req.user.restaurant_id],
  );
  if (!result.affectedRows) {
    const exists = await query("SELECT id FROM promotions WHERE id=? AND restaurant_id=?", [req.params.id, req.user.restaurant_id]);
    if (!exists.length) fail(404, "Promoción no encontrada.");
  }
}

export async function deletePromotion(req) {
  const result = await query("DELETE FROM promotions WHERE id=? AND restaurant_id=?", [req.params.id, req.user.restaurant_id]);
  if (!result.affectedRows) fail(404, "Promoción no encontrada.");
}
