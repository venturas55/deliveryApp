# Pizzería Delivery Platform — V0.2

Esta versión evoluciona el MVP hacia una pequeña plataforma profesional/multi-restaurante.

## Incluye

- Node.js + Express
- MariaDB
- Multi-restaurante a nivel de datos (`restaurants`)
- Usuarios administradores con JWT + bcrypt
- Menú por restaurante
- Categorías, orden y activación de productos
- Zonas de reparto
- Pedidos transaccionales
- Historial de eventos de cada pedido
- Panel protegido
- Seguimiento público del pedido
- Rate limiting
- Helmet
- Proveedor de reparto desacoplado
- Mock delivery para desarrollo
- Adaptador Uber Direct heredado del MVP
- Preparado para añadir Glovo/Just Eat con el mismo contrato

## Instalación

1. Crear BD:

```bash
mysql -u root -p < schema.sql
```

2. Copiar configuración:

```bash
cp .env.example .env
```

3. Cambiar al menos:

- DB_*
- ADMIN_PASSWORD
- JWT_SECRET

4. Instalar:

```bash
npm install
```

5. Arrancar:

```bash
npm start
```

6. Crear el primer administrador:

```bash
curl -X POST http://localhost:3000/api/setup-admin
```

Luego acceder a:

- Tienda: `/`
- Seguimiento: `/tracking.html?id=1`
- Administración: `/admin.html`

## Vistas y archivos públicos

Express renderiza las páginas con `express-handlebars`:

- `src/views/layouts/main.handlebars`: documento HTML, estilos y script de cada página.
- `src/views/partials/header.handlebars`: cabecera compartida.
- `src/views/client/store.handlebars`: tienda y formulario del pedido.
- `src/views/client/tracking.handlebars`: seguimiento del cliente.
- `src/views/admin/orders.handlebars`: panel de pedidos del restaurante.
- `src/views/admin/products.handlebars`: gestión de artículos del restaurante.
- `src/views/partials/admin/login.handlebars`: formulario de acceso.
- `src/views/partials/admin/navigation.handlebars`: navegación común del restaurante.
- `public/`: JavaScript del navegador, CSS y otros recursos estáticos.

Las rutas de páginas se definen en `src/routes/` mediante `res.render()`. Se mantienen `/`,
`/index.html`, `/admin.html` y `/tracking.html?id=...`; también están disponibles
`/admin` y `/tracking?id=...`. Las rutas inexistentes responden con 404.
El menú, los pedidos y el seguimiento siguen consultando la API desde JavaScript.
Para modificar la estructura compartida, edita el layout o el parcial; para el
contenido de una página, su vista. Reinicia el servidor tras instalar dependencias.

En el área del restaurante, la barra **Pedidos / Gestionar artículos** permite
alternar entre `/admin/orders` y `/admin/products` con un clic, manteniendo la
sesión. La sección actual aparece resaltada y **Cerrar sesión** está disponible
en ambas pantallas. `/admin` y `/admin.html` siguen abriendo los pedidos.
La estructura del panel de pedidos está en la plantilla `orders.handlebars`;
`public/admin.js` la activa tras el acceso y carga los datos mediante la API.

## Organización de las rutas

- `src/server.js`: configuración de Express y Handlebars, recursos estáticos,
  montaje de routers, manejo de errores y arranque del servidor.
- `src/routes/api.js`: entrada de `/api`, límites de peticiones, inicio de sesión,
  creación inicial del administrador y montaje de las APIs de administración y clientes.
- `src/routes/admin.js`: página del panel y API de gestión de pedidos, productos
  y reparto bajo `/api/admin`. La autenticación se aplica a todo el router de
  gestión; las consultas se limitan al restaurante del administrador autenticado.
- `src/routes/clients.js`: páginas de tienda y seguimiento, menú público,
  creación de pedidos y consulta de su estado.
- `src/services/`: funciones compartidas para consultar restaurantes y registrar
  eventos de pedidos.

Los routers de páginas y de API se exportan por separado para conservar las URLs
existentes y aplicar autenticación y límites de peticiones donde corresponde.

## Cuentas de clientes y acceso con Google

Para una base de datos existente, ejecuta `npm run migrate` una vez antes de
arrancar esta versión. Es idempotente: crea `customers` y añade `orders.customer_id`
sin borrar pedidos. Las instalaciones nuevas también incluyen estos cambios en
`schema.sql`. En este entorno de desarrollo ya se ha aplicado la migración.

- `/client/login`: registro con nombre, email y contraseña, e inicio de sesión.
- `/`: carta pública; confirmar un pedido requiere una cuenta de cliente.
- `/client/orders`: pedidos en curso e historial del cliente autenticado.
- `/client/account`: nombre, teléfono, dirección habitual e indicaciones de entrega.
- `/tracking?id=...`: detalle y seguimiento privado, actualizado cada cinco segundos.

La navegación común está en `src/views/partials/client/navigation.handlebars`.
La migración `002-customer-profile.sql`, incluida en `npm run migrate`, añade
teléfono, dirección e indicaciones a las cuentas existentes. Ya se ha aplicado
en este entorno. La tienda rellena el formulario con estos datos; los cambios
realizados en el pedido afectan solo a esa entrega. Para cambiar los valores
habituales, utiliza **Mi cuenta**. El email de acceso se muestra como solo lectura.
La API de pedidos también usa el perfil cuando se omiten los campos de entrega.
Cada pedido conserva una copia de sus datos, aunque el cliente cambie su cuenta.
Las sesiones de cliente y administrador son independientes. El carrito y los
datos del formulario se conservan al ir a iniciar sesión. Los pedidos antiguos
sin cuenta siguen disponibles para el restaurante, pero no se asignan a clientes
automáticamente. La antigua API `/api/orders/:id/public` también requiere ahora
la sesión del propietario; ya no permite consultar pedidos ajenos por su número.

Para habilitar **Continuar con Google**:

1. Crea un cliente OAuth de tipo **Aplicación web** en Google Cloud / Google Auth
   Platform y configura la pantalla de consentimiento (y usuarios de prueba si procede).
2. Añade `http://localhost:7007` a los **Orígenes autorizados de JavaScript**.
   Añade el dominio HTTPS correspondiente al publicar la aplicación.
3. Copia su identificador en `.env`: `GOOGLE_CLIENT_ID=...apps.googleusercontent.com`.
4. Reinicia el servidor. El botón aparecerá en `/client/login`.

Este flujo utiliza Google Identity Services con respuesta JavaScript: no requiere
un secreto de cliente ni una ruta de redirección OAuth. El servidor verifica la
firma, audiencia y caducidad del ID token con la biblioteca oficial y comprueba
un nonce de la sesión de acceso. Google puede pedir selección de cuenta o
consentimiento; no se entra sin la autorización del usuario. Si el correo ya
está registrado con contraseña, se exige usar ese método, sin vinculación automática.
Sin `GOOGLE_CLIENT_ID`, el registro y acceso por contraseña siguen funcionando.
Configuración oficial: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

Las pruebas cubren registro, login, separación de roles, privacidad de pedidos y
rechazo de credenciales Google inválidas. La prueba real con Google requiere
configurar un cliente OAuth y usar el botón en un navegador.

## Gestión de artículos

Desde el panel, abre **Gestionar artículos** (`/admin/products`). Puedes crear,
listar, editar y eliminar artículos de tu restaurante, con nombre, descripción,
categoría, precio en euros, orden dentro de la categoría y disponibilidad.
**Ocultar/Publicar** permite retirar temporalmente un artículo sin eliminarlo.
Los cambios se muestran al volver a cargar la tienda. Eliminar un artículo
requiere confirmación y conserva el nombre y precio registrados en pedidos anteriores.

La API protegida utiliza `GET/POST /api/admin/products` y
`PATCH/DELETE /api/admin/products/:id`. Los precios se envían en céntimos enteros;
`PATCH` admite cambios parciales. Todas las operaciones se limitan al restaurante
del administrador autenticado. No hace falta modificar el esquema de MariaDB.

## Circuito completo con reparto simulado

El listado de pedidos permite filtrar por **Todos**, **Pendientes** (sin aceptar),
**En curso** (aceptados, en preparación, listos o en reparto), **Entregados** y
**Cancelados**. La selección se mantiene durante la sesión de la pestaña, incluso
al volver desde artículos, y se respeta en la actualización automática. Cada
filtro muestra hasta los 200 pedidos más recientes del restaurante.

Configura `DELIVERY_PROVIDER=mock` en `.env` y reinicia el servidor.
No requiere cambios en el esquema de la base de datos.

1. Crea un pedido desde la tienda (`/`).
2. En `/admin.html`, pulsa **Aceptar pedido**, **Preparar pedido** y **Marcar listo**.
3. Pulsa **Consultar reparto** para ver el coste y el tiempo estimado. La oferta
   es válida durante cinco minutos; una nueva consulta sustituye a la anterior.
4. Pulsa **Confirmar reparto**. El pedido pasa a buscar repartidor.
5. Usa **Simular asignación**, **Simular recogida** y **Simular entrega**, en ese orden.
6. Abre **Seguimiento del cliente** para ver los estados; se actualiza cada cinco
   segundos. **Productos e historial** muestra el contenido y los eventos del pedido.

La simulación avanza manualmente desde el panel, sin contratar ningún servicio
externo. El tiempo mostrado es orientativo y no activa un temporizador.
Los estados y eventos se guardan en MariaDB y se conservan al reiniciar.
Se puede cancelar antes de solicitar el reparto. Los pedidos entregados o
cancelados no se pueden reabrir. El coste cotizado del proveedor se registra en
el historial y no modifica el importe que ya pagará el cliente.

### Prueba de integración

Con MariaDB disponible y el esquema importado, ejecuta `npm test`.
La prueba inicia su propio servidor con el proveedor simulado, crea un restaurante
temporal y elimina sus datos al terminar. Comprueba la entrega completa, el
seguimiento público, la cancelación, el aislamiento por restaurante, la caducidad
de ofertas y el rechazo de duplicados y transiciones fuera de orden.

## Seguridad

`/api/setup-admin` está pensado únicamente para el bootstrap inicial. Después de crear el administrador, añadir:

`SETUP_DISABLED=true`

y reiniciar.

En producción se recomienda poner nginx delante con HTTPS, usar una contraseña larga y aleatoria para `JWT_SECRET`, restringir el panel y configurar copias de seguridad de MariaDB.

## Próximos módulos

1. Imágenes de productos desde el panel.
2. Gestión de zonas/CP.
3. Horarios y festivos.
4. Pago online.
5. Dirección estructurada + geocodificación.
6. Webhooks reales del proveedor de reparto.
7. Uber Direct producción.
8. Glovo On-Demand.
9. Just Eat JET Go.
10. Multi-tenant completo: cada restaurante con usuarios, branding, dominio/subdominio y credenciales de reparto independientes.
11. Notificaciones SMS/WhatsApp/email.
12. PWA instalable en móvil/tablet.
