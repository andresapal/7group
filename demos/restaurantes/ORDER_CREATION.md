# FASE 8 — CREACIÓN Y GESTIÓN REAL DEL PEDIDO

## Resumen

FASE 8 convierte la confirmación del pedido en un proceso robusto con validación final, manejo de confirmaciones ambiguas, recuperación de errores, auditoría completa y ciclo de vida del pedido.

---

## Componentes Modificados

### 1. `engine/intent-detector.js`
- **Detección de confirmación ambigua**: Cuando el estado es `WAITING_CONFIRMATION`, respuestas como "bueno", "ajá", "creo que sí", "puede ser", "supongo" son detectadas como ambiguas (no-sí-no-no, sino indefinidas).
- Prioridad: después de sí/no explícito, antes de cualquier otro intent.

### 2. `engine/conversation-manager.js`
- **Manejo de ambiguedad**: Si la confirmación es ambigua, responde "Necesito una confirmacion clara. ¿Confirmas el pedido, si o no?" sin crear el pedido.
- **Respuesta de error mejorada**: Nunca dice "confirmado" cuando `create_order` falla. Mensaje de fallback: "Tu pedido esta listo para confirmarse, pero estoy teniendo un problema con el sistema."
- **Total del backend**: La respuesta de confirmación usa el total calculado por el backend, no el del draft.
- **Audit trail**: Al crear pedido exitosamente, se registra `call_id`, `conversation_id`, `confirmation_id`, y `created_at` en el draft.

### 3. `engine/mock-tools.js`
- **Status inicial**: Pedidos creados con status `'confirmado'` (antes `'nuevo'`).
- **Campos de auditoría**: Cada pedido incluye `call_id`, `conversation_id`, `confirmation_id`, `source: 'voice_agent'`, y `status_history[]`.
- **ORDER_STATES**: Estados válidos con transiciones definidas:
  ```
  confirmado → en_preparacion → listo → despachado → entregado
                    ↓
                cancelado (desde confirmado o en_preparacion)
  ```
- **5 funciones nuevas**:
  - `set_order_audit({ order_id, call_id, conversation_id })` — registrar auditoría
  - `advance_order_status({ order_id, new_status, actor })` — avanzar estado validando transiciones
  - `verify_order({ idempotency_key, order_id })` — recuperación ante estado incierto
  - `get_active_orders()` — pedidos activos para KDS
  - `get_order_full({ order_id })` — pedido completo con auditoría
- **cancel_order**: Estados cancelables actualizados a `['confirmado', 'en_preparacion']`

### 4. `engine/tool-orchestrator.js`
- 5 herramientas nuevas registradas con permisos apropiados:
  - `set_order_audit` → TRANSACCIONAL
  - `advance_order_status` → TRANSACCIONAL
  - `verify_order` → CONSULTA
  - `get_active_orders` → CONSULTA
  - `get_order_full` → CONSULTA

---

## Flujo de Confirmación

```
Cliente dice "sí"/"dale"/"confirmo" → create_order con 8 validaciones backend
  ├── Éxito → "Pedido número X confirmado por $Y" + audit trail
  └── Falla → "Tu pedido está listo pero tengo un problema con el sistema"

Cliente dice "bueno"/"ajá"/"creo que sí" → NO crea pedido
  └── "Necesito una confirmación clara. ¿Confirmas, sí o no?"

Cliente dice "no"/"todavía no" → Vuelve a COLLECTING_ORDER
```

## Idempotencia

- Clave: `conversation_id + '_confirmed'`
- Segundo `create_order` con misma clave retorna el pedido existente sin crear duplicado.

## Auditoría por Pedido

```json
{
  "call_id": "call_abc123",
  "conversation_id": "conv_xyz",
  "confirmation_id": "conv_xyz_confirmed",
  "source": "voice_agent",
  "status_history": [
    { "from": null, "to": "confirmado", "at": "2026-08-29T...", "actor": "system" }
  ]
}
```

---

## Tests

| Suite | Count | Status |
|-------|-------|--------|
| Unit tests | 79/79 | PASS |
| E2E scenarios | 68/68 | PASS |
| **Total** | **147/147** | **PASS** |

### Escenarios FASE 8 añadidos (S61–S68):

| ID | Nombre | Categoría |
|----|--------|-----------|
| S61 | Confirmación ambigua "bueno" pide confirmación clara | confirmation |
| S62 | Confirmación ambigua "creo que sí" pide confirmación clara | confirmation |
| S63 | Confirmación ambigua luego explícita — pedido se crea | confirmation |
| S64 | Pedido creado tiene número y total del backend | audit |
| S65 | Pedido usa total del backend, no del draft | audit |
| S66 | Confirmación explícita "dale" crea pedido | confirmation |
| S67 | Confirmación "ajá" es ambigua — no crea pedido | confirmation |
| S68 | Orden creada tiene status confirmado | audit |

---

## Archivos para subir a GitHub

```
engine/intent-detector.js    (modificado — detección ambigua)
engine/conversation-manager.js (modificado — manejo ambiguo + error recovery + audit)
engine/mock-tools.js          (modificado — status confirmado + audit + lifecycle + 5 funciones)
engine/tool-orchestrator.js   (modificado — 5 herramientas registradas)
engine/e2e-scenarios.js       (modificado — 8 escenarios nuevos S61-S68)
engine/tests.js               (modificado — assertion 'confirmado')
ORDER_CREATION.md             (nuevo — este documento)
```
