# FASE 2 — Motor Conversacional del Agente de Voz

## 1. Resumen

Motor conversacional basado en texto que simula el cerebro del agente de voz para restaurantes. Procesa mensajes de usuario, detecta intenciones, gestiona un pedido provisional, y genera respuestas naturales en español colombiano.

**No incluye:** voz, telefonía, STT/TTS, backend real, base de datos. Todo eso viene en FASE 3+.

## 2. Arquitectura

```
Usuario (texto) → ConversationManager
                    ├── IntentDetector (¿qué quiere?)
                    ├── ContextResolver (¿a qué se refiere?)
                    ├── OrderDraft (pedido provisional)
                    ├── ToolOrchestrator → MockTools → MockData
                    ├── ValidationLayer (¿es válido?)
                    ├── ErrorHandler (errores → mensajes amigables)
                    ├── ResponseGenerator (templates de respuesta)
                    └── Logger (eventos estructurados)
                    → Respuesta (texto)
```

Principio central: **VOICE AGENT → TOOL → BACKEND → DATABASE**. El agente nunca toca datos directamente.

## 3. Archivos

| Archivo | Responsabilidad | Líneas |
|---------|----------------|--------|
| `conversation-manager.js` | Coordinador central — recibe mensaje, orquesta pipeline | ~550 |
| `conversation-state.js` | Máquina de estados + estado temporal | ~220 |
| `order-draft.js` | CRUD del pedido provisional | ~400 |
| `intent-detector.js` | Detección de intenciones + extracción de entidades | ~530 |
| `mock-tools.js` | 16 herramientas simuladas | ~345 |
| `mock-data.js` | Datos del restaurante demo | ~285 |
| `tool-orchestrator.js` | Validación pre/post + ejecución de herramientas | ~210 |
| `context-resolver.js` | Resolución de referencias ("esa", "la otra") | ~110 |
| `response-generator.js` | Templates de respuesta con variación | ~160 |
| `validation-layer.js` | Validaciones de datos en cada etapa | ~150 |
| `error-handler.js` | Errores técnicos → mensajes humanos | ~80 |
| `logger.js` | Logging estructurado con suscriptores | ~205 |
| `tests.js` | 54 tests automatizados | ~470 |
| `index.html` | Interfaz de chat + panel debug | ~380 |

## 4. Máquina de Estados

```
GREETING → UNDERSTANDING → COLLECTING_ORDER ⇄ CLARIFYING
                               ↓
                         DELIVERY_SELECTION → CUSTOMER_DATA
                               ↓                    ↓
                         ORDER_REVIEW ← CALCULATING
                               ↓
                     WAITING_CONFIRMATION
                          ↓         ↓
                    CONFIRMED    (back to COLLECTING_ORDER)
                          ↓
                     COMPLETED

             En cualquier momento:
             → CANCELLED | HUMAN_REQUEST | ERROR
```

Estados terminales: `COMPLETED`, `ABANDONED`.

## 5. Intenciones (20)

| Intent | Ejemplo | Handler |
|--------|---------|---------|
| ORDER | "Quiero una pizza" | _handleAddItem |
| ADD_ITEM | "También dame papas" | _handleAddItem |
| REMOVE_ITEM | "Quita la hawaiana" | _handleRemoveItem |
| MODIFY_ITEM | "Sin cebolla" | _handleModifyItem |
| CHANGE_QUANTITY | "Que sean tres" | _handleChangeQuantity |
| ASK_PRICE | "¿Cuánto cuesta?" | _handleAskPrice |
| ASK_PRODUCT | "¿Qué tienen?" | _handleAskProduct |
| ASK_AVAILABILITY | "¿Tienen hawaiana?" | _handleAskAvailability |
| PROMOTION | "¿Alguna promoción?" | _handlePromotion |
| DELIVERY | "A domicilio" | _handleDelivery |
| PICKUP | "Lo recojo" | _handlePickup |
| ORDER_STATUS | "¿Cómo va mi pedido?" | _handleOrderStatus |
| CANCEL_ORDER | "Cancela todo" | _handleCancel |
| HELP | "Ayúdame" | _handleHelp |
| HUMAN_REQUEST | "Quiero hablar con persona" | _handleHumanRequest |
| CONFIRM_YES | "Sí, confirmo" | _handleConfirmYes |
| CONFIRM_NO | "No, quiero cambiar" | _handleConfirmNo |
| NOTHING_MORE | "No, eso es todo" | _handleNothingMore |
| UNKNOWN | (no reconocido) | _handleUnknown |

Prioridad de detección: Confirmación > Humano > Cancelar > Contexto > Delivery > Pago > Precio > Menú > Promo > Disponibilidad > Status > Ayuda > Remove > Modify > Cantidad > Add > Greeting > Fallback.

## 6. Herramientas (16)

| Herramienta | Descripción | Args requeridos |
|-------------|-------------|-----------------|
| search_product | Buscar productos fuzzy | query |
| get_product | Detalles de producto | product_id |
| check_availability | Verificar disponibilidad | product_id |
| get_menu | Menú completo o por categoría | — |
| get_promotions | Promociones vigentes | — |
| find_customer | Buscar cliente por teléfono | phone |
| create_customer | Crear cliente nuevo | name, phone |
| get_customer_addresses | Direcciones guardadas | customer_id |
| validate_delivery_zone | Validar zona de cobertura | address |
| calculate_delivery | Calcular costo de domicilio | address |
| calculate_order | **Calcular total** (fuente de verdad) | items |
| create_order | Crear pedido real (requiere confirmación) | items, customer_name, delivery_type, payment_method, total |
| get_order_status | Estado de pedido | — |
| cancel_order | Cancelar pedido | order_id |
| request_human | Transferir a humano | — |
| get_restaurant_config | Configuración del restaurante | — |

## 7. Order Draft (Pedido Provisional)

El pedido existe solo en memoria durante la conversación. No es un pedido real.

**Ciclo de vida:** `building` → `reviewing` → `confirmed`

**Campos:**
- `items[]` — productId, productName, quantity, unitPrice, modifications[], lineTotal
- `deliveryType` — 'delivery' | 'pickup' | null
- `deliveryAddress` — raw, formatted, zoneId, isValid
- `paymentMethod` — efectivo, nequi, daviplata, tarjeta
- `subtotal, deliveryFee, discounts[], tax, total` — calculados por backend
- `confirmationStatus` — building | reviewing | confirmed | cancelled

**Regla:** Los precios NUNCA vienen del agente. Siempre de `calculate_order`.

## 8. Datos Demo

Restaurante: **Pizzería Don Mario** (agente: Ana)

12 productos en 5 categorías:
- Pizzas: Pepperoni ($32K), Hawaiana ($30K), Margarita ($28K)
- Hamburguesas: Clásica ($22K), Doble Queso ($32K), BBQ ($26K — agotada)
- Acompañantes: Papas ($10K), Aros de Cebolla ($12K)
- Bebidas: Gaseosa ($4K), Malteada ($14K)
- Combos: Personal ($32K), Familiar ($52K)

Zonas de delivery: Norte (gratis), Centro (gratis), Sur (+$2K), Occidente (+$3K)
Domicilio gratis arriba de $80K.

2 clientes registrados: María González (3167890123), Roberto Sánchez (3134567890).

## 9. Tests

**54 tests en 24 suites.** Todos pasan.

| Suite | Tests | Cobertura |
|-------|-------|-----------|
| Greeting | 3 | Saludo conocido/desconocido, transición de estado |
| Add Items | 7 | Por nombre, cantidad, múltiples, alias, short name, no encontrado, no disponible |
| Remove Items | 2 | Por nombre, pedido vacío |
| Modifications | 2 | Sin ingrediente, extra |
| Quantity | 2 | Numérica, palabra (docena) |
| Price Inquiry | 2 | Con producto, sin producto |
| Menu | 2 | General, por categoría |
| Delivery | 3 | Domicilio, recoger, sin items |
| Full Order Flow | 2 | Pickup completo, delivery + dirección + confirmar |
| Confirmation | 2 | Sí confirma, No permite cambios |
| Cancel | 2 | Vacío, con items |
| Human Transfer | 1 | Solicitar persona |
| Promotions | 1 | Sin promociones activas |
| Availability | 1 | Producto disponible |
| Help | 1 | Solicitar ayuda |
| Misunderstanding | 4 | 1ª, 3ª, 4ª (escalación), reset de contador |
| Payment | 1 | Efectivo |
| State Machine | 2 | Estado correcto, estado terminal rechaza |
| Edge Cases | 4 | Vacío, largo, caracteres especiales, duplicados |
| Security | 3 | Prompt injection, system injection, precio no inventado |
| Order Status | 1 | Sin pedidos |
| Flow Control | 2 | "Nada más" avanza, "Sí" a "algo más" |
| Known Customer | 2 | Saludo personalizado, direcciones guardadas |
| Response Structure | 2 | Campos requeridos, debug snapshot |

## 10. Interfaz de Pruebas

`engine/index.html` — Chat interactivo con:

- **Chat panel:** enviar mensajes, botones de acceso rápido
- **Debug panel:** estado actual, intent detectado, turno, pedido en tiempo real, log de eventos
- **Tests:** botón "Ejecutar Tests" corre las 54 pruebas y muestra resultados
- **Modos:** Nueva conversación (anónimo) o Cliente Conocido (María)

## 11. Decisiones Técnicas

| Decisión | Razón |
|----------|-------|
| Vanilla JS ES6 modules | Mismo stack que el demo existente, sin bundler |
| Pattern matching (no LLM) | FASE 2 es el motor, no la IA. Interface idéntica para reemplazar por Claude en FASE 4 |
| Mock layer separado | `mock-tools.js` se reemplaza por HTTP en producción sin tocar nada más |
| Datos en archivo aparte | `mock-data.js` es la "base de datos" del demo |
| `calculate_order` como fuente de verdad | El agente NUNCA calcula precios — siempre usa el backend |
| Sin `toUpperCase` en input | Cumple regla del proyecto: CSS text-transform + onblur |
| Sin emojis | Cumple regla del proyecto |

## 12. Seguridad

- Mensajes del usuario son DATOS, nunca instrucciones
- Prompt injection tratado como UNKNOWN
- Sanitización de input (caracteres de control, longitud max 500)
- Validación pre/post en tool orchestrator
- `create_order` requiere `confirmationStatus === 'confirmed'`
- Agent nunca inventa precios ni productos

## 13. Flujo de un Mensaje

```
1. processMessage(conv, "Quiero una pizza hawaiana")
2. recordMessage(state, 'user', text)
3. detectIntent(text, state, draft) → { ORDER, 0.80, {items: [{productRef: "hawaiana", qty: 1}]} }
4. _routeIntent → _handleAddItem
5. _resolveAndAddProduct → executeTool('search_product', {query: "hawaiana"})
6. Mock: search against PRODUCTS → [Pizza Hawaiana Grande]
7. executeTool('check_availability', {product_id: "prod_002"}) → available
8. addItem(draft, {productId, productName, quantity: 1, unitPrice: 30000})
9. recordProductMention(state, "prod_002", "Pizza Hawaiana Grande")
10. Response: "Pizza Hawaiana Grande. ¿Algo más?"
11. transitionState → COLLECTING_ORDER
12. recordMessage(state, 'agent', response)
13. Return { response, state, intent, debug }
```

## 14. Errores Conocidos / Limitaciones

- **Warn: `UNDERSTANDING → UNDERSTANDING`** — transición redundante en greeting. Inofensivo.
- **Multi-item en un mensaje** — funciona pero parsing heurístico puede fallar con frases complejas
- **Sin context resolver integrado** — `context-resolver.js` existe pero no está conectado al manager. FASE 3 lo integra.
- **Sin voz** — todo es texto. STT/TTS viene en FASE 3.
- **Sin persistencia** — el pedido no se guarda en ningún lado

## 15. Para FASE 3

Lo que necesita el siguiente paso:

1. **API REST real** — reemplazar `mock-tools.js` por HTTP calls
2. **Base de datos** — Supabase para productos, clientes, pedidos
3. **STT/TTS** — Deepgram o Whisper para voz → texto → voz
4. **Telefonía** — Twilio para recibir/hacer llamadas
5. **Claude LLM** — reemplazar `intent-detector.js` por Claude con function calling
6. **Integrar context-resolver** — conectar resolución de pronombres al manager
7. **Persistencia de conversaciones** — guardar historial para analytics
8. **WebSocket** — actualizaciones en tiempo real del KDS

## 16. Cómo Probar

### En navegador
Abrir `engine/index.html` en un servidor local:
```bash
cd 7group/demos/restaurantes/engine
npx serve .
```
Abrir http://localhost:3000 y usar el chat.

### Tests automatizados
```bash
cd 7group/demos/restaurantes/engine
node run-tests.mjs
```

### Flujo de pedido completo
1. "Quiero una pizza hawaiana" → agrega
2. "Sin piña" → modifica
3. "También dame unas papas" → agrega
4. "No, eso es todo" → avanza a delivery
5. "A domicilio" → pregunta dirección
6. "Calle 85 norte" → valida zona
7. "Efectivo" → calcula total
8. "Sí" → confirma pedido
