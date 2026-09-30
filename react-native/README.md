# App cliente React Native

App Expo independiente. Requiere Node y Expo Go o emulador.

```sh
cd react-native
npm install
npx expo start
```

Configura la URL absoluta de la API en `src/config.js`. En emulador Android usa `http://10.0.2.2:3000/api`; en dispositivo f�sico usa la IP local del equipo servidor. El backend debe ser accesible desde el dispositivo.

Incluye registro e inicio de sesión, carta, carrito local, checkout contra `POST /api/orders`, perfil, pedidos y estado. El pedido online depende de Redsys; esta app primera versión solo ofrece efectivo y tarjeta al recibir. Para entrega a domicilio usa la dirección guardada en la cuenta; también permite recogida.