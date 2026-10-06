# Aplicación React Native: cliente y restaurante

## Administración móvil

Un único proyecto Expo comparte backend y sesión. El cliente conserva su implementación en `App.js` (`ClientNavigator`) y `src/OrdersPanel.js`; `src/admin/AdminNavigator.js` contiene la navegación del restaurante. `src/shared/ui.js` ofrece componentes comunes para las nuevas pantallas y `src/api.js` sigue siendo el transporte y gestor de sesiones compartido. No se han movido archivos del cliente.

En la aplicación cliente, cierra la sesión de cliente y pulsa **Acceso restaurante**. Inicia sesión con una cuenta existente de la tabla `admins`; no se usa el login Google de clientes. Al reabrir la app, el rol guardado selecciona la interfaz, pero el backend comprueba administrador, restaurante activo y pertenencia en cada petición. El access token permanece en memoria; refresh token y rol se guardan en SecureStore. El rol local solo sirve para seleccionar pantallas.

Incluye resumen diario, pedidos por estado, detalle y acciones de cocina, recogida, reparto propio y externo, cobro manual, clientes e historial, disponibilidad y edición de artículos, estadísticas y nombre/teléfono del restaurante. Los datos proceden de MariaDB. Los importes de pedidos manuales se calculan en el servidor. El pedido manual usa clientes con pedidos previos en el restaurante y su dirección guardada; el alta de nuevos clientes y la edición de direcciones se mantienen en la administración web. El esquema actual no contiene modificadores de artículos.

Pedidos y avisos se actualizan cada 15 segundos en primer plano, al regresar a la app y mediante pull-to-refresh. Dashboard se actualiza cada 30 segundos. Historial admite páginas de 200 pedidos. Clientes devuelve hasta 100 coincidencias y permite afinar la búsqueda. Los avisos reutilizan la regla web: efectivo al entrar, tarjeta cuando figura pagada. Se muestra un banner y vibración; no hay sonido, push ni avisos garantizados en segundo plano. La capa `useAdminData` y el componente `OrderNotice` permiten sustituir posteriormente el polling.

### Tablets y diseño adaptable

`app.config.js` activa `ios.supportsTablet: true` en CLIENT y ADMIN, tanto DEV como PROD. ADMIN usa `orientation: "default"` para permitir vertical y horizontal; CLIENT conserva su orientación configurada. Los Bundle ID, esquemas y configuración Google no cambian.

El diseño ADMIN responde al ancho de la ventana y del panel disponible, incluido Split View y cambios de orientación. A partir de 900 puntos disponibles muestra navegación lateral de 200 puntos; con texto ampliado requiere más espacio. En ventanas estrechas mantiene navegación inferior y una columna. Pedidos usa hasta dos columnas; dashboard, clientes, productos e histórico diario usan hasta tres cuando caben tarjetas legibles. Detalle y creación de pedidos distribuyen información y acciones en dos columnas cuando hay espacio. El contenido se limita a 1120 puntos y los formularios a 640. Las columnas se reducen con el tamaño de texto del sistema. Se mantienen Safe Areas y controles de al menos 48 puntos.

El soporte nativo de iPad y el cambio de orientación requieren generar e instalar una nueva Development Build y volver a compilar producción; reiniciar Metro no cambia una build instalada. No se han añadido dependencias. Por ejemplo:

```sh
npx eas-cli@latest build --profile admin-development --platform ios
npx eas-cli@latest build --profile admin-production --platform ios
```

Para probar ADMIN dentro de la app cliente, recompila el perfil `development` cliente con esta configuración. La validación de bundles y anchos no sustituye una prueba real en iPad/tablet Android: comprobar giro, Split View, teclado, texto ampliado, selección de pedidos y envío de formularios.

### Backend requerido

Despliega y reinicia también Node.js. Aplica la migración existente `019-auth-refresh-tokens.sql` si aún no está aplicada. Esta ampliación no añade tablas ni dependencias.

Se reutilizan `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/admin/me`, productos, pedidos, cambios de estado y operaciones de reparto. Pedidos admite `view=mobile` para una respuesta limitada sin referencias Redsys ni payloads internos, `status` y `before_id` para filtrado/paginación. Las respuestas antiguas de pedidos se conservan cuando no se solicita `view=mobile`.

Nuevas rutas JSON protegidas: `GET /api/admin/dashboard`, `GET /api/admin/stats`, `GET /api/admin/customers?q=...`, `GET /api/admin/customers/:id`, `GET/PATCH /api/admin/restaurant`, `GET /api/admin/order-notifications`, `POST /api/admin/orders` y `POST /api/admin/orders/:id/mark-paid`. Estadísticas y pedido manual reutilizan los controladores web. Clientes e historial se limitan a pedidos del restaurante autenticado. Configuración devuelve exclusivamente `id`, `name`, `phone`, `address`, `city`; permite editar solo nombre/teléfono. No se envían credenciales de proveedores ni secretos de servidor a estas pantallas.

El dashboard muestra importe de pedidos de hoy sin cancelaciones/devoluciones y puede incluir pagos pendientes. Las ventas y ticket medio de estadísticas corresponden a pedidos entregados no reembolsados; el recuento diario incluye todos los estados. Las fechas siguen el servidor y MariaDB, igual que la web.

### Variantes desde el mismo proyecto

Los perfiles existentes `development`, `preview` y `production`, sus IDs CLIENT y su configuración Google permanecen vigentes. `APP_VARIANT` sigue seleccionando DEV/PROD; `APP_TARGET=admin` selecciona la aplicación de restaurante.

| Destino | Producción | Desarrollo |
| --- | --- | --- |
| Cliente | `com.massaefuoco.client` | `com.massaefuoco.client.dev` |
| Admin | `com.massaefuoco.admin` | `com.massaefuoco.admin.dev` |

Los nuevos perfiles EAS heredan los existentes:

```sh
npx eas-cli@latest build --profile admin-development --platform ios
npx eas-cli@latest build --profile admin-preview --platform android
npx eas-cli@latest build --profile admin-production --platform ios
```

La variante ADMIN necesita su propia build e instalación por tener otro Bundle ID y esquema (`massaefuoco-admin`, o `massaefuoco-admin-dev`). No se han creado registros App Store/Play Store ni publicado builds. Los cambios JavaScript ADMIN pueden probarse desde la Development Build cliente existente mediante Acceso restaurante, siempre que ya incluya SecureStore. No requiere módulos nativos adicionales.

Para comprobar configuración ADMIN local en PowerShell:

```powershell
$env:APP_TARGET="admin"
$env:APP_VARIANT="development"
npx expo config --type public
Remove-Item Env:APP_TARGET
Remove-Item Env:APP_VARIANT
```

Validación: `node --test test/admin-mobile.test.js test/mobile-session.test.js` desde la raíz requiere MariaDB configurada en `.env`; crea y elimina sus propios datos de prueba. La compilación de bundles no verifica interacción, vibración, OAuth o reparto/pagos reales en un dispositivo.

## Cliente existente

App Expo independiente. Requiere Node, Android Studio con Android SDK y un emulador o dispositivo Android con depuración USB. Google login usa módulos nativos: Expo Go no es compatible.

```sh
cd react-native
npm install
npx expo run:android
```

Este comando compila e instala la aplicación con NitroModules. Abre la aplicación instalada, no Expo Go. Después, para iniciar Metro sin recompilar:

```sh
npm start
```

Si aparece `Failed to get NitroModules`, recompila con `npx expo run:android`; reiniciar Metro no incorpora módulos nativos a una aplicación ya instalada. Repite la compilación tras añadir o actualizar dependencias nativas.

Para iOS, compila en macOS con Xcode mediante `npx expo run:ios`, con `GOOGLE_IOS_CLIENT_ID` configurado.

Configura la URL absoluta de la API en `src/config.js`. En emulador Android usa `http://10.0.2.2:3000/api`; en dispositivo f�sico usa la IP local del equipo servidor. El backend debe ser accesible desde el dispositivo.

Incluye registro e inicio de sesión, carta, carrito local, checkout contra `POST /api/orders`, perfil, pedidos y estado. La sesión se restaura al abrir la app: el access token dura 30 minutos y permanece solo en memoria; el refresh token dura 30 días, se rota en cada renovación y se guarda en `expo-secure-store`. El cierre de sesión intenta revocar el refresh token en el backend. Tras aplicar la migración `019-auth-refresh-tokens.sql`, instala una nueva Development Build para incorporar SecureStore.

El pedido online depende de Redsys; esta app primera versión solo ofrece efectivo y tarjeta al recibir. Para entrega a domicilio usa la dirección guardada en la cuenta; también permite recogida.


Si haces cambios nativos que afecte a app.json o:
        ⚠️ Instalar/eliminar módulos nativos
        ⚠️ Cambiar plugins de Expo
        ⚠️ Cambiar permisos iOS
        ⚠️ Cambiar URL schemes
        ⚠️ Cambiar ciertas opciones de app.json
        ⚠️ Añadir capabilities de Apple
        ⚠️ Actualizar dependencias nativas
 entonces deberias hacer nuevamente:
    npx eas-cli@latest build --profile development --platform ios
##IOS
Si no, se detecta automaticamente y tener corriendo:
    npx expo start --dev-client, se han añadido scripts ahora vale:
    npm run dev o npm run dev:clear
    
Para una build final:
     ==> PARA DESARROLLO
            npx eas-cli@latest build --platform ios --profile development   

    ==> PARA PRODUCCION
            echo $env:APP_VARIANT
            echo $env:GOOGLE_IOS_CLIENT_ID
            npx expo config --type public
            npx eas-cli@latest build --platform ios --profile production    
Para subirla a App Store Connect:
            npx eas-cli@latest submit --platform ios     => aparecera en App Store Connect



##ANDROID

    ==> PARA DESARROLLO
        cd D:\CFGS\development\dev\delivery\react-native
        npx expo-doctor
        $env:APP_VARIANT="development"
        $env:GOOGLE_IOS_CLIENT_ID="42207435401-24td0lvmvr4gfkboab41hp9i4d35utgu.apps.googleusercontent.com"
        npx expo config --type public
        Remove-Item Env:APP_VARIANT -ErrorAction SilentlyContinue
        npx eas-cli@latest build --platform android --profile development

    ==> PARA PRODUCCION
        Remove-Item Env:APP_VARIANT -ErrorAction SilentlyContinue
        Remove-Item Env:GOOGLE_IOS_CLIENT_ID -ErrorAction SilentlyContinue
        npx expo config --type public
        npx eas-cli@latest build --platform android --profile production



El retorno de Redsys usa enlaces profundos (`massaefuoco://` en producción y
`massaefuoco-dev://` en desarrollo). Al cambiar esos esquemas hay que crear e
instalar una nueva build nativa de cada perfil que se utilice.

O hacerlo todo de una con: npx eas-cli@latest build --platform ios --profile production --auto-submit


DESARROLLO                         PRODUCCIÓN
─────────────────────────────      ─────────────────────────
Massa e fuoco DEV                  Massa e fuoco
com.massaefuoco.client.dev         com.massaefuoco.client
Development Build                  TestFlight
Necesita Metro                     No necesita Metro
Cambios inmediatos JS              Versión compilada


## Pedidos y pagos desde la app

La pantalla de pedidos separa los pedidos en curso del historial (entregados y cancelados). El detalle muestra productos, desglose del importe, dirección, seguimiento disponible y estado del pago.

Los pedidos pendientes o con pago fallido permiten pagar con tarjeta en el navegador mediante Redsys, incluidos los pedidos originalmente en efectivo o con tarjeta al recibir. Al iniciar el pago, el método cambia a online. Los pedidos cancelados, pagados o reembolsados no admiten esta acción.

Despliega también los cambios del backend. Requiere `PUBLIC_URL`, `REDSYS_MERCHANT_CODE`, `REDSYS_SECRET_KEY` y la notificación pública de Redsys accesible. El enlace de pago caduca en diez minutos; vuelve a abrirlo desde el pedido si caduca. Desde la app, el retorno de Redsys abre la app y actualiza los pedidos; desde la web conserva el retorno a seguimiento web. Únicamente la notificación verificada de Redsys confirma el pago.
