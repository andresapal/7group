# FASE 6 — VOZ EN TIEMPO REAL

**Estado:** COMPLETADA  
**Fecha:** 2026-08-29  
**Tecnologia:** OpenAI Realtime API (WebSocket + Server VAD)  
**Principio:** La voz es una nueva interfaz, no un nuevo cerebro  

---

## Resumen

FASE 6 integra voz en tiempo real al agente de restaurante usando la OpenAI Realtime API. El usuario habla por microfono desde el navegador, el agente responde con voz natural. Todo el procesamiento de negocio sigue corriendo en el motor conversacional de FASE 1-5 sin modificaciones.

---

## Arquitectura

```
MICROFONO (navegador)
    |
    v
AudioWorklet (PCM16 @ 24kHz)
    |
    v
WebSocket → OpenAI Realtime API
    |
    ├── STT (Whisper) → transcripcion
    ├── VAD (server_vad) → deteccion de turnos
    └── TTS (voz seleccionada) → audio de respuesta
    |
    v
process_message() [function calling]
    |
    v
CONVERSATION ENGINE (FASE 1-5)
    |  conversation-manager.js
    |  intent-detector.js
    |  order-draft.js
    |  tool-orchestrator.js
    |  mock-tools.js
    |
    v
Texto de respuesta
    |
    v
OpenAI Realtime API → TTS
    |
    v
AudioContext → PARLANTE (navegador)
```

### Flujo de un turno

1. Usuario habla → microfono captura audio
2. AudioWorklet convierte Float32 a PCM16 @ 24kHz, codifica en base64
3. Se envia por WebSocket como `input_audio_buffer.append`
4. OpenAI detecta fin de habla (VAD) → transcribe con Whisper
5. El modelo LLM (GPT-4o) llama `process_message(text)` con el texto exacto
6. Nosotros ejecutamos `processMessage(conv, text)` del motor FASE 1-5
7. La respuesta texto se devuelve como resultado de la funcion
8. OpenAI genera audio TTS y lo envia como `response.audio.delta`
9. Decodificamos PCM16 → Float32 → AudioBuffer → parlante

### Separacion de responsabilidades

| Capa | Responsabilidad | NO hace |
|---|---|---|
| OpenAI Realtime | STT, VAD, TTS, turnos | No toma pedidos, no decide precios |
| voice-session.js | Audio I/O, conexion WS, bridge | No procesa intents, no modifica drafts |
| conversation-manager.js | Intents, estados, tools, respuestas | No sabe que existe voz |

---

## Archivos

| Archivo | Descripcion | Lineas |
|---|---|---|
| `voice.html` | Interfaz de voz con microfono, estados, transcript, debug | ~500 |
| `engine/voice-session.js` | Sesion de voz: WebSocket + AudioWorklet + engine bridge | ~470 |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `index.html` | Boton "Voz en Vivo" en topbar y nav |
| `simulator.html` | Enlace "Voz en Vivo" en topbar |
| `agente/index.html` | Link actualizado a voice.html, tag "Voz Tiempo Real" |

---

## Interfaz de Voz (voice.html)

### Panel de Configuracion
- Input de API Key (password, solo en memoria)
- Selector de voz (8 opciones: shimmer, alloy, echo, coral, sage, ash, ballad, verse)
- Selector de cliente (nuevo, Maria Gonzalez, Roberto Sanchez)
- Sensibilidad VAD (alta/media/baja)
- Nota de seguridad: key solo en memoria, conexion directa a OpenAI

### Interfaz de Voz
- Boton de microfono central con animaciones por estado
- Anillos pulsantes cuando escucha/habla
- Indicador de estado con punto de color + texto
- Cronometro de duracion de llamada
- Boton mute y boton de finalizar

### Estados Visuales

| Estado | Color | Animacion | Descripcion |
|---|---|---|---|
| IDLE | gris | ninguna | Sin conexion |
| CONNECTING | gris | ninguna | Conectando WebSocket |
| READY | verde | ninguna | Listo, esperando al usuario |
| LISTENING | azul | pulso rapido | Usuario hablando (VAD activo) |
| PROCESSING | naranja | pulso rapido | Procesando en motor |
| SPEAKING | cyan | pulso medio | Agente hablando (TTS) |
| INTERRUPTED | azul | pulso | Usuario interrumpio al agente |
| ERROR | rojo | ninguna | Error (recuperable) |
| ENDED | gris | ninguna | Sesion finalizada |

### Panel de Transcripcion
- Muestra conversacion en tiempo real
- Avatares diferenciados (C = Cliente, A = Agente)
- Timestamps por mensaje
- Colapsable

### Panel de Desarrollador
- Metricas en grid: estado voz, estado motor, turnos, latencia, interrupciones, errores
- Log de eventos en tiempo real con tipos codificados por color
- Hasta 200 eventos visibles

---

## Voice Session (engine/voice-session.js)

### API

```javascript
import { VoiceSession, VOICE_STATES, VOICES } from './engine/voice-session.js';

const session = new VoiceSession({
  apiKey: 'sk-...',
  voice: 'shimmer',
  phone: '3001234567',         // opcional
  vadThreshold: 0.5,           // 0.0-1.0
  silenceDurationMs: 800       // ms de silencio para fin de turno
});

// Eventos
session.on('state_changed', ({ from, to }) => { ... });
session.on('user_transcript', ({ text }) => { ... });
session.on('agent_transcript', ({ text }) => { ... });
session.on('engine_response', ({ text, state, intent, debug }) => { ... });
session.on('interrupted', () => { ... });
session.on('error', ({ type, message }) => { ... });
session.on('ended', ({ metrics }) => { ... });

// Lifecycle
await session.start();      // inicia microfono + WS + motor
session.setMuted(true);     // mute/unmute
session.stop();              // termina todo

// Metricas
session.getMetrics();
// { sessionId, durationMs, totalTurns, avgLatencyMs, p95LatencyMs, totalInterruptions, totalErrors }
```

### Manejo de Audio

**Captura (PCM16 encode):**
1. `getUserMedia()` con echo cancellation + noise suppression
2. `AudioContext` a 24kHz (sample rate nativo de OpenAI)
3. `AudioWorklet` convierte Float32 → Int16 (PCM16)
4. Base64 encode → WebSocket `input_audio_buffer.append`

**Reproduccion (PCM16 decode):**
1. Recibe base64 via `response.audio.delta`
2. Decodifica base64 → Uint8Array → Int16Array
3. Convierte Int16 → Float32 (divide por 32768)
4. Crea AudioBuffer → BufferSource → destination
5. Cola de chunks para playback continuo sin gaps

### Interrupciones

Cuando el usuario habla mientras el agente esta hablando:
1. VAD detecta `input_audio_buffer.speech_started`
2. Se detiene el playback inmediatamente (`_stopPlayback()`)
3. Se cancela la respuesta en curso (`response.cancel`)
4. Estado cambia a INTERRUPTED → LISTENING
5. Metrica `totalInterruptions` se incrementa

### Seguridad

- API Key solo en memoria del navegador (nunca persistida)
- Se pasa por WebSocket subprotocol (`openai-insecure-api-key.{key}`)
- Conexion directa navegador → OpenAI (sin relay intermedio)
- El input del password se limpia al desconectar
- No se usa localStorage para credenciales

---

## Configuracion del Relay LLM

El modelo GPT-4o en la Realtime API actua SOLO como relay. Su system prompt:

> "Eres la interfaz de voz de un asistente virtual de restaurante. Tu UNICO trabajo es ser un puente entre la voz del cliente y el sistema de pedidos."

Reglas del relay:
1. SIEMPRE llama `process_message` con lo que el cliente dijo
2. Lee la respuesta en voz alta, NATURAL y AMABLE
3. NUNCA agrega, modifica ni interpreta la respuesta
4. NUNCA toma pedidos por su cuenta
5. NUNCA inventa precios o productos
6. Habla en espanol colombiano

Herramienta unica:
```json
{
  "name": "process_message",
  "parameters": {
    "text": "exactamente lo que dijo el cliente"
  }
}
```

---

## Metricas recopiladas

| Metrica | Descripcion |
|---|---|
| `sessionId` | ID unico de sesion |
| `durationMs` | Duracion total de la llamada |
| `totalTurns` | Numero de turnos completados |
| `avgLatencyMs` | Latencia promedio por turno |
| `p95LatencyMs` | Percentil 95 de latencia |
| `minLatencyMs` | Latencia minima |
| `maxLatencyMs` | Latencia maxima |
| `totalInterruptions` | Veces que el usuario interrumpio al agente |
| `totalErrors` | Errores totales |

---

## Requisitos

1. **Navegador:** Chrome, Edge, Firefox (con soporte AudioWorklet)
2. **Microfono:** Permiso de microfono concedido
3. **API Key:** OpenAI API Key con acceso a Realtime API
4. **Red:** Conexion WebSocket estable a `wss://api.openai.com`

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

Cero archivos del motor fueron modificados. La voz es una interfaz, no un cerebro.

---

## FASE 6 COMPLETADA
