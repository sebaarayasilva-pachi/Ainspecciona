# Sistema de créditos

## Resumen
- Cada inspección consume 1 crédito.
- Los créditos se compran vía MercadoPago (planes: starter 1, business 50, corporate 100).
- El webhook suma créditos al tenant cuando el pago es aprobado.

## Admin: agregar créditos de prueba

```bash
# POST /api/admin/tenants/:tenantId/credits
# Body: { "amount": 10 }
```

Ejemplo con curl (reemplaza TENANT_ID):
```bash
curl -X POST "https://ainspecciona.web.app/api/admin/tenants/TENANT_ID/credits" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10}'
```

> **Nota:** El endpoint admin no tiene autenticación en el MVP. Restringir en producción.

## Migración en producción

1. Inicia Cloud SQL Proxy:
   ```bash
   cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql
   ```

2. Ejecuta migraciones:
   ```powershell
   .\migrate.ps1
   ```

## Webhook MercadoPago

Configurar en [MercadoPago Developers](https://www.mercadopago.cl/developers):
- URL: `https://ainspecciona.web.app/api/mercadopago/webhook`
- Eventos: `payment`
