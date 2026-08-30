# FASE 9 — PRODUCTO 7GROUP MULTI-TENANT

## Resumen

Transformación del motor VoiceOrder de un restaurante único a una plataforma multi-tenant donde **7Group es el proveedor** y cada restaurante es un cliente independiente.

---

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│               7GROUP PLATFORM                     │
│                                                   │
│  ┌─────────────┐   ┌─────────────┐               │
│  │  TENANT A    │   │  TENANT B    │   ...        │
│  │  Don Mario   │   │  Wok & Roll  │              │
│  │  Agent: Ana  │   │ Agent: Carlos│              │
│  │  Menu: Pizza │   │  Menu: Woks  │              │
│  │  Orders: A   │   │  Orders: B   │              │
│  └──────┬───────┘   └──────┬───────┘              │
│         │                  │                      │
│  ┌──────┴──────────────────┴───────┐              │
│  │      TENANT REGISTRY            │              │
│  │  Routing · Isolation · Roles    │              │
│  └─────────────┬───────────────────┘              │
│                │                                  │
│  ┌─────────────┴───────────────────┐              │
│  │    CONVERSATION ENGINE          │              │
│  │  State Machine · NLU · Tools    │              │
│  └─────────────────────────────────┘              │
└──────────────────────────────────────────────────┘
```

---

## Archivos Modificados / Creados

### Nuevos
| Archivo | Descripción |
|---------|-------------|
| `tenant-registry.js` | Registro central de tenants, agents, users, roles, menus |
| `tenant-tests.js` | 76 tests de aislamiento multi-tenant |

### Modificados
| Archivo | Cambio |
|---------|--------|
| `mock-tools.js` | Todas las funciones reciben `ctx` con `tenant_id`; stores per-tenant; orderId con código de tenant |
| `tool-orchestrator.js` | Pasa tenant context de conversación a cada tool |
| `conversation-state.js` | `createConversationState()` acepta `tenantId` y `agentId` |
| `conversation-manager.js` | `createConversation()` acepta y propaga `tenantId`/`agentId` |
| `voice-session.js` | Constructor acepta tenant config |
| `index.html` | Botón "Tenant Tests" en UI |

### No modificados (compatibilidad preservada)
| Archivo | Razón |
|---------|-------|
| `mock-data.js` | Ya no es importado por mock-tools, pero existe como referencia |
| `tests.js` | 79 tests originales siguen pasando sin cambios |
| `e2e-scenarios.js` | Backward compatibility (default tenant) |

---

## Requisitos Implementados

### 1. Concepto de Tenant ✅
```javascript
{
  id: 'tenant_donmario',
  name: 'Pizzería Don Mario',
  status: 'ACTIVE',          // ACTIVE | INACTIVE | SUSPENDED
  config: { ... }            // Configuración completa del restaurante
}
```

### 2. Agents pertenecen a Tenants ✅
```javascript
{
  id: 'agent_ana',
  tenantId: 'tenant_donmario',
  name: 'Ana',
  voice: 'shimmer',
  status: 'ACTIVE'           // ACTIVE | INACTIVE | SUSPENDED | ERROR
}
```

### 3. Configuración separada del código ✅
Cada tenant define su configuración inline en `tenant-registry.js`:
- Nombre del restaurante, horarios, zonas de delivery
- Menú completo (productos, categorías, precios, ingredientes, modificadores)
- Promociones activas
- Clientes registrados

### 4. Aislamiento de datos ✅
`getTenantData(tenantId)` retorna SOLO los datos de ese tenant:
```javascript
{ config, products, categories, promotions, zones, customers }
```
Ninguna función puede acceder datos de otro tenant.

### 5. Catálogo por Tenant ✅
- **Tenant A (Don Mario):** 12 productos — pizzas, hamburguesas, acompañamientos, bebidas, combos
- **Tenant B (Wok & Roll):** 11 productos — woks, rolls, entradas, bebidas, combos
- Menús completamente diferentes, sin overlap de IDs ni nombres

### 6. Ruteo Teléfono → Tenant → Agent ✅
```javascript
resolvePhone('3209001001') → { tenantId: 'tenant_donmario', agentId: 'agent_ana' }
resolvePhone('3209002002') → { tenantId: 'tenant_wokroll', agentId: 'agent_carlos' }
```

### 7. Llamadas asociadas a Tenant/Agent ✅
`conversationState` incluye `tenantId` y `agentId`. Toda la sesión opera con esos valores.

### 8. Órdenes scoped a Tenant ✅
- Stores separados por tenant (`Map` por tenantId)
- Order IDs incluyen código de tenant: `P-DON-1848`, `P-WOK-1848`
- `create_order` estampa `tenant_id` en el objeto de la orden
- KDS broadcast incluye `tenant_id`

### 9. Usuarios y Roles ✅

| Rol | Permisos |
|-----|----------|
| `SEVEN_GROUP_ADMIN` | Acceso total a todos los tenants |
| `CLIENT_ADMIN` | Solo su tenant: agents, orders, config |
| `CLIENT_USER` | Solo su tenant: view orders |

```javascript
canAccess('usr_7g_admin', 'tenant_wokroll') → true   // Admin 7Group
canAccess('usr_dm_admin', 'tenant_wokroll') → false   // Admin Don Mario ≠ Wok
```

### 10. Estados de Agent ✅
```
ACTIVE → INACTIVE → ACTIVE
ACTIVE → SUSPENDED → ACTIVE
ACTIVE → ERROR → ACTIVE
```
`canAgentOperate(agentId)` retorna `true` solo si el agent Y su tenant están `ACTIVE`.

### 11. Sin hardcoded ✅
- Ningún nombre de restaurante, agent, menú o precio hardcodeado en el engine
- Todo proviene del tenant registry
- El engine es genérico; los datos son por tenant

### 12. Dos Tenants de Prueba ✅

| | Tenant A | Tenant B |
|---|----------|----------|
| Nombre | Pizzería Don Mario | Wok & Roll |
| Agent | Ana (shimmer) | Carlos (echo) |
| Teléfono | 3209001001 | 3209002002 |
| Productos | 12 (pizza, burger) | 11 (woks, rolls) |
| Promos | 2x1 Pizzas Martes | Jueves de Rolls |

### 13. Onboarding sin duplicar código ✅
```javascript
createTenant({
  id: 'tenant_nuevo',
  name: 'Nuevo Restaurante',
  status: 'ACTIVE',
  config: { ... },
  products: [ ... ],
  categories: [ ... ],
  promotions: [ ... ],
  zones: [ ... ],
  customers: []
});

createAgent({
  id: 'agent_nuevo',
  tenantId: 'tenant_nuevo',
  name: 'Nuevo Agent',
  voice: 'alloy',
  phone: '3209003003'
});
```
Cero código nuevo necesario. Solo datos.

---

## Tests de Aislamiento (76/76)

| Suite | Tests | Estado |
|-------|-------|--------|
| Tenant Registry | T1–T6 | ✅ |
| Data Isolation | T7–T17 | ✅ |
| Agents | T18–T27 | ✅ |
| Phone Routing | T28–T32 | ✅ |
| Users & Roles | T33–T39 | ✅ |
| Conversation Isolation | T40–T45 | ✅ |
| Order Isolation | T46–T49 | ✅ |
| Full Order Cycle | T50–T60 | ✅ |
| Cross-Tenant Rejection | T61–T62 | ✅ |
| Backward Compatibility | T63–T64 | ✅ |
| Menu Isolation | T65–T68 | ✅ |
| Promotions Isolation | T69–T70 | ✅ |

**Tests originales preservados: 79/79 ✅**

**Total: 155/155 tests pasan**

---

## Backward Compatibility

- `createConversation('rest_01', null)` (sin tenantId) → usa Tenant A como default
- Todos los 79 tests originales pasan sin cambios
- `mock-data.js` sigue existiendo como referencia pero ya no es importado por el engine

---

## NO incluido en FASE 9 (según spec)

- ❌ Billing / suscripciones / trial / checkout
- ❌ Nuevos canales (WhatsApp, web widget)
- ❌ Nuevas funcionalidades de agente
- ❌ Dashboard multi-tenant de administración
- ❌ Base de datos real (usa Maps in-memory)

---

## Cómo verificar

1. Abrir `engine/index.html` en un servidor local
2. Click **"Ejecutar Tests"** → 79/79 (engine original)
3. Click **"Tenant Tests"** → 76/76 (aislamiento multi-tenant)
4. Total: **155/155 tests pasando**
