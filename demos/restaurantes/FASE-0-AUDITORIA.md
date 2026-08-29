# FASE 0 — AUDITORÍA TÉCNICA DEL SISTEMA ACTUAL
## Integración de Agente de Voz de Pedidos para Restaurantes
### 7Group · PedidoIA

---

## 1. RESUMEN EJECUTIVO

El sistema actual de restaurantes (`demos/restaurantes/index.html`) es un **demo visual 100% estático**. No existe backend, base de datos, APIs, autenticación, ni lógica de negocio del lado del servidor.

Todo el "sistema" vive en un único archivo HTML de 697 líneas que:
- Renderiza una interfaz de Kitchen Display System (KDS)
- Simula conversaciones de un agente de voz con transcripts hardcodeados
- Gestiona pedidos con arrays JavaScript en memoria
- Pierde todos los datos al refrescar la página

**Conclusión crítica: NO hay sistema existente de restaurante al cual integrar un agente de voz.** El agente de voz no puede ser un add-on sobre algo existente — tiene que construirse junto con el sistema de pedidos desde cero, o integrarse con el software POS/ERP real del cliente restaurante.

---

## 2. STACK ACTUAL

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Frontend | HTML + CSS + JS vanilla | Un solo archivo, sin framework |
| Backend | **NO EXISTE** | — |
| Lenguaje | JavaScript (ES5) | `var`, `.forEach`, `function(){}` — sin ES6+ |
| Framework | **Ninguno** | Sin React, Vue, Angular, ni bundlers |
| Base de datos | **NO EXISTE** | Variables JavaScript en memoria (`var PEDIDOS=[]`) |
| ORM | **NO EXISTE** | — |
| Autenticación | **NO EXISTE** | Página pública sin login |
| Autorización | **NO EXISTE** | — |
| Almacenamiento | **Ninguno** | No usa localStorage ni sessionStorage |
| Servicios externos | Google Fonts (Inter, JetBrains Mono) | Solo tipografía |
| Deployment | GitHub Pages (estático) | Repo `andresapal/7group` |
| Variables de entorno | **NO EXISTEN** | — |
| APIs | **NO EXISTEN** | — |
| Webhooks | **NO EXISTEN** | — |
| Background jobs | **NO EXISTEN** | — |
| Colas | **NO EXISTEN** | — |

### Otros backends en el proyecto 7Group (NO relacionados con restaurantes)

1. **Logística PyME** (`demos/logistica-pyme/firebase-config.js`) — Google Sheets via Apps Script como backend. Tiene CRUD para shipments, inventory, orders, dispatches, clients. Es el único módulo con persistencia real.

2. **Agendar** (`agendar/apps-script-mailer.js`) — Google Apps Script para agendar citas, crear eventos en Calendar, enviar emails y notificar por Telegram.

3. **Aseguralo** (`agente/aseguralo/config.json`) — Un URL de Apps Script para el broker de seguros.

Ninguno de estos backends tiene relación con restaurantes ni con el demo de PedidoIA.

---

## 3. ARQUITECTURA ACTUAL

```
ARQUITECTURA ACTUAL (Demo PedidoIA)

┌──────────────────────────────────────────────────────┐
│                    BROWSER                            │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │            index.html (697 líneas)              │  │
│  │                                                 │  │
│  │  ┌──────────────┐  ┌──────────────────────────┐ │  │
│  │  │  CSS (213 l) │  │  HTML Structure (184 l)  │ │  │
│  │  │  Variables   │  │  Topbar + Nav + Modules  │ │  │
│  │  │  KDS Cards   │  │  KDS + Voice + History   │ │  │
│  │  │  Voice Panel │  │  Menu + Reports + Modals │ │  │
│  │  │  Tables      │  │  Lead Capture Form       │ │  │
│  │  └──────────────┘  └──────────────────────────┘ │  │
│  │                                                 │  │
│  │  ┌──────────────────────────────────────────────┐│  │
│  │  │           JavaScript (299 l)                ││  │
│  │  │                                             ││  │
│  │  │  var MENU = [12 items hardcoded]            ││  │
│  │  │  var PEDIDOS = [5 orders hardcoded]         ││  │
│  │  │  var HISTORIAL = [6 records hardcoded]      ││  │
│  │  │  var CALL_SCRIPTS = [2 conversations]       ││  │
│  │  │                                             ││  │
│  │  │  renderPedidos()    → KDS board             ││  │
│  │  │  cambiarEstado()    → state transitions     ││  │
│  │  │  simularLlamada()   → timed transcript      ││  │
│  │  │  renderHistorial()  → history table         ││  │
│  │  │  renderMenu()       → menu cards            ││  │
│  │  │  renderReportes()   → KPIs + bar charts     ││  │
│  │  │  enviarLead()       → wa.me redirect        ││  │
│  │  └──────────────────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  PERSISTENCIA: CERO                                   │
│  BACKEND: CERO                                        │
│  APIs: CERO                                           │
└──────────────────────────────────────────────────────┘

GitHub Pages ─────── Sirve archivo estático ───── Fin
```

---

## 4. MODELO DE DATOS

### 4.1 Entidades existentes (JavaScript en memoria)

#### MENU (productos)
```
{
  id: Number,           // 1-12, auto-incremento manual
  nombre: String,       // "Pizza Pepperoni Grande"
  desc: String,         // "Masa artesanal, pepperoni premium..."
  precio: Number,       // 32000 (pesos colombianos, entero)
  cat: String           // "Pizzas" | "Hamburguesas" | "Acompanantes" | "Bebidas" | "Combos"
}
```
- **12 productos** hardcodeados
- Sin SKU, sin código de barras, sin imágenes
- Sin variantes (tamaño, extras, ingredientes removibles)
- Sin control de inventario/disponibilidad
- Sin impuestos ni IVA
- El precio es final (no hay lógica de cálculo)

#### PEDIDOS (órdenes activas)
```
{
  id: String,           // "P-001" a "P-005"
  hora: String,         // "12:15" (texto, no timestamp)
  cliente: String,      // "Juan Perez" (nombre libre)
  tel: String,          // "3101234567"
  canal: String,        // Siempre "Llamada IA"
  items: [{
    nombre: String,     // Referencia textual al producto
    qty: Number,        // Cantidad
    precio: Number      // Precio unitario
  }],
  total: Number,        // Suma manual (no calculada por función)
  dir: String,          // "Cra 15 #45-20, Apto 301" (texto libre)
  pago: String,         // "Efectivo" | "Nequi" | "Daviplata" | "Tarjeta"
  estado: String,       // "nuevo" | "preparando" | "listo" | "entregado" | "cancelado"
  minutos: Number       // Tiempo transcurrido (estático, no se actualiza)
}
```
- **5 pedidos** hardcodeados
- Items referencian productos por nombre (no por ID)
- Total es pre-calculado manualmente, no se verifica contra items
- No hay relación formal producto ↔ item
- No hay ID de cliente (solo nombre+teléfono como texto)
- No hay timestamp real (solo hora como string)
- No hay costo de domicilio separado

#### HISTORIAL (pedidos pasados)
```
{
  id: String,           // "P-093" a "P-098"
  hora: String,
  cliente: String,
  canal: String,
  items: Number,        // NOTA: aquí es cantidad, no array
  total: Number,
  tiempo: String,       // "14 min" (texto)
  estado: String        // "entregado" | "cancelado"
}
```
- Estructura DIFERENTE a PEDIDOS (items es Number, no Array)
- No tiene dirección, teléfono, ni detalle de items

#### CALL_SCRIPTS (guiones de llamada)
```
{
  cliente: String,
  tel: String,
  items: [{nombre, qty, precio}],
  dir: String,
  pago: String,
  transcript: [{
    who: "agent" | "client",
    text: String
  }]
}
```
- **2 guiones** hardcodeados
- Son estáticos, no generativos
- No son IA real — son secuencias de texto con setTimeout

### 4.2 Entidades que NO existen

| Entidad | Necesaria para agente de voz | Estado |
|---------|------------------------------|--------|
| Categorías (tabla) | Sí | Solo string en producto |
| Variantes/tamaños | Sí | No existe |
| Ingredientes | Sí (para remover/agregar) | No existe |
| Complementos/extras | Sí (para upsell) | No existe |
| Modificaciones | Sí ("sin cebolla", "extra queso") | No existe |
| Promociones/descuentos | Sí | No existe |
| Clientes (tabla) | Sí (lookup por teléfono) | No existe |
| Direcciones (tabla) | Sí (historial por cliente) | No existe |
| Domicilios (config) | Sí (zonas, costos, tiempos) | No existe |
| Métodos de pago | Sí (configurables) | Solo strings hardcoded |
| Usuarios/roles | Sí (admin, cocina, domiciliario) | No existe |
| Sucursales | Potencialmente | No existe |
| Inventario/stock | Sí (disponibilidad en tiempo real) | No existe |
| Horarios | Sí (cuándo puede pedir) | No existe |
| Impuestos | Depende (IVA, propinas) | No existe |

### 4.3 Relaciones entre entidades

**No hay relaciones formales.** Todo es referencia textual:
- Pedido → Producto: por `nombre` (string match), no por `id`
- Pedido → Cliente: por `cliente` (nombre como texto), no hay tabla de clientes
- No hay foreign keys, ni integridad referencial, ni normalización

---

## 5. FLUJO ACTUAL DEL PEDIDO

### 5.1 Flujo de simulación (el único que existe)

```
USUARIO PRESIONA "Simular Llamada"
  │
  ├── simularLlamada()                          [línea 546]
  │   ├── Selecciona CALL_SCRIPTS[callIdx]      (round-robin entre 2 scripts)
  │   ├── Cambia a tab "Agente de Voz"          
  │   ├── Limpia transcript
  │   ├── forEach transcript → setTimeout       (1200-2000ms entre mensajes)
  │   │   └── Crea div.voice-msg en DOM         (no es IA, es texto fijo)
  │   │
  │   └── setTimeout final (tras último msg + 1500ms)
  │       ├── Calcula total = sum(qty * precio)  [línea 583]
  │       ├── Genera ID = "P-" + padStart        [línea 585]
  │       ├── PEDIDOS.push({...})                [línea 586-590]
  │       ├── CALL_LOG.unshift({...})            [línea 592]
  │       ├── renderCallLog()                    
  │       ├── renderPedidos()                    
  │       ├── renderReportes()                   
  │       └── showToast("Nuevo pedido...")       
  │
  v
PEDIDO APARECE EN KDS BOARD (estado: "nuevo")
  │
  ├── cambiarEstado(id, "preparando")            [línea 499]
  │   └── PEDIDOS.find(id).estado = "preparando"
  │   └── renderPedidos() + renderHistorial() + renderReportes()
  │
  ├── cambiarEstado(id, "listo")
  │   └── Mismo patrón
  │
  ├── cambiarEstado(id, "entregado")
  │   └── Mismo patrón → desaparece del KDS, aparece en Historial
  │
  └── cambiarEstado(id, "cancelado")
      └── showToast con tipo "error"
```

### 5.2 Lo que NO ocurre en el flujo

- No hay validación de disponibilidad de producto
- No hay cálculo de costo de domicilio
- No hay verificación de zona de cobertura
- No hay validación de horario de operación
- No hay lookup de cliente existente
- No hay persistencia (todo se pierde al refrescar)
- No hay notificación a cocina (no hay websockets ni push)
- No hay integración con sistema POS externo
- No hay confirmación de pago
- No hay asignación de domiciliario
- No hay tracking de entrega

---

## 6. APIs EXISTENTES

### **NO EXISTEN APIs.**

El sistema es 100% client-side. No hay:
- Endpoints HTTP (ni REST ni GraphQL)
- Fetch calls a backend
- WebSockets
- Server-Sent Events
- Apps Script para restaurantes

La única llamada externa es `window.open('https://wa.me/573143095194?text=...')` en `enviarLead()` (línea 685), que abre WhatsApp en una pestaña nueva para captura de leads.

### APIs en OTROS módulos de 7Group (referencia)

El proyecto logística tiene un patrón funcional que PODRÍA replicarse:

```
Frontend ──fetch──► Apps Script URL ──► Google Sheets
                    (doPost/doGet)       (CRUD)
```

Archivo: `demos/logistica-pyme/firebase-config.js` (mal nombrado, no usa Firebase)

Operaciones disponibles en logística (no en restaurantes):
- `SheetsAPI.post({action: 'append'|'update'|'upsert'|'delete', sheet, key, row})`
- `SheetsAPI.get(sheetName, {key, value})`

Este patrón se podría adaptar para restaurantes como solución interim, pero NO es el backend adecuado para un agente de voz en tiempo real.

---

## 7. LÓGICA DE PRECIOS

### 7.1 Dónde se calcula actualmente

| Concepto | Ubicación | Cómo funciona |
|----------|-----------|---------------|
| Precio unitario | `MENU[].precio` | Hardcoded en array |
| Cantidad × precio | `simularLlamada()` línea 583 | `items.reduce(sum, qty*precio)` |
| Complementos | **NO EXISTE** | — |
| Modificaciones | **NO EXISTE** | — |
| Descuentos | **NO EXISTE** | — |
| Promociones | **NO EXISTE** | — |
| Domicilio | **NO EXISTE** | — |
| Impuestos | **NO EXISTE** | — |
| Total final | Precalculado en datos demo | No hay función centralizada |

### 7.2 Riesgo crítico

**El total de los pedidos hardcodeados NO se calcula dinámicamente.** Ejemplo:

Pedido P-003:
- 2× Hamburguesa Doble Queso = 2 × $32,000 = $64,000
- 2× Papas Grandes = 2 × $10,000 = $20,000
- 2× Malteada = 2 × $14,000 = $28,000
- **Cálculo real: $112,000** ✓ (coincide con `total: 112000`)

Los totales de los datos demo SÍ son correctos manualmente, pero no hay una función `calcularTotal(items)` reutilizable.

La única función que calcula es en `simularLlamada()`:
```javascript
var total = script.items.reduce(function(s,i){ return s + i.qty * i.precio }, 0);
```

### 7.3 Para el agente de voz

Se necesita una función centralizada del lado del backend que:
1. Reciba items con IDs de producto y cantidades
2. Valide que los productos existan y estén disponibles
3. Aplique precios actuales de la base de datos
4. Calcule complementos/modificaciones
5. Calcule costo de domicilio por zona
6. Aplique descuentos/promociones si existen
7. Calcule impuestos si aplican
8. Retorne total verificado

**El agente de voz NUNCA debe calcular el precio final.** Debe usar la función del backend.

---

## 8. ESTADOS DEL PEDIDO

### 8.1 Estados actuales

```
nuevo ──► preparando ──► listo ──► entregado
  │           │            │
  └───────────┴────────────┴──► cancelado
```

| Estado | Descripción | Color | Badge |
|--------|-------------|-------|-------|
| `nuevo` | Recién creado, sin aceptar | — | — |
| `preparando` | Aceptado, en cocina | — | — |
| `listo` | Listo para entrega/recogida | — | — |
| `entregado` | Entregado al cliente | verde | badge-green |
| `cancelado` | Cancelado | rojo | badge-red |

### 8.2 Transiciones

| De → A | Quién | Acción en UI | Función |
|--------|-------|-------------|---------|
| nuevo → preparando | Cualquiera (no hay roles) | Botón "Aceptar Pedido" | `cambiarEstado(id,'preparando')` |
| preparando → listo | Cualquiera | Botón "Listo para Entrega" | `cambiarEstado(id,'listo')` |
| listo → entregado | Cualquiera | Botón "Marcar Entregado" | `cambiarEstado(id,'entregado')` |
| cualquiera → cancelado | Cualquiera | Botón "X" | `cambiarEstado(id,'cancelado')` |

### 8.3 Problemas detectados

- No hay restricción de transiciones (se puede ir de cualquier estado a cancelado, pero no se puede retroceder)
- No hay registro de quién cambió el estado
- No hay timestamp por cambio de estado
- No hay notificación al cambiar estado
- No hay razón de cancelación
- Falta estado `en_camino` (domiciliario en ruta)
- Falta estado `rechazado` (rechazo en cocina por falta de ingredientes)

---

## 9. AUTENTICACIÓN Y SEGURIDAD

### **NO EXISTE NINGÚN mecanismo de seguridad.**

| Elemento | Estado |
|----------|--------|
| Login/registro | No existe |
| Autenticación | No existe |
| Autorización | No existe |
| Roles | No existe |
| Sesiones | No existe |
| Tokens | No existe |
| API keys | No existe |
| Secrets | No existe |
| CORS | No aplica (no hay backend) |
| Rate limiting | No existe |
| Validación de input | Mínima (solo verifica que campos no estén vacíos en `saveItem()` y `enviarLead()`) |
| HTTPS | Sí, por GitHub Pages |
| CSP headers | No configurados |

### Para el agente de voz se necesitará

1. **Autenticación del restaurante** (login admin para configurar menú, ver pedidos)
2. **API key para el agente de voz** (acceso controlado a crear pedidos)
3. **Roles mínimos:** admin, cocina, domiciliario, agente-IA
4. **Rate limiting** en creación de pedidos (prevenir abuso)
5. **Validación server-side** de todos los inputs del agente
6. **El agente NO debe tener acceso a:** configuración del restaurante, datos financieros, información de otros restaurantes (si es multi-tenant)

---

## 10. ELEMENTOS REUTILIZABLES

### Del demo actual de restaurantes

| Elemento | Reutilizable | Como qué |
|----------|-------------|----------|
| Estructura de UI (KDS board) | ✅ Sí | Template visual del frontend |
| Diseño de tarjetas de pedido | ✅ Sí | Componente KDS |
| Flujo de estados del pedido | ✅ Parcial | Base para máquina de estados real |
| Modelo de datos de menú | ✅ Parcial | Estructura base, falta expandir |
| CSS / paleta de colores | ✅ Sí | Design system |
| Simulación de llamada (UX) | ✅ Sí | Referencia de cómo mostrar la conversación en tiempo real |
| Categorías de productos | ✅ Parcial | Pizzas, Hamburguesas, etc. |
| Métodos de pago | ✅ Parcial | Efectivo, Nequi, Daviplata, Tarjeta |
| Lead capture → WhatsApp | ✅ Sí | Funcional hoy |

### De otros módulos de 7Group

| Elemento | Fuente | Reutilizable como |
|----------|--------|-------------------|
| SheetsAPI + LocalCache | `logistica-pyme/firebase-config.js` | Patrón backend interim (Google Sheets) |
| Apps Script doPost/doGet | `apps-script.js` | Template para API backend |
| Calendar + Email + Telegram | `agendar/apps-script-mailer.js` | Notificaciones al restaurante |

---

## 11. ELEMENTOS FALTANTES

### Críticos (sin estos no se puede construir el agente)

| # | Elemento | Prioridad | Complejidad |
|---|----------|-----------|-------------|
| 1 | Backend real (servidor) | CRÍTICA | Alta |
| 2 | Base de datos persistente | CRÍTICA | Media |
| 3 | API de productos (search, details, availability) | CRÍTICA | Media |
| 4 | API de pedidos (create, update, get status) | CRÍTICA | Media |
| 5 | API de clientes (get/create by phone) | CRÍTICA | Media |
| 6 | Motor de voz IA (STT + LLM + TTS) | CRÍTICA | Alta |
| 7 | Función centralizada de cálculo de precios | CRÍTICA | Media |
| 8 | Telephony integration (recibir llamadas) | CRÍTICA | Alta |

### Importantes (necesarios para producción)

| # | Elemento | Prioridad |
|---|----------|-----------|
| 9 | Autenticación y roles | ALTA |
| 10 | Variantes de producto (tamaños, extras) | ALTA |
| 11 | Modificaciones ("sin cebolla") | ALTA |
| 12 | Gestión de disponibilidad/stock | ALTA |
| 13 | Zonas de cobertura y costos de domicilio | ALTA |
| 14 | Horarios de operación | ALTA |
| 15 | Notificaciones en tiempo real (WebSocket/Push) | ALTA |
| 16 | Historial de pedidos por cliente | MEDIA |
| 17 | Promociones y descuentos | MEDIA |
| 18 | Tracking de domicilio | MEDIA |
| 19 | Reportes y analytics reales | MEDIA |
| 20 | Multi-sucursal | BAJA (fase futura) |

---

## 12. RIESGOS

### Riesgos técnicos

| # | Riesgo | Severidad | Descripción |
|---|--------|-----------|-------------|
| R1 | **No hay backend** | CRÍTICA | No hay nada server-side. El agente de voz necesita un backend real con APIs seguras. Google Sheets NO es adecuado para pedidos en tiempo real de un restaurante. |
| R2 | **Precios calculados en frontend** | ALTA | El total se calcula en el browser. El agente de voz no puede confiar en cálculos client-side. Se necesita cálculo server-side. |
| R3 | **Productos sin identificadores estables** | ALTA | Los items en pedidos se referencian por nombre textual (`"Pizza Pepperoni Grande"`), no por ID. Un typo del agente de voz no matcheará. Necesitan IDs o slugs estables. |
| R4 | **Sin validación de datos** | ALTA | No hay validación de: stock, zona, horario, precio actual, producto activo. El agente podría vender un producto agotado o fuera de horario. |
| R5 | **Ausencia de transacciones** | ALTA | `cambiarEstado()` modifica un array en memoria sin transaccionalidad. Dos clicks simultáneos podrían corromper el estado. |
| R6 | **Clientes duplicados** | MEDIA | No hay tabla de clientes. Cada pedido registra nombre+teléfono como texto libre. "Juan Pérez" y "Juan Perez" serían clientes diferentes. |
| R7 | **Direcciones no estructuradas** | MEDIA | Dirección es texto libre. No hay geocodificación, validación de zona, ni cálculo de distancia. |
| R8 | **Estados ambiguos** | MEDIA | No hay timestamp por transición de estado. No se puede calcular tiempo real en cocina. El campo `minutos` es estático. |
| R9 | **Sin persistencia** | CRÍTICA | Todo dato se pierde al refrescar. No hay localStorage ni cookies ni backend. |
| R10 | **Lógica difícil de reutilizar** | MEDIA | El JavaScript usa `var`, concatenación de strings HTML, y rendering manual. No es modular ni testeable. |
| R11 | **Sin sistema de notificaciones** | ALTA | No hay forma de avisar a cocina que llegó un pedido nuevo (sin WebSocket, sin Push, sin sonido). |
| R12 | **Sin logging/auditoría** | MEDIA | No hay registro de acciones, errores, ni eventos. Imposible diagnosticar problemas. |

### Riesgos de negocio

| # | Riesgo | Descripción |
|---|--------|-------------|
| B1 | **Integración POS real** | Cada restaurante usa un software diferente (o ninguno). La integración con POS existente es el mayor reto técnico-comercial. |
| B2 | **Latencia de voz** | Un agente de voz necesita responder en <1 segundo. La cadena STT→LLM→TTS→Telephony tiene latencia acumulada. |
| B3 | **Acento y ruido** | Clientes colombianos con diversos acentos, en ambientes ruidosos. El STT debe ser robusto. |
| B4 | **Manejo de excepciones** | "Quiero una pizza sin bordes" — el agente debe manejar pedidos no estándar, preguntas sobre ingredientes, alergias, etc. |
| B5 | **Costo por minuto** | Telephony (Twilio) + STT + LLM + TTS tienen costo por llamada. El unit economics debe cerrar vs contratar un humano. |

---

## 13. ARQUITECTURA FUTURA PROPUESTA

### Regla inviolable

```
VOICE AGENT → TOOL → BACKEND → DATABASE

NUNCA:
VOICE AGENT → DATABASE
```

### Arquitectura propuesta

```
                    ┌──────────────────────────────┐
                    │     TELEPHONY PROVIDER        │
                    │   (Twilio / Vonage / Telnyx)  │
                    │                               │
                    │  Recibe llamada telefónica     │
                    │  Stream de audio bidireccional │
                    └──────────┬───────────────────┘
                               │ WebSocket (audio)
                               ▼
                    ┌──────────────────────────────┐
                    │      VOICE ORCHESTRATOR       │
                    │   (Servidor Node.js/Python)    │
                    │                               │
                    │  STT: Audio → Texto           │
                    │  (Deepgram / Whisper / Google) │
                    │                               │
                    │  LLM: Texto → Decisión + Resp │
                    │  (Claude / GPT-4o)            │
                    │  - System prompt con menú     │
                    │  - Tool calling para acciones  │
                    │                               │
                    │  TTS: Texto → Audio           │
                    │  (ElevenLabs / PlayHT / XTTS) │
                    └──────────┬───────────────────┘
                               │ Tool calls (HTTP)
                               ▼
                    ┌──────────────────────────────┐
                    │       RESTAURANT API           │
                    │    (Backend: FastAPI / Next)    │
                    │                               │
                    │  /api/products/search          │
                    │  /api/products/:id             │
                    │  /api/products/:id/availability│
                    │  /api/customers/lookup         │
                    │  /api/customers                │
                    │  /api/orders/calculate         │
                    │  /api/orders                   │
                    │  /api/orders/:id/status        │
                    │  /api/delivery/estimate        │
                    │  /api/hours/check              │
                    │                               │
                    │  Auth: API Key + Restaurant ID │
                    │  Rate Limit: por restaurante   │
                    │  Validation: server-side       │
                    └──────────┬───────────────────┘
                               │ SQL / ORM
                               ▼
                    ┌──────────────────────────────┐
                    │         DATABASE               │
                    │    (Supabase / PostgreSQL)      │
                    │                               │
                    │  restaurants                   │
                    │  products                      │
                    │  categories                    │
                    │  variants                      │
                    │  modifiers                     │
                    │  customers                     │
                    │  addresses                     │
                    │  orders                        │
                    │  order_items                   │
                    │  order_status_log              │
                    │  delivery_zones                │
                    │  payment_methods               │
                    │  promotions                    │
                    │  business_hours                │
                    └──────────────────────────────┘

                               ║
          ┌════════════════════╬═══════════════════┐
          ║                    ║                    ║
          ▼                    ▼                    ▼
  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐
  │  DASHBOARD   │  │  KDS (Cocina) │  │  POS (si hay) │
  │  Admin Web   │  │  Tablero Web  │  │  Integración  │
  │              │  │              │  │  vía API       │
  │  Gestionar:  │  │  Ver pedidos  │  │               │
  │  - Menú      │  │  nuevos en    │  │  El pedido se │
  │  - Horarios  │  │  tiempo real  │  │  crea también │
  │  - Precios   │  │  (WebSocket)  │  │  en el POS    │
  │  - Zonas     │  │              │  │  del negocio   │
  │  - Reportes  │  │  Cambiar      │  │               │
  └──────────────┘  │  estado       │  └───────────────┘
                    └───────────────┘
```

### Tools del agente de voz (function calling)

El LLM tendrá acceso a estas herramientas — cada una llama al Restaurant API:

| Tool | Descripción | Endpoint |
|------|-------------|----------|
| `search_product` | Buscar producto por nombre/descripción | `GET /api/products/search?q=` |
| `get_product_details` | Detalle de un producto con variantes y modificadores | `GET /api/products/:id` |
| `check_availability` | Verificar si producto está disponible ahora | `GET /api/products/:id/availability` |
| `get_customer` | Buscar cliente por teléfono (caller ID) | `GET /api/customers/lookup?phone=` |
| `create_customer` | Crear cliente nuevo | `POST /api/customers` |
| `get_customer_addresses` | Direcciones guardadas del cliente | `GET /api/customers/:id/addresses` |
| `calculate_delivery` | Estimar costo y tiempo de domicilio | `POST /api/delivery/estimate` |
| `calculate_order` | Calcular total del pedido (server-side) | `POST /api/orders/calculate` |
| `create_order` | Crear pedido confirmado | `POST /api/orders` |
| `get_order_status` | Consultar estado de pedido existente | `GET /api/orders/:id/status` |
| `update_order` | Modificar pedido antes de preparar | `PATCH /api/orders/:id` |
| `cancel_order` | Cancelar pedido | `POST /api/orders/:id/cancel` |

### Stack tecnológico sugerido

| Capa | Opción recomendada | Razón |
|------|-------------------|-------|
| Backend | **Next.js API Routes** o **FastAPI (Python)** | Next.js si queremos unificar con frontend; FastAPI si preferimos Python para ML/voz |
| Database | **Supabase (PostgreSQL)** | Ya usado en TYGO, realtime built-in, auth incluido |
| Telephony | **Twilio** | SDK maduro, precios Colombia, WebSocket streaming |
| STT | **Deepgram** | Mejor latencia, buen español, streaming |
| LLM | **Claude (Anthropic)** | Tool calling robusto, español nativo |
| TTS | **ElevenLabs** o **PlayHT** | Voces en español natural, baja latencia |
| Realtime (KDS) | **Supabase Realtime** | Notificación instantánea a cocina |
| Hosting | **Vercel** (Next.js) o **Railway** (FastAPI) | Serverless o container |

---

## 14. RECOMENDACIÓN DE SIGUIENTE FASE

### FASE 1 — Construir el backend del restaurante (sin agente de voz aún)

**Objetivo:** Crear un sistema funcional de gestión de pedidos que pueda operar independientemente y que después el agente de voz use como backend.

**Entregables Fase 1:**

1. **Base de datos** (Supabase)
   - Schema completo: restaurants, products, categories, variants, modifiers, customers, addresses, orders, order_items, order_status_log, delivery_zones, business_hours
   - Seed data con menú real del restaurante piloto

2. **API REST**
   - Todos los endpoints listados en la sección 13
   - Auth por API key
   - Validación completa server-side
   - Cálculo de precios centralizado

3. **Dashboard Admin** (web)
   - CRUD de productos, categorías, variantes
   - Configurar horarios, zonas, precios de domicilio
   - Ver reportes

4. **KDS (Kitchen Display)**
   - Tablero de pedidos en tiempo real (Supabase Realtime)
   - Cambiar estados con un click
   - Sonido/alerta al nuevo pedido

### FASE 2 — Integrar agente de voz

**Solo después de que Fase 1 esté funcional y validada con un restaurante piloto.**

1. Configurar Twilio para recibir llamadas
2. Implementar Voice Orchestrator (STT → LLM → TTS)
3. Conectar LLM tools a la API de Fase 1
4. Probar con llamadas reales
5. Iterar personalidad y flujo del agente

### Alternativa: Fase 1 simplificada (Google Sheets)

Si se quiere validar rápido con un restaurante real sin invertir en Supabase:
- Replicar el patrón de `firebase-config.js` (logística) para restaurantes
- Google Sheet como "base de datos"
- Apps Script como API
- **Limitaciones:** no hay realtime, latencia alta, no escala, no apto para agente de voz en producción
- **Útil para:** validar el concepto con 1 restaurante piloto antes de invertir en infra

---

## FASE 0 COMPLETADA

### Resumen de hallazgos

**¿Qué tenemos?**
- Un demo visual funcional que muestra el concepto (KDS, simulación de voz, menú, reportes)
- Buena UI/UX que sirve como template para el frontend real
- Un patrón de backend con Google Sheets probado en logística (reutilizable como MVP)
- Captura de leads funcional vía WhatsApp

**¿Qué NO tenemos?**
- Cero backend
- Cero persistencia
- Cero APIs
- Cero autenticación
- Cero integración con voz real
- Cero conexión con POS externo

**¿Qué piezas del sistema actual podemos reutilizar para construir el agente de voz?**

1. **UI del KDS** — la interfaz de tablero de cocina puede evolucionar a componente real
2. **Estados del pedido** — el flujo nuevo→preparando→listo→entregado es correcto, solo falta expandir
3. **Estructura de datos del menú** — la base (id, nombre, precio, categoría) es válida, se expande con variantes/modificadores
4. **Simulación de llamada UX** — el transcript visual puede ser la interfaz de monitoreo real del agente
5. **Patrón SheetsAPI** (de logística) — se puede replicar como backend interim para restaurantes
6. **Notificaciones Telegram** (de agendar) — se puede reutilizar para alertar al restaurante de nuevos pedidos

**Lo que hay que construir de cero:**
- Backend completo (API + DB)
- Motor de voz (STT + LLM + TTS)
- Integración telefónica (Twilio)
- Sistema de autenticación
- Lógica de precios server-side
- Sistema de notificaciones en tiempo real
