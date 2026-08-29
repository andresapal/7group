# FASE 7 — INTEGRACION TELEFONICA REAL

**Estado:** COMPLETADA  
**Fecha:** 2026-08-29  
**Proveedor:** Twilio (SIP/Media Streams)  
**Motor de Voz:** OpenAI Realtime API (g711_ulaw bidireccional)  
**Motor Conversacional:** FASE 1-5 (sin modificaciones)

---

## Resumen

FASE 7 conecta el agente de voz con un numero telefonico real. Un cliente llama al numero → Twilio enruta la llamada al servidor → el servidor conecta con OpenAI Realtime API → el motor conversacional procesa cada mensaje → el agente responde por voz. Todo el audio es G.711 mulaw (8kHz) sin conversion.

---

## Arquitectura

```
CLIENTE (telefono)
    |
    v
NUMERO TELEFONICO (Twilio)
    |
    v
WEBHOOK POST /incoming-call
    |
    v
TwiML <Connect><Stream>
    |
    v
WEBSOCKET /media-stream (bidireccional)
    |
    ├── Audio IN  (cliente → servidor → OpenAI)
    └── Audio OUT (OpenAI → servidor → cliente)
    |
    v
OPENAI REALTIME API
    |
    ├── STT (Whisper) — transcripcion
    ├── VAD — deteccion de turnos
    ├── Function Calling → process_message()
    └── TTS — voz de respuesta
    |
    v
CONVERSATION ENGINE (FASE 1-5)
    |
    ├── intent-detector.js
    ├── conversation-manager.js
    ├── order-draft.js
    ├── tool-orchestrator.js
    └── mock-tools.js
```

### Audio sin conversion

| Punto | Formato | Sample Rate |
|---|---|---|
| Twilio → Servidor | G.711 mulaw | 8kHz |
| Servidor → OpenAI | G.711 mulaw | 8kHz |
| OpenAI → Servidor | G.711 mulaw | 8kHz |
| Servidor → Twilio | G.711 mulaw | 8kHz |

El formato es identico en todos los puntos. El servidor actua como bridge sin procesar audio.

---

## Archivos

```
server/
├── package.json        — Dependencias (express, ws, twilio, dotenv)
├── .env.example        — Template de variables de entorno
├── .gitignore          — Excluye node_modules, .env, logs
├── config.js           — Carga y valida configuracion
├── index.js            — Servidor Express + WebSocket + webhooks
├── call-session.js     — Sesion de llamada individual
└── call-logger.js      — Logging y metricas de llamadas
```

---

## Configuracion Telefonica

### 1. Crear cuenta Twilio

1. Ir a https://www.twilio.com/
2. Crear cuenta (trial gratuito incluye credito)
3. Obtener Account SID y Auth Token del Dashboard

### 2. Comprar numero

1. Twilio Console → Phone Numbers → Buy a Number
2. Seleccionar pais y capacidad "Voice"
3. El numero aparecera como `+1XXXXXXXXXX` o `+57XXXXXXXXXX`

### 3. Configurar webhook

1. Twilio Console → Phone Numbers → tu numero → Voice & Fax
2. "A CALL COMES IN" → Webhook → `https://TU-SERVIDOR/incoming-call` → POST
3. "CALL STATUS CHANGES" → `https://TU-SERVIDOR/incoming-call/status` → POST

### 4. Variables de entorno

```bash
# Copiar .env.example a .env
cp .env.example .env

# Llenar:
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
PUBLIC_URL=https://xxxx.ngrok-free.app
```

### 5. Exponer servidor (desarrollo)

Para desarrollo local, usar ngrok:

```bash
# Instalar ngrok (una vez)
npm install -g ngrok

# Exponer el servidor
ngrok http 3849
```

Copiar la URL HTTPS de ngrok a `PUBLIC_URL` en `.env`.

### 6. Iniciar servidor

```bash
cd server
npm install
npm start
```

---

## Configuracion SIP

Twilio maneja SIP internamente. La configuracion es:

| Parametro | Valor |
|---|---|
| Protocolo | SIP sobre TLS |
| Codec | G.711 mulaw (PCMU) |
| Media | WebSocket Media Streams |
| Direccion | Bidireccional |
| Formato | base64 JSON sobre WebSocket |

No se requiere configuracion SIP manual — Twilio lo abstrae.

---

## Flujo de Llamada

```
1. CALL IN
   └── Twilio recibe llamada al numero configurado

2. WEBHOOK
   └── POST /incoming-call con CallSid, From, To
   └── Respuesta: TwiML <Connect><Stream url="wss://server/media-stream">

3. MEDIA STREAM
   └── Twilio abre WebSocket al servidor
   └── Evento "start" con callSid, callerNumber

4. CREATE SESSION
   └── CallSession creada con IDs unicos
   └── Motor conversacional inicializado

5. OPENAI CONNECT
   └── WebSocket a OpenAI Realtime API
   └── Configuracion: g711_ulaw, VAD, process_message tool

6. GREETING
   └── getGreeting() del motor → OpenAI TTS → Twilio → cliente

7. CONVERSATION LOOP
   └── Cliente habla → Twilio → OpenAI (STT)
   └── OpenAI → process_message(text)
   └── processMessage(conv, text) → respuesta
   └── Respuesta → OpenAI (TTS) → Twilio → cliente

8. ORDER / TOOLS
   └── Igual que FASE 1-5 (search_product, create_order, etc.)

9. CALL END
   └── Cliente cuelga → "stop" event
   └── O pedido completado → timeout → terminate
   └── O session timeout → despedida → terminate
```

---

## Gestion de Sesiones

### Identificador unico

```
call_id = "call_" + callSid
conversation_id = generado por createConversation()
```

### Datos registrados por llamada

| Campo | Descripcion |
|---|---|
| `call_id` | ID unico de la llamada |
| `conversation_id` | ID de la conversacion del motor |
| `phone_number` | Numero del cliente |
| `start_time` | Timestamp de inicio |
| `end_time` | Timestamp de fin |
| `duration` | Duracion en segundos |
| `status` | active / completed / error / transferred |
| `turn_count` | Numero de turnos |
| `tool_calls` | Numero de tools ejecutadas |
| `errors` | Numero de errores |
| `latency_avg_ms` | Latencia promedio |
| `final_state` | Estado final del motor (COMPLETED, CANCELLED, etc.) |
| `order_id` | ID del pedido creado (si aplica) |
| `end_reason` | Razon de finalizacion |

---

## Eventos

### Twilio WebSocket Events

| Evento | Accion |
|---|---|
| `connected` | Log conexion |
| `start` | Crear CallSession, inicializar motor y OpenAI |
| `media` | Forward audio → OpenAI |
| `stop` | Terminar sesion (client_hangup) |

### OpenAI Realtime Events

| Evento | Accion |
|---|---|
| `session.created` | Configurar sesion |
| `session.updated` | Hablar saludo |
| `input_audio_buffer.speech_started` | Reset silence timer, clear Twilio buffer (interrupcion) |
| `conversation.item.input_audio_transcription.completed` | Log transcripcion |
| `response.function_call_arguments.done` | Ejecutar motor conversacional |
| `response.audio.delta` | Forward audio → Twilio |
| `response.done` | Finalizar turno, registrar metricas |
| `error` | Log error, terminar si es critico |

---

## Identificacion por Telefono

```
Numero entrante (From)
    |
    ├── +57 strip → numero local
    |
    v
find_customer({ phone: numero })
    |
    ├── Encontrado → usar nombre, direcciones, historial
    └── No encontrado → flujo cliente nuevo
```

El motor ya maneja esto en `createConversation()` — sin cambios.

---

## Interrupcion

Comportamiento identico a FASE 6:

```
CLIENTE HABLA (durante respuesta del agente)
    |
    v
VAD detecta: input_audio_buffer.speech_started
    |
    ├── Twilio: {"event": "clear", "streamSid": "..."}  ← limpia buffer de audio
    └── Motor continua en el mismo estado
    |
    v
AGENTE ESCUCHA
    |
    v
NUEVA INSTRUCCION
```

No se crea flujo paralelo. La interrupcion limpia el buffer de Twilio para que el cliente deje de oir al agente inmediatamente.

---

## Transferencia Humana

Preparada pero desactivada por defecto.

```
TRANSFER_ENABLED=false
TRANSFER_PHONE_NUMBER=
```

Cuando se active:

```
Cliente dice "quiero hablar con alguien"
    |
    v
Intent: HUMAN_REQUEST
    |
    v
Motor responde con mensaje de transferencia
    |
    v
CallSession detecta state === 'HUMAN_REQUEST'
    |
    v
Twilio REST API: update call con <Dial>
    |
    v
Llamada transferida al numero configurado
```

---

## Seguridad

| Aspecto | Implementacion |
|---|---|
| API Key OpenAI | Variable de entorno, nunca en logs |
| Twilio credentials | Variable de entorno, nunca en frontend |
| WebSocket auth | Authorization header (server-side) |
| Webhook validation | CallSid requerido en requests |
| Frontend exposure | Servidor no sirve frontend, solo API |
| .gitignore | Excluye .env, node_modules, logs |
| Datos del cliente | Solo en memoria durante la llamada |

---

## Timeouts

| Timeout | Valor Default | Configurable |
|---|---|---|
| Conexion WS | 10s | `TIMEOUT_CONNECTION_MS` |
| Sesion maxima | 10 min | `TIMEOUT_SESSION_MS` |
| Silencio | 30s | `TIMEOUT_SILENCE_MS` |
| Tool execution | 5s | `TIMEOUT_TOOL_MS` |

### Comportamiento por timeout

- **Silencio 30s**: El agente pregunta "Sigues ahi?"
- **Silencio 60s**: Se despide y termina
- **Sesion 10min**: Pregunta si necesita algo mas, se despide

---

## Recuperacion de Fallas

| Falla | Comportamiento |
|---|---|
| OpenAI WS cerrado | Termina llamada, log error |
| Twilio WS cerrado | Termina sesion, log client_hangup |
| Parse error | Log, continua (no crash) |
| Engine error | "Disculpa, tuve un problema tecnico" |
| API key invalida | Termina inmediatamente |
| Tool timeout | Respuesta de error del motor |
| Servidor shutdown | Termina todas las sesiones activas (SIGINT/SIGTERM) |

---

## Anti-Duplicacion

La idempotencia de FASE 4 se conserva intacta:

```
idempotency_key = conversation_id + '_confirmed'
```

- Una llamada repetida crea una nueva conversacion (nuevo conversation_id)
- Dentro de la misma llamada, confirmar dos veces no crea orden duplicada
- El `_orderStore` mantiene el mapa de idempotency keys
- Event duplicados de Twilio no crean sesiones duplicadas (se valida callSid)

---

## Grabacion y Transcripcion

| Dato | Almacenamiento | Retencion |
|---|---|---|
| Audio de llamada | NO grabado | — |
| Transcripcion | En memoria durante llamada, ultimos 3 turnos en log | Sesion |
| Log de llamada | `logs/calls.json` (max 500) | Rotacion automatica |
| Datos del cliente | En memoria, no persistido | Sesion |

### Politica

- No se graba audio indiscriminadamente
- La transcripcion se usa para desarrollo y debugging
- Solo los ultimos 3 turnos se persisten en el log (espacio)
- Los logs se rotan automaticamente (max 500 registros)
- En produccion: implementar politica RGPD/Habeas Data Colombia

---

## Monitoreo

### Endpoints

| Endpoint | Descripcion |
|---|---|
| `GET /health` | Estado del servidor, llamadas activas, config |
| `GET /calls` | Llamadas activas en tiempo real |
| `GET /calls/history` | Historial de llamadas (ultimas 50) |
| `GET /metrics` | Metricas agregadas |

### Metricas agregadas

| Metrica | Calculo |
|---|---|
| `totalCalls` | Total de llamadas registradas |
| `activeCalls` | Llamadas en curso |
| `completedCalls` | Llamadas completadas |
| `errorCalls` | Llamadas con error |
| `transferredCalls` | Llamadas transferidas |
| `ordersCreated` | Pedidos generados |
| `avgDurationSec` | Duracion promedio |
| `avgLatencyMs` | Latencia promedio |
| `conversionRate` | % llamadas que generaron pedido |

---

## Pruebas

### Basicas

| Prueba | Validacion |
|---|---|
| Saludo | Agente responde con saludo natural |
| Pedido simple | "Una pizza hawaiana" → orden correcta |
| Varios productos | "Hawaiana y dos hamburguesas" |
| Modificacion | "Sin cebolla", "extra queso" |
| Cancelacion | "Cancelar el pedido" |

### Voz

| Prueba | Validacion |
|---|---|
| Interrupcion | Cliente habla durante agente → agente se detiene |
| Habla rapida | Transcripcion correcta |
| Habla lenta | No timeout prematuro |
| Ruido | Respuesta razonable o "no escuche" |
| Silencio 30s | "Sigues ahi?" |

### Telefono

| Prueba | Validacion |
|---|---|
| Llamada entrante | Contestada, saludo correcto |
| Cliente cuelga | Sesion termina limpiamente |
| Error conexion | Log correcto, cleanup |
| Server restart | Llamadas activas terminadas |

### Negocio

| Prueba | Validacion |
|---|---|
| Producto agotado | "La BBQ no esta disponible" |
| Precio | Precio correcto del sistema |
| Domicilio | Flujo de direccion + zona |
| Cliente existente | Saludo con nombre |
| Cliente nuevo | Pide nombre |
| Confirmacion | Resumen + confirmar = create_order |

### Seguridad

| Prueba | Validacion |
|---|---|
| Cambiar precio | Precio del sistema prevalece |
| Producto inexistente | "No encontre ese producto" |
| Sin confirmacion | No crea orden |
| Instrucciones maliciosas | Ignoradas (motor heuristico) |

---

## Como ejecutar pruebas

### 1. Configurar

```bash
cd server
cp .env.example .env
# Editar .env con valores reales
npm install
```

### 2. Exponer con ngrok

```bash
ngrok http 3849
# Copiar URL HTTPS a PUBLIC_URL en .env
```

### 3. Configurar Twilio

```
Twilio Console → Phone Numbers → tu numero
Voice URL: https://xxxx.ngrok-free.app/incoming-call (POST)
Status URL: https://xxxx.ngrok-free.app/incoming-call/status (POST)
```

### 4. Iniciar servidor

```bash
npm start
```

### 5. Llamar

Llamar al numero Twilio desde cualquier telefono y conversar con el agente.

### 6. Monitorear

```bash
# En otra terminal:
curl http://localhost:3849/health
curl http://localhost:3849/calls
curl http://localhost:3849/metrics
```

---

## Errores conocidos y limitaciones

1. **Mock tools compartidos**: El `_orderStore` es compartido entre llamadas concurrentes. En produccion se reemplaza por base de datos.
2. **Sin grabacion de audio**: Por politica de privacidad, no se graba audio. Solo transcripcion parcial.
3. **Transferencia no implementada end-to-end**: El mecanismo esta preparado pero requiere configurar el numero destino y activar `TRANSFER_ENABLED`.
4. **Latencia**: La cadena Twilio → OpenAI → Engine → OpenAI → Twilio agrega latencia. En pruebas de produccion, medir p95.
5. **Limitaciones del motor heuristico**: Las mismas de FASE 5 aplican por voz (splitting, contexto, pronombres).

---

## Lo que NO se modifico

- `engine/conversation-manager.js` — intacto
- `engine/intent-detector.js` — intacto
- `engine/order-draft.js` — intacto
- `engine/tool-orchestrator.js` — intacto
- `engine/mock-tools.js` — intacto
- `engine/mock-data.js` — intacto
- `engine/conversation-state.js` — intacto
- `engine/logger.js` — intacto
- `engine/tests.js` — intacto
- `engine/e2e-scenarios.js` — intacto
- `voice.html` — intacto (FASE 6)
- `voice-session.js` — intacto (FASE 6)

Cero archivos del motor o de la interfaz web fueron modificados.

---

## Preparacion para FASE 8

FASE 8 puede incluir:

- **Numero principal del negocio** (migrar de prueba a produccion)
- **Base de datos real** (reemplazar mock-tools por API HTTP)
- **Dashboard de monitoreo** (UI web para ver llamadas en vivo)
- **Grabacion selectiva** (con consentimiento del cliente)
- **Motor LLM** (reemplazar regex por Claude para mejor comprension)
- **Multi-restaurante** (un servidor, multiples restaurantes)
- **Analytics avanzado** (conversion funnels, abandonment analysis)

---

## FASE 7 COMPLETADA
