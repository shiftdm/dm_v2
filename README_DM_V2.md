# DM v2 - Flujo local (sin n8n)

Reemplaza completamente el flujo de n8n por uno local. No depende de webhooks externos.

## Cambios respecto a dm_v1

| dm_v1 | dm_v2 |
|-------|-------|
| Usa WEBHOOK_LOGIN y WEBHOOK_DM | Todo local, sin webhooks |
| n8n orquesta el flujo | `dm_loop_local.js` orquesta el flujo |
| Tiempos fijos en n8n | Tiempos configurables por env |

## Flujo (basado en n8n Universal-docker-dm-automation)

1. **Obtener cuenta** de la tabla `accounts` (username, password, proxy, table_name)
2. **Login** si no hay sesión (usa credenciales de la BD)
3. **Obtener leads** de `table_name` donde status está vacío (LIMIT 15)
4. **Por cada lead:**
   - Enviar DM vía `sendInstagramMessage`
   - Si éxito: marcar "send", ver stories 3-5 min, esperar `send_interval_minutes` ±10% min
   - Si temp_block: parar todo
   - Si error: marcar "not-send ( Error: ... )"
5. **Esperar** N minutos antes del siguiente ciclo

## Variables de entorno

```env
LOGIN_USERNAME=      # Usuario de Instagram (debe existir en accounts)
DATABASE_URL=        # Conexión PostgreSQL

# Delays en minutos (configurables)
DELAY_STORIES_MIN=3          # Min de viewing stories
DELAY_STORIES_MAX=5          # Max de viewing stories
LEADS_PER_CYCLE=15           # Leads por ciclo
WAIT_BETWEEN_CYCLES_MIN=2    # Min entre ciclos completos
```

## Tabla accounts

Debe tener: `username`, `password`, `proxy`, `port`, `table_name`, `daily_message_limit`, `timezone`, `send_interval_minutes`

- `table_name`: tabla de leads para esa cuenta
- `timezone`: zona horaria según ubicación del proxy (ej: `America/Argentina/Buenos_Aires`, `America/New_York`, `Europe/Madrid`). Usado para límite diario, timestamps y ventana horaria.
- `send_interval_minutes`: intervalo base entre envíos (min). Se aplica ±10% aleatorio para simular uso natural. Solo envía entre **8am y 11pm** en la zona horaria de la cuenta.

## Build y push (imagen autónoma, sin base externa)

```bash
docker build --platform linux/amd64 -t ghcr.io/shiftdm/dm_v2:latest .
docker push ghcr.io/shiftdm/dm_v2:latest
```

## Endpoints

- `POST /start-dm-loop` - Inicia el loop (usa cuenta de LOGIN_USERNAME)
- `POST /login-from-db` - Login usando credenciales de la BD
- `POST /instagram` - Enviar DM (directo)
- `POST /viewstory` - Ver/parar stories
