# Clientes por restaurante

Las cuentas de `customers` siguen siendo globales (email y acceso únicos). La tabla `restaurant_customers` permite que una cuenta pertenezca a varios restaurantes sin duplicar su identidad. Los datos del perfil siguen compartidos; los pedidos y los destinatarios del administrador se filtran por el restaurante autenticado.

## Despliegue

1. Ejecutar `npm run migrate` antes de desplegar el código nuevo.
2. La migración 021 crea la relación y vincula los clientes a los restaurantes de sus pedidos históricos. Si solo existe un restaurante, también vincula los clientes sin pedidos. Puede repetirse sin duplicar relaciones.
3. Si existen varios restaurantes, asignar los clientes sin relación únicamente cuando se conozca su restaurante. No se asignan automáticamente a todos. Revisarlos con:

```sql
SELECT c.id, c.name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM restaurant_customers rc WHERE rc.customer_id=c.id);
```

Una asignación administrativa conocida usa `INSERT IGNORE INTO restaurant_customers (restaurant_id, customer_id) VALUES (?, ?)` con identificadores verificados.

El registro, el inicio de sesión, Google nativo y los pedidos admiten `restaurant_id`, resuelto por `restaurants.id` contra un restaurante activo. La carta pública usa `GET /api/public/menu?restaurant_id=123`. `slug` es un alias editable; no se utiliza para resolver restaurantes. El alta asistida usa el restaurante del administrador. El pedido vincula al comprador dentro de la misma transacción. Durante despliegues mixtos, los lectores también reconocen pedidos históricos, siempre filtrados por restaurante.

El escaparate web (incluidos carta, carrito, checkout, productos, legales y Google web) usa `DEFAULT_RESTAURANT_ID` en el entorno del servidor. Si se omite, solo se selecciona automáticamente cuando existe exactamente un restaurante activo. Con varios restaurantes activos, la falta de configuración devuelve 503; nunca se escoge uno arbitrariamente. Cada despliegue web puede configurar su ID sin cambiar las rutas públicas. No se acepta que un formulario cambie el restaurante del sitio.

React Native puede configurar `EXPO_PUBLIC_RESTAURANT_ID` para consultar la carta de ese ID. Si se omite, carga la carta predeterminada del servidor. Después envía el ID devuelto por la carta en autenticación y pedidos. Cambiar esta configuración requiere generar de nuevo el bundle de la app. Los administradores siempre usan el restaurante de su sesión, independiente de estas configuraciones.

Antes de desplegar en un entorno con varios restaurantes activos, definir `DEFAULT_RESTAURANT_ID` y comprobar que corresponde al sitio. Las versiones antiguas que enviaban solo `slug` usarán el restaurante predeterminado del servidor; actualizar las apps para seleccionar otros restaurantes por ID. No se cambia ningún ID ni se reescribe ningún slug existente.

## Reversión

Revertir el código y conservar la tabla aditiva y sus relaciones. No eliminar clientes ni pedidos. El código antiguo de administración no aplica este aislamiento; no usarlo con varios restaurantes. La tabla puede conservarse hasta una futura migración explícita.
