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

## Seguridad

`/api/setup-admin` está pensado únicamente para el bootstrap inicial. Después de crear el administrador, añadir:

`SETUP_DISABLED=true`

y reiniciar.

En producción se recomienda poner nginx delante con HTTPS, usar una contraseña larga y aleatoria para `JWT_SECRET`, restringir el panel y configurar copias de seguridad de MariaDB.

## Próximos módulos

1. Gestión completa de productos desde el panel.
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
