# FASE 4 — TOOLS Y OPERACIONES DEL AGENTE

**Estado:** COMPLETADA  
**Fecha:** 2026-08-29  
**Tests:** 79/79 passing (65 anteriores + 14 nuevos)  
**Criterio de terminado:** consultar → validar → calcular → confirmar → crear orden real con todas las validaciones de backend

---

## Objetivo

Crear la capa segura que permite al agente ACTUAR sobre el sistema del restaurante. FASE 3 permitía consultar; FASE 4 permite crear, modificar y cancelar ordenes reales.

---

## Arquitectura

```
AGENTE (conversation-manager)
  │
  ├─ CONSULTA ──► search_product, get_product, get_menu, get_promotions,
  │               check_availability, get_product_options, validate_modification,
  │               find_customer, get_customer_addresses, get_order_status,
  │               get_restaurant_config, request_human
  │
  ├─ OPERACION ─► validate_delivery_zone, calculate_delivery, calculate_order
  │
  └─ TRANSACCIONAL ► create_customer, create_order, update_order, cancel_order
          │
          ▼
  tool-orchestrator.js (permisos + validacion + auditoria)
          │
          ▼
  mock-tools.js (servicios de datos + orden store)
          │
          ▼
  mock-data.js (catalogo) + _orderStore (ordenes creadas)
```

---

## Implementacion por requerimiento

### 1. Sistema de permisos

**Archivo:** `engine/tool-orchestrator.js`

3 niveles:

| Nivel | Tools | Controles |
|---|---|---|
| CONSULTA | 12 tools | Sin efectos secundarios |
| OPERACION | 3 tools | Calculos y validaciones |
| TRANSACCIONAL | 4 tools | Crea/modifica datos reales. Validacion extra. |

Cada tool tiene `permission` en su registro. Las transaccionales pasan validaciones adicionales.

### 2. create_order — 8 condiciones de backend

**Archivo:** `engine/mock-tools.js`

El backend valida TODAS las condiciones, sin confiar en el agente:

| # | Condicion | Validacion |
|---|---|---|
| 1 | Items presentes | `items` no vacio, array valido |
| 2 | Productos existen | Lookup en catalogo por `product_id` |
| 3 | Precios del sistema | Recalcula `unit_price` del catalogo, no del agente |
| 4 | Disponibilidad | `product.available === true` |
| 5 | Zona de domicilio | `validate_delivery_zone()` cuando delivery |
| 6 | Total calculado por backend | Recalcula y compara con tolerancia $100 |
| 7 | Info del cliente | Nombre requerido para delivery |
| 8 | Confirmacion explicita | `confirmation_status === 'confirmed'` |

Si cualquier condicion falla, retorna error estructurado. Nunca crea orden parcial.

### 3. Idempotencia

**Archivo:** `engine/mock-tools.js`

`create_order` recibe `idempotency_key` = `conversation_id + '_confirmed'`.

- Primera llamada: crea la orden, la guarda en `_orderStore`
- Segunda llamada con misma key: retorna la orden existente con `idempotent: true`
- Nunca se crean ordenes duplicadas

```
Key: conv_abc123_confirmed → Order P-1848
Key: conv_abc123_confirmed → Order P-1848 (idempotent: true)
```

### 4. Validacion de argumentos

**Archivo:** `engine/tool-orchestrator.js`

Cada tool tiene `argTypes` que valida:
- `string`: `typeof val !== 'string'`
- `number`: `typeof val !== 'number'`
- `array`: `!Array.isArray(val)`
- `object`: `typeof val !== 'object' || Array.isArray(val)`

Se valida ANTES de ejecutar. Errores claros: `INVALID_TYPE: items debe ser array`.

### 5. Respuestas estructuradas

Todas las tools retornan:

```json
// Exito
{ "success": true, "data": { "order_id": "P-1848", ... } }

// Error
{ "success": false, "error": "PRODUCT_UNAVAILABLE", "data": { "message": "..." } }
```

Errores tecnicos en logs. Al cliente solo mensajes utiles.

### 6. Auditoria

**Archivo:** `engine/tool-orchestrator.js`

Cada ejecucion registra:

```json
{
  "timestamp": "2026-08-29T...",
  "conversationId": "conv_abc",
  "tool": "create_order",
  "permission": "transaccional",
  "args": { "items": "[Array:2]", "delivery_type": "pickup" },
  "success": true,
  "error": null,
  "durationMs": 3
}
```

- `_sanitizeArgs()` evita payloads grandes en el log
- Nunca almacena secretos
- `getAuditLog(conversationId)` para consultar
- `clearAuditLog()` para tests

### 7. Clientes mejorados

**Archivo:** `engine/mock-tools.js`

`find_customer`:
- Retorna `found: true/false`
- Maneja multiples coincidencias (`multiple: true, count: N`)
- Valida telefono (minimo 7 digitos)
- Errores: `MISSING_PHONE`, `INVALID_PHONE`

`create_customer`:
- Valida nombre (minimo 2 chars)
- Valida telefono
- Detecta duplicados (`CUSTOMER_EXISTS`)
- No crea con datos incompletos

### 8. Ciclo de vida de ordenes

**Archivo:** `engine/mock-tools.js`

```
                  create_order
                      │
                      ▼
                   [nuevo]
                   /     \
         update_order    cancel_order
              │              │
              ▼              ▼
           [nuevo]      [cancelado]
```

`get_order_status`: busca por `order_id` o `customer_phone`  
`update_order`: solo en estado `nuevo` (antes de preparacion)  
`cancel_order`: solo en estados `nuevo` o `aceptado`

### 9. Separacion Draft vs Order

```
OrderDraft (conversacion)          Order (sistema)
─────────────────────────          ──────────────
confirmationStatus:                status:
  building                           nuevo
  reviewing                          aceptado
  confirmed ──── create_order ───►   en preparacion
  order_created                      listo
                                     entregado
                                     cancelado
```

El draft vive en memoria de la conversacion. La orden vive en `_orderStore` (en produccion: base de datos).

### 10. Control de estados

```
COLLECTING_ORDER → ... → WAITING_CONFIRMATION
                              │
                         confirmacion SI
                              │
                              ▼
                          CONFIRMED
                              │
                     executeTool('create_order')
                         backend valida 8 condiciones
                              │
                    ┌─────────┴──────────┐
                 exito                 error
                    │                    │
                    ▼                    ▼
               COMPLETED         COLLECTING_ORDER
            (order_created)       (vuelve a corregir)
```

No se puede saltar de COLLECTING_ORDER a create_order.

---

## Tests (14 nuevos, 79 total)

### F4: Valid Order Creation (1)
- Flujo completo: pizza → nada mas → recoger → efectivo → confirmar → orden con numero

### F4: Backend Validation (5)
- Sin confirmacion → rechazado
- Producto inexistente → rechazado
- Producto agotado → rechazado
- Total manipulado → rechazado (TOTAL_MISMATCH)
- Delivery sin direccion → rechazado

### F4: Idempotency (1)
- Doble create_order con misma key → misma orden, `idempotent: true`

### F4: Order Lifecycle (2)
- Obtener status de orden creada
- Cancelar orden en estado `nuevo`

### F4: Tool Validation (3)
- Tool inexistente → TOOL_NOT_FOUND
- Argumento faltante → MISSING_ARGUMENT
- Tipo invalido → INVALID_TYPE

### F4: Audit Trail (1)
- Ejecuciones quedan en audit log con tool, resultado, duracion

### F4: Permissions (1)
- Tools tienen niveles de permiso correctos (consulta/operacion/transaccional)

---

## Archivos modificados

| Archivo | Cambios |
|---|---|
| `engine/mock-tools.js` | create_order con 8 validaciones + idempotencia; order store; find_customer con multiples matches; create_customer con validacion; get_order_status con lookup; update_order con estado; cancel_order con estado; _resetOrderStore() |
| `engine/tool-orchestrator.js` | Sistema de permisos (3 niveles); argTypes validation; audit trail; getAuditLog/clearAuditLog |
| `engine/conversation-manager.js` | _handleConfirmYes llama create_order real con idempotency_key; _handleCancel usa cancel_order para ordenes creadas; manejo de errores de backend |
| `engine/tests.js` | +14 tests en 7 suites F4 |

---

## No implementado (siguiente fase)

- Audio / TTS / STT
- Realtime / SIP
- Numero telefonico
- Base de datos real (los datos viven en memoria)
- Webhooks/notificaciones a cocina

---

## FASE 4 COMPLETADA
