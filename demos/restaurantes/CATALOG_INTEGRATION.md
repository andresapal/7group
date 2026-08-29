# FASE 3 — CATALOGO Y REGLAS COMERCIALES

**Estado:** COMPLETADA  
**Fecha:** 2026-08-29  
**Tests:** 65/65 passing  
**Criterio de terminado:** 5/5 queries respondidas correctamente con datos del sistema

---

## Objetivo

Conectar el agente con datos reales de catalogo para que consulte productos, precios, opciones, disponibilidad y promociones sin inventar informacion.

---

## Arquitectura

```
AGENTE (conversation-manager)
  │
  ├── detectIntent() ──► intent + entities
  │
  ├── _handleAskProduct()    ──► get_menu
  ├── _handleAskPrice()      ──► search_product
  ├── _handleAskOptions()    ──► get_product_options / validate_modification
  ├── _handleAskAvailability() ► search_product + check_availability
  ├── _handlePromotion()     ──► get_promotions
  ├── _handleModifyItem()    ──► validate_modification
  └── _handleAddItem()       ──► search_product + check_availability + get_product
          │
          ▼
  tool-orchestrator.js (validacion pre/post)
          │
          ▼
  mock-tools.js (servicios de datos)
          │
          ▼
  mock-data.js (catalogo enriquecido)
```

El agente NUNCA toca datos directamente. Siempre pasa por tool-orchestrator → servicio → datos.

---

## Implementacion por requerimiento

### R1. Busqueda fuzzy con scoring

**Archivo:** `engine/mock-tools.js` → `search_product()`

Algoritmo de scoring por capas:

| Match | Score |
|---|---|
| Alias exacto | 1.00 |
| Alias parcial | 0.85 |
| Short name exacto | 0.95 |
| Short name parcial | 0.80 |
| Nombre contiene query | 0.75 |
| Descripcion contiene query | 0.40 |
| Overlap de palabras (>50%) | 0.30 - 0.60 |

Normalizacion: `_norm()` quita acentos, minusculas, trim.

Desambiguacion automatica: si el top result tiene score >= 0.7 y gap >= 0.15 del segundo, se auto-selecciona sin preguntar.

### R2. Aliases coloquiales

**Archivo:** `engine/mock-data.js`

Productos enriquecidos con aliases de lenguaje natural:

- Hamburguesa Clasica: `la sencilla`, `hamburguesa sencilla`, `hamburguesa normal`, `hamburguesa simple`
- Hamburguesa Doble Queso: `la especial`, `hamburguesa especial`, `la grande`, `la doble`, `la de doble carne`
- Combo Personal: `combo sencillo`
- Combo Familiar: `combo grande`, `combo para compartir`

### R3. Consulta de opciones de producto

**Archivo:** `engine/mock-tools.js` → `get_product_options()`  
**Intent:** `ASK_OPTIONS`  
**Patrones:** 12 regex en `OPTIONS_PATTERNS`

Retorna al cliente:
- Ingredientes del producto
- Items removibles (basado en `available_modifiers` tipo `remove`)
- Modificadores agregables con precio extra
- Variantes disponibles (sabores para gaseosas, malteadas)
- Items incluidos (para combos)

Solo datos customer-facing. Nunca costos internos, margenes o IDs internos.

### R4. Validacion de modificaciones

**Archivo:** `engine/mock-tools.js` → `validate_modification()`

Validacion en dos capas:
1. Buscar en lista explicita `available_modifiers` del producto
2. Si es tipo `remove`, buscar en lista de `ingredients`

Si no es valido, retorna `valid: false` con lista de modificaciones disponibles para sugerir alternativas.

**Ejemplo real:** "sin pepperoni" en Pizza Margarita → rechazado ("no lleva pepperoni, puedes quitar: tomate, albahaca").

### R5. Deteccion de modificacion en contexto

**Archivo:** `engine/conversation-manager.js` → `_handleAskOptions()`

Cuando el usuario dice "¿Puedo pedirla sin X?":
1. Detecta patron `sin X` en el mensaje
2. Resuelve producto del contexto (ultimo mencionado via `recordProductMention`)
3. Llama `validate_modification` para validar
4. Responde si es posible o no, con alternativas

El `_handleAskPrice` ahora registra menciones de producto para mantener contexto.

### R6. Promociones activas

**Archivo:** `engine/mock-data.js` → `PROMOTIONS[]`  
**Archivo:** `engine/mock-tools.js` → `get_promotions()`

3 promociones demo activas:

| Promo | Tipo | Condicion |
|---|---|---|
| 2x1 en Pizzas los Martes | BOGO | Solo martes, mismo valor o menor |
| Combo + Malteada por $8.000 | Addon discount | Con cualquier combo |
| Domicilio gratis > $80.000 | Free delivery | Pedido minimo $80.000 |

`get_promotions()` filtra solo activas y retorna solo campos customer-facing (id, name, description, conditions). Sin `discount_amount`, `min_order` u otros campos internos.

### R7. Deteccion de variantes

**Archivo:** `engine/conversation-manager.js` → `_handleAddItem()`

Cuando un producto tiene variantes (ej: Gaseosa → cola, limon, naranja):
- Detecta `variants` en el producto
- Pregunta "¿De cual sabor?" con la lista
- Guarda en `pendingQuestion: 'variant_selection'`

### R8. Filtrado de informacion

**Todos los tools** retornan solo datos relevantes para el cliente:
- Nombres, precios, descripciones, ingredientes → SI
- Costos internos, margenes, IDs de sistema, flags de admin → NO

### R9. Registro de herramientas

**Archivo:** `engine/tool-orchestrator.js`

Nuevas herramientas registradas:
- `get_product_options` (requiredArgs: `['product_id']`)
- `validate_modification` (requiredArgs: `['product_id', 'modification_type', 'modification_item']`)

---

## Tests automatizados (11 nuevos, 65 total)

### Suite: Catalog Search (5 tests)
- Buscar producto existente por nombre
- Producto no encontrado retorna hint del menu
- Query ambigua retorna opciones
- Buscar por alias coloquial ("la especial" → Doble Queso)
- Producto no disponible detectado correctamente

### Suite: Catalog Prices (1 test)
- Precio viene del sistema, no inventado ($30.000 para hawaiana)

### Suite: Catalog Modifications (2 tests)
- Modificacion valida aceptada ("sin cebolla" en Clasica)
- Modificacion invalida rechazada con alternativas ("sin pepperoni" en Margarita)

### Suite: Catalog Promotions (2 tests)
- Promociones activas listadas correctamente
- Promocion inexistente manejada sin error

### Suite: Catalog Options (1 test)
- Ingredientes y modificadores retornados para hamburguesa

---

## Criterio de terminado — Verificacion en vivo

| # | Query | Resultado | Estado |
|---|---|---|---|
| 1 | "¿Que hamburguesas tienen?" | Clasica $22.000, Doble Queso $32.000, BBQ $26.000 | PASS |
| 2 | "¿Cuanto vale la especial?" | Doble Queso: $32.000, Clasica: $22.000 | PASS |
| 3 | "¿Puedo pedirla sin cebolla?" | "Si, puedes pedir Hamburguesa Doble Queso sin cebolla" | PASS |
| 4 | "¿Tienen disponible la doble?" | "Si, tenemos Hamburguesa Doble Queso disponible" | PASS |
| 5 | "¿Que promociones tienen?" | 3 promociones activas listadas con condiciones | PASS |

Todas las respuestas usan datos reales del sistema sin inventar informacion.

---

## Archivos modificados

| Archivo | Cambios |
|---|---|
| `engine/mock-data.js` | +aliases, +PROMOTIONS[], +ingredientes detallados |
| `engine/mock-tools.js` | +search con scoring, +get_product_options, +validate_modification, +get_promotions filtrado |
| `engine/tool-orchestrator.js` | +2 herramientas registradas |
| `engine/conversation-state.js` | +ASK_OPTIONS intent |
| `engine/intent-detector.js` | +OPTIONS_PATTERNS, +prioridad 9b, fix _extractCategory |
| `engine/conversation-manager.js` | +_handleAskOptions, +_formatProductOptions, mejoras en _handleModifyItem, _handlePromotion, _handleAddItem, _handleAskPrice |
| `engine/tests.js` | +5 suites, +11 tests |

---

## No-goles (excluidos de esta fase)

- Conexion a base de datos real (FASE 5+)
- Gestion de inventario en tiempo real
- Reglas de precios dinamicos
- Promociones condicionales por hora/dia (estructura lista, logica en FASE 5)
- Combos personalizables con sub-selecciones

---

## FASE 3 COMPLETADA
