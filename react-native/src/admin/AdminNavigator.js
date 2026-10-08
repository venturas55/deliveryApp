import { useTheme, ThemeToggle } from "../shared/theme";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Image,
  Platform,
  ScrollView,
  Text,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  api,
  getSessionRole,
  logoutSession,
  restoreSession,
  saveSession,
  setAuthLostHandler,
} from "../api";
import { Button, Field, useStyles } from "../shared/ui";
import { adminApi } from "./api";
import { productImageUrl } from "../config";
import { Orders, OrderDetail } from "./Orders";
import {
  CustomerDetail,
  Customers,
  CreateOrder,
  Dashboard,
  Products,
  Settings,
  Statistics,
} from "./Screens";
import useAdminData from "./useAdminData";
import { ContentPane, SIDEBAR_WIDTH } from "../shared/layout";
import useOrderSound from "./useOrderSound";

const destinations = [
  ["dashboard", "Resumen"],
  ["orders", "Pedidos"],
  ["create", "Nuevo pedido"],
  ["customers", "Clientes"],
  ["products", "Artículos"],
  ["stats", "Estadísticas"],
  ["settings", "Ajustes"],
];

function RestaurantLogo() {
  const { data } = useAdminData("/restaurant", 15000);
  const uri = productImageUrl(data?.logo_url);
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel="Logo de la empresa"
      resizeMode="contain"
      style={{ width: "100%", height: 100, marginTop: 12 }}
    />
  );
}

function Navigation({ current, navigate, sidebar }) {
  const { color } = useTheme();
  const s = useStyles();
  const selected = (name) =>
    current.name === name ||
    (name === "orders" && current.name === "order") ||
    (name === "customers" && current.name === "customer");
  return (
    <ScrollView
      horizontal={!sidebar}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ padding: 12, gap: 8 }}
    >
      {destinations.map(([name, label]) => (
        <Button
          key={name}
          title={label}
          chip
          selected={selected(name)}
          onPress={() => navigate(name)}
        />
      ))}
    </ScrollView>
  );
}

function OrderNotice({ navigate, soundEnabled }) {
  const { color } = useTheme();
  const s = useStyles();
  const [cursor, setCursor] = useState(null),
    [count, setCount] = useState(0);
  const seen = useRef(new Set());
  const { notify, error: soundError } = useOrderSound(soundEnabled);
  const path = cursor
    ? `/order-notifications?afterId=${cursor.afterId}&since=${encodeURIComponent(cursor.since)}`
    : "/order-notifications";
  const { data, error } = useAdminData(path, 15000);
  useEffect(() => {
    if (!data) return;
    if (!cursor) {
      data.events.forEach((event) =>
        seen.current.add(`${event.id}:${event.kind}`),
      );
      setCursor(data.cursor);
      return;
    }
    const added = data.events.filter(
      (event) => !seen.current.has(`${event.id}:${event.kind}`),
    );
    added.forEach((event) => seen.current.add(`${event.id}:${event.kind}`));
    if (added.length) {
      setCount((current) => current + added.length);
      Vibration.vibrate(250);
      notify(added.length);
    }
  }, [data, cursor, notify]);
  return (
    <>
      {error && <Text style={s.error}>Avisos: {error}</Text>}
      {soundError && (
        <Text accessibilityRole="alert" style={s.error}>
          Sonido: {soundError}
        </Text>
      )}
      {count > 0 && (
        <Card
          onPress={() => {
            setCount(0);
            navigate("orders");
          }}
          style={{
            margin: 12,
            backgroundColor: color("#fce8da", "backgroundColor"),
          }}
          accessibilityLiveRegion="polite"
        >
          <Text style={s.heading}>{count} avisos de pedidos · Ver pedidos</Text>
        </Card>
      )}
    </>
  );
}

export default function AdminNavigator({ onClient, adminOnly = false }) {
  const { color } = useTheme();
  const s = useStyles();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sidebar =
    width - insets.left - insets.right >= 900 * Math.max(1, fontScale);
  const [authenticated, setAuthenticated] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [stack, setStack] = useState([{ name: "dashboard", params: {} }]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const current = stack[stack.length - 1];
  const navigate = (name, params = {}) => setStack([{ name, params }]);
  const push = (name, params) =>
    setStack((value) => [...value, { name, params }]);
  const back = () =>
    setStack((value) => (value.length > 1 ? value.slice(0, -1) : value));
  useEffect(() => {
    let alive = true;
    setAuthLostHandler(() => {
      setAuthenticated(false);
      setPassword("");
      navigate("dashboard");
      setError("La sesión ha caducado. Inicia sesión de nuevo.");
    });
    (async () => {
      try {
        if ((await getSessionRole()) === "admin") {
          const token = await restoreSession();
          if (token) {
            await adminApi("/me");
            if (alive) setAuthenticated(true);
          }
        } else if (adminOnly) await logoutSession();
      } catch (failure) {
        if (alive) setError(failure.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      setAuthLostHandler(null);
    };
  }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [stack.length]);
  async function login() {
    setBusy(true);
    setError("");
    try {
      const session = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      await saveSession(session);
      await adminApi("/me");
      setPassword("");
      setAuthenticated(true);
      navigate("dashboard");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await logoutSession();
    } catch (failure) {
      Alert.alert("Cierre de sesión", failure.message);
    }
    setAuthenticated(false);
    navigate("dashboard");
  }
  if (loading)
    return (
      <SafeAreaView style={[s.safe, { justifyContent: "center" }]}>
        <ActivityIndicator color={color("#923a25", "color")} />
      </SafeAreaView>
    );
  if (!authenticated)
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              s.content,
              s.form,
              { flexGrow: 1, justifyContent: "center" },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.title}>Massa e fuoco Admin</Text>
            <Text style={s.muted}>Acceso del restaurante</Text>
            <ThemeToggle />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
            />
            {error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            <Button
              title={busy ? "Entrando…" : "Entrar"}
              onPress={login}
              disabled={busy || !email || !password}
            />
            {!adminOnly && (
              <Button
                secondary
                title="Volver a cliente"
                disabled={busy}
                onPress={onClient}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  const openOrder = (id) => push("order", { id });
  const titles = {
    dashboard: "Resumen",
    orders: "Pedidos",
    order: `Pedido #${current.params.id}`,
    customers: "Clientes",
    customer: "Cliente",
    products: "Artículos",
    stats: "Estadísticas",
    settings: "Restaurante",
    create: "Nuevo pedido",
  };
  return (
    <SafeAreaView style={s.safe}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {sidebar && (
          <View
            key="sidebar"
            style={{
              width: SIDEBAR_WIDTH,
              backgroundColor: color("#efe7db", "backgroundColor"),
              borderRightWidth: 1,
              borderRightColor: color("#e6ded3", "borderRightColor"),
            }}
          >
            <View style={{ padding: 18 }}>
              <Text style={s.heading}>Massa e fuoco</Text>
              <Text style={s.muted}>Restaurante</Text>
              <RestaurantLogo />
            </View>
            <Navigation current={current} navigate={navigate} sidebar />
          </View>
        )}
        <ContentPane key="workspace">
          <View style={[s.header, { flexWrap: "wrap" }]}>
            <ThemeToggle />
            <Button
              secondary
              icon={
                soundEnabled ? "volume-high-outline" : "volume-mute-outline"
              }
              selected={soundEnabled}
              accessibilityLabel={
                soundEnabled ? "Silenciar avisos" : "Activar sonido"
              }
              onPress={() => setSoundEnabled((value) => !value)}
            />
            <View style={{ flex: 1, minWidth: 140 }}>
              <Text style={s.muted}>MASSA E FUOCO · ADMIN</Text>
              <Text style={s.title}>{titles[current.name]}</Text>
            </View>
            {stack.length > 1 && (
              <Button secondary title="Volver" onPress={back} />
            )}
          </View>
          <OrderNotice navigate={navigate} soundEnabled={soundEnabled} />
          <View
            style={{ flex: 1 }}
            key={`${current.name}:${current.params.id || current.params.status || ""}`}
          >
            {current.name === "dashboard" && <Dashboard navigate={navigate} />}
            {current.name === "orders" && (
              <Orders
                openOrder={openOrder}
                initialStatus={current.params.status}
              />
            )}
            {current.name === "order" && <OrderDetail id={current.params.id} />}
            {current.name === "customers" && (
              <Customers openCustomer={(id) => push("customer", { id })} />
            )}
            {current.name === "customer" && (
              <CustomerDetail id={current.params.id} openOrder={openOrder} />
            )}
            {current.name === "products" && <Products />}
            {current.name === "stats" && <Statistics />}
            {current.name === "settings" && <Settings logout={logout} />}
            {current.name === "create" && <CreateOrder openOrder={openOrder} />}
          </View>
          {!sidebar && (
            <View>
              <Navigation current={current} navigate={navigate} />
            </View>
          )}
        </ContentPane>
      </View>
    </SafeAreaView>
  );
}
