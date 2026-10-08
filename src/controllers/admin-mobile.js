import { query } from "../db.js";
import * as admin from "./admin.js";
import { httpError } from "../services/http-error.js";
import { presentOrder } from "../services/order-presenter.js";

const pick = (row, fields) => Object.fromEntries(fields.map(key => [key, row[key] ?? null]));
const editableRestaurantFields = ["name", "phone", "slug", "legal_name", "tax_id", "legal_address", "legal_email", "legal_registration", "delivery_base_cents", "free_delivery_from_cents", "delivery_address_data"];
const restaurantFields = ["id", "name", "phone", "address", "city", "slug", "created_at", "delivery_city", "delivery_number", "legal_name", "tax_id", "legal_address", "legal_email", "legal_registration", "delivery_base_cents", "free_delivery_from_cents"];
const orderFields = ["id", "customer_id", "customer_name", "customer_phone", "delivery_address", "delivery_notes", "delivery_apartment", "delivery_patio", "payment_method", "payment_status", "delivery_method", "sales_channel", "status", "subtotal_cents", "discount_cents", "delivery_cents", "total_cents", "provider", "provider_status", "created_at", "updated_at", "paid_at"];

export function mobileOrder(row) {
  const view = presentOrder(row);
  return {
    ...pick(row, orderFields),
    ...pick(view, ["statusLabel", "nextStatus", "nextLabel", "canCancel", "canQuote", "canStartOwnDelivery", "canCompletePickup", "canCompleteOwnDelivery"]),
    canQuote: view.canQuote && !row.provider_order_id,
    canMarkPaid: ["cash", "card_on_delivery"].includes(row.payment_method) &&
      !["paid", "cancelled", "refunded"].includes(row.payment_status) && row.status !== "cancelled",
    delivery: pick(view.delivery, ["trackingUrl", "canSync", "courier", "pickupEta", "dropoffEta", "returnPending"]),
    ...(row.items ? { items: row.items.map(item => pick(item, ["id", "product_id", "product_name", "quantity", "unit_price_cents"])) } : {}),
    ...(row.events ? { events: row.events.map(event => pick(event, ["event_type", "created_at"])) } : {}),
  };
}

export async function restaurant(req) {
  return pick(await admin.adminConfigs(req), restaurantFields);
}

export async function updateRestaurant(req) {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !Object.keys(body).length || Object.keys(body).some(key => !editableRestaurantFields.includes(key)))
    throw httpError(400, "Campos de configuración no permitidos");
  // Reuse the web configuration validation, including structured delivery addresses.
  await admin.updateAdminConfigs(req);
  return restaurant(req);
}

export async function summary(req) {
  const id = req.user.restaurant_id;
  const counts = await query("SELECT status,COUNT(*) AS total FROM orders WHERE restaurant_id=? GROUP BY status", [id]);
  const [today] = await query(`SELECT COUNT(*) AS orders,
    COALESCE(SUM(CASE WHEN status<>'cancelled' AND payment_status NOT IN ('refunded','refund_pending') THEN total_cents ELSE 0 END),0) AS sales_cents
    FROM orders WHERE restaurant_id=? AND created_at>=CURRENT_DATE`, [id]);
  return { counts: Object.fromEntries(counts.map(row => [row.status, Number(row.total)])),
    today: { orders: Number(today.orders), sales_cents: Number(today.sales_cents) } };
}

export async function statistics(req) {
  const data = await admin.adminOrderStats(req);
  const [totals] = await query(`SELECT COUNT(*) AS orders,COUNT(DISTINCT customer_id) AS customers,
    COALESCE(SUM(total_cents),0) AS sales_cents,COALESCE(AVG(total_cents),0) AS average_cents
    FROM orders WHERE restaurant_id=? AND status='delivered' AND payment_status<>'refunded'`, [req.user.restaurant_id]);
  const sales = await query(`SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,SUM(total_cents) AS sales_cents
    FROM orders WHERE restaurant_id=? AND status='delivered' AND payment_status<>'refunded'
    AND created_at>=CURRENT_DATE - INTERVAL 13 DAY GROUP BY DATE(created_at)`, [req.user.restaurant_id]);
  const byDay = new Map(sales.map(row => [row.day, Number(row.sales_cents)]));
  const historicalHours = await query(
    `SELECT HOUR(created_at) AS hour,COUNT(*) AS total FROM orders
    WHERE restaurant_id=? GROUP BY HOUR(created_at)`,
    [req.user.restaurant_id],
  );
  const historicalByHour = new Map(
    historicalHours.map(row => [Number(row.hour), Number(row.total)]),
  );
  const historicalHourly = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    total: historicalByHour.get(hour) || 0,
  }));
  const customerSpending = data.customerSpending.map(row => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    rank: row.rank,
    total_orders: row.total_orders,
    total_spent_cents: row.total_spent_cents,
  }));
  return { totals: Object.fromEntries(Object.entries(totals).map(([key,value]) => [key, Number(value)])),
    daily: data.daily.map(row => ({
      day: row.day,
      label: row.label,
      total: row.total,
      sales_cents: byDay.get(row.day) || 0,
      hourly: row.hourly.map(hour => ({ ...hour })),
    })),
    historicalHourly,
    customerSpending };
}

export async function customers(req, detail = false) {
  const search = req.query.q ?? "";
  if (typeof search !== "string" || search.length > 120) throw httpError(400, "Búsqueda no válida");
  const params = [req.user.restaurant_id];
  let where = "";
  if (detail) { where = " AND c.id=?"; params.push(req.params.id); }
  else if (search.trim()) {
    where = " AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)";
    params.push(...Array(3).fill(`%${search.trim()}%`));
  }
  const rows = await query(`SELECT c.id,c.name,c.email,c.phone,c.delivery_address,c.delivery_formatted_address,COUNT(*) AS total_orders,
    COALESCE(SUM(CASE WHEN o.status='delivered' AND o.payment_status<>'refunded' THEN o.total_cents ELSE 0 END),0) AS total_spent_cents
    FROM customers c JOIN orders o ON o.customer_id=c.id AND o.restaurant_id=?
    WHERE 1=1${where} GROUP BY c.id,c.name,c.email,c.phone,c.delivery_address,c.delivery_formatted_address ORDER BY c.name,c.id LIMIT 100`, params);
  const result = rows.map(row => ({ ...row, total_orders: Number(row.total_orders), total_spent_cents: Number(row.total_spent_cents) }));
  if (!detail) return result;
  if (!result[0]) throw httpError(404, "Cliente no encontrado en este restaurante");
  const orders = await query("SELECT * FROM orders WHERE restaurant_id=? AND customer_id=? ORDER BY id DESC LIMIT 200", [req.user.restaurant_id, req.params.id]);
  return { ...result[0], orders: orders.map(mobileOrder) };
}

export async function createOrder(req) {
  const body = req.body;
  if (!body || !Number.isSafeInteger(body.customer_id) || body.customer_id < 1 ||
      !Array.isArray(body.items) || !body.items.length || body.items.length > 100 ||
      !["cash", "card_on_delivery"].includes(body.payment_method))
    throw httpError(400, "Revisa artículos y forma de pago");
  const cart = body.items.map(item => {
    if (!item || !Number.isSafeInteger(item.product_id) || item.product_id < 1 ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50)
      throw httpError(400, "Revisa el carrito");
    return { product_id: item.product_id, quantity: item.quantity };
  });
  if (new Set(cart.map(item => item.product_id)).size !== cart.length)
    throw httpError(400, "No repitas artículos");
  // Customers are global accounts. Mobile only uses customers with orders in this restaurant.
  await customers({ ...req, params: { id: body.customer_id }, query: {} }, true);
  const id = await admin.createAdminOrder(req, cart);
  return mobileOrder(await admin.adminOrder({ ...req, params: { id } }));
}
