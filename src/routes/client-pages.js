import { Router } from "express";
import rateLimit from "express-rate-limit";
import { signCustomer } from "../auth.js";
import * as clients from "../controllers/clients.js";
import { adminConfigs } from "../controllers/admin.js";
import * as accounts from "../controllers/accounts.js";
import * as payments from "../controllers/redsys-payments.js";
import { httpError } from "../services/http-error.js";
import { presentOrder } from "../services/order-presenter.js";
import {
  requireCustomer,
  setSession,
  clearSession,
  safeNext,
  readCart,
  writeCart,
} from "../services/web-session.js";
import { searchAddresses } from "../services/geocoding.js";
import { createRedsysPayment } from "../services/redsys.js";
const router = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const addressLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });

router.get(["/", "/index.html"], async (req, res) => {
  const data = await clients.menu({ query: { name: "Massa e fuoco" } });
    const configsData = await adminConfigs(req);
    console.log("CONFIGS DATA:", configsData);
  const products = data.products.map((p) => ({ ...p, id: Number(p.id) }));
  const groups = new Map();
  for (const product of products) {
    if (!groups.has(product.category)) groups.set(product.category, []);
    groups.get(product.category).push(product);
  }
  const cart = readCart(req).flatMap((item) => {
    const product = products.find((p) => p.id === item.product_id);
    return product &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      item.quantity <= 50
      ? [
          {
            ...product,
            quantity: item.quantity,
            lineTotal: product.price_cents * item.quantity,
          },
        ]
      : [];
  });

  const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const delivery =
    cart.length &&
    subtotal < Number(configsData.free_delivery_from_cents) || 3000
      ? Number(configsData.delivery_base_cents) || 399
      : 0;
  const profile = req.customer
    ? await accounts.customerProfile(req.customer.sub)
    : null;
  if (profile)
    profile.addressData = {
      formatted_address: profile.delivery_formatted_address,
      street: profile.delivery_street,
      number: profile.delivery_number,
      city: profile.delivery_city,
      province: profile.delivery_province,
      postal_code: profile.delivery_postal_code,
      country: profile.delivery_country,
      latitude: profile.delivery_latitude,
      longitude: profile.delivery_longitude,
      place_id: profile.delivery_place_id,
    };

  res.render("client/store", {
    title: "Carta",
    cartActive: true,
    restaurant: data.restaurant,
    categories: [...groups].map(([name, products]) => ({ name, products })),
    cart,
    subtotal,
    delivery,
    configsData,
    total: subtotal + delivery,
    profile,
    addressData: profile?.addressData,
  });
});
router.post("/cart", async (req, res) => {
  const id = Number(req.body.product_id),
    action = req.body.action;
  if (!Number.isInteger(id) || !["add", "decrease", "remove"].includes(action))
    throw httpError(400, "Operación de carrito no válida");
  const data = await clients.menu({ query: { slug: "demo" } });
  const cart = readCart(req).filter((item) =>
    data.products.some((p) => Number(p.id) === item.product_id),
  );
  const product = data.products.find((p) => Number(p.id) === id);
  if (!product) throw httpError(404, "Artículo no disponible");
  let item = cart.find((i) => i.product_id === id);
  if (action === "add") {
    if (!item) {
      if (cart.length >= 40)
        throw httpError(400, "Máximo 40 artículos distintos por pedido");
      item = { product_id: id, quantity: 0 };
      cart.push(item);
    }
    if (item.quantity >= 50)
      throw httpError(400, "Máximo 50 unidades por artículo");
    item.quantity++;
  } else if (item) item.quantity = action === "remove" ? 0 : item.quantity - 1;
  writeCart(
    res,
    cart.filter((i) => i.quantity > 0),
  );
  res.redirect(303, "/#cartPanel");
});
router.post("/checkout", requireCustomer, async (req, res) => {
  req.body = {
    ...req.body,
    slug: "demo",
    items: readCart(req),
  };
  const order = await clients.createOrder(req);
  console.log("ORDER CHECKOUT:", order);
  // ─────────────────────────────────────────────
  // PAGO ONLINE → REDSYS
  // ─────────────────────────────────────────────
  if (req.body.payment_method === "online") {
    const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, "");

    if (!publicUrl) {
      throw new Error("PUBLIC_URL no configurado");
    }

    /*
     * Redsys admite hasta 12 caracteres.
     *
     * Ejemplo:
     * pedido DB 22 → 000000000022
     */
    const redsysOrder =
      String(Date.now()).slice(-8) + String(order.id).padStart(4, "0");
    await payments.setRedsysPaymentPending(order.id, redsysOrder);
    console.log(
      "REDSYS:",
      "pedido DB =",
      order.id,
      "pedido Redsys =",
      redsysOrder,
      "importe =",
      order.total_cents,
    );
    const payment = createRedsysPayment({
      order: redsysOrder,
      amountCents: order.total_cents,
      merchantUrl: `${publicUrl}/payment/redsys/notification`,
      urlOk: `${publicUrl}/payment/redsys/success?order=${order.id}`,
      urlKo: `${publicUrl}/payment/redsys/error?order=${order.id}`,
    });

    // El pedido ya está creado.
    // Ahora sí podemos vaciar el carrito.
    writeCart(res, []);

    // Página intermedia que hace POST automáticamente a Redsys.
    return res.type("html").send(`
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Conectando con Redsys</title>
      </head>

      <body>

        <p>Conectando con la pasarela de pago segura...</p>

        <form
          id="redsysForm"
          action="${payment.endpoint}"
          method="POST"
        >

          <input
            type="hidden"
            name="Ds_SignatureVersion"
            value="${payment.signatureVersion}"
          >

          <input
            type="hidden"
            name="Ds_MerchantParameters"
            value="${payment.merchantParameters}"
          >

          <input
            type="hidden"
            name="Ds_Signature"
            value="${payment.signature}"
          >

          <noscript>
            <button type="submit">
              Continuar al pago
            </button>
          </noscript>

        </form>

        <script>
          document.getElementById("redsysForm").submit();
        </script>

      </body>
      </html>
    `);
  }

  // ─────────────────────────────────────────────
  // EFECTIVO / TARJETA AL REPARTIDOR
  // ─────────────────────────────────────────────

  writeCart(res, []);

  return res.redirect(303, "/tracking?id=" + order.id);
});
router.get(
  "/client/address-search",
  requireCustomer,
  addressLimit,
  async (req, res) => {
    try {
      console.log("BUSQUEDA:", JSON.stringify(req.query.q));
      console.log("USER AGENT:", req.get("user-agent"));

      const results = await searchAddresses(req.query.q);

      console.log("RESULTADOS:", results);

      return res.json(results);
    } catch (error) {
      console.error("ERROR ADDRESS SEARCH:", error);

      return res
        .status(502)
        .json({ error: "No se pudo consultar el buscador de direcciones" });
    }
  },
);
router.get("/client/login", (req, res) =>
  res.render("client/login", {
    title: "Acceso de clientes",
    loginActive: true,
    next: safeNext(req.query.next, "/client/orders"),
    googleEnabled: !!process.env.GOOGLE_CLIENT_ID,
  }),
);
router.post("/client/login", loginLimit, async (req, res) => {
  const customer = await accounts.loginCustomer(req.body);
  setSession(res, "customer", signCustomer(customer));
  res.redirect(303, safeNext(req.body.next, "/client/orders"));
});
router.post("/client/register", loginLimit, async (req, res) => {
  const customer = await accounts.registerCustomer(req.body);
  setSession(res, "customer", signCustomer(customer));
  res.redirect(303, safeNext(req.body.next, "/client/orders"));
});
router.post("/client/logout", (req, res) => {
  clearSession(res, "customer");
  writeCart(res, []);
  res.redirect(303, "/");
});
router.get("/client/account", requireCustomer, async (req, res) => {
  const profile = await accounts.customerProfile(req.customer.sub);
  profile.addressData = {
    formatted_address: profile.delivery_formatted_address,
    street: profile.delivery_street,
    number: profile.delivery_number,
    city: profile.delivery_city,
    province: profile.delivery_province,
    postal_code: profile.delivery_postal_code,
    country: profile.delivery_country,
    latitude: profile.delivery_latitude,
    longitude: profile.delivery_longitude,
    place_id: profile.delivery_place_id,
  };
  res.render("client/account", {
    title: "Mi cuenta",
    accountActive: true,
    profile,
    addressData: profile.addressData,
    saved: req.query.saved === "1",
  });
});
router.post("/client/account", requireCustomer, async (req, res) => {
  await accounts.updateProfile(req.customer.sub, req.body);
  res.redirect(303, "/client/account?saved=1");
});
router.get("/client/orders", requireCustomer, async (req, res) => {
  const orders = await clients.customerOrders(req);
  res.render("client/orders", {
    title: "Mis pedidos",
    ordersActive: true,
    filter: req.query.filter || "active",
    orders: orders.map(presentOrder),
    refresh: true,
  });
});
router.get(
  ["/tracking", "/tracking.html"],
  requireCustomer,
  async (req, res) => {
    req.params.id = req.query.id;
    const order = presentOrder(await clients.customerOrder(req));
    res.render("client/tracking", {
      title: "Seguimiento",
      ordersActive: true,
      order,
      refresh: !order.finished,
    });
  },
);

export default router;
