import { formatMoney, getLocale } from "./i18n/index";
import { t } from "./i18n/index";
import { useTheme, useThemedStyles } from "./shared/theme";
import React, {forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";
import {ActivityIndicator, AppState, Linking, Modal, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View} from "react-native";
import Constants from "expo-constants";
import {api} from "./api";

const finished = order => ["delivered", "cancelled"].includes(order.status);
const money = formatMoney;
const statuses = {new:"Solicitando",accepted:"Aceptado",preparing:"Preparando",ready:"Listo",
  delivery_requested:"Buscando repartidor",courier_assigned:"Repartidor asignado",
  out_for_delivery:"En reparto",delivered:"Entregado",cancelled:"Cancelado"};
const payments = {pending:"Pendiente de pago",paid:"Pagado",failed:"Pago no completado",
  cancelled:"Pago cancelado",refunded:"Reembolsado",refund_pending:"Reembolso en curso"};
const methods = {cash:"Efectivo",card_on_delivery:"Tarjeta al recibir",online:"Pago online"};
const date = value => {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString(getLocale(), {
    day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
};
function Action({title,onPress,disabled,secondary}) {
  const { color } = useTheme();
  const s = useThemedStyles(baseStyles);
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[s.action,secondary && s.secondary,disabled && {opacity:0.5}]}>
    <Text style={[s.actionText,secondary && {color: color("#392d27", "color")}]}>{t(title)}</Text>
  </TouchableOpacity>;
}

const OrdersPanel = forwardRef(function OrdersPanel({token}, ref) {
  const { color } = useTheme();
  const s = useThemedStyles(baseStyles);
  const [orders,setOrders]=useState([]),[tab,setTab]=useState("active"),
    [loading,setLoading]=useState(true),[selected,setSelected]=useState(null),
    [detail,setDetail]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const selectedRef=useRef(null),mounted=useRef(true);
  async function refresh() {
    setError("");
    try {
      const id=selectedRef.current;
      const [activeOrders,pastOrders,order]=await Promise.all([
        api("/customer/orders?filter=active",{},token),api("/customer/orders?filter=history",{},token),
        id ? api(`/customer/orders/${id}`,{},token) : null]);
      if (!mounted.current) return;
      setOrders([...activeOrders,...pastOrders]);
      if (id && selectedRef.current===id) setDetail(order);
    } catch(e) {if(mounted.current)setError(e.message);}
    finally {if(mounted.current)setLoading(false);}
  }
  useImperativeHandle(ref, () => ({ refresh }));
  useEffect(()=>{
    mounted.current=true;
    refresh();
    const listener=AppState.addEventListener("change",state=>{if(state==="active")refresh();});
    return ()=>{mounted.current=false;listener.remove();};
  },[token]);
  async function open(order) {
    selectedRef.current=order.id;
    setSelected(order.id);setDetail(null);setError("");
    try {
      const data=await api(`/customer/orders/${order.id}`,{},token);
      if(mounted.current && selectedRef.current===order.id)setDetail(data);
    } catch(e) {if(mounted.current && selectedRef.current===order.id)setError(e.message);}
  }
  function close(){selectedRef.current=null;setSelected(null);setDetail(null);setError("");}
  async function pay(){
    setBusy(true);setError("");
    try {
      const {url}=await api(`/customer/orders/${selected}/payment`,{
        method:"POST",body:JSON.stringify({appScheme:Constants.expoConfig?.scheme})},token);
      await refresh();
      await Linking.openURL(url);
    } catch(e){setError(e.message);}
    finally {setBusy(false);}
  }
  async function track(){
    try {await Linking.openURL(detail.trackingUrl);}catch{setError("No se pudo abrir el seguimiento.");}
  }
  const active=orders.filter(order=>!finished(order)),history=orders.filter(finished);
  const visible=tab==="active"?active:history;
  return <>
    <Text style={s.heading}>{t("Mis pedidos")}</Text>
    <Text style={s.muted}>{t("Consulta tu pedido y los detalles de tus compras.")}</Text>
    <View style={s.tabs}>
      {[["active","En curso",active.length],["history","Historial",history.length]].map(([key,label,count])=>
        <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{selected:tab===key}}
          onPress={()=>setTab(key)} style={[s.tab,tab===key && s.tabSelected]}>
          <Text style={[s.tabText,tab===key && {color: color("#fff", "color")}]}>{t("{{v0}} · {{v1}}", { v0: t(label), v1: t(count) })}</Text>
        </TouchableOpacity>)}
    </View>
    <Action title={t("Actualizar pedidos")} onPress={refresh} secondary />
    {!selected && !!error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
    {loading ? <ActivityIndicator style={{margin:24}} color={color("#9d3d24", "color")}/> : visible.length ? visible.map(order=>
      <TouchableOpacity key={String(order.id)} accessibilityRole="button"
        accessibilityLabel={t("Ver pedido {{v0}}", { v0: t(order.id) })} onPress={()=>open(order)} style={s.card}>
        <View style={s.line}><Text style={s.title}>{t("Pedido #{{v0}}", { v0: t(order.id) })}</Text><Text style={s.title}>{t(money(order.total_cents))}</Text></View>
        <Text style={s.muted}>{t(date(order.created_at))}</Text>
        <Text style={s.muted}>{t("Hora solicitada: {{v0}}", {v0: order.scheduled_for ? order.scheduleLabel : t("Lo antes posible")})}</Text>
        <View style={s.line}><Text style={s.badge}>{t(statuses[order.status] || order.status)}</Text>
          <Text style={order.payment_status==="paid"?s.paid:s.pending}>{t(payments[order.payment_status] || "Pendiente de pago")}</Text></View>
        <Text style={s.muted}>{t("{{v0}} · Ver detalle ›", { v0: t(order.delivery_method==="pickup"?"Recogida en local":"A domicilio") })}</Text>
      </TouchableOpacity>) : <View style={s.card}><Text style={s.title}>{t(tab==="active"?"Sin pedidos en curso":"Tu historial está vacío")}</Text>
        <Text style={s.muted}>{t(tab==="active"?"Tus próximos pedidos aparecerán aquí.":"Los pedidos entregados y cancelados aparecerán aquí.")}</Text></View>}
    <Modal visible={selected!==null} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={s.modal}>
        <View style={s.modalHeader}><Text style={s.heading}>{t("Pedido #{{v0}}", { v0: t(selected) })}</Text>
          <Action title={t("Cerrar")} onPress={close} secondary/></View>
        <ScrollView contentContainerStyle={s.content}>
          {!!error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
          {!detail ? <><ActivityIndicator color={color("#9d3d24", "color")}/><Action title={t("Reintentar")} secondary onPress={refresh}/></> : <>
            <Text style={s.badge}>{t(statuses[detail.status] || detail.status)}</Text>
            <Text style={s.muted}>{t(date(detail.created_at))}</Text>
            <Text style={s.muted}>{t("Hora solicitada: {{v0}}", {v0: detail.scheduled_for ? detail.scheduleLabel : t("Lo antes posible")})}</Text>
            <View style={s.card}><Text style={s.title}>{t("Productos")}</Text>
              {detail.items.map((item,index)=><View key={index} style={s.line}>
                <Text style={s.item}>{t("{{v0}} × {{v1}}", { v0: t(item.quantity), v1: item.product_name })}</Text>
                <Text>{t(money(item.quantity*item.unit_price_cents))}</Text></View>)}
              <View style={s.line}><Text>{t("Subtotal")}</Text><Text>{t(money(detail.subtotal_cents))}</Text></View>
              {Number(detail.discount_cents)>0 && <View style={s.line}><Text>{t("Descuento {{v0}}", { v0: t(detail.promo_code || "") })}</Text><Text>{t("−{{v0}}", { v0: t(money(detail.discount_cents)) })}</Text></View>}
              <View style={s.line}><Text>{t("Entrega")}</Text><Text>{t(money(detail.delivery_cents))}</Text></View>
              <View style={[s.line,s.total]}><Text style={s.title}>{t("Total")}</Text><Text style={s.title}>{t(money(detail.total_cents))}</Text></View>
            </View>
            <View style={s.card}><Text style={s.title}>{t(detail.delivery_method==="pickup"?"Recogida en local":"Entrega a domicilio")}</Text>
              <Text style={s.muted}>{detail.delivery_address}</Text>
              {!!detail.dropoffEta && <Text style={s.muted}>{t("Entrega estimada: {{v0}}", { v0: t(date(detail.dropoffEta)) })}</Text>}
              {!!detail.returnPending && <Text style={s.pending}>{t("Devolución al restaurante en curso")}</Text>}
              {!!detail.trackingUrl && <Action title={t("Seguir reparto")} secondary onPress={track}/>}</View>
            <View style={s.card}><Text style={s.title}>{t("Pago")}</Text>
              <Text style={detail.payment_status==="paid"?s.paid:s.pending}>{t(payments[detail.payment_status] || detail.payment_status)}</Text>
              <Text style={s.muted}>{t(methods[detail.payment_method] || detail.payment_method)}</Text>
              {!!detail.paid_at && <Text style={s.muted}>{t("Pagado: {{v0}}", { v0: t(date(detail.paid_at)) })}</Text>}
              {detail.canPay && <><Text style={s.muted}>{t("Paga con tarjeta en Redsys. Al continuar, el método de pago cambia a online.")}</Text>
                <Action title={t(busy?"Abriendo pago…":`Pagar ${money(detail.total_cents)}`)} onPress={pay} disabled={busy}/>
                <Text style={s.muted}>{t("Tras pagar, vuelve a la app. La confirmación puede tardar unos segundos.")}</Text></>}
            </View>
            <Action title={t("Actualizar estado")} secondary onPress={refresh} disabled={busy}/>
          </>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
});

export default OrdersPanel;

const baseStyles = StyleSheet.create({
  heading:{fontSize:24,fontWeight:"800",color:"#392d27"},title:{fontSize:16,fontWeight:"700",color:"#392d27"},
  muted:{color:"#777067",lineHeight:21,marginTop:6},tabs:{flexDirection:"row",backgroundColor:"#e9e3d9",borderRadius:14,padding:4,marginTop:20},
  tab:{flex:1,padding:12,borderRadius:11,alignItems:"center"},tabSelected:{backgroundColor:"#9d3d24"},tabText:{fontWeight:"700",color:"#716a61"},
  card:{backgroundColor:"#fff",borderRadius:18,padding:18,marginTop:14,borderWidth:1,borderColor:"#e4ded3"},
  line:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:10},item:{flex:1,color:"#392d27"},
  badge:{color:"#9d3d24",fontWeight:"700",paddingVertical:6},paid:{color:"#274f2d",fontWeight:"600"},pending:{color:"#872419",fontWeight:"600"},
  action:{backgroundColor:"#9d3d24",padding:14,borderRadius:12,alignItems:"center",marginTop:12},secondary:{backgroundColor:"#e9e3d9"},actionText:{color:"#fff",fontWeight:"700"},
  modal:{flex:1,backgroundColor:"#f7f4ee"},modalHeader:{padding:20,flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12},
  content:{paddingHorizontal:20,paddingBottom:32},total:{borderTopWidth:1,borderTopColor:"#e4ded3",paddingTop:14},error:{color:"#872419",backgroundColor:"#fbe5de",padding:14,borderRadius:12,marginTop:12},
});
