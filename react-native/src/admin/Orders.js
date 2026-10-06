import React, { useState } from "react";
import { Alert, FlatList, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Button, Card, date, money, paymentName, paymentStatus, s } from "../shared/ui";
import useAdminData from "./useAdminData";
import { orderPath, write } from "./api";
import { Grid, GRID_GAP, useContentLayout } from "../shared/layout";

const filters = [["new", "Nuevos"], ["accepted", "Aceptados"], ["preparing", "Preparación"], ["ready", "Listos"], ["delivery_requested", "Buscando reparto"], ["courier_assigned", "Asignados"], ["out_for_delivery", "En reparto"], ["delivered", "Entregados"], ["cancelled", "Cancelados"]];
const colors = { new: "#923a25", accepted: "#275c91", preparing: "#865e13", ready: "#276944", out_for_delivery: "#62418c", cancelled: "#8b2c2c" };

export function OrderCard({ order, onPress }) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
  return <Card onPress={onPress}>
    <View style={s.row}><Text style={s.heading}>#{order.id}</Text><Text style={s.heading}>{money(order.total_cents)}</Text></View>
    <Text style={s.text}>{order.customer_name}</Text>
    <Text style={[s.label, { color: colors[order.status] || "#53483e" }]}>{order.statusLabel}</Text>
    <Text style={s.muted}>{order.delivery_method === "pickup" ? "Recogida" : "Reparto"} · {paymentName(order.payment_method)} · {paymentStatus(order.payment_status)}</Text>
    <Text style={s.muted}>{date(order.created_at)} · {order.status === "delivered" || order.status === "cancelled" ? "Finalizado" : `${minutes} min transcurridos`}</Text>
  </Card>;
}

export function Orders({ openOrder, initialStatus = "new" }) {
  const { columns, itemWidth } = useContentLayout(320, 2);
  const [status, setStatus] = useState(initialStatus), [before, setBefore] = useState(""), [delivery, setDelivery] = useState("all");
  const { data, loading, error, refresh } = useAdminData(`/orders?view=mobile&filter=all&status=${status}&delivery_method=${delivery}${before ? `&before_id=${before}` : ""}`, ["delivered", "cancelled"].includes(status) || before ? 0 : 15000);
  const changeStatus = value => { setBefore(""); setStatus(value); };
  return <View style={{ flex: 1 }}>
    <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 14 }}>
      {filters.map(([key,label]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: status === key }} onPress={() => changeStatus(key)} style={[s.chip, status === key && s.chipActive]}><Text style={{ color: status === key ? "white" : "#392d27" }}>{label}</Text></Pressable>)}
    </ScrollView></View>
    <View style={[s.wrap, { paddingHorizontal: 18, marginBottom: 8 }]}>{[["all", "Todos"], ["pickup", "Recogida"], ["delivery", "Reparto"]].map(([key,label]) => <Pressable accessibilityRole="button" key={key} onPress={() => { setDelivery(key); setBefore(""); }} style={[s.chip, delivery === key && s.chipActive]}><Text style={{ color: delivery === key ? "white" : "#392d27" }}>{label}</Text></Pressable>)}</View>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <FlatList key={columns} numColumns={columns} columnWrapperStyle={columns > 1 ? { gap: GRID_GAP } : undefined}
      data={data || []} keyExtractor={item => String(item.id)} contentContainerStyle={[s.content, s.responsiveContent]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#923a25" />}
      renderItem={({ item }) => <View style={{ width: columns === 1 ? "100%" : itemWidth }}><OrderCard order={item} onPress={() => openOrder(item.id)} /></View>}
      ListEmptyComponent={!loading && !error ? <Text style={s.muted}>Sin pedidos en este estado.</Text> : null}
      ListFooterComponent={<View>{data?.length === 200 && <Button secondary title="Pedidos anteriores" onPress={() => setBefore(String(data[data.length - 1].id))} />}{before && <Button secondary title="Volver a los recientes" onPress={() => setBefore("")} />}</View>} />
  </View>;
}

export function OrderDetail({ id }) {
  const { data: order, error, loading, refresh } = useAdminData(`${orderPath(id)}?view=mobile`, 15000);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState(""), [quotes, setQuotes] = useState([]);
  async function action(path, body = {}, method = "POST") {
    if (busy) return;
    setBusy(true); setProblem("");
    try {
      const result = await write(orderPath(id) + path, body, method);
      if (path === "/delivery/quote") setQuotes(result.quotes || [result]);
      else setQuotes([]);
      await refresh();
    } catch (failure) { setProblem(failure.message); await refresh(); }
    finally { setBusy(false); }
  }
  if (!order) return <View style={s.content}><Text style={error ? s.error : s.muted}>{error || "Cargando pedido…"}</Text><Button secondary title="Reintentar" onPress={refresh} /></View>;
  const confirm = (title, text, callback) => Alert.alert(title, text, [{ text: "Volver", style: "cancel" }, { text: "Confirmar", onPress: callback }]);
  return <ScrollView contentContainerStyle={[s.content, s.responsiveContent]} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
    <OrderCard order={order} />
    {(problem || error) ? <Text accessibilityRole="alert" style={s.error}>{problem || error}</Text> : null}
    <Grid minWidth={360} maxColumns={2}><View style={{ gap: GRID_GAP }}>
    <Card><Text style={s.heading}>Artículos</Text>{order.items.map(item => <View style={s.row} key={String(item.id)}><Text style={[s.text, { flex: 1 }]}>{item.quantity} × {item.product_name}</Text><Text style={s.text}>{money(item.quantity * item.unit_price_cents)}</Text></View>)}</Card>
    <Card><Text style={s.heading}>Cliente</Text><Text style={s.text}>{order.customer_name}</Text><Button secondary title={`Llamar: ${order.customer_phone || "sin teléfono"}`} disabled={!order.customer_phone} onPress={() => Linking.openURL(`tel:${order.customer_phone}`).catch(failure => setProblem(failure.message))} /><Text style={s.text}>{order.delivery_address}</Text>{order.delivery_apartment ? <Text style={s.text}>Piso: {order.delivery_apartment}</Text> : null}{order.delivery_patio ? <Text style={s.text}>Patio: {order.delivery_patio}</Text> : null}{order.delivery_notes ? <Text style={s.text}>Observaciones: {order.delivery_notes}</Text> : null}</Card>
    </View><View style={{ gap: GRID_GAP }}>
    <Card><Text style={s.heading}>Importe y pago</Text><Text style={s.text}>Artículos: {money(order.subtotal_cents)}</Text><Text style={s.text}>Descuento: {money(order.discount_cents)}</Text><Text style={s.text}>Reparto: {money(order.delivery_cents)}</Text><Text style={s.heading}>Total: {money(order.total_cents)}</Text><Text style={s.text}>{paymentName(order.payment_method)} · {paymentStatus(order.payment_status)}</Text>
      {order.canMarkPaid && <Button title="Marcar pago recibido" disabled={busy} onPress={() => confirm("Confirmar cobro", "Marca el pago solo después de recibir el importe.", () => action("/mark-paid"))} />}
    </Card>
    {order.nextStatus && <Button title={order.nextLabel} disabled={busy} onPress={() => action("/status", { status: order.nextStatus }, "PATCH")} />}
    {order.canCompletePickup && <Button title="Entregado al cliente" disabled={busy} onPress={() => action("/status", { status: "delivered" }, "PATCH")} />}
    {order.canStartOwnDelivery && <Button title="Iniciar reparto propio" disabled={busy} onPress={() => action("/status", { status: "out_for_delivery" }, "PATCH")} />}
    {order.canCompleteOwnDelivery && <Button title="Marcar entregado" disabled={busy} onPress={() => action("/status", { status: "delivered" }, "PATCH")} />}
    {order.delivery_method === "delivery" && <Card><Text style={s.heading}>Reparto</Text><Text style={s.text}>{order.provider || "Sin proveedor asignado"} {order.provider_status || ""}</Text>
      {order.delivery?.trackingUrl && <Button secondary title="Abrir seguimiento" onPress={() => Linking.openURL(order.delivery.trackingUrl).catch(failure => setProblem(failure.message))} />}
      {order.delivery?.canSync && <Button secondary title="Consultar estado del proveedor" disabled={busy} onPress={() => action("/delivery/sync")} />}
      {order.canQuote && <Button secondary title="Consultar precio de reparto" disabled={busy} onPress={() => action("/delivery/quote")} />}
      {order.canQuote && quotes.filter(quote => quote.expiresAt > Date.now()).map(quote => <Button key={quote.quoteId} title={`${quote.provider}: ${money(quote.feeCents)} · Solicitar`} disabled={busy} onPress={() => confirm("Solicitar reparto", `${quote.provider}: ${money(quote.feeCents)}`, () => action("/delivery", { provider: quote.provider, quoteId: quote.quoteId }))} />)}
    </Card>}
    {order.canCancel && <Button danger title="Cancelar pedido" disabled={busy} onPress={() => confirm("Cancelar pedido", "Se devolverá el pago online cuando corresponda.", () => action("/status", { status: "cancelled" }, "PATCH"))} />}
    <Card><Text style={s.heading}>Actividad</Text>{order.events.map((event,index) => <Text key={index} style={s.muted}>{date(event.created_at)} · {event.event_type}</Text>)}</Card>
    </View></Grid>
  </ScrollView>;
}
