# FASE 10 — SUBSCRIPTION, TRIAL & BILLING

## Resumen

Capa comercial completa para 7Group VoiceOrder: planes configurables, suscripciones con trial, medicion de consumo por tenant, facturacion con IVA, checkout/webhooks preparados para Stripe, y panel de administracion.

**Separada de la logica del agente** (Fases 1-9 no tocadas).

---

## Estructura de Costos y Margenes

### Costos API por minuto de llamada

| Componente | Costo/min USD | Costo/min COP |
|-----------|--------------|---------------|
| OpenAI Realtime | $0.060 | $252 |
| Deepgram STT | $0.004 | $17 |
| Twilio | $0.020 | $84 |
| **Total** | **$0.084** | **$353** |

### Planes y Margenes

| Plan | Precio/mes | Min incluidos | Costo API | Overhead | **Margen** | **%** |
|------|-----------|---------------|-----------|----------|------------|-------|
| Starter | $350,000 | 500 | $176,500 | $30,000 | **$143,500** | **41%** |
| Pro | $590,000 | 1,000 | $353,000 | $30,000 | **$207,000** | **35%** |
| Business | $950,000 | 2,000 | $706,000 | $30,000 | **$214,000** | **23%** |

### Excedentes (margen alto)

| Excedente | Precio/min | Costo/min | Margen/min | % |
|-----------|-----------|-----------|------------|---|
| Starter | $1,500 | $353 | $1,147 | 76% |
| Pro | $1,200 | $353 | $847 | 71% |
| Business | $1,000 | $353 | $647 | 65% |

### Setup Fee: $450,000 (Starter/Pro) | $0 (Business)

---

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│               7GROUP BILLING                      │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │  PLANS (configurables)                    │    │
│  │  Starter · Pro · Business · Custom        │    │
│  └────────────────┬─────────────────────────┘    │
│                   │                               │
│  ┌────────────────┴─────────────────────────┐    │
│  │  SUBSCRIPTIONS                            │    │
│  │  TRIAL → ACTIVE → PAST_DUE → SUSPENDED   │    │
│  │                              → CANCELLED   │    │
│  └────────────────┬─────────────────────────┘    │
│                   │                               │
│  ┌────────────────┴─────────────────────────┐    │
│  │  USAGE METERING (per tenant)              │    │
│  │  Calls · Minutes · Orders                 │    │
│  └────────────────┬─────────────────────────┘    │
│                   │                               │
│  ┌────────────────┴─────────────────────────┐    │
│  │  INVOICES + PAYMENTS                      │    │
│  │  Plan + Excedentes + IVA 19%              │    │
│  └────────────────┬─────────────────────────┘    │
│                   │                               │
│  ┌────────────────┴─────────────────────────┐    │
│  │  CHECKOUT + WEBHOOKS (Stripe-ready)       │    │
│  │  Idempotent event processing              │    │
│  └────────────────┬─────────────────────────┘    │
│                   │                               │
│  ┌────────────────┴─────────────────────────┐    │
│  │  SERVICE STATE                            │    │
│  │  Billing → controla si Agent opera        │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │  ADMIN PANEL (billing-admin.html)         │    │
│  │  KPIs · Clientes · Consumo · Facturas    │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## Archivos Creados

| Archivo | Descripcion |
|---------|-------------|
| `billing.js` | Modulo central: plans, subs, usage, invoices, payments, checkout, webhooks, service state, admin queries |
| `billing-tests.js` | 22 tests (B1–B22) cubriendo los 14+ escenarios del spec |
| `billing-admin.html` | Panel de administracion 7Group con KPIs, tabla de clientes, detalle modal, consumo visual |
| `7GROUP_BILLING.md` | Este documento de entrega |

### Modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | Boton "Billing Tests" + import de billing-tests.js |

### No modificados (per spec)

| Archivo | Razon |
|---------|-------|
| `conversation-manager.js` | No toca cerebro del agente |
| `mock-tools.js` | No modifica tools del restaurante |
| `tool-orchestrator.js` | No modifica orquestacion |
| `tenant-registry.js` | No modifica tenants |
| `voice-session.js` | No modifica telefonia |

---

## Requisitos Implementados

### 1. Planes configurables ✅
```javascript
{
  id: 'plan_starter',
  name: 'Starter',
  priceMonthly: 350000,      // COP
  minutesIncluded: 500,
  agentsIncluded: 1,
  overagePerMinute: 1500,
  trialDays: 15,
  setupFee: 450000,
  features: ['voice_agent', 'kds', 'menu_setup', 'basic_reports']
}
```
Funciones: `listPlans()`, `getPlan()`, `createPlan()`, `updatePlan()`

### 2. Suscripciones con maquina de estados ✅
```
TRIAL → ACTIVE → PAST_DUE → SUSPENDED
                → CANCELLED
```
Transiciones invalidas rechazadas con error.
Funcion `transitionSubscription()` valida la transicion.

### 3. Trial configurable ✅
- `trialDays` por plan (15 para Starter/Pro, 30 para Business)
- `getTrialStatus()` retorna dias restantes
- `convertTrial()` pasa de TRIAL a ACTIVE
- Plan con `trialDays: 0` inicia directo en ACTIVE

### 4. Billing preparado para Stripe ✅
- `stripeCustomerId` en billing client
- `stripeSubscriptionId` en subscription
- `stripePaymentIntentId` en payment
- `stripeInvoiceId` en invoice
- Solo se almacenan los ultimos 4 digitos de tarjeta (`cardLast4`)

### 5. Checkout ✅
```javascript
initiateCheckout({ clientId, planId })
// → { id: 'cs_...', amount, setupFee, monthlyAmount, ... }
```
En produccion: crearia Stripe Checkout Session con redirect URL.

### 6. Webhooks con idempotencia ✅
```javascript
handleWebhookEvent({
  id: 'evt_unique_id',     // Idempotency key
  type: 'payment_success',
  data: { subscriptionId, invoiceId, amount, cardLast4 }
})
```
Tipos soportados:
- `payment_success` → activa sub, registra pago, marca factura
- `payment_failed` → marca PAST_DUE, verifica gracia
- `subscription_created/renewed/cancelled/updated`

**Duplicados rechazados**: mismo event.id → `{ handled: false, action: 'duplicate' }`

### 7. Estado de servicio ✅
```javascript
getServiceStatus('tenant_donmario')
// → { allowed: true/false, reason, warning? }
```
El billing controla si el agente opera:
- TRIAL activo → allowed + warning de dias
- ACTIVE → allowed
- PAST_DUE en gracia → allowed + warning
- PAST_DUE fuera de gracia → blocked
- SUSPENDED/CANCELLED → blocked
- Sin billing client (demo) → always allowed

### 8. Medicion de consumo (Usage Metering) ✅
```javascript
recordUsage({ tenantId, type: 'CALL', durationSeconds: 180 })
recordUsage({ tenantId, type: 'ORDER', metadata: { orderId: 'P-DON-001' } })

getUsageSummary(tenantId, periodStart, periodEnd)
// → { totalCalls, totalMinutes, totalOrders }
```
Integra con el tenant system existente de Fase 9.

### 9. Excedentes ✅
```javascript
calculateOverage(subscriptionId)
// → { minutesIncluded, minutesUsed, minutesOver, overageCost }
```

### 10. Facturacion ✅
```javascript
generateInvoice(subscriptionId)
// → { invoiceNumber: 'INV-7G-7001', lineItems, subtotal, taxes(19%), total }
```
Line items: plan mensualidad + excedente (si aplica).
IVA Colombia 19% automatico.

### 11. Historial ✅
```javascript
listInvoices({ clientId })
listPayments({ clientId })
getWebhookLog()
```

### 12. Panel Admin 7Group ✅
`billing-admin.html` con:
- KPIs: ingreso total, clientes, past due, facturas
- Tabla de clientes con plan, estado, consumo visual (barra), servicio on/off
- Modal de detalle: contacto, consumo, facturas, trial, estado servicio
- Tabla de planes configurados

### 13. Control de acceso ✅
- `getClientDetail()` acepta `requestingRole`
- SEVEN_GROUP_ADMIN ve todo
- Clientes ven solo su data (preparado para portal futuro)

### 14. Cambio de plan ✅
```javascript
changePlan(subId, 'plan_pro')
// → { changeType: 'upgrade'|'downgrade', oldPlanId, newPlanId }
```

### 15. Cancelacion ✅
```javascript
cancelSubscription(subId, false) // → cancela al final del periodo
cancelSubscription(subId, true)  // → cancela inmediato
```

### 16. Fallo de pago ✅
- ACTIVE → PAST_DUE (primer fallo)
- Grace period configurable (`gracePeriodDays`, default 7)
- Pasada la gracia → SUSPENDED

### 17. Seguridad ✅
- No almacena datos completos de tarjeta
- Solo `cardLast4` y referencia a Stripe (`stripePaymentIntentId`)
- Pago confirmado por webhook, nunca por frontend

---

## Tests (22/22)

| Test | Descripcion | Estado |
|------|-------------|--------|
| B1 | Planes configurables — lista, crea, modifica | ✅ |
| B2 | State machine — TRIAL→ACTIVE→PAST_DUE→SUSPENDED→CANCELLED | ✅ |
| B3 | Transiciones invalidas rechazadas | ✅ |
| B4 | Trial configurable por plan | ✅ |
| B5 | Checkout session con montos correctos | ✅ |
| B6 | Webhook payment_success → activa sub + pago | ✅ |
| B7 | Webhook payment_failed → PAST_DUE | ✅ |
| B8 | Webhooks idempotentes | ✅ |
| B9 | Usage metering por tenant | ✅ |
| B10 | Excedentes calculados | ✅ |
| B11 | Factura con plan + excedente + IVA | ✅ |
| B12 | Service state — billing controla agente | ✅ |
| B13 | Cambio de plan — upgrade/downgrade | ✅ |
| B14 | Cancelacion inmediata vs fin de periodo | ✅ |
| B15 | Admin dashboard consolidado | ✅ |
| B16 | Client detail completo | ✅ |
| B17 | Seguridad — no almacena datos de tarjeta | ✅ |
| B18 | Webhook invalido rechazado | ✅ |
| B19 | Renewal reset de periodo | ✅ |
| B20 | Lookup billing client por tenant | ✅ |
| B21 | Convert trial solo desde TRIAL | ✅ |
| B22 | Factura sin excedente | ✅ |

---

## NO incluido en FASE 10 (segun spec)

- ❌ Cerebro del agente (intacto)
- ❌ Catalogo de productos (intacto)
- ❌ Tools del restaurante (intacto)
- ❌ Telefonia (intacta)
- ❌ Onboarding completo (Fase 11)
- ❌ Registro publico (Fase 12)
- ❌ Integracion real con Stripe (estructura lista, falta keys + deploy)

---

## Como verificar

1. Abrir `engine/index.html` en servidor local
2. Click **"Ejecutar Tests"** → 79/79 (engine original)
3. Click **"Tenant Tests"** → 76/76 (Fase 9)
4. Click **"Billing Tests"** → 22/22 (Fase 10)
5. **Total: 177/177 tests pasando**

### Panel Admin
1. Abrir `engine/billing-admin.html`
2. Click **"Cargar Demo Data"**
3. Ver KPIs, tabla de clientes, barras de consumo
4. Click **"Ver"** en cualquier cliente para el detalle completo

---

## Siguiente: FASE 11 — Onboarding Automation
