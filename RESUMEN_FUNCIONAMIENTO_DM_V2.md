# DM v2 — Resumen de funcionamiento completo

Documento de referencia técnica del sistema de envío automático de DMs de Instagram.

---

## 1. Visión general

**DM v2** es una aplicación Node.js que automatiza el envío de mensajes directos en Instagram. Reemplaza el flujo anterior basado en n8n por uno **local y autónomo**, sin webhooks externos.

**Stack:** Node.js 20, Express 5, Puppeteer, PostgreSQL, Chromium  
**Puertos:** 3001 (API REST), 6080 (noVNC para ver el navegador)

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Container                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ Xvfb :99    │  │ x11vnc       │  │ websockify → noVNC :6080 │ │
│  │ (display)   │  │ (VNC server) │  │ (ver browser en web)     │ │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Express API (:3001)                                          ││
│  │  /start-dm-loop  /login-from-db  /instagram  /viewstory     ││
│  │  /health  /2fa-required  /submit-2fa                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌──────────────────────────┼──────────────────────────────────┐│
│  │ dm_loop_local.js          │  lib/                            ││
│  │ (orquestador del loop)    │  login.js, messaging.js,         ││
│  │                           │  stories.js, browser.js, action.js││
│  └──────────────────────────┴──────────────────────────────────┘│
│                              │                                   │
│  ┌──────────────────────────┴──────────────────────────────────┐│
│  │ Puppeteer + Chromium (headless: false, visible en noVNC)     ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   PostgreSQL     │
                    │ accounts, leads  │
                    └──────────────────┘
```

---

## 3. Base de datos

### 3.1 Tabla `accounts`

Almacena las cuentas de Instagram y su configuración.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL | PK |
| username | VARCHAR(100) | Usuario Instagram |
| password | VARCHAR(100) | Contraseña |
| proxy | VARCHAR(255) | Formato: `ip:puerto:usuario:contraseña` |
| port | VARCHAR(50) | Puerto (legacy) |
| table_name | VARCHAR(50) | Nombre de la tabla de leads para esta cuenta |
| daily_message_limit | INTEGER | Límite diario de DMs (default: 80) |
| timezone | VARCHAR(80) | Zona horaria (ej: `America/Argentina/Buenos_Aires`) |
| send_interval_minutes | INTEGER | Minutos entre envíos (default: 8) |
| active | BOOLEAN | `false` = pausar loop para esta cuenta |

**Ejemplo:**
```sql
INSERT INTO accounts (username, password, proxy, port, table_name, daily_message_limit, timezone, send_interval_minutes, active)
VALUES ('mi_cuenta', 'mi_pass', '65.87.9.233:12323:user:pass', '12323', 'leads', 80, 'America/Argentina/Buenos_Aires', 8, true);
```

### 3.2 Tabla de leads (ej: `leads`)

Cada cuenta apunta a una tabla de leads mediante `table_name`. La tabla debe tener:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL | PK |
| username | VARCHAR(100) | Usuario Instagram destino (sin @) |
| message | TEXT | Mensaje a enviar |
| status | VARCHAR(255) | Vacío/null = pendiente. `send` = enviado. `not-send ( Error: ... )` = falló |
| time_stamp | TIMESTAMP | Fecha/hora del envío o error (formato datetime nativo) |

**Ejemplo:**
```sql
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(255),
  time_stamp TIMESTAMP
);

INSERT INTO leads (username, message) VALUES ('lead1', 'Hola, te escribo porque...');
```

### 3.3 Migraciones

Para bases existentes, ejecutar en orden:

- `001_add_daily_message_limit.sql` — añade `daily_message_limit`
- `002_add_timezone.sql` — añade `timezone`
- `003_add_send_interval.sql` — añade `send_interval_minutes`
- `004_add_active.sql` — añade `active`

---

## 4. Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|----------|-------------|---------|-------------|
| DATABASE_URL | Sí | — | Conexión PostgreSQL (ej: `postgresql://user:pass@host:5432/db?sslmode=require`) |
| LOGIN_USERNAME | Sí | — | Usuario Instagram por defecto (debe existir en `accounts`) |
| PORT | No | 3001 | Puerto de la API |
| DELAY_STORIES_MIN | No | 3 | Minutos mínimos viendo stories tras cada DM |
| DELAY_STORIES_MAX | No | 5 | Minutos máximos viendo stories |
| LEADS_PER_CYCLE | No | 15 | Leads a procesar por ciclo |
| WAIT_BETWEEN_CYCLES_MIN | No | 2 | Minutos de espera entre ciclos completos |
| PUPPETEER_EXECUTABLE_PATH | No | /opt/puppeteer-chrome | Ruta de Chrome. Si no existe, se usa `/usr/bin/chromium` |

---

## 5. API REST — Endpoints

### 5.1 `POST /start-dm-loop`

Inicia el loop automático de envío de DMs.

**Body (opcional):**
```json
{"username": "keinnossler"}
```
Si no se envía, usa `LOGIN_USERNAME`.

**Respuestas:**
- `200` — `{"success": true, "message": "DM loop started"}`
- `400` — Loop ya corriendo, cuenta inactiva o LOGIN_USERNAME no definido
- `404` — Cuenta no encontrada en `accounts`
- `429` — Límite diario alcanzado

---

### 5.2 `POST /login-from-db`

Login usando credenciales de la tabla `accounts`.

**Body:**
```json
{"username": "keinnossler"}
```
Si no se envía, usa `LOGIN_USERNAME`.

**Respuestas:**
- `200` — `{"success": true, "message": "Session active", "user": "...", "proxy": "..."}`
- `400` — username requerido
- `404` — Cuenta no encontrada
- `500` — Error de login (ej: Chrome no encontrado)

---

### 5.3 `POST /login`

Login directo con credenciales en el body (sin BD).

**Body:**
```json
{
  "username": "usuario",
  "password": "contraseña",
  "proxy": "ip:puerto:user:pass"
}
```
`proxy` es opcional.

---

### 5.4 `POST /instagram`

Envía un DM directo. Requiere sesión activa (login previo).

**Body:**
```json
{
  "to": "usuario_destino",
  "message": "Texto del mensaje"
}
```

**Respuestas:**
- `200` — `{"success": true, "from": "...", "messageCount": N, "messagesRemaining": M}`
- `400` — Faltan `to` o `message`, o no hay usuario logueado
- `429` — Límite diario superado
- `500` — Error al enviar

---

### 5.5 `POST /viewstory`

Activa o detiene la visualización automática de stories.

**Body:**
```json
{"status": "start"}
```
o
```json
{"status": "stop"}
```

---

### 5.6 `GET /health`

Estado del servicio.

**Respuesta:**
```json
{
  "ok": true,
  "currentUser": "keinnossler",
  "proxy": "...",
  "rateLimit": {"count": 5, "limit": 80, "messagesRemaining": 75},
  "isLoopRunning": true
}
```

---

### 5.7 2FA (autenticación en dos pasos)

- **`POST /2fa-required`** — Llamado internamente cuando Instagram pide 2FA.
- **`POST /submit-2fa`** — Enviar el código 2FA:

```json
{"code": "123456"}
```

El código se asocia al usuario de `LOGIN_USERNAME`. El login espera hasta 2 minutos por el código.

---

## 6. Flujo del loop de DMs

El loop (`runDmLoopLocal` en `lib/dm_loop_local.js`) ejecuta:

1. **Obtener cuenta** — Lee `accounts` para el usuario indicado.
2. **Ventana horaria** — Solo envía entre **8:00 y 23:00** (timezone de la cuenta). Si está fuera, espera hasta las 8:00.
3. **Rate limit** — Comprueba `daily_message_limit` vs mensajes enviados hoy (por timezone).
4. **Login** — Si no hay sesión o el navegador no está bien, hace login.
5. **Obtener leads** — `SELECT id, username, message FROM {table_name} WHERE (status IS NULL OR status = '') ORDER BY id ASC LIMIT 15`.
6. **Por cada lead:**
   - Comprobar que la cuenta sigue activa y dentro de la ventana horaria.
   - Enviar DM con `sendInstagramMessage(username, message)`.
   - Si **temp_block** → parar loop, marcar lead con error.
   - Si **éxito** → marcar `status = 'send'`, ver stories (3–5 min), esperar `send_interval_minutes ±10%` antes del siguiente.
   - Si **error** → marcar `status = 'not-send ( Error: ... )'`.
7. **Entre ciclos** — Esperar `WAIT_BETWEEN_CYCLES_MIN` minutos y repetir.

### Detección de temp_block

Si Instagram bloquea temporalmente, el loop se detiene, se cierra el navegador y se emite `__TEMP_BLOCK_DETECTED__` en logs.

### Pausar el loop

- `UPDATE accounts SET active = false WHERE username = 'x';` — El loop comprueba esto antes de cada envío y se detiene.
- No hay endpoint para parar el loop manualmente; se depende de `active` o de reiniciar el contenedor.

---

## 7. Flujo de envío de un DM (`sendInstagramMessage`)

1. Navegar a `https://www.instagram.com/{username}/`.
2. Comprobar si el usuario existe (página no disponible).
3. Seguir al usuario si no se sigue.
4. Abrir el chat:
   - Si **requested** → flujo Options (menú → Send Message).
   - Si **following** → flujo Message público o Options.
5. Escribir y enviar el mensaje.
6. Devolver `{ success, error?, temp_block? }`.

---

## 8. Rate limiting

- **Archivo:** `messageCounts.json` (en el directorio de trabajo).
- **Lógica:** Por usuario y por día (según `timezone` de la cuenta).
- **Límite:** `daily_message_limit` de `accounts` (default 80).
- Se reinicia automáticamente cada día según la zona horaria.

---

## 9. Sesiones y perfiles

- **Ruta de perfiles:** `./profiles/{username}/`
- **Cookies:** Se guardan tras login exitoso para reutilizar sesión.
- **Limpieza:** `cleanup-locks.sh` mata procesos Chrome huérfanos antes de cada login.

---

## 10. Docker

### Build

```bash
docker build --platform linux/amd64 -t ghcr.io/shiftdm/dm_v2:latest .
```

### Run (ejemplo)

```bash
docker run -d \
  -p 3009:3001 \
  -p 6080:6080 \
  -e DATABASE_URL="postgresql://..." \
  -e LOGIN_USERNAME="keinnossler" \
  ghcr.io/shiftdm/dm_v2:latest
```

### Puertos

- **3001** (interno) → API.
- **6080** (interno) → noVNC (ver el navegador en `http://host:6080`).

### Chrome

- Se instala Chromium del sistema y Chrome vía Puppeteer.
- Si `PUPPETEER_EXECUTABLE_PATH` no existe, se usa `/usr/bin/chromium`.

---

## 11. Ejemplos de uso con curl

```bash
# Login
curl -X POST http://95.111.231.79:3009/login-from-db \
  -H "Content-Type: application/json" \
  -d '{"username": "keinnossler"}'

# Enviar DM directo
curl -X POST http://95.111.231.79:3009/instagram \
  -H "Content-Type: application/json" \
  -d '{"to": "lead1", "message": "Hola!"}'

# Iniciar loop
curl -X POST http://95.111.231.79:3009/start-dm-loop \
  -H "Content-Type: application/json" \
  -d '{"username": "keinnossler"}'

# Health
curl http://95.111.231.79:3009/health
```

---

## 12. Estructura de archivos principales

```
dm_v2/
├── server.js              # API Express, rutas, runDmCycle
├── db.js                  # Pool PostgreSQL
├── lib/
│   ├── dm_loop_local.js   # Orquestador del loop
│   ├── login.js           # Login Instagram (2FA)
│   ├── messaging.js       # sendInstagramMessage
│   ├── stories.js         # Ver stories automático
│   ├── browser.js         # Puppeteer, launchContext
│   └── action.js          # followUser, likeAndCommentOnPost
├── utils/
│   ├── proxy.js           # getAccountByUsername, getProxyByUsername
│   ├── rate_limiter.js    # Límite diario por usuario
│   ├── schedule.js        # Ventana 8am–11pm
│   ├── helpers.js         # getProfilePath, loadSession, saveSession
│   └── log.js             # Logging
├── migrations/            # SQL para alterar accounts
├── docker-compose.example.yml
├── Dockerfile
└── sql_commands           # CREATE TABLE accounts, leads
```

---

## 13. Resumen de errores frecuentes

| Error | Causa | Solución |
|-------|-------|----------|
| `Browser was not found at...` | Chrome no en la ruta configurada | Usar `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` o reconstruir imagen |
| `Account not found in DB` | Usuario no existe en `accounts` | Insertar cuenta en `accounts` |
| `DM loop already running` | Loop ya activo | Esperar o reiniciar contenedor |
| `No user logged in` | Sesión no iniciada | Llamar a `/login-from-db` antes de `/instagram` |
| `Daily limit exceeded` | Límite diario alcanzado | Esperar al día siguiente o subir `daily_message_limit` |
| `temp_block` | Bloqueo temporal de Instagram | Parar, esperar horas/días, revisar proxy y ritmo de envío |
