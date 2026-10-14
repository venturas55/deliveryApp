import { LocalizedAlert as Alert } from "../i18n/LocaleProvider";
import { t } from "../i18n/index";
import { useTheme } from "../shared/theme";
import React, { useState } from "react";
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  Button,
  Card,
  date,
  money,
  paymentName,
  paymentStatus,
  useStyles,
} from "../shared/ui";
import useAdminData from "./useAdminData";
import { orderPath, write } from "./api";
import { Grid, GRID_GAP, useContentLayout } from "../shared/layout";

const filters = [
  ["new", "Nuevos"],
  ["accepted", "Aceptados"],
  ["preparing", "Preparación"],
  ["ready", "Listos"],
  ["delivery_requested", "Buscando reparto"],
  ["courier_assigned", "Asignados"],
  ["out_for_delivery", "En reparto"],
  ["delivered", "Entregados"],
  ["cancelled", "Cancelados"],
];
const colors = {
  new: "#923a25",
  accepted: "#275c91",
  preparing: "#865e13",
  ready: "#276944",
  out_for_delivery: "#62418c",
  cancelled: "#8b2c2c",
};

function OrderTiming({ order }) {
  const { color } = useTheme();
  const s = useStyles();
  const scheduled = !!order.scheduled_for;
  const time = scheduled ? order.scheduleLabel || new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(order.scheduled_for)) : null;
  return (
    <View style={{ borderWidth: 1, borderColor: color("#9d3d24"), borderRadius: 10, padding: 12, gap: 4 }}>
      <Text style={s.muted}>{t("Hora solicitada")}</Text>
      <Text style={s.heading}>{t(scheduled ? "Programado" : "Lo antes posible")}</Text>
      {scheduled && <Text style={s.text}>{t("{{v0}} · {{v1}}", {v0: time, v1: "Europe/Madrid"})}</Text>}
    </View>
  );
}

export function OrderCard({ order, onPress }) {
  const { color } = useTheme();
  const s = useStyles();
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000),
  );
  return (
    <Card onPress={onPress}>
      <View style={s.row}>
        <Text style={s.heading}>{t("#{{v0}}", { v0: t(order.id) })}</Text>
        <Text style={s.heading}>{t(money(order.total_cents))}</Text>
      </View>
      <Text style={s.text}>{order.customer_name}</Text>
      <OrderTiming order={order} />
      <Text
        style={[s.label, { color: color(colors[order.status] || "#53483e") }]}
      >{t(order.statusLabel)}</Text>
      <Text style={s.muted}>{t("{{v0}} · {{v1}} · {{v2}}", { v0: t(order.delivery_method === "pickup" ? "Recogida" : "Reparto"), v1: t(paymentName(order.payment_method)), v2: t(paymentStatus(order.payment_status)) })}</Text>
      <Text style={s.muted}>{t("{{v0}} · {{v1}}", { v0: t(date(order.created_at)), v1: t(order.status === "delivered" || order.status === "cancelled"
          ? "Finalizado"
          : `${minutes} min transcurridos`) })}</Text>
    </Card>
  );
}

export function Orders({ openOrder, initialStatus = "new" }) {
  const { color } = useTheme();
  const s = useStyles();
  const { columns, itemWidth } = useContentLayout(320, 2);
  const [status, setStatus] = useState(initialStatus),
    [before, setBefore] = useState(""),
    [delivery, setDelivery] = useState("all");
  const { data, loading, error, refresh } = useAdminData(
    `/orders?view=mobile&filter=all&status=${status}&delivery_method=${delivery}${before ? `&before_id=${before}` : ""}`,
    ["delivered", "cancelled"].includes(status) || before ? 0 : 15000,
  );
  const changeStatus = (value) => {
    setBefore("");
    setStatus(value);
  };
  return (
    <View style={{ flex: 1 }}>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, padding: 14 }}
        >
          {filters.map(([key, label]) => (
            <Button
              key={key}
              title={t(label)}
              chip
              selected={status === key}
              onPress={() => changeStatus(key)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={[s.wrap, { paddingHorizontal: 18, marginBottom: 8 }]}>
        {[
          ["all", "Todos"],
          ["pickup", "Recogida"],
          ["delivery", "Reparto"],
        ].map(([key, label]) => (
          <Button
            key={key}
            title={t(label)}
            chip
            selected={delivery === key}
            onPress={() => {
              setDelivery(key);
              setBefore("");
            }}
          />
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>
      ) : null}
      <FlatList
        key={columns}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap: GRID_GAP } : undefined}
        data={data || []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[s.content, s.responsiveContent]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={color("#923a25", "tintColor")}
          />
        }
        renderItem={({ item }) => (
          <View style={{ width: columns === 1 ? "100%" : itemWidth }}>
            <OrderCard order={item} onPress={() => openOrder(item.id)} />
          </View>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={s.muted}>{t("Sin pedidos en este estado.")}</Text>
          ) : null
        }
        ListFooterComponent={
          <View>
            {data?.length === 200 && (
              <Button
                secondary
                title={t("Pedidos anteriores")}
                onPress={() => setBefore(String(data[data.length - 1].id))}
              />
            )}
            {before && (
              <Button
                secondary
                title={t("Volver a los recientes")}
                onPress={() => setBefore("")}
              />
            )}
          </View>
        }
      />
    </View>
  );
}

export function OrderDetail({ id }) {
  const { color } = useTheme();
  const s = useStyles();
  const {
    data: order,
    error,
    loading,
    refresh,
  } = useAdminData(`${orderPath(id)}?view=mobile`, 15000);
  const [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [quotes, setQuotes] = useState([]);
  async function action(path, body = {}, method = "POST") {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await write(orderPath(id) + path, body, method);
      if (path === "/delivery/quote") setQuotes(result.quotes || [result]);
      else setQuotes([]);
      await refresh();
    } catch (failure) {
      setProblem(failure.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!order)
    return (
      <View style={s.content}>
        <Text style={error ? s.error : s.muted}>{t(error || "Cargando pedido…")}</Text>
        <Button secondary title={t("Reintentar")} onPress={refresh} />
      </View>
    );
  const confirm = (title, text, callback) =>
    Alert.alert(title, text, [
      { text: "Volver", style: "cancel" },
      { text: "Confirmar", onPress: callback },
    ]);
  return (
    <ScrollView
      contentContainerStyle={[s.content, s.responsiveContent]}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refresh} />
      }
    >
      <OrderCard order={order} />
      {problem || error ? (
        <Text accessibilityRole="alert" style={s.error}>{t(problem || error)}</Text>
      ) : null}
      <Grid minWidth={360} maxColumns={2}>
        <View style={{ gap: GRID_GAP }}>
          <Card>
            <Text style={s.heading}>{t("Artículos")}</Text>
            {order.items.map((item) => (
              <View style={s.row} key={String(item.id)}>
                <Text style={[s.text, { flex: 1 }]}>{t("{{v0}} × {{v1}}", { v0: t(item.quantity), v1: item.product_name })}</Text>
                <Text style={s.text}>{t(money(item.quantity * item.unit_price_cents))}</Text>
              </View>
            ))}
          </Card>
          <Card>
            <Text style={s.heading}>{t("Cliente")}</Text>
            <Text style={s.text}>{order.customer_name}</Text>
            <Button
              secondary
              title={t("Llamar: {{v0}}", { v0: order.customer_phone || "sin teléfono" })}
              disabled={!order.customer_phone}
              onPress={() =>
                Linking.openURL(`tel:${order.customer_phone}`).catch(
                  (failure) => setProblem(failure.message),
                )
              }
            />
            <Text style={s.text}>{order.delivery_address}</Text>
            {order.delivery_apartment ? (
              <Text style={s.text}>{t("Piso: {{v0}}", { v0: order.delivery_apartment })}</Text>
            ) : null}
            {order.delivery_patio ? (
              <Text style={s.text}>{t("Patio: {{v0}}", { v0: order.delivery_patio })}</Text>
            ) : null}
            {order.delivery_notes ? (
              <Text style={s.text}>{t("Observaciones: {{v0}}", { v0: order.delivery_notes })}</Text>
            ) : null}
          </Card>
        </View>
        <View style={{ gap: GRID_GAP }}>
          <Card>
            <Text style={s.heading}>{t("Importe y pago")}</Text>
            <Text style={s.text}>{t("Artículos: {{v0}}", { v0: t(money(order.subtotal_cents)) })}</Text>
            <Text style={s.text}>{t("Descuento: {{v0}}", { v0: t(money(order.discount_cents)) })}</Text>
            <Text style={s.text}>{t("Reparto: {{v0}}", { v0: t(money(order.delivery_cents)) })}</Text>
            <Text style={s.heading}>{t("Total: {{v0}}", { v0: t(money(order.total_cents)) })}</Text>
            <Text style={s.text}>{t("{{v0}} · {{v1}}", { v0: t(paymentName(order.payment_method)), v1: t(paymentStatus(order.payment_status)) })}</Text>
            {order.canMarkPaid && (
              <Button
                title={t("Marcar pago recibido")}
                disabled={busy}
                onPress={() =>
                  confirm(
                    "Confirmar cobro",
                    "Marca el pago solo después de recibir el importe.",
                    () => action("/mark-paid"),
                  )
                }
              />
            )}
          </Card>
          {order.nextStatus && (
            <Button
              title={t(order.nextLabel)}
              disabled={busy}
              onPress={() =>
                action("/status", { status: order.nextStatus }, "PATCH")
              }
            />
          )}
          {order.canCompletePickup && (
            <Button
              title={t("Entregado al cliente")}
              disabled={busy}
              onPress={() =>
                action("/status", { status: "delivered" }, "PATCH")
              }
            />
          )}
          {order.canStartOwnDelivery && (
            <Button
              title={t("Iniciar reparto propio")}
              disabled={busy}
              onPress={() =>
                action("/status", { status: "out_for_delivery" }, "PATCH")
              }
            />
          )}
          {order.canCompleteOwnDelivery && (
            <Button
              title={t("Marcar entregado")}
              disabled={busy}
              onPress={() =>
                action("/status", { status: "delivered" }, "PATCH")
              }
            />
          )}
          {order.delivery_method === "delivery" && (
            <Card>
              <Text style={s.heading}>{t("Reparto")}</Text>
              <Text style={s.text}>{t("{{v0}} {{v1}}", { v0: t(order.provider || "Sin proveedor asignado"), v1: t(order.provider_status || "") })}</Text>
              {order.delivery?.trackingUrl && (
                <Button
                  secondary
                  title={t("Abrir seguimiento")}
                  onPress={() =>
                    Linking.openURL(order.delivery.trackingUrl).catch(
                      (failure) => setProblem(failure.message),
                    )
                  }
                />
              )}
              {order.delivery?.canSync && (
                <Button
                  secondary
                  title={t("Consultar estado del proveedor")}
                  disabled={busy}
                  onPress={() => action("/delivery/sync")}
                />
              )}
              {order.canQuote && (
                <Button
                  secondary
                  title={t("Consultar precio de reparto")}
                  disabled={busy}
                  onPress={() => action("/delivery/quote")}
                />
              )}
              {order.canQuote &&
                quotes
                  .filter((quote) => quote.expiresAt > Date.now())
                  .map((quote) => (
                    <Button
                      key={quote.quoteId}
                      title={t("{{v0}}: {{v1}} · Solicitar", { v0: t(quote.provider), v1: t(money(quote.feeCents)) })}
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          "Solicitar reparto",
                          `${quote.provider}: ${money(quote.feeCents)}`,
                          () =>
                            action("/delivery", {
                              provider: quote.provider,
                              quoteId: quote.quoteId,
                            }),
                        )
                      }
                    />
                  ))}
            </Card>
          )}
          {order.canCancel && (
            <Button
              danger
              title={t("Cancelar pedido")}
              disabled={busy}
              onPress={() =>
                confirm(
                  "Cancelar pedido",
                  "Se devolverá el pago online cuando corresponda.",
                  () => action("/status", { status: "cancelled" }, "PATCH"),
                )
              }
            />
          )}
          <Card>
            <Text style={s.heading}>{t("Actividad")}</Text>
            {order.events.map((event, index) => (
              <Text key={index} style={s.muted}>{t("{{v0}} · {{v1}}", { v0: t(date(event.created_at)), v1: t(event.event_type) })}</Text>
            ))}
          </Card>
        </View>
      </Grid>
    </ScrollView>
  );
}
