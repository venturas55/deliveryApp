
## Direcciones y geocodificación

El checkout y **Mi cuenta** requieren seleccionar una sugerencia del buscador de
direcciones. El servidor consulta el geocodificador configurado y guarda la
dirección estructurada, coordenadas y `place_id`; una cadena escrita manualmente
no se acepta como dirección definitiva. El piso/puerta y las instrucciones se
guardan aparte y nunca se usan para calcular coordenadas.

Por defecto se usa Nominatim server-side. En producción configura
`GEOCODER_BASE_URL` y un `GEOCODER_USER_AGENT` identificable, respetando los
límites y condiciones del proveedor elegido.
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
- Seguimiento privado del pedido
- Rate limiting
- Helmet
- Proveedor de reparto desacoplado
- Mock delivery para desarrollo
- Uber Direct y Glovo On-Demand configurables por restaurante
- Just Eat JET Go configurable por restaurante
- Credenciales de reparto cifradas con AES-256-GCM
- Cotización simultánea, selección de proveedor y webhooks autenticados

## Instalación

1. Crear BD desde cero:

```bash
mysql -u root -p < schema.sql
```

`schema.sql` es autosuficiente para una instalación nueva o una reconstrucción:
elimina y crea `deliveryapp`, y después crea todas las tablas, columnas, índices
y datos demo. **Es destructivo** y no necesitas ejecutar `npm run migrate` después.
Las migraciones siguen disponibles únicamente para actualizar instalaciones que
ya contienen datos.

Haz una copia de seguridad antes de ejecutarlo si la base actual contiene datos.
Las migraciones siguen disponibles únicamente para actualizar instalaciones que
ya contienen datos sin eliminarlos.

2. Copiar configuración:

```bash
cp .env.example .env
```

3. Cambiar al menos:

- DB_*
- ADMIN_EMAIL
- ADMIN_PASSWORD
- JWT_SECRET
- DELIVERY_CREDENTIALS_KEY: clave base64 de 32 bytes para cifrar credenciales

Genera la clave con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
y copia el resultado en `DELIVERY_CREDENTIALS_KEY` dentro de `.env`. No la guardes
en Git ni la cambies después de cifrar credenciales sin un procedimiento de rotación.

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
curl -X POST http://localhost:7007/api/setup-admin
```

El endpoint lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` desde `.env` y crea el
administrador para el restaurante demo. En Windows PowerShell puedes usar:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:7007/api/setup-admin -ContentType "application/json" -Body "{}"
```

Después entra en `http://localhost:7007/admin/login` con ese email y contraseña.
Cuando el acceso funcione, añade esta variable a `.env` y reinicia el servidor:

```env
SETUP_DISABLED=true
```

Así `/api/setup-admin` queda deshabilitado y no puede volver a utilizarse para
crear administradores. Si el email ya existe, el endpoint no cambia la contraseña
y devuelve que el administrador ya está creado.

Luego acceder a:

- Tienda: `/`
- Seguimiento: `/tracking.html?id=1`
- Administración: `/admin.html`

## Renderizado del servidor

Todas las pantallas llegan como HTML completo generado por Handlebars. La carta,
el carrito, los pedidos, los formularios de cuenta y el panel del restaurante
funcionan con enlaces y formularios nativos, sin JavaScript del navegador.

- `src/views/client/`: carta, login, cuenta, historial y seguimiento.
- `src/views/admin/`: login, pedidos, detalle, artículos y confirmación de borrado.
- `src/views/partials/`: cabecera, navegación y campo CSRF compartidos.
- `src/views/layouts/main.handlebars`: estructura general de las páginas.
- `src/routes/pages.js`: contexto y montaje de las vistas.
- `src/routes/client-pages.js`: carta, carrito, cuenta y pedidos del cliente.
- `src/routes/admin-pages.js`: acceso y formularios de gestión del restaurante.
- `src/controllers/`: operaciones compartidas entre páginas y API; mantienen las
  mismas validaciones, transacciones y restricciones por cuenta/restaurante.
- `src/routes/api.js`, `admin.js`, `clients.js`, `customer-auth.js`: API JSON
  existente, compatible con sus tokens Bearer.
- `src/services/web-session.js`: cookies de sesión, carrito firmado y protección CSRF.
- `public/page-behavior.js`: confirmación y prevención de doble envío, actualización
  de páginas de pedidos cada cinco segundos si no se está editando un formulario.
- `public/google-login.js`: integración opcional con el SDK de Google. No genera
  vistas de la aplicación; Google necesita JavaScript para su botón oficial.

Las sesiones web de cliente y administrador se guardan por separado en cookies
`HttpOnly`, `SameSite=Lax` y `Secure` en producción. No se usan tokens del navegador
almacenados en `localStorage`. Todos los formularios POST incluyen un token CSRF.
Las sesiones anteriores de `localStorage` requieren volver a iniciar sesión.
El carrito solo guarda identificadores y cantidades en una cookie firmada;
los precios y la disponibilidad siempre se calculan desde la base de datos.

Rutas de cliente: `/`, `/client/login`, `/client/account`, `/client/orders` y
`/tracking?id=...`. Rutas de restaurante: `/admin/login`, `/admin/orders`,
`/admin/orders/:id` y `/admin/products`. Se conservan los alias `/index.html`,
`/admin.html`, `/admin` y `/tracking.html`. Las pantallas privadas redirigen al
login correspondiente cuando falta su sesión. La identidad del restaurante es
estable y la navegación marca la sección activa.

Después de actualizar, reinicia `npm start` e inicia sesión de nuevo.
Esta migración de vistas no cambia la base de datos ni requiere nuevas dependencias.
Sin JavaScript, utiliza el enlace de actualización o recarga para ver nuevos estados.

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
Las sesiones de cliente y administrador son independientes. El carrito se conserva al ir a iniciar sesión; después se muestran los datos guardados en la cuenta. Los pedidos antiguos
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

## Proveedores de reparto

El administrador configura cada proveedor por separado en `/admin/providers`.
La configuración pertenece al restaurante autenticado; activar Uber no activa
Glovo. Los secretos se cifran con AES-256-GCM usando `DELIVERY_CREDENTIALS_KEY`,
que debe ser una clave base64 de exactamente 32 bytes y debe vivir en el entorno
o en un gestor de secretos, nunca en MariaDB.

Uber usa OAuth `client_credentials` con el scope `eats.deliveries` y las rutas
oficiales de Direct para quotes y deliveries. Glovo y Just Eat JET Go conservan
la URL base y las rutas contratadas por restaurante: sus adapters no inventan
endpoints de creación.
La cotización consulta en paralelo los proveedores activos y permite elegir uno
antes de solicitar el reparto. Los webhooks se reciben en
`/api/webhooks/delivery/:provider/:restaurantId` con firma HMAC en
`x-delivery-signature`.

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
**Cancelados**. La selección se guarda en la URL y se respeta al actualizar la página. Cada
filtro muestra hasta los 200 pedidos más recientes del restaurante.

Configura `DELIVERY_PROVIDER=mock` en `.env` y reinicia el servidor.
No requiere cambios en el esquema de la base de datos.

1. Crea un pedido desde la tienda (`/`).
2. En `/admin.html`, pulsa **Aceptar pedido**, **Preparar pedido** y **Marcar listo**.
3. Pulsa **Consultar reparto** para ver el coste y el tiempo estimado. La oferta
   es válida durante cinco minutos; una nueva consulta sustituye a la anterior.
4. Pulsa **Confirmar reparto**. El pedido pasa a buscar repartidor.
5. Usa **Simular asignación**, **Simular recogida** y **Simular entrega**, en ese orden.
6. Abre **Gestionar pedido** para ver el contenido y el historial. El cliente
   consulta su seguimiento privado desde **Mis pedidos**.

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
7. Multi-tenant completo: cada restaurante con usuarios, branding, dominio/subdominio y credenciales de reparto independientes.
8. Notificaciones SMS/WhatsApp/email.
9. PWA instalable en móvil/tablet.

## Verificación del renderizado

`npm test` comprueba las APIs y los formularios sin ejecutar JavaScript del cliente:
login, permisos, CSRF, HTML escapado, datos precargados, carrito, checkout,
historial, CRUD del restaurante y cierre independiente de ambas sesiones.
Requiere MariaDB configurado con `schema.sql` y las migraciones aplicadas.
Los datos de prueba se eliminan al terminar. El botón de Google necesita sus
credenciales reales y comprobación interactiva en navegador.

## Prueba rápida de Glovo LaaS API

Se ha añadido una prueba mínima y separada de la integración Glovo en `src/delivery/glovo.js` y `scripts/test-glovo.js`.

La prueba hace únicamente:

1. `POST /oauth/token` con `grantType=client_credentials`.
2. `GET /v2/laas/addresses` para comprobar autenticación y ver los `addressBook` disponibles.
3. Si existe `GLOVO_ADDRESS_BOOK_ID`, solicita una cotización mediante `POST /v2/laas/quotes`.

**No crea ningún pedido/reparto real.**

Esta prueba independiente no forma parte de la configuración normal del
restaurante. Si necesitas ejecutarla, proporciona temporalmente estas variables
solo para ese proceso (PowerShell: `$env:NOMBRE=valor`), sin guardarlas en `.env`:

```env
GLOVO_API_BASE_URL=<URL DE STAGING O PRODUCCION INDICADA POR GLOVO>
GLOVO_CLIENT_ID=
GLOVO_CLIENT_SECRET=
GLOVO_ADDRESS_BOOK_ID=
GLOVO_TEST_ADDRESS=Carrer de Colón 20, Valencia, Spain
GLOVO_TEST_LAT=39.4699
GLOVO_TEST_LNG=-0.3763
GLOVO_TEST_DETAILS=Prueba API
```

Ejecuta:

```bash
npm install
npm run glovo:test
```

O pasando una dirección directamente:

```bash
npm run glovo:test -- "Carrer de Colón 20, Valencia, Spain"
```

La API de Glovo documenta OAuth 2.0, `POST /oauth/token`, `POST /v2/laas/quotes` y el uso obligatorio de `addressBook` para el pickup en las cotizaciones. La cotización no crea el reparto y tiene una validez limitada.
