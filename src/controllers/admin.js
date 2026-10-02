import { query, transaction } from "../db.js";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  normalizeDelivery,
  applyDeliveryUpdate,
  deliveryView,
} from "../services/delivery-tracking.js";
import {
  getConfiguredDeliveryProvider,
  getConfiguredDeliveryProviders,
} from "../delivery/index.js";
import { mockDelivery } from "../delivery/mock.js";
import { logEvent } from "../services/order-events.js";
import { httpError } from "../services/http-error.js";
import { cleanAddress, validateAddress } from "../services/geocoding.js";
import {
  getDeliveryProviders,
  providerFields,
  saveDeliveryProvider,
} from "../services/delivery-config.js";
import { refundOrderPayment } from "./redsys-payments.js";
import { createHash, randomBytes } from "node:crypto";
import { emailValue, validEmail } from "./accounts.js";
import { readAdminOrderCart } from "../services/web-session.js";
import { createEmailTransport, sendEmail } from "../services/email.js";
// Lock the order so each state change and its event are committed together.

function orderError(status, message) {
  return Object.assign(new Error(message), { status });
}

function eurosToCents(value) {
  const normalized = String(value).trim().replace(",", ".");

  const euros = Number(normalized);

  if (!Number.isFinite(euros) || euros < 0) {
    throw orderError(400, "El importe introducido no es válido");
  }

  return Math.round(euros * 100);
}

export async function telephoneCustomer(phone, restaurantId) {
  if (typeof phone !== "string" || phone.trim().length > 40)
    throw orderError(400, "Teléfono no válido");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) throw orderError(400, "Introduce un teléfono válido");
  const candidates = [digits];
  if (digits.length === 9) candidates.push("34" + digits);
  if (digits.startsWith("34") && digits.length === 11)
    candidates.push(digits.slice(2));
  const rows = await query(
    `SELECT id,name,email,phone,delivery_address,delivery_notes,delivery_formatted_address,delivery_street,delivery_number,delivery_city,delivery_province,delivery_postal_code,delivery_country,delivery_latitude,delivery_longitude,delivery_place_id FROM customers WHERE REGEXP_REPLACE(phone,'[^0-9]','') IN (${candidates.map(() => "?").join(",")}) LIMIT 1`,
    candidates,
  );
  return rows[0] || null;
}

export async function createAdminCustomer(req) {
  const body = req.body || {},
    name = String(body.name || "").trim(),
    phone = String(body.phone || "").trim(),
    email = emailValue(body.email);
  if (!name || name.length > 120 || phone.length > 40 || !validEmail(email))
    throw orderError(400, "Revisa nombre, teléfono y correo electrónico");
  let addressData;
  try {
    addressData = JSON.parse(body.delivery_address_data || "{}");
  } catch {
    throw orderError(400, "Dirección seleccionada no válida");
  }
  const addressError = validateAddress(addressData);
  if (addressError) throw orderError(400, addressError);
  const address = cleanAddress(addressData);
  let base;
  try {
    base = new URL(process.env.PUBLIC_URL);
  } catch {
    throw orderError(
      503,
      "Configura PUBLIC_URL como una URL completa para enviar el enlace",
    );
  }
  const phoneMatch = await telephoneCustomer(phone, req.user.restaurant_id);
  if (phoneMatch)
    throw orderError(409, "Ya existe un cliente con ese teléfono");
  const token = randomBytes(32).toString("base64url"),
    tokenHash = createHash("sha256").update(token).digest("hex");

  let transporter;
  try {
    transporter = await createEmailTransport();
    await transaction(async (c) => {
      const result = await c.query(
        "INSERT INTO customers(name,email,password_hash,phone,delivery_address,delivery_formatted_address,delivery_street,delivery_number,delivery_city,delivery_province,delivery_postal_code,delivery_country,delivery_latitude,delivery_longitude,delivery_place_id,password_setup_token_hash,password_setup_expires_at) VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 24 HOUR))",
        [
          name,
          email,
          phone,
          address.formatted_address,
          address.formatted_address,
          address.street,
          address.number,
          address.city,
          address.province,
          address.postal_code,
          address.country,
          address.latitude,
          address.longitude,
          address.place_id,
          tokenHash,
        ],
      );
      await sendEmail({
          to: email,
          subject: "Establece la contraseña de tu cuenta",
          text: `Hola ${name},\n\nEl restaurante ha creado una cuenta para ti. Establece tu contraseña desde este enlace (válido durante 24 horas):\n${new URL("/client/set-password?token=" + encodeURIComponent(token), base).toString()}`,
        }, transporter);
      return result.insertId;
    });
  } catch (error) {
    console.error("Admin customer creation failed", {
      code: error.code,
      responseCode: error.responseCode,
      command: error.command,
      response: error.response,
    });
    if (error.code === "ER_DUP_ENTRY")
      throw orderError(409, "Ya existe una cuenta con ese correo o teléfono");
    if (error.status) throw error;
    throw orderError(502, "No se pudo enviar el correo; no se creó el usuario");
  } finally {
    transporter?.close();
  }
  return true;
}

export async function updateAdminOrderCart(req) {
  const cart = readAdminOrderCart(req),
    action = req.body.action,
    id = Number(req.body.product_id);
  if (
    !Number.isInteger(id) ||
    id < 1 ||
    !["add", "decrease", "remove"].includes(action)
  )
    throw orderError(400, "Acción de carrito no válida");
  const products = await query(
    "SELECT id FROM products WHERE id=? AND restaurant_id=? AND active=1",
    [id, req.user.restaurant_id],
  );
  if (!products.length) throw orderError(404, "Artículo no disponible");
  let item = cart.find((entry) => Number(entry.product_id) === id);
  if (action === "remove")
    return cart.filter((entry) => Number(entry.product_id) !== id);
  if (!item && action === "add") cart.push({ product_id: id, quantity: 1 });
  else if (item) {
    item.quantity += action === "add" ? 1 : -1;
    if (item.quantity <= 0)
      return cart.filter((entry) => Number(entry.product_id) !== id);
    if (item.quantity > 50)
      throw orderError(400, "Máximo 50 unidades por artículo");
  }
  return cart;
}

export async function createAdminOrder(req) {
  const body = req.body || {},
    restaurantId = req.user.restaurant_id,
    channel = body.channel,
    deliveryMethod = body.delivery_method;
  if (!["telephone", "counter"].includes(channel))
    throw orderError(400, "Canal de pedido no válido");
  if (!["delivery", "pickup"].includes(deliveryMethod))
    throw orderError(400, "Tipo de pedido no válido");
  const customerRows = await query("SELECT * FROM customers WHERE id=?", [
    body.customer_id,
  ]);
  if (!customerRows.length) throw orderError(404, "Cliente no encontrado");
  const customer = customerRows[0];
  const cart = readAdminOrderCart(req);
  if (!cart.length) throw orderError(400, "Añade artículos al carrito");
  const products = await query(
    `SELECT id,name,price_cents FROM products WHERE restaurant_id=? AND active=1 AND id IN (${cart.map(() => "?").join(",")})`,
    [restaurantId, ...cart.map((item) => item.product_id)],
  );
  const productMap = new Map(products.map((item) => [Number(item.id), item]));
  let subtotal = 0;
  const items = cart.map((item) => {
    const product = productMap.get(Number(item.product_id)),
      quantity = Number(item.quantity);
    if (
      !product ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 50
    )
      throw orderError(400, "Revisa el carrito");
    subtotal += product.price_cents * quantity;
    return { ...product, quantity };
  });
  let address = customer.delivery_place_id
    ? {
        formatted_address: customer.delivery_formatted_address,
        street: customer.delivery_street,
        number: customer.delivery_number,
        city: customer.delivery_city,
        province: customer.delivery_province,
        postal_code: customer.delivery_postal_code,
        country: customer.delivery_country,
        latitude: customer.delivery_latitude,
        longitude: customer.delivery_longitude,
        place_id: customer.delivery_place_id,
      }
    : null;
  if (body.delivery_address_data) {
    try {
      address = JSON.parse(body.delivery_address_data);
    } catch {
      throw orderError(400, "Dirección seleccionada no válida");
    }
  }
  if (deliveryMethod === "delivery") {
    const addressError = validateAddress(address);
    if (addressError) throw orderError(400, addressError);
    address = cleanAddress(address);
  }
  const deliveryAddress =
    deliveryMethod === "pickup"
      ? "Recogida en local"
      : address.formatted_address;
  const delivery =
    deliveryMethod === "delivery" &&
    subtotal < Number(process.env.FREE_DELIVERY_FROM_CENTS || 3000)
      ? Number(process.env.DELIVERY_BASE_CENTS || 399)
      : 0;
  return transaction(async (c) => {
    const result = await c.query(
      "INSERT INTO orders(customer_id,restaurant_id,customer_name,customer_phone,delivery_address,delivery_formatted_address,delivery_street,delivery_number,delivery_city,delivery_province,delivery_postal_code,delivery_country,delivery_latitude,delivery_longitude,delivery_place_id,payment_method,delivery_method,sales_channel,subtotal_cents,delivery_cents,total_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        customer.id,
        restaurantId,
        customer.name,
        customer.phone,
        deliveryAddress,
        deliveryMethod === "pickup" ? null : address.formatted_address,
        deliveryMethod === "pickup" ? null : address.street,
        deliveryMethod === "pickup" ? null : address.number,
        deliveryMethod === "pickup" ? null : address.city,
        deliveryMethod === "pickup" ? null : address.province,
        deliveryMethod === "pickup" ? null : address.postal_code,
        deliveryMethod === "pickup" ? null : address.country,
        deliveryMethod === "pickup" ? null : address.latitude,
        deliveryMethod === "pickup" ? null : address.longitude,
        deliveryMethod === "pickup" ? null : address.place_id,
        body.payment_method === "card_on_delivery"
          ? "card_on_delivery"
          : "cash",
        deliveryMethod,
        channel,
        subtotal,
        delivery,
        subtotal + delivery,
      ],
    );
    const id = Number(result.insertId);
    for (const item of items)
      await c.query(
        "INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents) VALUES(?,?,?,?,?)",
        [id, item.id, item.name, item.quantity, item.price_cents],
      );
    await logEvent(c, id, "order.created", { status: "new", source: channel });
    return id;
  });
}
async function changeOrder(req, fn) {
  return transaction(async (c) => {
    const rows = await c.query(
      "SELECT * FROM orders WHERE id=? AND restaurant_id=? FOR UPDATE",
      [req.params.id, req.user.restaurant_id],
    );
    if (!rows.length) throw orderError(404, "Pedido no encontrado");
    return fn(c, rows[0]);
  });
}
function deliveryReady(order) {
  if (order.delivery_method === "pickup")
    throw orderError(409, "Los pedidos para recoger no requieren reparto");
  if (order.status !== "ready" || order.provider_order_id)
    throw orderError(
      409,
      "El pedido debe estar listo y sin reparto solicitado",
    );
}

function productData(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw orderError(400, "Datos de artículo inválidos");
  const data = {};
  const defaults = {
    description: "",
    category: "Pizzas",
    active: 1,
    sort_order: 0,
    image_url: "",
    image_description: "",
  };
  for (const [field, max] of [
    ["name", 120],
    ["description", 255],
    ["category", 80],
    ["image_url", 500],
    ["image_description", 255],
  ]) {
    if (partial && body[field] === undefined) continue;
    const value = body[field] ?? defaults[field];
    if (
      typeof value !== "string" ||
      value.trim().length > max ||
      (!["description", "image_description"].includes(field) && !value.trim())
    )
      throw orderError(
        400,
        `Campo ${field} inválido (máximo ${max} caracteres)`,
      );
    data[field] = value.trim();
  }
  for (const field of ["price_cents", "sort_order"]) {
    if (partial && body[field] === undefined) continue;
    const value = body[field] ?? defaults[field];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 2147483647
    )
      throw orderError(
        400,
        `Campo ${field} debe ser un entero positivo o cero`,
      );
    data[field] = value;
  }
  if (!partial || body.active !== undefined) {
    const value = body.active ?? 1;
    if (![0, 1, true, false].includes(value))
      throw orderError(400, "Disponibilidad inválida");
    data.active = Number(value);
  }
  if (!Object.keys(data).length)
    throw orderError(400, "No hay cambios que guardar");
  return data;
}

function configsData(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw orderError(400, "Datos de configuración inválidos");
  }

  const data = {};

  // Campos de texto
  const textFields = [
    ["name", 150],
    ["slug", 80],
    ["phone", 40],
    ["address", 500],
    ["city", 100],
    ["legal_name", 150, false],
    ["tax_id", 24, false],
    ["legal_address", 500, false],
    ["legal_email", 190, false],
    ["legal_registration", 255, false],
  ];

  for (const [field, max, required = true] of textFields) {
    if (partial && body[field] === undefined) continue;

    const value = body[field] ?? "";

    if (
      typeof value !== "string" ||
      (required && !value.trim()) ||
      value.trim().length > max
    ) {
      throw orderError(
        400,
        `Campo ${field} inválido (máximo ${max} caracteres)`,
      );
    }

    data[field] = value.trim();
  }

  if (data.legal_email && !validEmail(data.legal_email))
    throw orderError(400, "Campo legal_email no válido");

  for (const [field, max] of [
    ["delivery_formatted_address", 500],
    ["delivery_street", 180],
    ["delivery_number", 40],
    ["delivery_city", 120],
    ["delivery_province", 120],
    ["delivery_postal_code", 20],
    ["delivery_country", 2],
    ["delivery_place_id", 255],
    ["delivery_patio", 120],
  ]) {
    if (partial && body[field] === undefined) continue;
    const value = body[field] ?? "";
    if (typeof value !== "string" || value.length > max) {
      throw orderError(
        400,
        `Campo ${field} inválido (máximo ${max} caracteres)`,
      );
    }
    data[field] = value.trim();
  }

  for (const field of ["delivery_base_cents", "free_delivery_from_cents"]) {
    if (partial && body[field] === undefined) continue;

    const euros = Number(String(body[field]).replace(",", "."));

    if (!Number.isFinite(euros) || euros < 0) {
      throw orderError(400, `Campo ${field} inválido`);
    }

    for (const field of ["delivery_latitude", "delivery_longitude"]) {
      if (partial && body[field] === undefined) continue;
      const value = Number(body[field]);
      if (!Number.isFinite(value))
        throw orderError(400, `Campo ${field} inválido`);
      data[field] = value;
    }

    // Euros → céntimos
    data[field] = Math.round(euros * 100);
  }

  // Restaurante activo/inactivo
  if (!partial || body.active !== undefined) {
    const value = body.active ?? 1;

    if (![0, 1, true, false, "0", "1"].includes(value)) {
      throw orderError(400, "Disponibilidad inválida");
    }

    data.active = Number(value);
  }

  if (!Object.keys(data).length) {
    throw orderError(400, "No hay cambios que guardar");
  }

  return data;
}

export async function adminOrders(req) {
  const groups = new Map([
    ["all", []],
    ["pending", ["new"]],
    [
      "in_progress",
      [
        "accepted",
        "preparing",
        "ready",
        "delivery_requested",
        "courier_assigned",
        "out_for_delivery",
      ],
    ],
    ["delivered", ["delivered"]],
    ["cancelled", ["cancelled"]],
  ]);
  const filter = req.query.filter ?? "all";
  if (!groups.has(filter)) throw httpError(400, "Filtro de pedidos no válido");
  const deliveryFilter = req.query.delivery_method ?? "all";
  const paymentFilter = req.query.payment_method ?? "all";
  if (!["all", "delivery", "pickup"].includes(deliveryFilter))
    throw httpError(400, "Filtro de entrega no válido");
  if (!["all", "card", "cash"].includes(paymentFilter))
    throw httpError(400, "Filtro de pago no válido");
  const states = groups.get(filter);
  let clause = states.length
    ? ` AND status IN (${states.map(() => "?").join(",")})`
    : "";
  const params = [req.user.restaurant_id, ...states];
  if (deliveryFilter !== "all") {
    clause += " AND delivery_method=?";
    params.push(deliveryFilter);
  }
  if (paymentFilter !== "all") {
    const methods = paymentFilter === "card" ? ["online", "card_on_delivery"] : ["cash"];
    clause += ` AND payment_method IN (${methods.map(() => "?").join(",")})`;
    params.push(...methods);
  }
  const orders = await query(
    `SELECT * FROM orders WHERE restaurant_id=?${clause} ORDER BY id DESC LIMIT 200`,
    params,
  );
  return orders;
}

export async function adminOrderStats(req) {
  const restaurantId = req.user.restaurant_id;
  const days = await query(
    `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,COUNT(*) AS total FROM orders
    WHERE restaurant_id=? AND created_at>=CURRENT_DATE - INTERVAL 13 DAY
    GROUP BY DATE(created_at) ORDER BY day`,
    [restaurantId],
  );
  const byDay = new Map(days.map((row) => [row.day, Number(row.total)]));
  const hourlyDays = await query(
    `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,HOUR(created_at) AS hour,COUNT(*) AS total FROM orders
    WHERE restaurant_id=? AND created_at>=CURRENT_DATE - INTERVAL 13 DAY
    GROUP BY DATE(created_at),HOUR(created_at)`,
    [restaurantId],
  );
  const hourlyByDay = new Map();
  for (const row of hourlyDays) {
    if (!hourlyByDay.has(row.day)) hourlyByDay.set(row.day, new Map());
    hourlyByDay.get(row.day).set(Number(row.hour), Number(row.total));
  }
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 13 + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      label: date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "short",
      }),
      day: key,
      total: byDay.get(key) || 0,
    };
  });
  const hours = await query(
    `SELECT FLOOR(HOUR(created_at)/3) AS slot,COUNT(*) AS total FROM orders
    WHERE restaurant_id=? GROUP BY FLOOR(HOUR(created_at)/3)`,
    [restaurantId],
  );
  const bySlot = new Map(
    hours.map((row) => [Number(row.slot), Number(row.total)]),
  );
  const hourly = Array.from({ length: 8 }, (_, slot) => ({
    label: `${String(slot * 3).padStart(2, "0")}:00–${String(slot * 3 + 3).padStart(2, "0")}:00`,
    total: bySlot.get(slot) || 0,
  }));
  const dailyMax = Math.max(1, ...daily.map((row) => row.total));
  const hourlyMax = Math.max(1, ...hourly.map((row) => row.total));
  const customerSpending = await query(
    `SELECT c.id,c.name,c.email,c.phone,COUNT(*) AS total_orders,
      SUM(o.total_cents) AS total_spent_cents
    FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.restaurant_id=? AND o.status='delivered'
      AND o.payment_status<>'refunded'
    GROUP BY c.id,c.name,c.email,c.phone
    ORDER BY total_spent_cents DESC,total_orders DESC,c.id ASC`,
    [restaurantId],
  );
  return {
    customerSpending: customerSpending.map((row, index) => ({
      ...row,
      rank: index + 1,
      total_orders: Number(row.total_orders),
      total_spent_cents: Number(row.total_spent_cents),
    })),
    daily: daily.map((row) => {
      const dayHours = hourlyByDay.get(row.day) || new Map();
      const hourly = Array.from({ length: 24 }, (_, hour) => ({
        label: `${String(hour).padStart(2, "0")}:00`,
        total: dayHours.get(hour) || 0,
      }));
      const max = Math.max(1, ...hourly.map((item) => item.total));
      return {
        ...row,
        width: Math.round((row.total / dailyMax) * 100),
        hourly: hourly.map((item) => ({
          ...item,
          width: Math.round((item.total / max) * 100),
        })),
      };
    }),
    hourly: hourly.map((row) => ({
      ...row,
      width: Math.round((row.total / hourlyMax) * 100),
    })),
  };
}

export async function adminOrder(req) {
  const rows = await query(
    "SELECT * FROM orders WHERE id=? AND restaurant_id=?",
    [req.params.id, req.user.restaurant_id],
  );
  if (!rows.length) throw httpError(404, "Pedido no encontrado");
  const items = await query("SELECT * FROM order_items WHERE order_id=?", [
    req.params.id,
  ]);
  const events = await query(
    "SELECT event_type,payload_json,created_at FROM order_events WHERE order_id=? ORDER BY id DESC",
    [req.params.id],
  );
  return { ...rows[0], items, events };
}

export async function markOrderPaid(req) {
  return changeOrder(req, async (c, order) => {
    if (!["cash", "card_on_delivery"].includes(order.payment_method))
      throw orderError(409, "El pago manual solo admite efectivo o tarjeta al entregar");
    if (order.status === "cancelled" || ["paid", "cancelled", "refunded"].includes(order.payment_status))
      throw orderError(409, "Este pedido no admite marcar el pago como recibido");
    await c.query(
      "UPDATE orders SET payment_status='paid',paid_at=COALESCE(paid_at,NOW()) WHERE id=?",
      [order.id],
    );
    await logEvent(c, order.id, "payment.manual_paid", {
      method: order.payment_method,
      admin_id: req.user.sub,
    });
    return { ok: true };
  });
}

export async function setOrderStatus(req) {
  const transitions = {
    new: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["cancelled", "out_for_delivery"],
    out_for_delivery: ["delivered"],
  };

  const status = req.body?.status;

  if (
    ![
      "accepted",
      "preparing",
      "ready",
      "cancelled",
      "out_for_delivery",
      "delivered",
    ].includes(status)
  ) {
    throw orderError(400, "Estado no permitido");
  }

  /*
   * Si el administrador está rechazando
   * el pedido, comprobamos primero si
   * tenemos que devolver un pago Redsys.
   */
  if (status === "cancelled") {
    await refundOrderPayment(req.params.id);
  }

  /*
   * Solo llegamos aquí si:
   *
   * - no necesitaba devolución, o
   * - Redsys confirmó la devolución.
   */
  await changeOrder(req, async (c, order) => {
    const completePickup = order.delivery_method === "pickup" && order.status === "ready" && status === "delivered";
    if (!completePickup && !transitions[order.status]?.includes(status)) {
      throw orderError(
        409,
        "El pedido ya ha cambiado o no permite esta transición",
      );
    }

    if (status === "out_for_delivery" && order.delivery_method === "pickup")
      throw orderError(409, "Los pedidos para recoger no se asignan a reparto");

    if (status === "out_for_delivery" && order.status === "ready") {
      if (order.provider_order_id)
        throw orderError(409, "El pedido ya tiene un reparto externo");
      await c.query(
        "UPDATE orders SET status=?,provider='own',provider_status=? WHERE id=?",
        [status, status, order.id],
      );
    } else if (completePickup) {
      await c.query("UPDATE orders SET status=? WHERE id=?", [status, order.id]);
    } else if (status === "delivered") {
      if (order.provider !== "own" || order.status !== "out_for_delivery")
        throw orderError(
          409,
          "Solo el administrador puede cerrar un reparto propio en curso",
        );
      await c.query("UPDATE orders SET status=?,provider_status=? WHERE id=?", [
        status,
        status,
        order.id,
      ]);
    } else {
      await c.query(
        `UPDATE orders
         SET status = ?
         WHERE id = ?`,
        [status, order.id],
      );
    }

    await logEvent(c, order.id, "status.changed", {
      from: order.status,
      status,
    });

    /*
     * Dejamos además constancia
     * explícita de la devolución.
     */
    if (
      status === "cancelled" &&
      order.payment_method === "online" &&
      order.payment_status === "refunded"
    ) {
      await logEvent(c, order.id, "payment.refunded", {
        amountCents: order.refund_amount_cents,
      });
    }
  });

  return {
    ok: true,
  };
}
export async function deliveryQuote(req) {
  const quote = await changeOrder(req, async (c, order) => {
    deliveryReady(order);
    const items = await c.query("SELECT * FROM order_items WHERE order_id=?", [
      order.id,
    ]);
      
    const providers = await getConfiguredDeliveryProviders(order.restaurant_id);
    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          console.log("=== DELIVERY QUOTE ===");
          console.log(
            "ORDER ENVIADO AL PROVIDER:",
            JSON.stringify(
              { ...order, items },
              (key, value) =>
                typeof value === "bigint"
                  ? value.toString()
                  : value,
              2
            )
          );
          const result = await provider.quote({ ...order, items });
          return {
            ...result,
            expiresAt: result.expiresAt || Date.now() + 5 * 60 * 1000,
          };
        } catch (error) {
          return { provider: provider.name, error: error.message };
        }
      }),
    );
    const quotes = results.filter((result) => !result.error),
      errors = results.filter((result) => result.error);
    if (!quotes.length) {
      const details = errors
        .map((item) => `${item.provider}: ${item.error}`)
        .join(" | ");
      throw orderError(
        422,
        `Ningún proveedor pudo cotizar el reparto. Revisa la configuración: ${details}`,
      );
    }
    const payload = { quotes, errors };
    await logEvent(c, order.id, "delivery.quoted", payload);
    return process.env.DELIVERY_PROVIDER === "mock" ? quotes[0] : payload;
  });
  return quote;
}

export async function dispatchDelivery(req) {
  const requestedProvider =
    req.body?.provider ||
    req.body?.quote?.provider ||
    (process.env.DELIVERY_PROVIDER === "mock" ? "mock" : null);
  const requestedQuoteId = req.body?.quoteId || req.body?.quote?.quoteId;
  if (!requestedProvider || !requestedQuoteId)
    throw orderError(400, "Proveedor y quoteId requeridos");
  // Commit the stable QR/idempotency key before any external create request.
  if (requestedProvider === "uber")
    await changeOrder(req, async (c, order) => {
      deliveryReady(order);
      if (!order.pickup_verification_code)
        await c.query(
          "UPDATE orders SET pickup_verification_code=? WHERE id=?",
          [randomUUID(), order.id],
        );
      if (!order.delivery_verification_code)
        await c.query(
          "UPDATE orders SET delivery_verification_code=? WHERE id=?",
          [randomUUID(), order.id],
        );
    });
  const delivery = await changeOrder(req, async (c, order) => {
    deliveryReady(order);
    const events = await c.query(
      "SELECT payload_json FROM order_events WHERE order_id=? AND event_type='delivery.quoted' ORDER BY id DESC LIMIT 1",
      [order.id],
    );
    const stored = events.length ? JSON.parse(events[0].payload_json) : null;
    const quote = stored?.quotes
      ? stored.quotes.find(
          (item) =>
            item.provider === requestedProvider &&
            item.quoteId === requestedQuoteId,
        )
      : stored;
    const provider = await getConfiguredDeliveryProvider(
      order.restaurant_id,
      requestedProvider,
    );
    if (
      !quote ||
      quote.expiresAt <= Date.now() ||
      quote.provider !== provider.name
    )
      throw orderError(
        409,
        "Consulta de nuevo el precio: la oferta ha caducado o no es válida",
      );
    const items = await c.query("SELECT * FROM order_items WHERE order_id=?", [
      order.id,
    ]);
    const delivery = await provider.create({ ...order, items }, quote);
    await c.query(
      "UPDATE orders SET status='delivery_requested',provider=?,provider_order_id=?,provider_status=? WHERE id=?",
      [
        delivery.provider,
        delivery.providerOrderId,
        delivery.providerStatus,
        order.id,
      ],
    );
    await logEvent(c, order.id, "delivery.requested", {
      ...delivery,
      status: "delivery_requested",
      feeCents: quote.feeCents,
    });
    if (delivery.provider === "uber") {
      const update = normalizeDelivery("uber", delivery.raw, {
        snapshot: true,
      });
      if (!update)
        throw orderError(
          502,
          "Uber devolvió un reparto no válido; reintenta la solicitud",
        );
      await applyDeliveryUpdate(
        c,
        {
          ...order,
          status: "delivery_requested",
          provider: "uber",
          provider_order_id: delivery.providerOrderId,
          provider_status: delivery.providerStatus,
        },
        update,
        { source: "create" },
      );
    }
    return delivery;
  });
  return delivery;
}

export async function syncDelivery(req) {
  return changeOrder(req, async (c, order) => {
    if (order.provider !== "uber" || !order.provider_order_id)
      throw orderError(409, "Este pedido no tiene reparto Uber");
    const provider = await getConfiguredDeliveryProvider(
      order.restaurant_id,
      "uber",
      true,
    );
    const data = await provider.get(order.provider_order_id);
    const update = normalizeDelivery("uber", data, { snapshot: true });
    if (!update) throw orderError(502, "Uber devolvió un estado no reconocido");
    return applyDeliveryUpdate(c, order, update, { source: "sync" });
  });
}

export async function pickupQr(req) {
  const order = await adminOrder(req);
  if (!deliveryView(order).showPickupQr)
    throw orderError(409, "QR no disponible: comprueba el estado de recogida");
  return QRCode.toBuffer(order.pickup_verification_code, {
    type: "png",
    width: 320,
    margin: 4,
    errorCorrectionLevel: "M",
  });
}

export async function simulateDelivery(req) {
  const result = await changeOrder(req, async (c, order) => {
    const uberSimulation =
      process.env.DELIVERY_SIMULATION === "true" && order.provider === "uber";
    if (
      (order.provider !== "mock" && !uberSimulation) ||
      !order.provider_order_id
    )
      throw orderError(409, "Este pedido no tiene un reparto simulado");
    const next = mockDelivery.next(order.status);
    if (!next || req.body?.status !== next.status)
      throw orderError(409, "El pedido ya ha cambiado o no permite este paso");
    if (uberSimulation) {
      const update = {
        providerOrderId: order.provider_order_id,
        eventId: `simulation-${next.providerStatus}-${Date.now()}`,
        providerStatus: next.providerStatus,
        status: next.status,
        eventMs: Date.now(),
        data: {
          id: order.provider_order_id,
          status: next.providerStatus,
          ...(next.status === "courier_assigned"
            ? {
                courier: {
                  name: "Repartidor simulado",
                  public_phone_info: { formatted_phone_number: "+34900000000" },
                },
              }
            : next.status === "out_for_delivery"
              ? {
                  pickup: {
                    verification: {
                      barcodes: [
                        {
                          type: "QR",
                          value: order.pickup_verification_code,
                          scan_result: {
                            outcome: "SUCCESS",
                            timestamp: new Date().toISOString(),
                          },
                        },
                      ],
                    },
                  },
                }
              : next.status === "delivered"
                ? {
                    dropoff: {
                      verification: {
                        barcodes: [
                          {
                            type: "QR",
                            value: order.delivery_verification_code,
                            scan_result: {
                              outcome: "SUCCESS",
                              timestamp: new Date().toISOString(),
                            },
                          },
                        ],
                      },
                    },
                  }
                : {}),
        },
        raw: { simulation: true, status: next.providerStatus },
      };
      await applyDeliveryUpdate(c, order, update, { source: "simulation" });
      return next;
    }
    await c.query("UPDATE orders SET status=?,provider_status=? WHERE id=?", [
      next.status,
      next.providerStatus,
      order.id,
    ]);
    await logEvent(c, order.id, "delivery.updated", {
      from: order.status,
      ...next,
      provider: "mock",
    });
    return next;
  });
  return result;
}

export async function createProduct(req) {
  const {
    name,
    description,
    category,
    price_cents,
    active,
    sort_order,
    image_url,
    image_description,
  } = productData(req.body);
  const result = await query(
    "INSERT INTO products(restaurant_id,category,name,description,price_cents,active,sort_order,image_url,image_description) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      req.user.restaurant_id,
      category,
      name,
      description,
      price_cents,
      active,
      sort_order,
      image_url,
      image_description,
    ],
  );
  return { id: Number(result.insertId) };
}

export async function updateProduct(req) {
  const data = productData(req.body, true);
  // Column names come exclusively from productData's allowlist.
  const fields = Object.keys(data);
  const result = await query(
    `UPDATE products SET ${fields.map((field) => field + "=?").join(",")} WHERE id=? AND restaurant_id=?`,
    [...Object.values(data), req.params.id, req.user.restaurant_id],
  );
  if (!result.affectedRows) {
    const existing = await query(
      "SELECT id FROM products WHERE id=? AND restaurant_id=?",
      [req.params.id, req.user.restaurant_id],
    );
    if (!existing.length) throw orderError(404, "Producto no encontrado");
  }
  return { ok: true };
}

export async function deleteProduct(req) {
  // Existing orders retain their product name, quantity and price snapshots.
  const result = await query(
    "DELETE FROM products WHERE id=? AND restaurant_id=?",
    [req.params.id, req.user.restaurant_id],
  );
  if (!result.affectedRows) throw orderError(404, "Producto no encontrado");
  return { ok: true };
}

export async function adminProducts(req) {
  return query(
    "SELECT * FROM products WHERE restaurant_id=? ORDER BY category,sort_order,id",
    [req.user.restaurant_id],
  );
}

export async function adminDeliveryProviders(req) {
  return getDeliveryProviders(req.user.restaurant_id);
}

export async function saveAdminDeliveryProvider(req) {
  const provider = req.params.provider;
  if (!req.body || typeof req.body !== "object")
    throw orderError(400, "Configuración inválida");
  const names = providerFields(provider);
  if (!names) throw orderError(400, "Proveedor no válido");
  const credentials =
    req.body.credentials ||
    Object.fromEntries(
      names.credentials
        .map((name) => [name, req.body[`credentials[${name}]`]])
        .filter(([, value]) => value !== undefined),
    );
  const settings =
    req.body.settings ||
    Object.fromEntries(
      names.settings
        .map((name) => [name, req.body[`settings[${name}]`]])
        .filter(([, value]) => value !== undefined),
    );
  try {
    return await saveDeliveryProvider(req.user.restaurant_id, provider, {
      ...req.body,
      credentials,
      settings,
    });
  } catch (error) {
    if (error.message.includes("DELIVERY_CREDENTIALS_KEY"))
      throw orderError(
        400,
        "Configura DELIVERY_CREDENTIALS_KEY en el archivo .env antes de guardar credenciales\n"+error.message,
      );
    throw error;
  }
}

export async function testAdminDeliveryProvider(req) {
  const providerName = req.params.provider;
  const provider = await getConfiguredDeliveryProvider(
    req.user.restaurant_id,
    providerName,
    true,
  );
  try {
    const result = await provider.testConnection();
    await query(
      "UPDATE delivery_providers SET last_test_status='ok',last_test_error=NULL,last_tested_at=CURRENT_TIMESTAMP WHERE restaurant_id=? AND provider=?",
      [req.user.restaurant_id, providerName],
    );
    return result;
  } catch (error) {
    await query(
      "UPDATE delivery_providers SET last_test_status='error',last_test_error=?,last_tested_at=CURRENT_TIMESTAMP WHERE restaurant_id=? AND provider=?",
      [error.message.slice(0, 500), req.user.restaurant_id, providerName],
    );
    throw error;
  }
}

export async function adminConfigs(req) {
  console.log("Restaurant:", req.client._httpMessage.locals.restaurantName);
  const configs = await query(
    `SELECT * FROM restaurants WHERE name like ?`,
    `%${req.client._httpMessage.locals.restaurantName}%`,
  );
  //const configs=await query(`SELECT * FROM restaurants WHERE id=?`,1);
  return configs[0];
}
export async function updateAdminConfigs(req) {
  const body = {
    ...req.body,
  };

  const rawAddress = body.delivery_address_data;
  if (rawAddress && String(rawAddress).trim() !== "{}") {
    let addressData = rawAddress;
    if (typeof addressData === "string") {
      try {
        addressData = JSON.parse(addressData);
      } catch {
        throw orderError(400, "Dirección seleccionada inválida");
      }
    }
    const addressError = validateAddress(addressData);
    if (addressError) throw orderError(400, addressError);
    const address = cleanAddress(addressData);
    Object.assign(body, {
      address: address.formatted_address,
      city: address.city,
      delivery_formatted_address: address.formatted_address,
      delivery_street: address.street,
      delivery_number: address.number,
      delivery_city: address.city,
      delivery_province: address.province,
      delivery_postal_code: address.postal_code,
      delivery_country: address.country,
      delivery_latitude: address.latitude,
      delivery_longitude: address.longitude,
      delivery_place_id: address.place_id,
    });
  }
  delete body.delivery_address_data;

  // Euros del formulario → céntimos
  if (body.delivery_base_euros !== undefined) {
    body.delivery_base_cents = eurosToCents(body.delivery_base_euros);

    delete body.delivery_base_euros;
  }

  if (body.free_delivery_from_euros !== undefined) {
    body.free_delivery_from_cents = eurosToCents(body.free_delivery_from_euros);

    delete body.free_delivery_from_euros;
  }

  const data = configsData(body, true);

  console.log("CONFIG ACTUALIZADA:", data);

  const fields = Object.keys(data);

  const result = await query(
    `UPDATE restaurants
     SET ${fields.map((field) => `${field}=?`).join(", ")}
     WHERE id=?`,
    [...Object.values(data), req.user.restaurant_id],
  );

  console.log("FILAS MODIFICADAS:", result.affectedRows);

  return { ok: true };
}

function extractByPrefix(row, prefix) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}

export async function getClientes(id = null) {
  const params = [];
  let where = "";

  // Si recibimos un ID, filtramos por ese cliente
  if (id !== null && id !== undefined) {
    where = "WHERE c.id = ?";
    params.push(id);
  }

  const rows = await query(
    `
    SELECT
      c.id AS customer_id,
      c.name AS customer_name,
      c.email AS customer_email,
      c.phone AS customer_phone,
      c.google_sub AS customer_google_sub,

      c.delivery_address AS customer_delivery_address,
      c.delivery_notes AS customer_delivery_notes,
      c.delivery_formatted_address AS customer_delivery_formatted_address,
      c.delivery_street AS customer_delivery_street,
      c.delivery_number AS customer_delivery_number,
      c.delivery_city AS customer_delivery_city,
      c.delivery_province AS customer_delivery_province,
      c.delivery_postal_code AS customer_delivery_postal_code,
      c.delivery_country AS customer_delivery_country,
      c.delivery_latitude AS customer_delivery_latitude,
      c.delivery_longitude AS customer_delivery_longitude,
      c.delivery_place_id AS customer_delivery_place_id,
      c.delivery_patio AS customer_delivery_patio,
      c.delivery_apartment AS customer_delivery_apartment,

      c.created_at AS customer_created_at,

      o.id AS order_id,
      o.restaurant_id AS order_restaurant_id,

      o.payment_method AS order_payment_method,
      o.payment_status AS order_payment_status,
      o.paid_at AS order_paid_at,

      o.delivery_method AS order_delivery_method,
      o.delivery_address AS order_delivery_address,
      o.delivery_notes AS order_delivery_notes,
      o.delivery_formatted_address AS order_delivery_formatted_address,
      o.delivery_street AS order_delivery_street,
      o.delivery_number AS order_delivery_number,
      o.delivery_city AS order_delivery_city,
      o.delivery_province AS order_delivery_province,
      o.delivery_postal_code AS order_delivery_postal_code,
      o.delivery_country AS order_delivery_country,
      o.delivery_latitude AS order_delivery_latitude,
      o.delivery_longitude AS order_delivery_longitude,
      o.delivery_place_id AS order_delivery_place_id,
      o.delivery_patio AS order_delivery_patio,
      o.delivery_apartment AS order_delivery_apartment,

      o.status AS order_status,
      o.subtotal_cents AS order_subtotal_cents,
      o.delivery_cents AS order_delivery_cents,
      o.total_cents AS order_total_cents,
      o.created_at AS order_created_at

    FROM customers c

    LEFT JOIN orders o
      ON o.customer_id = c.id

    ${where}

    ORDER BY
      c.name ASC,
      o.created_at DESC
  `,
    params,
  );

  const customersMap = new Map();

  for (const row of rows) {
    // Creamos el cliente una sola vez
    if (!customersMap.has(row.customer_id)) {
      customersMap.set(row.customer_id, {
        ...extractByPrefix(row, "customer_"),
        orders: [],
        total_orders: 0,
        total_spent_cents: 0,
      });
    }

    // Si esta fila contiene un pedido
    if (row.order_id) {
      const customer = customersMap.get(row.customer_id);

      customer.orders.push(extractByPrefix(row, "order_"));

      customer.total_orders++;

      customer.total_spent_cents += Number(row.order_total_cents || 0);
    }
  }

  const customers = [...customersMap.values()];

  // Si hemos solicitado un cliente concreto
  if (id !== null && id !== undefined) {
    return customers[0] ?? null;
  }

  // Sin ID devolvemos todos
  return customers;
}
