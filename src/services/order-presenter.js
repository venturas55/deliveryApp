import {deliveryView} from "./delivery-tracking.js";
export const labels={new:"Recibido",accepted:"Aceptado",preparing:"En preparación",ready:"Listo para recoger",delivery_requested:"Buscando repartidor",courier_assigned:"Repartidor asignado",out_for_delivery:"En camino",delivered:"Entregado",cancelled:"Cancelado"};
const kitchen={new:["accepted","Aceptar pedido"],accepted:["preparing","Preparar pedido"],preparing:["ready","Marcar listo"]};
const simulation={delivery_requested:["courier_assigned","Simular asignación"],courier_assigned:["out_for_delivery","Simular recogida"],out_for_delivery:["delivered","Simular entrega"]};
export const eventLabels={"order.created":"Pedido recibido","status.changed":"Cambio de estado","delivery.quoted":"Precio de reparto consultado","delivery.requested":"Reparto solicitado","delivery.updated":"Actualización del reparto"};
export function presentOrder(order){
  const delivery={...deliveryView(order),...(order.returnPending!==undefined?{returnPending:order.returnPending}:{})},next=kitchen[order.status],step=order.provider==="mock"||process.env.DELIVERY_SIMULATION==="true"&&order.provider==="uber"?simulation[order.status]:null;
  return {...order,delivery,statusLabel:order.provider_status==="returned"?"Devuelto al restaurante":delivery.returnPending?"Devolución en curso":labels[order.status]||order.status,nextStatus:next?.[0],nextLabel:next?.[1],simulationStatus:step?.[0],simulationLabel:step?.[1],canCancel:["new","accepted","preparing","ready"].includes(order.status),canQuote:order.status==="ready",finished:["delivered","cancelled"].includes(order.status)&&!delivery.returnPending};
}
Object.assign(eventLabels,{"delivery.synced":"Estado recuperado de Uber","delivery.ignored":"Notificación ignorada"});
