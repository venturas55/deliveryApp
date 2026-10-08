import {
  useTheme,
  useThemedStyles,
  ThemeProvider,
  ThemeToggle,
} from "./src/shared/theme";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Platform,
  ScrollView,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  api,
  logoutSession,
  restoreSession,
  saveSession,
  setAuthLostHandler,
  getSessionRole,
} from "./src/api";
import { productImageUrl } from "./src/config";
import Constants from "expo-constants";
import OrdersPanel from "./src/OrdersPanel";
import CustomerAccount from "./src/CustomerAccount";
import AdminNavigator from "./src/admin/AdminNavigator";
import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
} from "react-native-nitro-google-signin";

const money = (cents) =>
  `${(Number(cents || 0) / 100).toFixed(2).replace(".", ",")} €`;
const Button = ({ title, onPress, secondary = false, disabled = false }) => {
  const styles = useThemedStyles(baseStyles);
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
};
const Field = ({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}) => {
  const { color } = useTheme();
  const styles = useThemedStyles(baseStyles);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={color("#817d75", "placeholderTextColor")}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      style={styles.input}
    />
  );
};

function ClientNavigator({ onAdminAccess }) {
  const { color } = useTheme();
  const styles = useThemedStyles(baseStyles);
  const [token, setToken] = useState(null),
    [profile, setProfile] = useState(null),
    [screen, setScreen] = useState("menu"),
    [menu, setMenu] = useState([]),
    [restaurant, setRestaurant] = useState(null),
    [deliveryPricing, setDeliveryPricing] = useState(null),
    [orders, setOrders] = useState([]),
    [cart, setCart] = useState({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [pickup, setPickup] = useState(false),
    [payment, setPayment] = useState("online"),
    [phone, setPhone] = useState(""),
    [notes, setNotes] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const menuScroll = useRef(null);
  const ordersPanel = useRef(null);
  const refreshInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const categoryOffsets = useRef({});
  const menuCategories = useMemo(() => {
    const groups = new Map();
    menu.forEach((product) => {
      const category =
        typeof product.category === "string" && product.category.trim()
          ? product.category.trim()
          : "Otros";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(product);
    });
    return [...groups].map(([name, products]) => ({ name, products }));
  }, [menu]);
  const quantities = Object.values(cart).reduce((sum, n) => sum + n, 0);
  useEffect(() => {
    setActiveCategory(menuCategories[0]?.name || "");
  }, [menuCategories]);
  useEffect(() => {
    setAuthLostHandler(() => {
      setToken(null);
      setProfile(null);
      setOrders([]);
      setScreen("auth");
      setError("La sesión ha caducado. Inicia sesión de nuevo.");
    });
    return () => setAuthLostHandler(null);
  }, []);
  function selectCategory(category) {
    const offset = categoryOffsets.current[category];
    if (offset === undefined) return;
    setActiveCategory(category);
    menuScroll.current?.scrollTo({
      y: Math.max(0, offset - 12),
      animated: true,
    });
  }
  function updateActiveCategory(event) {
    const scrollY = event.nativeEvent.contentOffset.y + 48;
    let current = menuCategories[0]?.name || "";
    for (const category of menuCategories) {
      const offset = categoryOffsets.current[category.name];
      if (offset !== undefined && offset <= scrollY) current = category.name;
      else break;
    }
    setActiveCategory((previous) =>
      previous === current ? previous : current,
    );
  }
  const total = useMemo(
    () =>
      menu.reduce(
        (sum, p) => sum + Number(p.price_cents) * (cart[p.id] || 0),
        0,
      ),
    [menu, cart],
  );
  const deliveryCents = pickup
    ? 0
    : deliveryPricing
      ? total >= Number(deliveryPricing.free_from_cents)
        ? 0
        : Number(deliveryPricing.base_cents)
      : null;
  async function refreshProfile(auth = token, syncFields = true) {
    if (!auth) return;
    const p = await api("/customer-auth/me", {}, auth);
    setProfile(p);
    if (syncFields) {
      setName(p.name || "");
      setPhone(p.phone || "");
      setNotes(p.delivery_notes || "");
    }
  }
  async function refreshOrders(auth = token) {
    if (auth) setOrders(await api("/customer/orders?filter=all", {}, auth));
  }
  async function refreshMenu() {
    const m = await api("/public/menu");
    setMenu(m.products || []);
    setRestaurant(m.restaurant);
    setDeliveryPricing(
      m.delivery_pricing ||
        (m.restaurant
          ? {
              base_cents: m.restaurant.delivery_base_cents,
              free_from_cents: m.restaurant.free_delivery_from_cents,
            }
          : null),
    );
  }
  async function refreshClient() {
    if (refreshInFlight.current || busy) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setError("");
    try {
      const results = await Promise.allSettled([
        refreshMenu(),
        token ? refreshProfile(token, false) : Promise.resolve(),
        ordersPanel.current ? ordersPanel.current.refresh() : refreshOrders(),
      ]);
      const failure = results.find(result => result.status === "rejected");
      if (failure) setError(failure.reason.message || "No se pudo actualizar.");
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        await refreshMenu();
        const restored = await restoreSession();
        if (restored) {
          setToken(restored);
          await Promise.all([
            refreshProfile(restored),
            refreshOrders(restored),
          ]);
        } else {
          setScreen("auth");
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    async function handlePaymentReturn(url) {
      let destination;
      try {
        destination = new URL(url);
      } catch {
        return;
      }
      if (
        destination.protocol !== `${Constants.expoConfig?.scheme}:` ||
        destination.hostname !== "payment" ||
        destination.pathname !== "/return"
      )
        return;
      setError("");
      setScreen("orders");
      try {
        const auth = await restoreSession();
        if (auth) await refreshOrders(auth);
      } catch (e) {
        setError(e.message);
      }
    }
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handlePaymentReturn(url),
    );
    Linking.getInitialURL()
      .then((url) => {
        if (url) return handlePaymentReturn(url);
      })
      .catch((e) => setError(e.message));
    return () => subscription.remove();
  }, []);
  async function authenticate() {
    setBusy(true);
    setError("");
    try {
      const data = await api(`/customer-auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(
          authMode === "login"
            ? { email, password }
            : { name, email, password },
        ),
      });
      const auth = await saveSession(data);
      setToken(auth);
      setProfile(data.customer);
      setScreen("menu");
      await refreshProfile(auth);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function authenticateWithGoogle() {
    setBusy(true);
    setError("");

    try {
      const config = await api("/customer-auth/google/config");

      console.log("GOOGLE CONFIG:", {
        enabled: config.enabled,
        clientId: config.clientId,
        hasNonce: !!config.nonce,
        hasChallenge: !!config.challenge,
        iosClientId: Constants.expoConfig?.extra?.googleIosClientId,
      });

      if (!config.enabled) {
        throw new Error(
          "El acceso con Google no está configurado en el servidor.",
        );
      }
      console.log("EXPO CONFIG COMPLETA:", Constants.expoConfig);
      console.log("EXPO EXTRA:", Constants.expoConfig?.extra);
      GoogleOneTapSignIn.configure({
        webClientId: config.clientId,
        iosClientId: Constants.expoConfig?.extra?.googleIosClientId,
        nonce: config.nonce,
        scopes: ["email", "profile"],
      });

      console.log("GOOGLE: configure OK");

      await GoogleOneTapSignIn.checkPlayServices();

      console.log("GOOGLE: checkPlayServices OK");

      let response = await (Platform.OS === "ios"
        ? GoogleOneTapSignIn.presentExplicitSignIn()
        : GoogleOneTapSignIn.signIn());

      console.log("GOOGLE RESPONSE:", response);

      if (isNoSavedCredentialFoundResponse(response)) {
        console.log("GOOGLE: createAccount");
        response = await GoogleOneTapSignIn.createAccount();
        console.log("GOOGLE CREATE RESPONSE:", response);
      }

      if (isNoSavedCredentialFoundResponse(response)) {
        console.log("GOOGLE: presentExplicitSignIn fallback");
        response = await GoogleOneTapSignIn.presentExplicitSignIn();
        console.log("GOOGLE FALLBACK RESPONSE:", response);
      }

      if (isCancelledResponse(response)) {
        console.log("GOOGLE: cancelled");
        return;
      }

      if (!isSuccessResponse(response)) {
        console.log("GOOGLE: response not successful", response);
        throw new Error("No se pudo iniciar sesión con Google.");
      }

      const credential = response.data.idToken;

      console.log("GOOGLE: idToken received:", !!credential);

      if (!credential) {
        throw new Error("Google no devolvió un token de acceso.");
      }

      console.log("GOOGLE: sending token to backend");

      const data = await api("/customer-auth/google/native", {
        method: "POST",
        body: JSON.stringify({
          credential,
          challenge: config.challenge,
        }),
      });

      console.log("GOOGLE: backend authentication OK");

      const auth = await saveSession(data);
      setToken(auth);
      setProfile(data.customer);
      setScreen("menu");

      await Promise.all([refreshProfile(auth), refreshOrders(auth)]);
    } catch (e) {
      console.error("GOOGLE LOGIN ERROR:", e);
      console.error("GOOGLE ERROR MESSAGE:", e?.message);
      console.error("GOOGLE ERROR CODE:", e?.code);
      console.error("GOOGLE ERROR STACK:", e?.stack);

      setError(e?.message || "Error iniciando sesión con Google.");
    } finally {
      setBusy(false);
    }
  }
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      if (payment === "card_on_delivery" && !pickup)
        throw new Error("El pago al recoger requiere recogida en el local.");
      if (!phone.trim())
        throw new Error("Añade un teléfono a tu perfil antes de pedir.");
      if (!pickup && !profile?.delivery_place_id)
        throw new Error(
          "Guarda una dirección validada en Mi cuenta, o elige recogida en local.",
        );
      const items = Object.entries(cart)
        .filter(([, quantity]) => quantity > 0)
        .map(([product_id, quantity]) => ({
          product_id: Number(product_id),
          quantity,
        }));
      const order = await api(
        "/orders",
        {
          method: "POST",
          body: JSON.stringify({
            items,
            slug: "demo",
            delivery_method: pickup ? "pickup" : "delivery",
            payment_method: payment,
            customer_name: profile.name,
            customer_phone: phone,
            delivery_notes: notes,
          }),
        },
        token,
      );
      setCart({});
      setScreen("order");
      if (payment === "online") {
        const { url } = await api(
          `/customer/orders/${order.id}/payment`,
          {
            method: "POST",
            body: JSON.stringify({ appScheme: Constants.expoConfig?.scheme }),
          },
          token,
        );
        await Linking.openURL(url);
      }
      await refreshOrders();
      Alert.alert(
        "Pedido realizado",
        `Pedido #${order.id} - ${money(order.total_cents)}`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    let logoutError = "";
    try {
      await logoutSession();
    } catch (e) {
      logoutError = `Se cerró la sesión localmente, pero no se pudo revocar en el servidor: ${e.message}`;
    } finally {
      setToken(null);
      setProfile(null);
      setOrders([]);
      setScreen("auth");
      setError(logoutError);
    }
  }
  if (loading)
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={color("#9d3d24", "color")} />
      </SafeAreaView>
    );
  const nav = (
    <View style={styles.nav}>
      {[
        ["menu", "Carta"],
        ["cart", `Carrito (${quantities})`],
        ["orders", "Pedidos"],
        ["account", token ? "Mi cuenta" : "Login"],
      ].map(([key, label]) => (
        <Text
          key={key}
          onPress={() => {
            setError("");
            if (
              (key === "orders" || key === "account" || key === "cart") &&
              !token
            ) {
              setScreen("auth");
              return;
            }
            setScreen(key);
            if (key === "orders") refreshOrders();
          }}
          style={[styles.navItem, screen === key && styles.navActive]}
        >
          {label}
        </Text>
      ))}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {/* Nombre del restaurante y botón de tema */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Text
            style={[styles.brand, { flex: 1, marginRight: 8 }]}
            numberOfLines={1}
          >
            {restaurant?.name || "Massa e fuoco Dev"}
          </Text>

          <ThemeToggle small />
        </View>

        <Text style={styles.sub}>Pide tus pizzas favoritas.</Text>

        {!token && (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onAdminAccess}
            style={{ paddingVertical: 12 }}
          >
            <Text style={styles.sub}>Acceso restaurante</Text>
          </TouchableOpacity>
        )}
      </View>
      {nav}
      {screen === "menu" && menuCategories.length > 0 && (
        <View style={styles.categoryBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryList}
          >
            {menuCategories.map(({ name }) => {
              const active = activeCategory === name;
              return (
                <TouchableOpacity
                  key={name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => selectCategory(name)}
                  style={[
                    styles.categoryChip,
                    active && styles.categoryChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      active && styles.categoryChipTextActive,
                    ]}
                  >
                    {name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
      <ScrollView
        ref={menuScroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        onScroll={screen === "menu" ? updateActiveCategory : undefined}
        scrollEventThrottle={100}
        alwaysBounceVertical
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshClient}
            enabled={!busy}
            tintColor={color("#9d3d24", "color")}
            colors={[color("#9d3d24", "color")]}
          />
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {screen === "menu" && (
          <>
            <Text style={styles.title}>Nuestra carta</Text>
            {menuCategories.map(({ name, products }) => (
              <View
                key={name}
                onLayout={({ nativeEvent }) => {
                  categoryOffsets.current[name] = nativeEvent.layout.y;
                }}
              >
                <Text style={styles.categoryHeading}>{name}</Text>
                {products.map((p) => (
                  <View style={styles.card} key={String(p.id)}>
                    {productImageUrl(p.image_url) && (
                      <Image
                        source={{ uri: productImageUrl(p.image_url) }}
                        style={styles.productImage}
                        resizeMode="cover"
                        accessibilityLabel={p.image_description || p.name}
                      />
                    )}
                    <View style={styles.productRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.product}>{p.name}</Text>
                        <Text style={styles.muted}>
                          {p.description || p.category}
                        </Text>
                        <Text style={styles.price}>{money(p.price_cents)}</Text>
                      </View>
                      <Button
                        title={cart[p.id] ? `Añadir + ${cart[p.id]}` : "Añadir"}
                        onPress={() =>
                          setCart({ ...cart, [p.id]: (cart[p.id] || 0) + 1 })
                        }
                      />
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}
        {screen === "auth" && (
          <>
            <Text style={styles.title}>
              {authMode === "login" ? "Entrar" : "Crear cuenta"}
            </Text>
            {authMode === "register" && (
              <Field value={name} onChangeText={setName} placeholder="Nombre" />
            )}
            <Field
              value={email}
              onChangeText={setEmail}
              placeholder="Correo electrónico"
              keyboardType="email-address"
            />
            <Field
              value={password}
              onChangeText={setPassword}
              placeholder="Contraseña (mínimo 8 caracteres)"
              secureTextEntry
            />
            <Button
              title={
                busy
                  ? "Conectando:"
                  : authMode === "login"
                    ? "Iniciar sesión"
                    : "Registrarme"
              }
              onPress={authenticate}
              disabled={busy}
            />
            <Button
              secondary
              title={authMode === "login" ? "Crear cuenta" : "Ya tengo cuenta"}
              onPress={() =>
                setAuthMode(authMode === "login" ? "register" : "login")
              }
            />
            {authMode === "login" && (
              <>
                <Text style={styles.or}>o</Text>
                <Button
                  secondary
                  title={
                    busy ? "Conectando con Google?" : "Continuar con Google"
                  }
                  onPress={authenticateWithGoogle}
                  disabled={busy}
                />
              </>
            )}
          </>
        )}
        {screen === "cart" && (
          <>
            <Text style={styles.title}>Tu pedido</Text>
            {!quantities && (
              <Text style={styles.muted}>Aún no has añadido pizzas.</Text>
            )}
            {menu
              .filter((p) => cart[p.id])
              .map((p) => (
                <View style={styles.cartRow} key={String(p.id)}>
                  <Text style={styles.product}>{p.name}</Text>
                  <View style={styles.stepper}>
                    <Text
                      onPress={() =>
                        setCart({
                          ...cart,
                          [p.id]: Math.max(0, cart[p.id] - 1),
                        })
                      }
                      style={styles.step}
                    >
                      -
                    </Text>
                    <Text>{cart[p.id]}</Text>
                    <Text
                      onPress={() =>
                        setCart({ ...cart, [p.id]: cart[p.id] + 1 })
                      }
                      style={styles.step}
                    >
                      +
                    </Text>
                  </View>
                  <Text>{money(p.price_cents * cart[p.id])}</Text>
                </View>
              ))}
            <Text style={styles.total}>Subtotal {money(total)}</Text>
            {!!quantities && (
              <>
                {!pickup && (
                  <Text style={[styles.muted, { textAlign: "right" }]}>
                    {deliveryCents === null
                      ? "Coste de env\u00edo no disponible"
                      : `Env\u00edo ${money(deliveryCents)}`}
                  </Text>
                )}
                {deliveryCents !== null && (
                  <Text style={styles.total}>
                    Total {money(total + deliveryCents)}
                  </Text>
                )}
              </>
            )}
            {!!quantities && (
              <>
                <Text style={styles.label}>Entrega</Text>
                <View style={styles.row}>
                  <Button
                    secondary={pickup}
                    title="A domicilio"
                    onPress={() => {
                      setPickup(false);
                      setPayment("online");
                    }}
                  />
                  <Button
                    secondary={!pickup}
                    title="Recogida"
                    onPress={() => setPickup(true)}
                  />
                </View>
                <Text style={styles.muted}>
                  {pickup
                    ? "Recogerás el pedido en el local."
                    : profile?.delivery_formatted_address ||
                      "Usaremos tu Dirección guardada en la cuenta."}
                </Text>
                <Text style={styles.label}>Pago</Text>
                <View style={styles.row}>
                  <Button
                    secondary={payment !== "online"}
                    title="Tarjeta"
                    onPress={() => setPayment("online")}
                  />
                  <Button
                    secondary={payment !== "card_on_delivery"}
                    title="Al recoger"
                    onPress={() => setPayment("card_on_delivery")}
                    disabled={!pickup || busy}
                  />
                </View>
                <Text style={styles.muted}>
                  {payment === "online"
                    ? "Pago seguro con tarjeta en Redsys."
                    : "Paga con tarjeta al recoger en el local."}
                </Text>
                <Button
                  title={busy ? "Enviando pedido" : "Confirmar pedido"}
                  onPress={checkout}
                  disabled={busy}
                />
              </>
            )}
          </>
        )}
        {screen === "orders" && <OrdersPanel ref={ordersPanel} token={token} />}
        {screen === "order" && (
          <>
            <Text style={styles.title}>Pedido enviado</Text>
            <Text style={styles.muted}>
              Puedes consultar el estado desde "Pedidos".
            </Text>
            <Button
              title="Ver pedidos"
              onPress={() => {
                setScreen("orders");
                refreshOrders();
              }}
            />
          </>
        )}
        {screen === "account" && (
          <CustomerAccount profile={profile} token={token} onUpdated={refreshProfile} onLogout={logout} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
function AppContent() {
  const { color } = useTheme();
  const styles = useThemedStyles(baseStyles);
  const { dark, ready } = useTheme();
  const adminOnly = Constants.expoConfig?.extra?.appTarget === "admin";
  const [mode, setMode] = useState(null);
  useEffect(() => {
    let alive = true;
    getSessionRole()
      .then((role) => {
        if (alive) setMode(adminOnly || role === "admin" ? "admin" : "client");
      })
      .catch(() => {
        if (alive) setMode(adminOnly ? "admin" : "client");
      });
    return () => {
      alive = false;
    };
  }, [adminOnly]);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      {!ready || mode === null ? (
        <SafeAreaView style={styles.center}>
          <ActivityIndicator color={color("#9d3d24", "color")} />
        </SafeAreaView>
      ) : mode === "admin" ? (
        <AdminNavigator
          adminOnly={adminOnly}
          onClient={() => setMode("client")}
        />
      ) : (
        <ClientNavigator onAdminAccess={() => setMode("admin")} />
      )}
    </SafeAreaProvider>
  );
}
function statusName(status) {
  return (
    {
      new: "Solicitando",
      accepted: "Aceptado",
      preparing: "Preparando",
      ready: "Listo",
      delivery_requested: "Buscando repartidor",
      courier_assigned: "Repartidor asignado",
      out_for_delivery: "En reparto",
      delivered: "Entregado",
      cancelled: "Cancelado",
    }[status] || status
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f4ee" },
  center: {
    backgroundColor: "#f7f4ee",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 },
  brand: { color: "#392d27", fontSize: 24, fontWeight: "800" },
  sub: { color: "#777067", marginTop: 3 },
  nav: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e4ded3",
    backgroundColor: "#fff",
  },
  navItem: { paddingVertical: 13, color: "#716a61", fontWeight: "600" },
  navActive: { color: "#9d3d24" },
  categoryBar: {
    backgroundColor: "#f7f4ee",
    borderBottomWidth: 1,
    borderColor: "#e4ded3",
  },
  categoryList: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e4ded3",
  },
  categoryChipActive: {
    backgroundColor: "#9d3d24",
    borderColor: "#9d3d24",
  },
  categoryChipText: { color: "#51483f", fontSize: 14, fontWeight: "600" },
  categoryChipTextActive: { color: "#fff" },
  content: { padding: 18, paddingBottom: 40 },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#392d27",
    marginBottom: 16,
  },
  categoryHeading: {
    color: "#392d27",
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 12,
    marginTop: 8,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  productImage: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    backgroundColor: "#eee8df",
  },
  productRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  product: { fontSize: 16, fontWeight: "700", color: "#332820" },
  muted: { color: "#777067", marginTop: 5, lineHeight: 20 },
  price: { color: "#9d3d24", fontWeight: "700", marginTop: 8 },
  button: {
    backgroundColor: "#9d3d24",
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondary: { backgroundColor: "#eee8df" },
  secondaryText: { color: "#51483f" },
  input: {
    backgroundColor: "#fff",
    borderColor: "#e4ded3",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 11,
    color: "#332820",
  },
  cartRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: "#e4ded3",
    paddingVertical: 14,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 13 },
  step: { fontSize: 22, color: "#9d3d24", paddingHorizontal: 5 },
  total: {
    textAlign: "right",
    fontSize: 18,
    fontWeight: "800",
    marginVertical: 17,
    color: "#332820",
  },
  label: {
    fontWeight: "700",
    color: "#51483f",
    marginTop: 12,
    marginBottom: 4,
  },
  or: { textAlign: "center", color: "#777067", marginTop: 12 },
  row: { flexDirection: "row", gap: 10 },
  error: {
    backgroundColor: "#fbe5de",
    color: "#862c1b",
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
});
