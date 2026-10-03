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
