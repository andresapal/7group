/**
 * BILLING — FASE 10
 *
 * Capa comercial de 7Group: planes, suscripciones, trial, consumo,
 * facturación, checkout y webhooks.
 *
 * Separada de la lógica del agente (Fases 1-9).
 * Preparada para integración con Stripe (o proveedor equivalente).
 *
 * Estructura:
 *   PLANS → CLIENTS → SUBSCRIPTIONS → USAGE → INVOICES → PAYMENTS
 */

// ══════════════════════════════════════════════════════════════════
// 1. PLANES
// ══════════════════════════════════════════════════════════════════

/**
 * Plan states
 */
export const PLAN_STATES = {
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',   // no new subscriptions, existing continue
  DISABLED: 'DISABLED'         // completely off
};

/**
 * Default plans — configurable, NOT hardcoded prices
 * Prices in COP (Colombian Pesos)
 */
const _plans = new Map();

function _initPlans() {
  _plans.clear();

  // ── Planes alineados con LEVEL_PLANS (modelo real por llamada) ──
  // Costo real: calls × $2,150 + $4,200 fijo/mes
  // Margen minimo 45% en todos los planes CO

  _plans.set('plan_starter', {
    id: 'plan_starter',
    name: 'Starter',
    description: 'Para negocios que empiezan con IA',
    priceMonthly: 169000,          // COP — margen 54% (34 calls)
    currency: 'COP',
    minutesIncluded: 120,
    callsIncluded: 34,
    agentsIncluded: 1,
    features: ['voice_agent', 'kds', 'menu_setup', 'basic_reports'],
    overagePerMinute: 1500,        // COP per extra minute
    trialDays: 15,
    setupFee: 0,
    status: PLAN_STATES.ACTIVE,
    sortOrder: 1
  });

  _plans.set('plan_profesional', {
    id: 'plan_profesional',
    name: 'Profesional',
    description: 'Para negocios con volumen medio',
    priceMonthly: 339000,          // COP — margen 54% (71 calls)
    currency: 'COP',
    minutesIncluded: 250,
    callsIncluded: 71,
    agentsIncluded: 2,
    features: ['voice_agent', 'kds', 'menu_setup', 'advanced_reports', 'priority_support', 'multi_agent'],
    overagePerMinute: 1200,
    trialDays: 15,
    setupFee: 0,
    status: PLAN_STATES.ACTIVE,
    sortOrder: 2
  });

  _plans.set('plan_empresarial', {
    id: 'plan_empresarial',
    name: 'Empresarial',
    description: 'Para negocios con alto volumen',
    priceMonthly: 599000,          // COP — margen 53% (129 calls)
    currency: 'COP',
    minutesIncluded: 450,
    callsIncluded: 129,
    agentsIncluded: 3,
    features: ['voice_agent', 'kds', 'menu_setup', 'advanced_reports', 'priority_support', 'multi_agent', 'api_access'],
    overagePerMinute: 1000,
    trialDays: 15,
    setupFee: 0,
    status: PLAN_STATES.ACTIVE,
    sortOrder: 3
  });

  _plans.set('plan_premium', {
    id: 'plan_premium',
    name: 'Premium',
    description: 'Para cadenas y operaciones grandes',
    priceMonthly: 1049000,         // COP — margen 53% (229 calls)
    currency: 'COP',
    minutesIncluded: 800,
    callsIncluded: 229,
    agentsIncluded: 5,
    features: ['voice_agent', 'kds', 'menu_setup', 'advanced_reports', 'priority_support', 'multi_agent', 'api_access', 'custom_voice', 'dedicated_number'],
    overagePerMinute: 800,
    trialDays: 30,
    setupFee: 0,
    status: PLAN_STATES.ACTIVE,
    sortOrder: 4
  });
}

_initPlans();

export function getPlan(planId) {
  return _plans.get(planId) || null;
}

export function listPlans(includeInactive = false) {
  const plans = [..._plans.values()];
  if (!includeInactive) return plans.filter(p => p.status === PLAN_STATES.ACTIVE).sort((a, b) => a.sortOrder - b.sortOrder);
  return plans.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function createPlan(planData) {
  if (!planData.id) throw new Error('Plan ID required');
  if (_plans.has(planData.id)) throw new Error(`Plan ${planData.id} already exists`);
  _plans.set(planData.id, { ...planData, status: planData.status || PLAN_STATES.ACTIVE });
  return _plans.get(planData.id);
}

export function updatePlan(planId, updates) {
  const plan = _plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  Object.assign(plan, updates);
  return plan;
}


// ══════════════════════════════════════════════════════════════════
// 2. CLIENTES BILLING
// ══════════════════════════════════════════════════════════════════

const _billingClients = new Map();

export function createBillingClient(data) {
  if (!data.id) data.id = 'bcli_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  if (!data.tenantId) throw new Error('tenantId required');

  const client = {
    id: data.id,
    tenantId: data.tenantId,
    businessName: data.businessName || '',
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    contactPhone: data.contactPhone || '',
    taxId: data.taxId || null,               // NIT in Colombia
    billingAddress: data.billingAddress || '',
    stripeCustomerId: data.stripeCustomerId || null,   // external billing ref
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  _billingClients.set(client.id, client);
  return client;
}

export function getBillingClient(clientId) {
  return _billingClients.get(clientId) || null;
}

export function getBillingClientByTenant(tenantId) {
  return [..._billingClients.values()].find(c => c.tenantId === tenantId) || null;
}

export function listBillingClients() {
  return [..._billingClients.values()];
}


// ══════════════════════════════════════════════════════════════════
// 3. SUSCRIPCIONES
// ══════════════════════════════════════════════════════════════════

export const SUB_STATES = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  SUSPENDED: 'SUSPENDED',
  CANCELLED: 'CANCELLED'
};

const VALID_SUB_TRANSITIONS = {
  [SUB_STATES.TRIAL]:     [SUB_STATES.ACTIVE, SUB_STATES.CANCELLED, SUB_STATES.SUSPENDED],
  [SUB_STATES.ACTIVE]:    [SUB_STATES.PAST_DUE, SUB_STATES.CANCELLED, SUB_STATES.SUSPENDED],
  [SUB_STATES.PAST_DUE]:  [SUB_STATES.ACTIVE, SUB_STATES.SUSPENDED, SUB_STATES.CANCELLED],
  [SUB_STATES.SUSPENDED]: [SUB_STATES.ACTIVE, SUB_STATES.CANCELLED],
  [SUB_STATES.CANCELLED]: []   // terminal
};

const _subscriptions = new Map();

export function createSubscription(data) {
  if (!data.clientId) throw new Error('clientId required');
  if (!data.planId) throw new Error('planId required');

  const plan = getPlan(data.planId);
  if (!plan) throw new Error(`Plan ${data.planId} not found`);

  const now = new Date();
  const id = data.id || 'sub_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

  const isTrial = data.startAsTrial !== false && plan.trialDays > 0;
  const trialEnd = isTrial ? new Date(now.getTime() + plan.trialDays * 86400000) : null;

  const sub = {
    id,
    clientId: data.clientId,
    planId: data.planId,
    status: isTrial ? SUB_STATES.TRIAL : SUB_STATES.ACTIVE,

    // Dates
    createdAt: now.toISOString(),
    startedAt: now.toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: _addMonths(now, 1).toISOString(),
    nextBillingDate: isTrial ? trialEnd.toISOString() : _addMonths(now, 1).toISOString(),

    // Trial
    trialStart: isTrial ? now.toISOString() : null,
    trialEnd: isTrial ? trialEnd.toISOString() : null,

    // External billing ref
    stripeSubscriptionId: data.stripeSubscriptionId || null,

    // Cancellation
    cancelledAt: null,
    cancelAtPeriodEnd: false,

    // Grace period for failed payments (configurable)
    gracePeriodDays: data.gracePeriodDays || 7,
    pastDueSince: null,

    updatedAt: now.toISOString()
  };

  _subscriptions.set(sub.id, sub);
  return sub;
}

export function getSubscription(subId) {
  return _subscriptions.get(subId) || null;
}

export function getSubscriptionByClient(clientId) {
  return [..._subscriptions.values()].find(s => s.clientId === clientId && s.status !== SUB_STATES.CANCELLED) || null;
}

export function listSubscriptions(filter = {}) {
  let subs = [..._subscriptions.values()];
  if (filter.status) subs = subs.filter(s => s.status === filter.status);
  if (filter.clientId) subs = subs.filter(s => s.clientId === filter.clientId);
  if (filter.planId) subs = subs.filter(s => s.planId === filter.planId);
  return subs;
}

export function transitionSubscription(subId, newStatus, metadata = {}) {
  const sub = _subscriptions.get(subId);
  if (!sub) throw new Error(`Subscription ${subId} not found`);

  const allowed = VALID_SUB_TRANSITIONS[sub.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid transition: ${sub.status} → ${newStatus}`);
  }

  const oldStatus = sub.status;
  sub.status = newStatus;
  sub.updatedAt = new Date().toISOString();

  // Handle specific transitions
  if (newStatus === SUB_STATES.CANCELLED) {
    sub.cancelledAt = new Date().toISOString();
  }
  if (newStatus === SUB_STATES.PAST_DUE) {
    sub.pastDueSince = sub.pastDueSince || new Date().toISOString();
  }
  if (newStatus === SUB_STATES.ACTIVE && oldStatus === SUB_STATES.PAST_DUE) {
    sub.pastDueSince = null;
  }

  // Merge any extra metadata
  if (metadata.stripeSubscriptionId) sub.stripeSubscriptionId = metadata.stripeSubscriptionId;
  if (metadata.nextBillingDate) sub.nextBillingDate = metadata.nextBillingDate;

  return sub;
}

/**
 * Check if trial is active, expired, or converted
 */
export function getTrialStatus(subId) {
  const sub = _subscriptions.get(subId);
  if (!sub) return null;
  if (!sub.trialStart) return { status: 'no_trial' };

  const now = new Date();
  const trialEnd = new Date(sub.trialEnd);

  if (sub.status === SUB_STATES.TRIAL && now < trialEnd) {
    const daysLeft = Math.ceil((trialEnd - now) / 86400000);
    return { status: 'active', daysLeft, trialEnd: sub.trialEnd };
  }
  if (sub.status === SUB_STATES.ACTIVE) {
    return { status: 'converted', convertedAt: sub.updatedAt };
  }
  if (sub.status === SUB_STATES.TRIAL && now >= trialEnd) {
    return { status: 'expired', expiredAt: sub.trialEnd };
  }
  return { status: sub.status === SUB_STATES.CANCELLED ? 'cancelled' : 'unknown' };
}

/**
 * Convert trial to active subscription (after payment)
 */
export function convertTrial(subId) {
  const sub = _subscriptions.get(subId);
  if (!sub) throw new Error(`Subscription ${subId} not found`);
  if (sub.status !== SUB_STATES.TRIAL) throw new Error('Not in trial');

  return transitionSubscription(subId, SUB_STATES.ACTIVE);
}

/**
 * Cancel subscription
 * @param {boolean} immediate - true = stop now, false = cancel at period end
 */
export function cancelSubscription(subId, immediate = false) {
  const sub = _subscriptions.get(subId);
  if (!sub) throw new Error(`Subscription ${subId} not found`);

  if (immediate) {
    return transitionSubscription(subId, SUB_STATES.CANCELLED);
  } else {
    sub.cancelAtPeriodEnd = true;
    sub.updatedAt = new Date().toISOString();
    return sub;
  }
}

/**
 * Change plan (upgrade/downgrade)
 */
export function changePlan(subId, newPlanId) {
  const sub = _subscriptions.get(subId);
  if (!sub) throw new Error(`Subscription ${subId} not found`);
  if (![SUB_STATES.ACTIVE, SUB_STATES.TRIAL].includes(sub.status)) {
    throw new Error(`Cannot change plan in status ${sub.status}`);
  }
  const newPlan = getPlan(newPlanId);
  if (!newPlan) throw new Error(`Plan ${newPlanId} not found`);

  const oldPlanId = sub.planId;
  sub.planId = newPlanId;
  sub.updatedAt = new Date().toISOString();

  return { subscription: sub, oldPlanId, newPlanId, changeType: newPlan.priceMonthly > getPlan(oldPlanId).priceMonthly ? 'upgrade' : 'downgrade' };
}

/**
 * Renew subscription for next period
 */
export function renewSubscription(subId) {
  const sub = _subscriptions.get(subId);
  if (!sub) throw new Error(`Subscription ${subId} not found`);

  if (sub.cancelAtPeriodEnd) {
    return transitionSubscription(subId, SUB_STATES.CANCELLED);
  }

  const now = new Date();
  sub.currentPeriodStart = now.toISOString();
  sub.currentPeriodEnd = _addMonths(now, 1).toISOString();
  sub.nextBillingDate = _addMonths(now, 1).toISOString();
  sub.updatedAt = now.toISOString();

  return sub;
}


// ══════════════════════════════════════════════════════════════════
// 4. CONSUMO / USAGE METERING
// ══════════════════════════════════════════════════════════════════

/**
 * Usage records: one entry per event
 * Aggregated by tenant + period for billing
 */
const _usageRecords = [];

export const USAGE_TYPES = {
  CALL: 'CALL',
  ORDER: 'ORDER'
};

/**
 * Record a usage event (called from the engine on each call/order)
 */
export function recordUsage(data) {
  if (!data.tenantId) throw new Error('tenantId required');
  if (!data.type) throw new Error('type required');

  const record = {
    id: 'usg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
    tenantId: data.tenantId,
    type: data.type,                          // CALL or ORDER
    durationSeconds: data.durationSeconds || 0,
    durationMinutes: data.durationSeconds ? Math.ceil(data.durationSeconds / 60) : 0,
    metadata: data.metadata || {},            // agentId, callId, orderId, etc.
    timestamp: new Date().toISOString()
  };

  _usageRecords.push(record);
  return record;
}

/**
 * Get usage summary for a tenant in a date range
 */
export function getUsageSummary(tenantId, periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  const records = _usageRecords.filter(r => {
    if (r.tenantId !== tenantId) return false;
    const t = new Date(r.timestamp);
    return t >= start && t <= end;
  });

  const calls = records.filter(r => r.type === USAGE_TYPES.CALL);
  const orders = records.filter(r => r.type === USAGE_TYPES.ORDER);

  const totalMinutes = calls.reduce((sum, r) => sum + r.durationMinutes, 0);
  const totalCalls = calls.length;
  const totalOrders = orders.length;

  return {
    tenantId,
    periodStart: periodStart,
    periodEnd: periodEnd,
    totalCalls,
    totalMinutes,
    totalOrders,
    records
  };
}

/**
 * Calculate overage for a subscription period
 */
export function calculateOverage(subscriptionId) {
  const sub = getSubscription(subscriptionId);
  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);

  const plan = getPlan(sub.planId);
  if (!plan) throw new Error(`Plan ${sub.planId} not found`);

  const client = getBillingClient(sub.clientId);
  if (!client) throw new Error(`Client ${sub.clientId} not found`);

  const usage = getUsageSummary(client.tenantId, sub.currentPeriodStart, sub.currentPeriodEnd);

  const minutesIncluded = plan.minutesIncluded;
  const minutesUsed = usage.totalMinutes;
  const minutesOver = Math.max(0, minutesUsed - minutesIncluded);
  const overageCost = minutesOver * plan.overagePerMinute;

  return {
    subscriptionId: sub.id,
    planId: plan.id,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    minutesIncluded,
    minutesUsed,
    minutesOver,
    overagePerMinute: plan.overagePerMinute,
    overageCost,
    currency: plan.currency,
    usage
  };
}


// ══════════════════════════════════════════════════════════════════
// 5. FACTURACIÓN / INVOICES
// ══════════════════════════════════════════════════════════════════

export const INVOICE_STATES = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  VOID: 'VOID'
};

const _invoices = new Map();
let _invoiceSeq = 7000;

export function generateInvoice(subscriptionId) {
  const sub = getSubscription(subscriptionId);
  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);

  const plan = getPlan(sub.planId);
  const client = getBillingClient(sub.clientId);
  const overage = calculateOverage(subscriptionId);

  const subtotal = plan.priceMonthly + overage.overageCost;
  const taxRate = 0.19;  // IVA Colombia 19%
  const taxes = Math.round(subtotal * taxRate);
  const total = subtotal + taxes;

  _invoiceSeq++;
  const invoiceNumber = 'INV-7G-' + _invoiceSeq;
  const id = 'inv_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

  const invoice = {
    id,
    invoiceNumber,
    subscriptionId: sub.id,
    clientId: sub.clientId,
    tenantId: client.tenantId,

    // Period
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,

    // Line items
    lineItems: [
      {
        description: `Plan ${plan.name} — mensualidad`,
        quantity: 1,
        unitPrice: plan.priceMonthly,
        amount: plan.priceMonthly
      }
    ],

    // Overage
    minutesIncluded: overage.minutesIncluded,
    minutesUsed: overage.minutesUsed,
    minutesOver: overage.minutesOver,

    // Totals
    subtotal,
    taxRate,
    taxes,
    discount: 0,
    total,
    currency: plan.currency,

    // Status
    status: INVOICE_STATES.DRAFT,
    stripeInvoiceId: null,

    // Dates
    issuedAt: new Date().toISOString(),
    dueAt: _addDays(new Date(), 5).toISOString(),
    paidAt: null,

    createdAt: new Date().toISOString()
  };

  // Add overage line item if applicable
  if (overage.minutesOver > 0) {
    invoice.lineItems.push({
      description: `Excedente: ${overage.minutesOver} min adicionales × $${plan.overagePerMinute.toLocaleString()}`,
      quantity: overage.minutesOver,
      unitPrice: plan.overagePerMinute,
      amount: overage.overageCost
    });
  }

  _invoices.set(invoice.id, invoice);
  return invoice;
}

export function getInvoice(invoiceId) {
  return _invoices.get(invoiceId) || null;
}

export function listInvoices(filter = {}) {
  let invs = [..._invoices.values()];
  if (filter.clientId) invs = invs.filter(i => i.clientId === filter.clientId);
  if (filter.subscriptionId) invs = invs.filter(i => i.subscriptionId === filter.subscriptionId);
  if (filter.status) invs = invs.filter(i => i.status === filter.status);
  return invs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function markInvoicePaid(invoiceId, paymentRef = null) {
  const inv = _invoices.get(invoiceId);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  inv.status = INVOICE_STATES.PAID;
  inv.paidAt = new Date().toISOString();
  if (paymentRef) inv.stripeInvoiceId = paymentRef;
  return inv;
}

export function markInvoiceFailed(invoiceId) {
  const inv = _invoices.get(invoiceId);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  inv.status = INVOICE_STATES.FAILED;
  return inv;
}


// ══════════════════════════════════════════════════════════════════
// 6. PAGOS / PAYMENTS
// ══════════════════════════════════════════════════════════════════

const _payments = new Map();

export const PAYMENT_STATES = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
};

export function recordPayment(data) {
  const id = data.id || 'pay_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

  const payment = {
    id,
    invoiceId: data.invoiceId,
    clientId: data.clientId,
    amount: data.amount,
    currency: data.currency || 'COP',
    status: data.status || PAYMENT_STATES.PENDING,
    method: data.method || 'card',               // card, pse, nequi, etc.
    stripePaymentIntentId: data.stripePaymentIntentId || null,
    cardLast4: data.cardLast4 || null,            // only last 4 digits, never full
    createdAt: new Date().toISOString()
  };

  _payments.set(payment.id, payment);
  return payment;
}

export function getPayment(paymentId) {
  return _payments.get(paymentId) || null;
}

export function listPayments(filter = {}) {
  let pays = [..._payments.values()];
  if (filter.clientId) pays = pays.filter(p => p.clientId === filter.clientId);
  if (filter.invoiceId) pays = pays.filter(p => p.invoiceId === filter.invoiceId);
  if (filter.status) pays = pays.filter(p => p.status === filter.status);
  return pays.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}


// ══════════════════════════════════════════════════════════════════
// 7. CHECKOUT (Stripe-ready)
// ══════════════════════════════════════════════════════════════════

/**
 * Initiate checkout for a plan
 * In production: creates Stripe Checkout Session
 * In demo: returns mock session
 */
export function initiateCheckout(data) {
  if (!data.clientId) throw new Error('clientId required');
  if (!data.planId) throw new Error('planId required');

  const client = getBillingClient(data.clientId);
  if (!client) throw new Error(`Client ${data.clientId} not found`);

  const plan = getPlan(data.planId);
  if (!plan) throw new Error(`Plan ${data.planId} not found`);

  // In production this would call Stripe:
  // const session = await stripe.checkout.sessions.create({ ... })

  const checkoutSession = {
    id: 'cs_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    clientId: data.clientId,
    planId: data.planId,
    amount: plan.setupFee > 0 ? plan.priceMonthly + plan.setupFee : plan.priceMonthly,
    setupFee: plan.setupFee,
    monthlyAmount: plan.priceMonthly,
    currency: plan.currency,
    status: 'pending',
    // In production: stripeCheckoutUrl would be the redirect URL
    stripeCheckoutUrl: null,
    createdAt: new Date().toISOString(),
    expiresAt: _addHours(new Date(), 1).toISOString()
  };

  return checkoutSession;
}

/**
 * Complete checkout (simulate payment success)
 * In production: this is triggered by Stripe webhook, NOT by frontend
 */
export function completeCheckout(checkoutSessionId, paymentData = {}) {
  // 1. Create or activate subscription
  // This would be called by webhook handler, not directly

  return {
    checkoutSessionId,
    status: 'completed',
    message: 'Payment confirmed via webhook — subscription activated'
  };
}


// ══════════════════════════════════════════════════════════════════
// 8. WEBHOOKS (Stripe-ready)
// ══════════════════════════════════════════════════════════════════

/**
 * Processed webhook IDs for idempotency
 */
const _processedWebhooks = new Set();

/**
 * Webhook event log
 */
const _webhookLog = [];

/**
 * Handle a billing webhook event
 * In production: validates Stripe signature, processes event
 *
 * @param {object} event - { id, type, data }
 * @returns {object} - { handled, action, error? }
 */
export function handleWebhookEvent(event) {
  if (!event || !event.id || !event.type) {
    _webhookLog.push({ ...event, result: 'rejected', reason: 'invalid_event', at: new Date().toISOString() });
    return { handled: false, action: 'rejected', error: 'Invalid webhook event' };
  }

  // Idempotency: reject duplicates
  if (_processedWebhooks.has(event.id)) {
    _webhookLog.push({ ...event, result: 'duplicate', at: new Date().toISOString() });
    return { handled: false, action: 'duplicate', error: 'Event already processed' };
  }

  _processedWebhooks.add(event.id);

  let result;

  try {
    switch (event.type) {
      case 'payment_success':
        result = _handlePaymentSuccess(event.data);
        break;
      case 'payment_failed':
        result = _handlePaymentFailed(event.data);
        break;
      case 'subscription_created':
        result = _handleSubscriptionCreated(event.data);
        break;
      case 'subscription_renewed':
        result = _handleSubscriptionRenewed(event.data);
        break;
      case 'subscription_cancelled':
        result = _handleSubscriptionCancelled(event.data);
        break;
      case 'subscription_updated':
        result = _handleSubscriptionUpdated(event.data);
        break;
      default:
        result = { handled: false, action: 'unknown_event' };
    }
  } catch (err) {
    result = { handled: false, action: 'error', error: err.message };
  }

  _webhookLog.push({ ...event, result: result.action, at: new Date().toISOString() });
  return result;
}

function _handlePaymentSuccess(data) {
  const { subscriptionId, invoiceId, paymentIntentId, amount, cardLast4 } = data;

  // Record payment
  const sub = getSubscription(subscriptionId);
  if (!sub) return { handled: false, action: 'sub_not_found' };

  const payment = recordPayment({
    invoiceId,
    clientId: sub.clientId,
    amount,
    status: PAYMENT_STATES.SUCCESS,
    stripePaymentIntentId: paymentIntentId,
    cardLast4
  });

  // Mark invoice paid
  if (invoiceId) {
    const inv = getInvoice(invoiceId);
    if (inv) markInvoicePaid(invoiceId, paymentIntentId);
  }

  // Activate subscription if trial or past_due
  if (sub.status === SUB_STATES.TRIAL) {
    transitionSubscription(subscriptionId, SUB_STATES.ACTIVE);
  } else if (sub.status === SUB_STATES.PAST_DUE) {
    transitionSubscription(subscriptionId, SUB_STATES.ACTIVE);
  }

  return { handled: true, action: 'payment_recorded', paymentId: payment.id };
}

function _handlePaymentFailed(data) {
  const { subscriptionId, invoiceId, reason } = data;

  const sub = getSubscription(subscriptionId);
  if (!sub) return { handled: false, action: 'sub_not_found' };

  // Mark invoice failed
  if (invoiceId) {
    const inv = getInvoice(invoiceId);
    if (inv) markInvoiceFailed(invoiceId);
  }

  // Move to PAST_DUE if active
  if (sub.status === SUB_STATES.ACTIVE) {
    transitionSubscription(subscriptionId, SUB_STATES.PAST_DUE);
  }

  // Check grace period
  if (sub.pastDueSince) {
    const pastDueDays = Math.floor((new Date() - new Date(sub.pastDueSince)) / 86400000);
    if (pastDueDays >= sub.gracePeriodDays) {
      transitionSubscription(subscriptionId, SUB_STATES.SUSPENDED);
      return { handled: true, action: 'suspended_grace_exceeded', pastDueDays };
    }
  }

  return { handled: true, action: 'marked_past_due', reason };
}

function _handleSubscriptionCreated(data) {
  return { handled: true, action: 'subscription_created_logged' };
}

function _handleSubscriptionRenewed(data) {
  const { subscriptionId } = data;
  const sub = getSubscription(subscriptionId);
  if (!sub) return { handled: false, action: 'sub_not_found' };

  renewSubscription(subscriptionId);
  return { handled: true, action: 'subscription_renewed' };
}

function _handleSubscriptionCancelled(data) {
  const { subscriptionId, immediate } = data;
  const sub = getSubscription(subscriptionId);
  if (!sub) return { handled: false, action: 'sub_not_found' };

  cancelSubscription(subscriptionId, immediate);
  return { handled: true, action: 'subscription_cancelled' };
}

function _handleSubscriptionUpdated(data) {
  return { handled: true, action: 'subscription_updated_logged' };
}

export function getWebhookLog() {
  return [..._webhookLog];
}


// ══════════════════════════════════════════════════════════════════
// 9. ESTADO DE SERVICIO
// ══════════════════════════════════════════════════════════════════

/**
 * Determines if a tenant's agent should be active based on billing status.
 * This bridges billing → agent state.
 *
 * Returns: { allowed, reason, warning? }
 */
export function getServiceStatus(tenantId) {
  const client = getBillingClientByTenant(tenantId);
  if (!client) {
    // No billing client = demo/internal tenant (always allowed)
    return { allowed: true, reason: 'no_billing_client' };
  }

  const sub = getSubscriptionByClient(client.id);
  if (!sub) {
    return { allowed: false, reason: 'no_subscription' };
  }

  switch (sub.status) {
    case SUB_STATES.TRIAL: {
      const trial = getTrialStatus(sub.id);
      if (trial.status === 'active') {
        return { allowed: true, reason: 'trial_active', warning: `Trial: ${trial.daysLeft} dias restantes` };
      }
      if (trial.status === 'expired') {
        return { allowed: false, reason: 'trial_expired' };
      }
      return { allowed: true, reason: 'trial' };
    }

    case SUB_STATES.ACTIVE:
      return { allowed: true, reason: 'active_subscription' };

    case SUB_STATES.PAST_DUE: {
      const daysPastDue = sub.pastDueSince
        ? Math.floor((new Date() - new Date(sub.pastDueSince)) / 86400000)
        : 0;
      // Allow with warning during grace period
      if (daysPastDue < sub.gracePeriodDays) {
        return { allowed: true, reason: 'past_due_grace', warning: `Pago pendiente hace ${daysPastDue} dias` };
      }
      return { allowed: false, reason: 'past_due_grace_exceeded' };
    }

    case SUB_STATES.SUSPENDED:
      return { allowed: false, reason: 'suspended' };

    case SUB_STATES.CANCELLED:
      return { allowed: false, reason: 'cancelled' };

    default:
      return { allowed: false, reason: 'unknown_status' };
  }
}


// ══════════════════════════════════════════════════════════════════
// 10. PANEL 7GROUP — ADMIN QUERIES
// ══════════════════════════════════════════════════════════════════

/**
 * Dashboard summary for 7Group admin
 */
export function getAdminDashboard() {
  const clients = listBillingClients();
  const subs = [..._subscriptions.values()];
  const invs = [..._invoices.values()];
  const pays = [..._payments.values()];

  const activeSubs = subs.filter(s => s.status === SUB_STATES.ACTIVE).length;
  const trialSubs = subs.filter(s => s.status === SUB_STATES.TRIAL).length;
  const pastDueSubs = subs.filter(s => s.status === SUB_STATES.PAST_DUE).length;
  const cancelledSubs = subs.filter(s => s.status === SUB_STATES.CANCELLED).length;

  const totalRevenue = pays
    .filter(p => p.status === PAYMENT_STATES.SUCCESS)
    .reduce((sum, p) => sum + p.amount, 0);

  const paidInvoices = invs.filter(i => i.status === INVOICE_STATES.PAID);
  const pendingInvoices = invs.filter(i => i.status === INVOICE_STATES.PENDING || i.status === INVOICE_STATES.DRAFT);
  const failedInvoices = invs.filter(i => i.status === INVOICE_STATES.FAILED);

  return {
    clients: {
      total: clients.length,
      list: clients
    },
    subscriptions: {
      total: subs.length,
      active: activeSubs,
      trial: trialSubs,
      pastDue: pastDueSubs,
      cancelled: cancelledSubs,
      list: subs
    },
    revenue: {
      total: totalRevenue,
      currency: 'COP',
      formatted: '$' + totalRevenue.toLocaleString('es-CO')
    },
    invoices: {
      total: invs.length,
      paid: paidInvoices.length,
      pending: pendingInvoices.length,
      failed: failedInvoices.length
    },
    payments: {
      total: pays.length,
      successful: pays.filter(p => p.status === PAYMENT_STATES.SUCCESS).length,
      failed: pays.filter(p => p.status === PAYMENT_STATES.FAILED).length
    }
  };
}

/**
 * Client detail view (for admin or client portal)
 */
export function getClientDetail(clientId, requestingRole = 'SEVEN_GROUP_ADMIN') {
  const client = getBillingClient(clientId);
  if (!client) return null;

  // Access control: clients only see their own
  // (In production, check JWT/session — here we check role)
  const sub = getSubscriptionByClient(clientId);
  const invoices = listInvoices({ clientId });
  const payments = listPayments({ clientId });

  let usage = null;
  if (sub) {
    usage = getUsageSummary(client.tenantId, sub.currentPeriodStart, sub.currentPeriodEnd);
  }

  const plan = sub ? getPlan(sub.planId) : null;
  const trial = sub ? getTrialStatus(sub.id) : null;
  const service = getServiceStatus(client.tenantId);

  return {
    client,
    plan,
    subscription: sub,
    trial,
    service,
    usage: usage ? {
      totalCalls: usage.totalCalls,
      totalMinutes: usage.totalMinutes,
      totalOrders: usage.totalOrders,
      minutesIncluded: plan ? plan.minutesIncluded : 0,
      minutesRemaining: plan ? Math.max(0, plan.minutesIncluded - usage.totalMinutes) : 0
    } : null,
    invoices,
    payments
  };
}


// ══════════════════════════════════════════════════════════════════
// 11. HELPERS
// ══════════════════════════════════════════════════════════════════

function _addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function _addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function _addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}


// ══════════════════════════════════════════════════════════════════
// 12. RESET (for tests)
// ══════════════════════════════════════════════════════════════════

export function _resetBilling() {
  _initPlans();
  _billingClients.clear();
  _subscriptions.clear();
  _invoices.clear();
  _payments.clear();
  _usageRecords.length = 0;
  _processedWebhooks.clear();
  _webhookLog.length = 0;
  _invoiceSeq = 7000;
}
