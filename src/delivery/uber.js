import dotenv from "dotenv";
dotenv.config();

let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const body = new URLSearchParams({
    client_id: process.env.UBER_CLIENT_ID,
    client_secret: process.env.UBER_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "eats.deliveries"
  });

  const r = await fetch("https://auth.uber.com/oauth/v2/token", {
    method: "POST",
    headers: {"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  if (!r.ok) throw new Error(`Uber auth failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  tokenCache = {token:data.access_token, expiresAt:Date.now()+((data.expires_in-60)*1000)};
  return tokenCache.token;
}

function addressObject(address) {
  // MVP: Uber's API expects a structured address. This parser is intentionally
  // conservative; production should use a geocoder/address form with separate fields.
  return JSON.stringify({
    street_address: [address],
    city: "Valencia",
    state: "Valencia",
    zip_code: "",
    country: "ES"
  });
}

export const uberDelivery = {
  name: "uber",
  async quote(order) {
    const token = await getToken();
    const pickup = {
      location: {
        address: addressObject(process.env.UBER_PICKUP_NAME),
        latitude: Number(process.env.UBER_PICKUP_LAT || 0),
        longitude: Number(process.env.UBER_PICKUP_LNG || 0)
      }
    };

    const r = await fetch("https://api.uber.com/v1/eats/deliveries/estimates", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body: JSON.stringify({
        pickup,
        dropoff_address: addressObject(order.delivery_address),
        pickup_times: [Date.now()+15*60*1000]
      })
    });
    if (!r.ok) throw new Error(`Uber quote failed: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return {
      provider:"uber",
      quoteId:data.estimate_id || data.id,
      feeCents:data.fee?.value ?? data.delivery_fee ?? 0,
      etaMinutes:data.duration ? Math.round(data.duration/60) : null,
      raw:data
    };
  },

  async create(order, quote) {
    const token = await getToken();
    const items = order.items.map(i => ({
      name:i.product_name,
      quantity:i.quantity,
      price:i.unit_price_cents,
      size:"small"
    }));

    const r = await fetch("https://api.uber.com/v1/eats/deliveries/orders", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body: JSON.stringify({
        estimate_id: quote.quoteId,
        pickup_at: Date.now()+15*60*1000,
        pickup_name: process.env.UBER_PICKUP_NAME,
        pickup_address: addressObject(process.env.UBER_PICKUP_NAME),
        pickup_phone_number: process.env.UBER_PICKUP_PHONE,
        dropoff_name: order.customer_name,
        dropoff_address: addressObject(order.delivery_address),
        dropoff_phone_number: order.customer_phone,
        manifest_items: items
      })
    });
    if (!r.ok) throw new Error(`Uber delivery failed: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return {provider:"uber", providerOrderId:data.id || data.order_id, providerStatus:data.status || "CREATED", raw:data};
  }
};
