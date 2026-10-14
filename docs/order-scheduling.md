# Hora solicitada del pedido

CLIENT web y app permiten pedir lo antes posible o seleccionar una hora de hoy,
en intervalos de 15 minutos, en Europe/Madrid. Se trata de una hora solicitada
para entrega o recogida, no de una garantía ni de una reserva de capacidad.
No existen horarios comerciales configurados: se ofrecen las franjas futuras
hasta las 23:45. El servidor vuelve a validar la franja al confirmar el pedido.

ADMIN web y app muestran la fecha y hora solicitadas en listado y detalle.
La aceptación, preparación, pago y reparto conservan sus controles actuales.
Los pedidos programados se reciben inmediatamente y se gestionan manualmente.

## Despliegue y compatibilidad

1. Ejecutar `npm run migrate` antes de desplegar el nuevo backend.
2. Reiniciar el backend y actualizar la app.
3. Comprobar un pedido inmediato y otro programado en CLIENT y ADMIN.

La migración 022 añade `orders.scheduled_for DATETIME NULL DEFAULT NULL`, en UTC.
Es repetible y no modifica pedidos existentes. `NULL` significa lo antes posible.
Versiones antiguas siguen creando pedidos inmediatos sin conocer la columna.

Para revertir el código, conservar la columna y sus datos; el backend anterior
puede continuar utilizándose. No eliminar la columna mientras existan pedidos
programados pendientes. No se requiere una migración destructiva para revertir.
