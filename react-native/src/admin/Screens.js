import { t } from "../i18n/index";
import LanguageSettings from "../i18n/LanguageSettings";
import { useTheme } from "../shared/theme";
import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { Button, Card, Field, money, useStyles } from "../shared/ui";
import { OrderCard } from "./Orders";
import useAdminData from "./useAdminData";
import { adminApi, write } from "./api";
import { Grid, GRID_GAP, useContentLayout } from "../shared/layout";
import { productImageUrl } from "../config";
import CustomerEmail from "./CustomerEmail";
import { Ionicons } from "@expo/vector-icons";

function CustomerAvatar({ customer }) {
  const { color } = useTheme();
  const uri = productImageUrl(customer.profile_image_url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const style = { width: 48, height: 48, borderRadius: 24, flexShrink: 0 };
  return uri && !failed ? (
    <Image source={{ uri }} style={style} resizeMode="cover"
      accessibilityLabel={`Foto de perfil de ${customer.name}`}
      onError={() => setFailed(true)} />
  ) : (
    <View style={[style, { alignItems: "center", justifyContent: "center",
      backgroundColor: color("#eee8df", "backgroundColor") }]}
      accessible accessibilityLabel={`Sin foto de perfil de ${customer.name}`}>
      <Ionicons name="person-outline" size={24} color={color("#716a61", "color")} />
    </View>
  );
}

function Problem({ error }) {
  const { color } = useTheme();
  const s = useStyles();
  return error ? (
    <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>
  ) : null;
}
function Page({ resource, children, form = false, scrollRef, onScroll }) {
  const { color } = useTheme();
  const s = useStyles();
  return (
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={100}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[s.content, s.responsiveContent, form && s.form]}
      refreshControl={
        <RefreshControl
          refreshing={resource.loading}
          onRefresh={resource.refresh}
        />
      }
    >
      <Problem error={resource.error} />
      {!resource.data && resource.loading ? (
        <Text style={s.muted}>{t("Cargando…")}</Text>
      ) : (
        children
      )}
    </ScrollView>
  );
}

export function Dashboard({ navigate }) {
  const { color } = useTheme();
  const s = useStyles();
  const resource = useAdminData("/dashboard", 30000),
    data = resource.data;
  return (
    <Page resource={resource}>
      {data && (
        <>
          <Text style={s.heading}>{t("Hoy")}</Text>
          <Card>
            <Text style={s.title}>{t(money(data.today.sales_cents))}</Text>
            <Text style={s.muted}>{t("{{v0}} pedidos · importe no cancelado ni reembolsado; puede incluir pagos pendientes", { v0: t(data.today.orders) })}</Text>
          </Card>
          <Text style={s.heading}>{t("Operación")}</Text>
          <Grid>
            {[
              ["new", "Pendientes"],
              ["accepted", "Aceptados"],
              ["preparing", "En preparación"],
              ["ready", "Listos"],
              ["out_for_delivery", "En reparto"],
            ].map(([status, label]) => (
              <Card key={status} onPress={() => navigate("orders", { status })}>
                <View style={s.row}>
                  <Text style={s.text}>{t(label)}</Text>
                  <Text style={s.title}>{t(data.counts[status] || 0)}</Text>
                </View>
              </Card>
            ))}
            <Card
              onPress={() =>
                navigate("orders", { status: "delivery_requested" })
              }
            >
              <Text style={s.text}>{t("Repartos buscando/asignados: {{v0}}", { v0: t((data.counts.delivery_requested || 0) +
                  (data.counts.courier_assigned || 0)) })}</Text>
            </Card>
          </Grid>
          <Button title={t("Nuevo pedido")} onPress={() => navigate("create")} />
          <Button
            secondary
            title={t("Estadísticas")}
            onPress={() => navigate("stats")}
          />
        </>
      )}
    </Page>
  );
}

export function Customers({ openCustomer, selectCustomer }) {
  const { color } = useTheme();
  const s = useStyles();
  const { columns, itemWidth } = useContentLayout();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useAdminData(`/customers?q=${encodeURIComponent(query)}`);
  return (
    <View style={{ flex: 1 }}>
      {emailOpen && <CustomerEmail close={() => setEmailOpen(false)} />}
      <View style={[s.form, { padding: 18 }]}>
        {!selectCustomer && (
          <Button
            title={t("Nueva comunicación")}
            onPress={() => setEmailOpen(true)}
          />
        )}
        <Field
          label={t("Buscar nombre, teléfono o email")}
          value={search}
          onChangeText={setSearch}
           keyboardType="phone-pad"
        />
      </View>
      <Problem error={resource.error} />
      <FlatList
        key={columns}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap: GRID_GAP } : undefined}
        data={resource.data || []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[s.content, s.responsiveContent]}
        refreshControl={
          <RefreshControl
            refreshing={resource.loading}
            onRefresh={resource.refresh}
          />
        }
        renderItem={({ item }) => (
          <View style={{ width: columns === 1 ? "100%" : itemWidth }}>
            <Card
              onPress={() =>
                selectCustomer ? selectCustomer(item) : openCustomer(item.id)
              }
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <CustomerAvatar customer={item} />
                <Text style={[s.heading, { flex: 1, minWidth: 0, marginBottom: 0 }]}>{item.name}</Text>
              </View>
              <Text style={s.muted}>{t("{{v0}} · {{v1}}", { v0: item.phone, v1: item.email })}</Text>
              {selectCustomer &&
              (item.delivery_formatted_address || item.delivery_address) ? (
                <Text style={s.muted}>{t("Dirección de entrega: {{v0}}", { v0: item.delivery_formatted_address || item.delivery_address })}</Text>
              ) : null}
              <Text style={s.text}>{t("{{v0}} pedidos · {{v1}} entregados", { v0: t(item.total_orders), v1: t(money(item.total_spent_cents)) })}</Text>
            </Card>
          </View>
        )}
        ListEmptyComponent={
          !resource.loading && !resource.error ? (
            <Text style={s.muted}>{t("Sin clientes con pedidos en este restaurante.")}</Text>
          ) : null
        }
        ListFooterComponent={
          resource.data?.length === 100 ? (
            <Text style={s.muted}>{t("Mostrando 100 clientes. Afina la búsqueda.")}</Text>
          ) : null
        }
      />
    </View>
  );
}

export function CustomerDetail({ id, openOrder }) {
  const { color } = useTheme();
  const s = useStyles();
  const resource = useAdminData(`/customers/${encodeURIComponent(id)}`),
    customer = resource.data;
  const [emailOpen, setEmailOpen] = useState(false);
  return (
    <Page resource={resource}>
      {customer && (
        <>
          {emailOpen && (
            <CustomerEmail
              customer={customer}
              close={() => setEmailOpen(false)}
            />
          )}
          <Button
            title={t("Enviar correo")}
            disabled={!customer.email?.trim()}
            onPress={() => setEmailOpen(true)}
          />
          <Card>
            <Text style={s.heading}>{customer.name}</Text>
            <Text style={s.text}>{customer.phone}</Text>
            <Text style={s.text}>{customer.email}</Text>
            {customer.delivery_formatted_address ||
            customer.delivery_address ? (
              <Text style={s.text}>{t("Dirección de entrega: {{v0}}", { v0: customer.delivery_formatted_address ||
                  customer.delivery_address })}</Text>
            ) : null}
            <Text style={s.text}>{t("{{v0}} pedidos · {{v1}} entregados", { v0: t(customer.total_orders), v1: t(money(customer.total_spent_cents)) })}</Text>
          </Card>
          <Text style={s.heading}>{t("Historial del restaurante")}</Text>
          <Grid maxColumns={2}>
            {customer.orders.map((order) => (
              <OrderCard
                key={String(order.id)}
                order={order}
                onPress={() => openOrder(order.id)}
              />
            ))}
          </Grid>
          {customer.orders.length === 200 && (
            <Text style={s.muted}>{t("Últimos 200 pedidos. Consulta anteriores desde Pedidos.")}</Text>
          )}
        </>
      )}
    </Page>
  );
}

export function Products() {
  const { color } = useTheme();
  const s = useStyles();
  const resource = useAdminData("/products"),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function update(id, body) {
    setBusy(true);
    setError("");
    try {
      await write(`/products/${id}`, body, "PATCH");
      await resource.refresh();
      setEditing(null);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page resource={resource} form={!!editing}>
      <Problem error={error} />
      {editing ? (
        <ProductEditor
          key={editing.id}
          product={editing}
          busy={busy}
          save={(body) => update(editing.id, body)}
          cancel={() => setEditing(null)}
        />
      ) : (
        <Grid>
          {(resource.data || []).map((product) => (
            <Card key={product.id}>
              {productImageUrl(product.image_url) ? (
                <Image
                  accessibilityLabel={`Foto de ${product.name}`}
                  source={{ uri: productImageUrl(product.image_url) }}
                  resizeMode="cover"
                  style={{
                    width: "100%",
                    height: 180,
                    borderRadius: 10,
                    marginBottom: 8,
                  }}
                />
              ) : (
                <View style={{ height: 64, justifyContent: "center" }}>
                  <Text style={s.muted}>{t("Sin foto")}</Text>
                </View>
              )}
              <Text style={s.heading}>{product.name}</Text>
              <Text style={s.muted}>{t("{{v0}} · {{v1}}", { v0: product.category, v1: t(money(product.price_cents)) })}</Text>
              <View style={s.row}>
                <Text style={s.text}>{t(Number(product.active) ? "Disponible" : "Agotado")}</Text>
                <Switch
                  accessibilityLabel={`Disponibilidad de ${product.name}`}
                  disabled={busy}
                  value={!!Number(product.active)}
                  onValueChange={(value) =>
                    update(product.id, { active: Number(value) })
                  }
                />
              </View>
              <Button
                secondary
                title={t("Editar artículo")}
                disabled={busy}
                onPress={() => setEditing(product)}
              />
            </Card>
          ))}
        </Grid>
      )}
      {resource.data?.length === 0 && (
        <Text style={s.muted}>{t("Sin artículos.")}</Text>
      )}
    </Page>
  );
}
function ProductEditor({ product, save, cancel, busy }) {
  const { color } = useTheme();
  const s = useStyles();
  const [name, setName] = useState(product.name),
    [price, setPrice] = useState((product.price_cents / 100).toFixed(2)),
    [category, setCategory] = useState(product.category),
    [description, setDescription] = useState(product.description || ""),
    [imageUrl, setImageUrl] = useState(product.image_url || ""),
    [error, setError] = useState("");
  function submit() {
    if (!/^\d+([.,]\d{1,2})?$/.test(price)) {
      setError("Precio no válido");
      return;
    }
    save({
      name,
      category,
      description,
      image_url: imageUrl.trim(),
      price_cents: Math.round(Number(price.replace(",", ".")) * 100),
    });
  }
  const imageUri = productImageUrl(imageUrl);
  return (
    <Card>
      {imageUri ? (
        <Image
          accessibilityLabel={`Foto de ${product.name}`}
          source={{ uri: imageUri }}
          resizeMode="cover"
          style={{
            width: "100%",
            height: 200,
            borderRadius: 10,
            marginBottom: 8,
          }}
        />
      ) : (
        <Text style={s.muted}>{t("Sin foto")}</Text>
      )}
      <Field
        label={t("URL de la imagen (vacío para quitarla)")}
        value={imageUrl}
        onChangeText={setImageUrl}
        maxLength={500}
        autoCapitalize="none"
        keyboardType="url"
      />
      <Field
        label={t("Nombre")}
        value={name}
        onChangeText={setName}
        maxLength={120}
      />
      <Field
        label={t("Precio (€)")}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <Field
        label={t("Categoría")}
        value={category}
        onChangeText={setCategory}
        maxLength={80}
      />
      <Field
        label={t("Descripción")}
        value={description}
        onChangeText={setDescription}
        maxLength={255}
        multiline
      />
      <Problem error={error} />
      <Button title={t("Guardar artículo")} disabled={busy} onPress={submit} />
      <Button secondary title={t("Volver")} disabled={busy} onPress={cancel} />
    </Card>
  );
}

export function Statistics() {
  const { color } = useTheme();
  const s = useStyles();
  const resource = useAdminData("/stats"),
    data = resource.data;
  const [selectedDay, setSelectedDay] = useState("");
  const [hourlyMode, setHourlyMode] = useState("day");
  const daily = Array.isArray(data?.daily) ? data.daily : [];
  const customers = Array.isArray(data?.customerSpending)
    ? data.customerSpending
    : [];
  useEffect(() => {
    if (daily.length) setSelectedDay(daily[daily.length - 1].day);
  }, [daily]);
  const selected =
    daily.find((day) => day.day === selectedDay) || daily[daily.length - 1];
  const hourlySource =
    hourlyMode === "history" ? data?.historicalHourly : selected?.hourly;
  const hasHourlyData = Array.isArray(hourlySource);
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const label = `${String(hour).padStart(2, "0")}:00`;
    const value = Array.isArray(hourlySource)
      ? hourlySource.find((item) => item.label === label)
      : null;
    return { label, total: Number(value?.total) || 0 };
  });
  const dailyMax = Math.max(1, ...daily.map((day) => day.total));
  const hourlyMax = Math.max(1, ...hourly.map((hour) => hour.total));
  return (
    <Page resource={resource}>
      {data && (
        <>
          <Card>
            <Text style={s.heading}>{t("Resumen de pedidos entregados")}</Text>
            <Text style={s.title}>{t(money(data.totals.sales_cents))}</Text>
            <Text style={s.text}>{t("{{v0}} pedidos · {{v1}} clientes", { v0: t(data.totals.orders), v1: t(data.totals.customers) })}</Text>
            <Text style={s.text}>{t("Ticket medio: {{v0}}", { v0: t(money(data.totals.average_cents)) })}</Text>
          </Card>
          <Card>
            <Text style={s.heading}>{t("Pedidos por día")}</Text>
            <Text style={s.muted}>{t("Últimos 14 días · selecciona un día para ver sus horas")}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                alignItems: "flex-end",
                gap: 8,
                paddingVertical: 12,
              }}
            >
              {daily.map((day) => {
                const active = day.day === selected?.day;
                const height = Math.max(
                  day.total ? 6 : 2,
                  (day.total / dailyMax) * 106,
                );
                return (
                  <Pressable
                    key={day.day}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={t("{{v0}}: {{v1}} pedidos", { v0: t(day.label), v1: t(day.total) })}
                    onPress={() => setSelectedDay(day.day)}
                    style={{ width: 48, alignItems: "center", gap: 5 }}
                  >
                    <Text style={[s.muted, { marginTop: 0 }]}>{t(day.total)}</Text>
                    <View
                      style={{
                        height: 110,
                        width: 26,
                        justifyContent: "flex-end",
                        backgroundColor: color("#f4eee5", "backgroundColor"),
                        borderRadius: 7,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height,
                          backgroundColor: active ? "#923a25" : "#bd8a68",
                          borderRadius: 7,
                        }}
                      />
                    </View>
                    <Text
                      style={[
                        s.muted,
                        active && {
                          color: color("#923a25", "color"),
                          fontWeight: "700",
                        },
                        { marginTop: 0 },
                      ]}
                    >{t(day.label)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Card>
          <Card>
            <Text style={s.heading}>{t("Pedidos por hora {{v0}}", { v0: t(hourlyMode === "day" && selected
                ? ` · ${selected.label}`
                : " · histórico") })}</Text>
            <View style={s.row}>
              <Button
                secondary={hourlyMode !== "day"}
                title={t("Día seleccionado")}
                onPress={() => setHourlyMode("day")}
              />
              <Button
                secondary={hourlyMode !== "history"}
                title={t("Todo el histórico")}
                onPress={() => setHourlyMode("history")}
              />
            </View>
            {!hasHourlyData ? (
              <Text style={s.muted}>{t("El servidor no devolvió los datos horarios. Actualiza el servidor para ver esta gráfica.")}</Text>
            ) : (
              <>
                <Text style={s.muted}>{t("Cada barra representa el intervalo indicado (24 horas).")}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{
                    alignItems: "flex-end",
                    gap: 6,
                    paddingVertical: 12,
                  }}
                >
                  {hourly.map((hour) => {
                    const hourNumber = Number(hour.label.slice(0, 2));
                    const nextHour = (hourNumber + 1) % 24;
                    const interval = `${hour.label}–${String(nextHour).padStart(2, "0")}:00`;
                    const height = hour.total
                      ? Math.max(5, (hour.total / hourlyMax) * 104)
                      : 2;
                    return (
                      <View
                        key={hour.label}
                        accessibilityLabel={t("{{v0}}: {{v1}} pedidos", { v0: t(interval), v1: t(hour.total) })}
                        style={{ width: 46, alignItems: "center", gap: 5 }}
                      >
                        <Text style={[s.muted, { marginTop: 0 }]}>{t(hour.total)}</Text>
                        <View
                          style={{
                            height: 108,
                            width: 28,
                            justifyContent: "flex-end",
                            backgroundColor: color(
                              "#f4eee5",
                              "backgroundColor",
                            ),
                            borderRadius: 7,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              height,
                              backgroundColor: color(
                                "#923a25",
                                "backgroundColor",
                              ),
                              borderRadius: 7,
                            }}
                          />
                        </View>
                        <Text style={[s.muted, { marginTop: 0 }]}>{t(String(hourNumber).padStart(2, "0"))}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
                {hourly.every((hour) => hour.total === 0) && (
                  <Text style={s.muted}>{t(hourlyMode === "day"
                      ? "No hay pedidos registrados en este día."
                      : "Todavía no hay pedidos en el histórico.")}</Text>
                )}
              </>
            )}
          </Card>
          <Card>
            <Text style={s.heading}>{t("Clientes que más han gastado")}</Text>
            <Text style={s.muted}>{t("Histórico · pedidos entregados, sin reembolsos")}</Text>
            {customers.length ? (
              customers.map((customer) => (
                <View
                  key={customer.id}
                  style={[
                    s.row,
                    {
                      justifyContent: "flex-start",
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: color("#e6ded3", "borderBottomColor"),
                    },
                  ]}
                >
                  <Text style={[s.heading, { width: 36, marginBottom: 0 }]}>{t("{{v0}}.", { v0: t(customer.rank) })}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.text}>{customer.name}</Text>
                    <Text style={s.muted}>{t("{{v0}} pedidos {{v1}}", { v0: t(customer.total_orders), v1: t(customer.phone ? ` · ${customer.phone}` : "") })}</Text>
                  </View>
                  <Text style={[s.text, { fontWeight: "700" }]}>{t(money(customer.total_spent_cents))}</Text>
                </View>
              ))
            ) : (
              <Text style={s.muted}>{t("Todavía no hay clientes con pedidos entregados.")}</Text>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

export function Settings({ logout }) {
  const resource = useAdminData("/restaurant");
  return (
    <Page resource={resource}>
      <LanguageSettings />
      {resource.data && <RestaurantEditor restaurant={resource.data} />}
      <Button secondary title={t("Cerrar sesión")} onPress={logout} />
    </Page>
  );
}
function RestaurantEditor({ restaurant }) {
  const s = useStyles();
  const initial = (row) => ({
    ...Object.fromEntries(
      [
        "name",
        "phone",
        "slug",
        "legal_name",
        "tax_id",
        "legal_address",
        "legal_email",
        "legal_registration",
      ].map((key) => [key, row[key] || ""]),
    ),
    delivery_base_cents: (Number(row.delivery_base_cents || 0) / 100).toFixed(
      2,
    ),
    free_delivery_from_cents: (
      Number(row.free_delivery_from_cents || 0) / 100
    ).toFixed(2),
  });
  const [form, setForm] = useState(() => initial(restaurant));
  const [logo, setLogo] = useState(null);
  const [logoUrl, setLogoUrl] = useState(restaurant.logo_url);
  const [pickingLogo, setPickingLogo] = useState(false);
  const [address, setAddress] = useState(null);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setForm(initial(restaurant));
    setLogo(null);
    setLogoUrl(restaurant.logo_url);
    setAddress(null);
    setMessage("");
  }, [restaurant.id]);
  useEffect(() => {
    console.log("ESTADO LOGO:", logo);
  }, [logo]);
  const field = (key, label, maxLength, props = {}) => (
    <Field
      key={key}
      label={t(label)}
      value={form[key]}
      maxLength={maxLength}
      editable={!busy}
      onChangeText={(value) => {
        setForm((previous) => ({ ...previous, [key]: value }));
        setMessage("");
      }}
      {...props}
    />
  );
  const readOnly = (label, value) => (
    <Field label={t(label)} value={String(value || "")} editable={false} />
  );
  async function pickLogo() {
    setPickingLogo(true);
    setError("");
    try {
      const picker = require("expo-document-picker");
      const result = await picker.getDocumentAsync({
        type: ["image/jpeg", "image/png", "image/webp"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (
        !asset ||
        !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)
      )
        throw new Error("Selecciona JPEG, PNG o WebP.");
      if (asset.size > 5 * 1024 * 1024)
        throw new Error("El logo no puede superar 5 MB.");
      setLogo(asset);
      setMessage("");
    } catch (failure) {
      setError(
        /Cannot find native module.*ExpoDocumentPicker/.test(failure.message)
          ? "Actualiza la app con una nueva compilación para adjuntar el logo."
          : failure.message,
      );
    } finally {
      setPickingLogo(false);
    }
  }
  async function findAddress() {
    setSearching(true);
    setError("");
    setSuggestions([]);
    try {
      const results = await adminApi(
        `/address-search?q=${encodeURIComponent(search.trim())}`,
      );
      setSuggestions(results);
      if (!results.length)
        setError(
          "No se encontraron direcciones. Añade calle, número y ciudad.",
        );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSearching(false);
    }
  }
  async function save() {
    if (busy || searching || pickingLogo) return;
    setError("");
    setMessage("");
    if (!form.name.trim() || !form.slug.trim()) {
      setError("Completa nombre e identificador web.");
      return;
    }
    for (const key of ["delivery_base_cents", "free_delivery_from_cents"]) {
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(form[key].trim())) {
        setError(
          "Introduce importes válidos, positivos o cero, con máximo dos decimales.",
        );
        return;
      }
    }
    setBusy(true);
    try {
      console.log("LOGO ANTES DE GUARDAR:", logo);
      let body = {
        ...form,
        ...(address ? { delivery_address_data: address } : {}),
      };
      if (logo) {
        body = new FormData();
        Object.entries(form).forEach(([key, value]) => body.append(key, value));
        if (address)
          body.append("delivery_address_data", JSON.stringify(address));
        const logoBlob = Platform.OS === "web"
          ? logo.file
          : await (await fetch(logo.uri)).blob();
        body.append(
          "logo",
          new Blob([logoBlob], { type: logo.mimeType || "image/png" }),
          logo.name || "logo.png",
        );
      }
      console.log("BODY ES FORMDATA:", body instanceof FormData);
      const saved = await write("/restaurant", body, "PATCH");
      setLogoUrl(saved.logo_url);
      setLogo(null);
      setMessage("Cambios guardados.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card>
        <Text style={s.heading}>{t("Datos del negocio")}</Text>
        <Text style={s.muted}>{t("Información que identifica a tu restaurante.")}</Text>
        <Text style={s.label}>{t("Logo de la empresa")}</Text>
        {logo?.uri || productImageUrl(logoUrl) ? (
          <Image
            source={{ uri: logo?.uri || productImageUrl(logoUrl) }}
            style={{
              width: 160,
              height: 120,
              alignSelf: "center",
              marginVertical: 12,
            }}
            resizeMode="contain"
            accessibilityLabel={t("Logo de la empresa")}
          />
        ) : (
          <Text style={s.muted}>{t("Sin logo")}</Text>
        )}
        <Text style={s.muted}>{t("JPEG, PNG o WebP. Máximo 5 MB. Se aplica al guardar cambios.")}</Text>
        <Button
          secondary
          title={t(pickingLogo ? "Abriendo..." : "Adjuntar logo")}
          disabled={busy || pickingLogo}
          onPress={pickLogo}
        />
        {logo && (
          <Button
            secondary
            title={t("Cancelar selección del logo")}
            disabled={busy}
            onPress={() => setLogo(null)}
          />
        )}
        {field("name", "Nombre del negocio", 120)}
        <Grid minWidth={260} maxColumns={2}>
          {field("phone", "Teléfono", 40, {
            keyboardType: "phone-pad",
            autoComplete: "tel",
          })}
          {readOnly(
            "Ciudad",
            address?.city || restaurant.delivery_city || restaurant.city,
          )}
        </Grid>
        {readOnly(
          "Dirección",
          address?.formatted_address || restaurant.address,
        )}
        <Field
          label={t("Buscar dirección")}
          value={search}
          onChangeText={setSearch}
          maxLength={200}
          editable={!busy && !searching}
          placeholder={t("Calle, número y ciudad")}
        />
        <Button
          secondary
          title={t(searching ? "Buscando..." : "Buscar dirección")}
          disabled={busy || searching || search.trim().length < 3}
          onPress={findAddress}
        />
        {suggestions.map((result) => (
          <Button
            key={result.place_id}
            secondary
            title={result.suggestion || result.formatted_address}
            disabled={busy}
            onPress={() => {
              setAddress(result);
              setSuggestions([]);
              setSearch("");
              setMessage("");
            }}
          />
        ))}
        {readOnly("Número", address?.number || restaurant.delivery_number)}
        {address && (
          <Text style={s.muted}>{t("Dirección seleccionada: {{v0}}. Se aplicará al guardar.", { v0: address.formatted_address })}</Text>
        )}
      </Card>
      <Card>
        <Text style={s.heading}>{t("Identificación legal")}</Text>
        <Text style={s.muted}>{t("Estos datos aparecerán en las páginas legales públicas. Completa la información real del titular antes de publicar.")}</Text>
        <Grid minWidth={260} maxColumns={2}>
          {field("legal_name", "Razón social o nombre del titular", 150)}
          {field("tax_id", "NIF", 24, { autoCapitalize: "characters" })}
        </Grid>
        {field("legal_address", "Domicilio legal", 500)}
        <Text style={s.muted}>{t("Si coincide con la dirección del negocio, puedes dejarlo vacío.")}</Text>
        <Grid minWidth={260} maxColumns={2}>
          {field("legal_email", "Correo de contacto legal y privacidad", 190, {
            keyboardType: "email-address",
            autoCapitalize: "none",
            autoComplete: "email",
          })}
          {field(
            "legal_registration",
            "Registro y datos registrales (si procede)",
            255,
          )}
        </Grid>
      </Card>
      <Card>
        <Text style={s.heading}>{t("Configuración del reparto")}</Text>
        <Text style={s.muted}>{t("Define el coste estándar y cuándo ofrecer el envío gratuito.")}</Text>
        <Grid minWidth={260} maxColumns={2}>
          <View>
            {field("delivery_base_cents", "Coste de envío (€)", 12, {
              keyboardType: "decimal-pad",
            })}
            <Text style={s.muted}>{t("Importe aplicado por defecto a los pedidos con reparto.")}</Text>
          </View>
          <View>
            {field("free_delivery_from_cents", "Envío gratis desde (€)", 12, {
              keyboardType: "decimal-pad",
            })}
            <Text style={s.muted}>{t("Importe mínimo del pedido para no cobrar gastos de envío.")}</Text>
          </View>
        </Grid>
      </Card>
      <Card>
        <Text style={s.heading}>{t("Información de la cuenta")}</Text>
        <Text style={s.muted}>{t("Datos internos asignados al restaurante.")}</Text>
        <Grid minWidth={260} maxColumns={2}>
          {readOnly("ID del restaurante", restaurant.id)}
          {field("slug", "Identificador web", 80, {
            autoCapitalize: "none",
            autoCorrect: false,
          })}
        </Grid>
        <Text style={s.muted}>{t("Identificador utilizado internamente en la URL del negocio.")}</Text>
        {readOnly("Cuenta creada", restaurant.created_at)}
      </Card>
      <Text style={s.muted}>{t("Los cambios se aplicarán a la configuración actual del restaurante.")}</Text>
      <Problem error={error} />
      {message ? (
        <Text accessibilityRole="alert" style={s.text}>{t(message)}</Text>
      ) : null}
      <Button
        title={t(busy ? "Guardando..." : "Guardar cambios")}
        disabled={busy || searching || pickingLogo}
        onPress={save}
      />
    </>
  );
}

export function CreateOrder({ openOrder }) {
  const { color } = useTheme();
  const s = useStyles();
  const [customer, setCustomer] = useState(null),
    [cart, setCart] = useState({}),
    [pickup, setPickup] = useState(true),
    [card, setCard] = useState(false),
    [counter, setCounter] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [activeCategory, setActiveCategory] = useState("");
  const resource = useAdminData("/products");
  const products = (resource.data || []).filter((product) =>
    Number(product.active),
  );
  const { columns, itemWidth } = useContentLayout(320, 2);
  const scrollRef = useRef(null),
    categoryOffsets = useRef({});
  const categories = [
    ...new Set(products.map((product) => product.category?.trim() || "Otros")),
  ];
  useEffect(() => {
    setActiveCategory(categories[0] || "");
  }, [resource.data]);
  function selectCategory(category) {
    const offset = categoryOffsets.current[category];
    if (offset === undefined) return;
    setActiveCategory(category);
    scrollRef.current?.scrollTo({
      y: Math.max(0, offset - 12),
      animated: true,
    });
  }
  function updateActiveCategory(event) {
    const scrollY = event.nativeEvent.contentOffset.y + 48;
    let current = categories[0] || "";
    for (const category of categories) {
      const offset = categoryOffsets.current[category];
      if (offset !== undefined && offset <= scrollY) current = category;
      else break;
    }
    setActiveCategory((previous) =>
      previous === current ? previous : current,
    );
  }
  if (!customer) return <Customers selectCustomer={setCustomer} />;
  const subtotal = products.reduce(
    (total, product) => total + product.price_cents * (cart[product.id] || 0),
    0,
  );
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const order = await write("/orders", {
        customer_id: customer.id,
        channel: counter ? "counter" : "telephone",
        delivery_method: pickup ? "pickup" : "delivery",
        payment_method: card ? "card_on_delivery" : "cash",
        items: Object.entries(cart)
          .filter(([, quantity]) => quantity > 0)
          .map(([id, quantity]) => ({ product_id: Number(id), quantity })),
      });
      openOrder(order.id);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      resource={resource}
      scrollRef={scrollRef}
      onScroll={updateActiveCategory}
    >
      <Card>
        <Text style={s.heading}>{customer.name}</Text>
        <Text style={s.muted}>{t("{{v0}} - {{v1}}", { v0: customer.phone, v1: customer.email })}</Text>
        {customer.delivery_formatted_address || customer.delivery_address ? (
          <Text style={s.muted}>{t("Dirección de entrega: {{v0}}", { v0: customer.delivery_formatted_address || customer.delivery_address })}</Text>
        ) : null}
        <Button
          secondary
          title={t("Cambiar cliente")}
          onPress={() => setCustomer(null)}
        />
      </Card>
      <Text style={s.muted}>{t("Clientes con pedidos previos en este restaurante. Nuevos clientes: alta desde administración web.")}</Text>
      {!!categories.length && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        >
          {categories.map((category) => {
            const active = activeCategory === category;
            return (
              <Button
                key={category}
                secondary={!active}
                title={t(category)}
                onPress={() => selectCategory(category)}
              />
            );
          })}
        </ScrollView>
      )}
      {categories.map((category) => {
        const categoryProducts = products.filter(
          (product) => (product.category?.trim() || "Otros") === category,
        );
        return (
          <View
            key={category}
            onLayout={({ nativeEvent }) => {
              categoryOffsets.current[category] = nativeEvent.layout.y;
            }}
          >
            <Text style={s.heading}>{t(category)}</Text>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP }}
            >
              {categoryProducts.map((product) => (
                <View
                  key={product.id}
                  style={{ width: columns === 1 ? "100%" : itemWidth }}
                >
                  <Card>
                    {productImageUrl(product.image_url) ? (
                      <Image
                        accessibilityLabel={`Foto de ${product.name}`}
                        source={{ uri: productImageUrl(product.image_url) }}
                        resizeMode="cover"
                        style={{
                          width: "100%",
                          height: 150,
                          borderRadius: 10,
                          marginBottom: 8,
                        }}
                      />
                    ) : (
                      <View style={{ height: 48, justifyContent: "center" }}>
                        <Text style={s.muted}>{t("Sin foto")}</Text>
                      </View>
                    )}
                    <Text style={s.heading}>{product.name}</Text>
                    {!!product.description && (
                      <Text style={s.muted}>{product.description}</Text>
                    )}
                    <Text style={[s.text, { fontWeight: "700" }]}>{t(money(product.price_cents))}</Text>
                    <View style={s.row}>
                      <Button
                        secondary
                        title={t("−")}
                        disabled={busy || !cart[product.id]}
                        onPress={() =>
                          setCart((current) => ({
                            ...current,
                            [product.id]: Math.max(
                              0,
                              (current[product.id] || 0) - 1,
                            ),
                          }))
                        }
                      />
                      <Text style={s.text}>{t(cart[product.id] || 0)}</Text>
                      <Button
                        secondary
                        title={t("+")}
                        disabled={busy || cart[product.id] >= 50}
                        onPress={() =>
                          setCart((current) => ({
                            ...current,
                            [product.id]: (current[product.id] || 0) + 1,
                          }))
                        }
                      />
                    </View>
                  </Card>
                </View>
              ))}
            </View>
          </View>
        );
      })}
      <Card>
        <Text style={s.heading}>{t("Resumen del pedido")}</Text>
        {products
          .filter((product) => cart[product.id] > 0)
          .map((product) => (
            <Text key={product.id} style={s.text}>{t("{{v0}} × {{v1}} · {{v2}}", { v0: t(cart[product.id]), v1: product.name, v2: t(money(cart[product.id] * product.price_cents)) })}</Text>
          ))}
        {!subtotal && (
          <Text style={s.muted}>{t("Añade artículos para crear el pedido.")}</Text>
        )}
        {[
          ["Recogida en local", pickup, setPickup],
          ["Tarjeta al entregar", card, setCard],
          ["Pedido en mostrador", counter, setCounter],
        ].map(([label, value, set]) => (
          <View key={label} style={s.row}>
            <Text style={[s.text, { flex: 1 }]}>{t(label)}</Text>
            <Switch
              accessibilityLabel={t(label)}
              value={value}
              onValueChange={set}
              disabled={busy}
            />
          </View>
        ))}
        <Text style={s.muted}>{t(pickup
            ? "Recogida sin gastos de reparto."
            : "Usa dirección guardada del cliente. El reparto se calcula al crear el pedido.")}</Text>
        <Text style={s.heading}>{t("Total de artículos: {{v0}}", { v0: t(money(subtotal)) })}</Text>
      </Card>
      <Problem error={error} />
      <Button
        title={t(busy ? "Creando…" : "Crear pedido")}
        disabled={busy || subtotal === 0}
        onPress={submit}
      />
    </Page>
  );
}
