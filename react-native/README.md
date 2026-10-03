# App cliente React Native

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

Incluye registro e inicio de sesión, carta, carrito local, checkout contra `POST /api/orders`, perfil, pedidos y estado. El pedido online depende de Redsys; esta app primera versión solo ofrece efectivo y tarjeta al recibir. Para entrega a domicilio usa la dirección guardada en la cuenta; también permite recogida.


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

Si no, se detecta automaticamente y tener corriendo:
    npx expo start --dev-client

Para una build final:
    npx eas-cli@latest build --platform ios --profile production    ==> PARA PRODUCCION
    npx eas-cli@latest build --platform ios --profile development   ==> PARA DESARROLLO

Para subirla a App Store Connect:
    npx eas-cli@latest submit --platform ios     => aparecera en App Store Connect

## Pedidos y pagos desde la app

La pantalla de pedidos separa los pedidos en curso del historial (entregados y cancelados). El detalle muestra productos, desglose del importe, dirección, seguimiento disponible y estado del pago.

Los pedidos pendientes o con pago fallido permiten pagar con tarjeta en el navegador mediante Redsys, incluidos los pedidos originalmente en efectivo o con tarjeta al recibir. Al iniciar el pago, el método cambia a online. Los pedidos cancelados, pagados o reembolsados no admiten esta acción.

Despliega también los cambios del backend. Requiere `PUBLIC_URL`, `REDSYS_MERCHANT_CODE`, `REDSYS_SECRET_KEY` y la notificación pública de Redsys accesible. El enlace de pago caduca en diez minutos; vuelve a abrirlo desde el pedido si caduca. Al volver a la app se actualiza el estado; únicamente la notificación verificada de Redsys confirma el pago.
