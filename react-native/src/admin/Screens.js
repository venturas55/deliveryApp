import React, { useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { Button, Card, Field, money, s } from "../shared/ui";
import { OrderCard } from "./Orders";
import useAdminData from "./useAdminData";
import { write } from "./api";
import { Grid, GRID_GAP, useContentLayout } from "../shared/layout";
import { productImageUrl } from "../config";

function Problem({ error }) { return error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null; }
function Page({ resource, children, form = false, scrollRef, onScroll }) {
  return <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={100} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, s.responsiveContent, form && s.form]} refreshControl={<RefreshControl refreshing={resource.loading} onRefresh={resource.refresh} />}>
    <Problem error={resource.error} />{!resource.data && resource.loading ? <Text style={s.muted}>Cargando…</Text> : children}
  </ScrollView>;
}

export function Dashboard({ navigate }) {
  const resource = useAdminData("/dashboard", 30000), data = resource.data;
  return <Page resource={resource}>{data && <>
    <Text style={s.heading}>Hoy</Text><Card><Text style={s.title}>{money(data.today.sales_cents)}</Text><Text style={s.muted}>{data.today.orders} pedidos · importe no cancelado ni reembolsado; puede incluir pagos pendientes</Text></Card>
    <Text style={s.heading}>Operación</Text>
    <Grid>
    {[["new", "Pendientes"], ["accepted", "Aceptados"], ["preparing", "En preparación"], ["ready", "Listos"], ["out_for_delivery", "En reparto"]].map(([status,label]) => <Card key={status} onPress={() => navigate("orders", { status })}><View style={s.row}><Text style={s.text}>{label}</Text><Text style={s.title}>{data.counts[status] || 0}</Text></View></Card>)}
    <Card onPress={() => navigate("orders", { status: "delivery_requested" })}><Text style={s.text}>Repartos buscando/asignados: {(data.counts.delivery_requested || 0) + (data.counts.courier_assigned || 0)}</Text></Card>
    </Grid>
    <Button title="Nuevo pedido" onPress={() => navigate("create")} /><Button secondary title="Estadísticas" onPress={() => navigate("stats")} />
  </>}</Page>;
}

export function Customers({ openCustomer, selectCustomer }) {
  const { columns, itemWidth } = useContentLayout();
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 350); return () => clearTimeout(timer); }, [search]);
  const resource = useAdminData(`/customers?q=${encodeURIComponent(query)}`);
  return <View style={{ flex: 1 }}><View style={[s.form, { padding: 18 }]}><Field label="Buscar nombre, teléfono o email" value={search} onChangeText={setSearch} /></View><Problem error={resource.error} />
    <FlatList key={columns} numColumns={columns} columnWrapperStyle={columns > 1 ? { gap: GRID_GAP } : undefined}
      data={resource.data || []} keyExtractor={item => String(item.id)} contentContainerStyle={[s.content, s.responsiveContent]}
      refreshControl={<RefreshControl refreshing={resource.loading} onRefresh={resource.refresh} />}
      renderItem={({ item }) => <View style={{ width: columns === 1 ? "100%" : itemWidth }}><Card onPress={() => selectCustomer ? selectCustomer(item) : openCustomer(item.id)}><Text style={s.heading}>{item.name}</Text><Text style={s.muted}>{item.phone} · {item.email}</Text><Text style={s.text}>{item.total_orders} pedidos · {money(item.total_spent_cents)} entregados</Text></Card></View>}
      ListEmptyComponent={!resource.loading && !resource.error ? <Text style={s.muted}>Sin clientes con pedidos en este restaurante.</Text> : null}
      ListFooterComponent={resource.data?.length === 100 ? <Text style={s.muted}>Mostrando 100 clientes. Afina la búsqueda.</Text> : null} />
  </View>;
}

export function CustomerDetail({ id, openOrder }) {
  const resource = useAdminData(`/customers/${encodeURIComponent(id)}`), customer = resource.data;
  return <Page resource={resource}>{customer && <><Card><Text style={s.heading}>{customer.name}</Text><Text style={s.text}>{customer.phone}</Text><Text style={s.text}>{customer.email}</Text><Text style={s.text}>{customer.total_orders} pedidos · {money(customer.total_spent_cents)} entregados</Text></Card><Text style={s.heading}>Historial del restaurante</Text><Grid maxColumns={2}>{customer.orders.map(order => <OrderCard key={String(order.id)} order={order} onPress={() => openOrder(order.id)} />)}</Grid>{customer.orders.length === 200 && <Text style={s.muted}>Últimos 200 pedidos. Consulta anteriores desde Pedidos.</Text>}</>}</Page>;
}

export function Products() {
  const resource = useAdminData("/products"), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function update(id, body) {
    setBusy(true); setError("");
    try { await write(`/products/${id}`, body, "PATCH"); await resource.refresh(); setEditing(null); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Page resource={resource} form={!!editing}><Problem error={error} />{editing ? <ProductEditor key={editing.id} product={editing} busy={busy} save={body => update(editing.id, body)} cancel={() => setEditing(null)} /> : <Grid>{(resource.data || []).map(product => <Card key={product.id}>
    {productImageUrl(product.image_url) ? <Image accessibilityLabel={`Foto de ${product.name}`} source={{ uri: productImageUrl(product.image_url) }} resizeMode="cover" style={{ width: "100%", height: 180, borderRadius: 10, marginBottom: 8 }} /> : <View style={{ height: 64, justifyContent: "center" }}><Text style={s.muted}>Sin foto</Text></View>}
    <Text style={s.heading}>{product.name}</Text><Text style={s.muted}>{product.category} · {money(product.price_cents)}</Text><View style={s.row}><Text style={s.text}>{Number(product.active) ? "Disponible" : "Agotado"}</Text><Switch accessibilityLabel={`Disponibilidad de ${product.name}`} disabled={busy} value={!!Number(product.active)} onValueChange={value => update(product.id, { active: Number(value) })} /></View><Button secondary title="Editar artículo" disabled={busy} onPress={() => setEditing(product)} /></Card>)}</Grid>}{resource.data?.length === 0 && <Text style={s.muted}>Sin artículos.</Text>}</Page>;
}
function ProductEditor({ product, save, cancel, busy }) {
  const [name, setName] = useState(product.name), [price, setPrice] = useState((product.price_cents / 100).toFixed(2)), [category, setCategory] = useState(product.category), [description, setDescription] = useState(product.description || ""), [imageUrl, setImageUrl] = useState(product.image_url || ""), [error, setError] = useState("");
  function submit() {
    if (!/^\d+([.,]\d{1,2})?$/.test(price)) { setError("Precio no válido"); return; }
    save({ name, category, description, image_url: imageUrl.trim(), price_cents: Math.round(Number(price.replace(",", ".")) * 100) });
  }
  const imageUri = productImageUrl(imageUrl);
  return <Card>{imageUri ? <Image accessibilityLabel={`Foto de ${product.name}`} source={{ uri: imageUri }} resizeMode="cover" style={{ width: "100%", height: 200, borderRadius: 10, marginBottom: 8 }} /> : <Text style={s.muted}>Sin foto</Text>}<Field label="URL de la imagen (vacío para quitarla)" value={imageUrl} onChangeText={setImageUrl} maxLength={500} autoCapitalize="none" keyboardType="url" /><Field label="Nombre" value={name} onChangeText={setName} maxLength={120} /><Field label="Precio (€)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" /><Field label="Categoría" value={category} onChangeText={setCategory} maxLength={80} /><Field label="Descripción" value={description} onChangeText={setDescription} maxLength={255} multiline /><Problem error={error} /><Button title="Guardar artículo" disabled={busy} onPress={submit} /><Button secondary title="Volver" disabled={busy} onPress={cancel} /></Card>;
}

export function Statistics() {
  const resource = useAdminData("/stats"), data = resource.data;
  const [selectedDay, setSelectedDay] = useState("");
  const [hourlyMode, setHourlyMode] = useState("day");
  const daily = Array.isArray(data?.daily) ? data.daily : [];
  const customers = Array.isArray(data?.customerSpending) ? data.customerSpending : [];
  useEffect(() => {
    if (daily.length) setSelectedDay(daily[daily.length - 1].day);
  }, [daily]);
  const selected = daily.find(day => day.day === selectedDay) || daily[daily.length - 1];
  const hourlySource = hourlyMode === "history"
    ? data?.historicalHourly
    : selected?.hourly;
  const hasHourlyData = Array.isArray(hourlySource);
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const label = `${String(hour).padStart(2, "0")}:00`;
    const value = Array.isArray(hourlySource)
      ? hourlySource.find(item => item.label === label)
      : null;
    return { label, total: Number(value?.total) || 0 };
  });
  const dailyMax = Math.max(1, ...daily.map(day => day.total));
  const hourlyMax = Math.max(1, ...hourly.map(hour => hour.total));
  return <Page resource={resource}>{data && <>
    <Card><Text style={s.heading}>Resumen de pedidos entregados</Text><Text style={s.title}>{money(data.totals.sales_cents)}</Text><Text style={s.text}>{data.totals.orders} pedidos · {data.totals.customers} clientes</Text><Text style={s.text}>Ticket medio: {money(data.totals.average_cents)}</Text></Card>
    <Card><Text style={s.heading}>Pedidos por día</Text><Text style={s.muted}>Últimos 14 días · selecciona un día para ver sus horas</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "flex-end", gap: 8, paddingVertical: 12 }}>
        {daily.map(day => {
          const active = day.day === selected?.day;
          const height = Math.max(day.total ? 6 : 2, day.total / dailyMax * 106);
          return <Pressable key={day.day} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${day.label}: ${day.total} pedidos`} onPress={() => setSelectedDay(day.day)} style={{ width: 48, alignItems: "center", gap: 5 }}>
            <Text style={[s.muted, { marginTop: 0 }]}>{day.total}</Text>
            <View style={{ height: 110, width: 26, justifyContent: "flex-end", backgroundColor: "#f4eee5", borderRadius: 7, overflow: "hidden" }}>
              <View style={{ height, backgroundColor: active ? "#923a25" : "#bd8a68", borderRadius: 7 }} />
            </View>
            <Text style={[s.muted, active && { color: "#923a25", fontWeight: "700" }, { marginTop: 0 }]}>{day.label}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </Card>
    <Card><Text style={s.heading}>Pedidos por hora{hourlyMode === "day" && selected ? ` · ${selected.label}` : " · histórico"}</Text>
      <View style={s.row}>
        <Button secondary={hourlyMode !== "day"} title="Día seleccionado" onPress={() => setHourlyMode("day")} />
        <Button secondary={hourlyMode !== "history"} title="Todo el histórico" onPress={() => setHourlyMode("history")} />
      </View>
      {!hasHourlyData ? <Text style={s.muted}>El servidor no devolvió los datos horarios. Actualiza el servidor para ver esta gráfica.</Text> : <>
        <Text style={s.muted}>Cada barra representa el intervalo indicado (24 horas).</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ alignItems: "flex-end", gap: 6, paddingVertical: 12 }}>
          {hourly.map(hour => {
            const hourNumber = Number(hour.label.slice(0, 2));
            const nextHour = (hourNumber + 1) % 24;
            const interval = `${hour.label}–${String(nextHour).padStart(2, "0")}:00`;
            const height = hour.total ? Math.max(5, hour.total / hourlyMax * 104) : 2;
            return <View key={hour.label} accessibilityLabel={`${interval}: ${hour.total} pedidos`} style={{ width: 46, alignItems: "center", gap: 5 }}>
              <Text style={[s.muted, { marginTop: 0 }]}>{hour.total}</Text>
              <View style={{ height: 108, width: 28, justifyContent: "flex-end", backgroundColor: "#f4eee5", borderRadius: 7, overflow: "hidden" }}>
                <View style={{ height, backgroundColor: "#923a25", borderRadius: 7 }} />
              </View>
              <Text style={[s.muted, { marginTop: 0 }]}>{String(hourNumber).padStart(2, "0")}</Text>
            </View>;
          })}
        </ScrollView>
        {hourly.every(hour => hour.total === 0) && <Text style={s.muted}>{hourlyMode === "day" ? "No hay pedidos registrados en este día." : "Todavía no hay pedidos en el histórico."}</Text>}
      </>}
    </Card>
    <Card><Text style={s.heading}>Clientes que más han gastado</Text><Text style={s.muted}>Histórico · pedidos entregados, sin reembolsos</Text>
      {customers.length ? customers.map(customer => <View key={customer.id} style={[s.row, { justifyContent: "flex-start", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e6ded3" }]}>
        <Text style={[s.heading, { width: 36, marginBottom: 0 }]}>{customer.rank}.</Text>
        <View style={{ flex: 1 }}><Text style={s.text}>{customer.name}</Text><Text style={s.muted}>{customer.total_orders} pedidos{customer.phone ? ` · ${customer.phone}` : ""}</Text></View>
        <Text style={[s.text, { fontWeight: "700" }]}>{money(customer.total_spent_cents)}</Text>
      </View>) : <Text style={s.muted}>Todavía no hay clientes con pedidos entregados.</Text>}
    </Card>
  </>}</Page>;
}

export function Settings({ logout }) {
  const resource = useAdminData("/restaurant"), [editing, setEditing] = useState(false);
  return <Page resource={resource} form>{resource.data && <>{editing ? <RestaurantEditor restaurant={resource.data} done={async () => { await resource.refresh(); setEditing(false); }} /> : <Card><Text style={s.heading}>{resource.data.name}</Text><Text style={s.text}>{resource.data.phone}</Text><Text style={s.text}>{resource.data.address}</Text><Text style={s.muted}>Dirección de recogida: modifica desde administración web para conservar los datos de reparto.</Text><Button secondary title="Editar nombre y teléfono" onPress={() => setEditing(true)} /></Card>}<Button secondary title="Cerrar sesión" onPress={logout} /></>}</Page>;
}
function RestaurantEditor({ restaurant, done }) {
  const [name,setName] = useState(restaurant.name), [phone,setPhone] = useState(restaurant.phone || ""), [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function save() { setBusy(true); try { await write("/restaurant", { name, phone }, "PATCH"); await done(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }
  return <Card><Field label="Nombre del restaurante" value={name} onChangeText={setName} maxLength={150} /><Field label="Teléfono" value={phone} onChangeText={setPhone} maxLength={40} keyboardType="phone-pad" /><Problem error={error} /><Button title="Guardar" disabled={busy} onPress={save} /><Button secondary title="Volver" disabled={busy} onPress={done} /></Card>;
}

export function CreateOrder({ openOrder }) {
  const [customer, setCustomer] = useState(null), [cart, setCart] = useState({}), [pickup, setPickup] = useState(true), [card, setCard] = useState(false), [counter, setCounter] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [activeCategory, setActiveCategory] = useState("");
  const resource = useAdminData("/products");
  const products = (resource.data || []).filter(product => Number(product.active));
  const { columns, itemWidth } = useContentLayout(320, 2);
  const scrollRef = useRef(null), categoryOffsets = useRef({});
  const categories = [...new Set(products.map(product => product.category?.trim() || "Otros"))];
  useEffect(() => { setActiveCategory(categories[0] || ""); }, [resource.data]);
  function selectCategory(category) {
    const offset = categoryOffsets.current[category];
    if (offset === undefined) return;
    setActiveCategory(category);
    scrollRef.current?.scrollTo({ y: Math.max(0, offset - 12), animated: true });
  }
  function updateActiveCategory(event) {
    const scrollY = event.nativeEvent.contentOffset.y + 48;
    let current = categories[0] || "";
    for (const category of categories) {
      const offset = categoryOffsets.current[category];
      if (offset !== undefined && offset <= scrollY) current = category;
      else break;
    }
    setActiveCategory(previous => previous === current ? previous : current);
  }
  if (!customer) return <Customers selectCustomer={setCustomer} />;
  const subtotal = products.reduce((total, product) => total + product.price_cents * (cart[product.id] || 0), 0);
  async function submit() {
    setBusy(true); setError("");
    try {
      const order = await write("/orders", { customer_id: customer.id, channel: counter ? "counter" : "telephone", delivery_method: pickup ? "pickup" : "delivery", payment_method: card ? "card_on_delivery" : "cash", items: Object.entries(cart).filter(([,quantity]) => quantity > 0).map(([id,quantity]) => ({ product_id: Number(id), quantity })) });
      openOrder(order.id);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Page resource={resource} scrollRef={scrollRef} onScroll={updateActiveCategory}><Card><Text style={s.heading}>{customer.name}</Text><Text style={s.muted}>{customer.phone}</Text><Button secondary title="Cambiar cliente" onPress={() => setCustomer(null)} /></Card>
    <Text style={s.muted}>Clientes con pedidos previos en este restaurante. Nuevos clientes: alta desde administración web.</Text>
    {!!categories.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {categories.map(category => {
        const active = activeCategory === category;
        return <Button key={category} secondary={!active} title={category} onPress={() => selectCategory(category)} />;
      })}
    </ScrollView>}
    {categories.map(category => {
      const categoryProducts = products.filter(product => (product.category?.trim() || "Otros") === category);
      return <View key={category} onLayout={({ nativeEvent }) => { categoryOffsets.current[category] = nativeEvent.layout.y; }}>
        <Text style={s.heading}>{category}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP }}>
          {categoryProducts.map(product => <View key={product.id} style={{ width: columns === 1 ? "100%" : itemWidth }}>
            <Card>
              {productImageUrl(product.image_url) ? <Image accessibilityLabel={`Foto de ${product.name}`} source={{ uri: productImageUrl(product.image_url) }} resizeMode="cover" style={{ width: "100%", height: 150, borderRadius: 10, marginBottom: 8 }} /> : <View style={{ height: 48, justifyContent: "center" }}><Text style={s.muted}>Sin foto</Text></View>}
              <Text style={s.heading}>{product.name}</Text>
              {!!product.description && <Text style={s.muted}>{product.description}</Text>}
              <Text style={[s.text, { fontWeight: "700" }]}>{money(product.price_cents)}</Text>
              <View style={s.row}>
                <Button secondary title="−" disabled={busy || !cart[product.id]} onPress={() => setCart(current => ({ ...current, [product.id]: Math.max(0, (current[product.id] || 0) - 1) }))} />
                <Text style={s.text}>{cart[product.id] || 0}</Text>
                <Button secondary title="+" disabled={busy || cart[product.id] >= 50} onPress={() => setCart(current => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))} />
              </View>
            </Card>
          </View>)}
        </View>
      </View>;
    })}
    <Card><Text style={s.heading}>Resumen del pedido</Text>{products.filter(product => cart[product.id] > 0).map(product => <Text key={product.id} style={s.text}>{cart[product.id]} × {product.name} · {money(cart[product.id] * product.price_cents)}</Text>)}{!subtotal && <Text style={s.muted}>Añade artículos para crear el pedido.</Text>}
      {[["Recogida en local", pickup,setPickup], ["Tarjeta al entregar",card,setCard], ["Pedido en mostrador",counter,setCounter]].map(([label,value,set]) => <View key={label} style={s.row}><Text style={[s.text,{flex:1}]}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={set} disabled={busy} /></View>)}
      <Text style={s.muted}>{pickup ? "Recogida sin gastos de reparto." : "Usa dirección guardada del cliente. El reparto se calcula al crear el pedido."}</Text>
      <Text style={s.heading}>Total de artículos: {money(subtotal)}</Text>
    </Card>
    <Problem error={error} /><Button title={busy ? "Creando…" : "Crear pedido"} disabled={busy || subtotal === 0} onPress={submit} />
  </Page>;
}
