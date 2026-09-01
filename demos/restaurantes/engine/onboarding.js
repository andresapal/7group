/**
 * ONBOARDING — FASE 11
 *
 * Motor de autoservicio 7Group: registro → demo → configuración →
 * trial 15 días → evaluación de consumo → conversión.
 *
 * Integra con:
 *   - tenant-registry.js (FASE 9) → crear tenant/agente
 *   - billing.js (FASE 10) → suscripción, trial, consumo, planes
 *
 * Aplica a CUALQUIER vertical (restaurantes, logística, seguros...).
 * El flujo es universal; los datos del catálogo cambian por vertical.
 */

import {
  createTenant, createAgent, getTenant, getTenantData,
  listAgents, setAgentStatus, AGENT_STATES, ROLES,
  getUser, getUserByEmail
} from './tenant-registry.js';

import {
  createBillingClient, getBillingClientByTenant,
  createSubscription, getSubscriptionByClient, getTrialStatus,
  convertTrial, transitionSubscription, SUB_STATES,
  recordUsage, getUsageSummary, USAGE_TYPES,
  listPlans, getPlan, getServiceStatus,
  changePlan
} from './billing.js';

// ══════════════════════════════════════════════════════════════════
// 1. REGISTRO DE LEADS
// ══════════════════════════════════════════════════════════════════

const _leads = new Map();
const _onboardingSessions = new Map();

/**
 * Lead states
 */
export const LEAD_STATES = {
  REGISTERED: 'REGISTERED',     // Llenó formulario
  DEMO_DONE: 'DEMO_DONE',       // Probó demo gratis
  CONFIGURING: 'CONFIGURING',   // Configurando su agente
  TRIAL: 'TRIAL',               // Trial 15 días activo
  CONVERTED: 'CONVERTED',       // Pagó un plan
  CHURNED: 'CHURNED'            // No convirtió
};

/**
 * Register a new lead
 */
export function registerLead(data) {
  if (!data.businessName) return { error: 'Nombre del negocio requerido' };
  if (!data.contactName) return { error: 'Nombre del responsable requerido' };
  if (!data.email) return { error: 'Correo requerido' };
  if (!data.phone) return { error: 'Telefono requerido' };
  if (!data.businessType) return { error: 'Tipo de negocio requerido' };

  // Check duplicate email
  for (const [, lead] of _leads) {
    if (lead.email === data.email) return { error: 'Este correo ya esta registrado' };
  }

  const id = 'lead_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

  const lead = {
    id,
    businessName: data.businessName,
    contactName: data.contactName,
    email: data.email,
    phone: data.phone,
    country: data.country || 'CO',
    city: data.city || null,
    businessType: data.businessType,     // pizza, hamburguesas, sushi, etc.
    status: LEAD_STATES.REGISTERED,
    source: data.source || 'website',    // website, referral, ads
    registeredAt: new Date().toISOString(),
    demoCompletedAt: null,
    trialStartedAt: null,
    convertedAt: null,

    // Will be set during onboarding
    tenantId: null,
    agentId: null,
    billingClientId: null,
    subscriptionId: null
  };

  _leads.set(id, lead);
  return { success: true, leadId: id, lead };
}

export function getLead(leadId) {
  return _leads.get(leadId) || null;
}

export function getLeadByEmail(email) {
  return [..._leads.values()].find(l => l.email === email) || null;
}

export function listLeads(filter = {}) {
  let leads = [..._leads.values()];
  if (filter.status) leads = leads.filter(l => l.status === filter.status);
  if (filter.businessType) leads = leads.filter(l => l.businessType === filter.businessType);
  return leads;
}

/**
 * Mark demo as completed
 */
export function markDemoCompleted(leadId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };

  lead.status = LEAD_STATES.DEMO_DONE;
  lead.demoCompletedAt = new Date().toISOString();
  return { success: true, lead };
}

// ══════════════════════════════════════════════════════════════════
// 2. ONBOARDING SESSION (wizard de configuración)
// ══════════════════════════════════════════════════════════════════

/**
 * Onboarding steps
 */
export const ONBOARDING_STEPS = {
  REGISTER: { order: 1, label: 'Registro', required: true },
  DEMO: { order: 2, label: 'Demo gratis', required: true },
  BUSINESS: { order: 3, label: 'Tu negocio', required: true },
  AGENT: { order: 4, label: 'Tu agente', required: true },
  CATALOG: { order: 5, label: 'Tu catalogo', required: true },
  OPERATIONS: { order: 6, label: 'Operacion', required: true },
  TEST: { order: 7, label: 'Prueba', required: true },
  PLAN: { order: 8, label: 'Elige plan', required: true },
  ACTIVATE: { order: 9, label: 'Activar', required: true }
};

/**
 * Start onboarding session for a lead
 */
export function startOnboarding(leadId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };

  const sessionId = 'onb_' + Date.now().toString(36);

  const session = {
    id: sessionId,
    leadId,
    currentStep: 'REGISTER',
    completedSteps: ['REGISTER'],    // registro ya hecho
    stepData: {},
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // If demo was done, mark it
  if (lead.status === LEAD_STATES.DEMO_DONE || lead.demoCompletedAt) {
    session.completedSteps.push('DEMO');
    session.currentStep = 'BUSINESS';
  }

  _onboardingSessions.set(sessionId, session);
  return { success: true, sessionId, session };
}

export function getOnboardingSession(sessionId) {
  return _onboardingSessions.get(sessionId) || null;
}

/**
 * Complete a step with its data
 */
export function completeStep(sessionId, stepName, data = {}) {
  const session = _onboardingSessions.get(sessionId);
  if (!session) return { error: 'Sesion no encontrada' };

  const step = ONBOARDING_STEPS[stepName];
  if (!step) return { error: 'Paso invalido: ' + stepName };

  // Store step data
  session.stepData[stepName] = data;

  // Add to completed if not already
  if (!session.completedSteps.includes(stepName)) {
    session.completedSteps.push(stepName);
  }

  // Advance to next step
  const stepKeys = Object.keys(ONBOARDING_STEPS);
  const currentIdx = stepKeys.indexOf(stepName);
  if (currentIdx < stepKeys.length - 1) {
    session.currentStep = stepKeys[currentIdx + 1];
  }

  session.updatedAt = new Date().toISOString();
  return { success: true, session };
}

/**
 * Get onboarding progress
 */
export function getOnboardingProgress(sessionId) {
  const session = _onboardingSessions.get(sessionId);
  if (!session) return null;

  const totalSteps = Object.keys(ONBOARDING_STEPS).length;
  const completed = session.completedSteps.length;

  return {
    sessionId,
    currentStep: session.currentStep,
    completedSteps: session.completedSteps,
    totalSteps,
    completed,
    percent: Math.round((completed / totalSteps) * 100),
    stepDetails: Object.entries(ONBOARDING_STEPS).map(([key, step]) => ({
      key,
      ...step,
      completed: session.completedSteps.includes(key),
      current: session.currentStep === key,
      data: session.stepData[key] || null
    }))
  };
}


// ══════════════════════════════════════════════════════════════════
// 3. PROVISIONING — crear tenant + agente + billing
// ══════════════════════════════════════════════════════════════════

/**
 * Provision tenant from onboarding data
 * Creates: tenant, agent, billing client, trial subscription
 */
export function provisionTenant(sessionId) {
  const session = _onboardingSessions.get(sessionId);
  if (!session) return { error: 'Sesion no encontrada' };

  const lead = _leads.get(session.leadId);
  if (!lead) return { error: 'Lead no encontrado' };

  // Validate minimum required steps
  const required = ['REGISTER', 'DEMO', 'BUSINESS', 'AGENT', 'CATALOG'];
  const missing = required.filter(s => !session.completedSteps.includes(s));
  if (missing.length > 0) {
    return { error: 'Pasos incompletos: ' + missing.join(', ') };
  }

  const bizData = session.stepData.BUSINESS || {};
  const agentData = session.stepData.AGENT || {};
  const catalogData = session.stepData.CATALOG || {};
  const opsData = session.stepData.OPERATIONS || {};

  // 1. Create tenant
  const tenantId = 'tenant_' + lead.businessName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const tenantResult = createTenant({
    id: tenantId,
    name: lead.businessName,
    contact_email: lead.email,
    contact_phone: lead.phone,
    config: {
      businessType: lead.businessType,
      address: bizData.address || '',
      city: bizData.city || lead.city || '',
      country: lead.country,
      schedule: opsData.schedule || { open: '10:00', close: '22:00' },
      delivery: {
        enabled: opsData.deliveryEnabled !== false,
        zones: opsData.zones || [],
        minOrder: opsData.minOrder || 0,
        fee: opsData.deliveryFee || 0
      },
      branding: {
        primaryColor: bizData.primaryColor || '#FF5722',
        logo: bizData.logo || null,
        tagline: bizData.tagline || ''
      }
    },
    products: catalogData.products || [],
    categories: catalogData.categories || [],
    promotions: catalogData.promotions || [],
    zones: opsData.zones || []
  });

  if (tenantResult.error) return tenantResult;

  // 2. Create agent
  const agentId = 'agent_' + tenantId;
  const agentResult = createAgent({
    id: agentId,
    tenant_id: tenantId,
    name: agentData.name || 'Agente',
    voice: agentData.voice || 'shimmer',
    phone: null,    // assigned later
    config: {
      personality: agentData.personality || 'profesional',
      greeting: agentData.greeting || `Hola, soy ${agentData.name || 'el agente'} de ${lead.businessName}. ¿En que te puedo ayudar?`,
      language: agentData.language || 'es',
      schedule: opsData.schedule || { open: '10:00', close: '22:00' }
    }
  });

  if (agentResult.error) return agentResult;

  // 3. Create billing client
  const billingClient = createBillingClient({
    tenantId,
    name: lead.businessName,
    email: lead.email,
    phone: lead.phone,
    taxId: bizData.nit || null,
    address: bizData.address || null
  });

  // 4. Create trial subscription (15 days, plan_starter default)
  const subscription = createSubscription({
    clientId: billingClient.id,
    planId: 'plan_starter',
    startAsTrial: true
  });

  // 5. Update lead
  lead.tenantId = tenantId;
  lead.agentId = agentId;
  lead.billingClientId = billingClient.id;
  lead.subscriptionId = subscription.id;
  lead.status = LEAD_STATES.TRIAL;
  lead.trialStartedAt = new Date().toISOString();

  // 6. Update session
  lead.status = LEAD_STATES.CONFIGURING;

  return {
    success: true,
    tenantId,
    agentId,
    billingClientId: billingClient.id,
    subscriptionId: subscription.id,
    trialEnds: subscription.trialEnd
  };
}


// ══════════════════════════════════════════════════════════════════
// 4. TRIAL — evaluación de consumo y gamificación
// ══════════════════════════════════════════════════════════════════

/**
 * 7Group cost model — internal costs per service
 * These are NEVER shown to the client
 */
const COST_MODEL = {
  aiPerMinute: 350,           // COP — costo IA por minuto (OpenAI/Anthropic)
  telephonyPerMinute: 180,    // COP — Twilio/proveedor SIP
  infraPerMinute: 70,         // COP — servidores, bandwidth
  totalPerMinute: 600,        // COP — costo total 7group por minuto
  marginTarget: 0.45,         // 45% margen MINIMO directo a 7group
  marginIdeal: 1.0,           // 100% — objetivo ideal de margen
  setupCostInternal: 150000   // COP — costo interno de onboarding
};

// ──────────────────────────────────────────────────────
// Plans by market — Colombia vs USA
// Costo 7Group por minuto es el mismo ($600 COP / ~$0.15 USD)
// En USA el pricing se multiplica x4-6 porque el mercado lo soporta
// RESULTADO: margen en USA es 70-85% vs Colombia 48-52%
// ──────────────────────────────────────────────────────

const LEVEL_PLANS = {
  CO: [
    // Colombia — COP — margen 48-52% (minimo viable)
    { level: 'Novato',      plan: 'Starter',     price: 149000,  currency: 'COP', mins: 120,  cost7g: 72000,   marginPct: 52 },
    { level: 'Emprendedor', plan: 'Profesional',  price: 289000,  currency: 'COP', mins: 250,  cost7g: 150000,  marginPct: 48 },
    { level: 'Profesional', plan: 'Empresarial',  price: 549000,  currency: 'COP', mins: 450,  cost7g: 270000,  marginPct: 51 },
    { level: 'Experto',     plan: 'Premium',      price: 989000,  currency: 'COP', mins: 800,  cost7g: 480000,  marginPct: 51 }
  ],
  US: [
    // USA — USD — margen 70-85% (mercado premium)
    // Costo: 120 min × $0.15 = $18 USD → precio $49 → margen 63%
    { level: 'Novato',      plan: 'Starter',     price: 49,    currency: 'USD', mins: 120,  cost7g: 18,   marginPct: 63 },
    { level: 'Emprendedor', plan: 'Professional', price: 99,    currency: 'USD', mins: 250,  cost7g: 37.5, marginPct: 62 },
    { level: 'Profesional', plan: 'Business',     price: 199,   currency: 'USD', mins: 450,  cost7g: 67.5, marginPct: 66 },
    { level: 'Experto',     plan: 'Enterprise',   price: 399,   currency: 'USD', mins: 800,  cost7g: 120,  marginPct: 70 }
  ]
};
// COMPARACION DE MERCADOS:
// ┌─────────────┬──────────────┬───────────────┬────────────┬────────────┐
// │ Nivel       │ CO precio    │ US precio     │ CO margen  │ US margen  │
// ├─────────────┼──────────────┼───────────────┼────────────┼────────────┤
// │ Starter     │ $149K COP    │ $49 USD       │ 52%        │ 63%        │
// │ Profesional │ $289K COP    │ $99 USD       │ 48%        │ 62%        │
// │ Empresarial │ $549K COP    │ $199 USD      │ 51%        │ 66%        │
// │ Premium     │ $989K COP    │ $399 USD      │ 51%        │ 70%        │
// └─────────────┴──────────────┴───────────────┴────────────┴────────────┘
// El costo real de 7Group es el MISMO en ambos mercados (~$600 COP/min)
// pero USA paga 4-6x mas → margen ideal se acerca al 100% con volumen
// Estrategia: Colombia valida producto, USA escala ganancia

/**
 * Get trial dashboard for a lead
 * Shows: ROI, KPIs, gamification, consumption, days left
 */
export function getTrialDashboard(leadId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };
  if (!lead.subscriptionId) return { error: 'Sin suscripcion' };

  const trial = getTrialStatus(lead.subscriptionId);
  const sub = getSubscriptionByClient(lead.billingClientId);
  if (!sub) return { error: 'Suscripcion no encontrada' };

  const plan = getPlan(sub.planId);

  // Get usage for trial period
  const usage = getUsageSummary(lead.tenantId, sub.trialStart || sub.currentPeriodStart, new Date().toISOString());

  // ROI calculations
  const avgOrderValue = usage.totalOrders > 0 ? 35000 : 0;   // COP promedio por pedido
  const totalRevenue = usage.totalOrders * avgOrderValue;
  const manualCostPerCall = 3500;   // COP — costo de atender manual (tiempo empleado)
  const manuallySaved = usage.totalCalls * manualCostPerCall;
  const conversionRate = usage.totalCalls > 0 ? Math.round((usage.totalOrders / usage.totalCalls) * 100) : 0;

  // Gamification — achievements
  const achievements = _calculateAchievements(usage, lead);

  // Trial progress
  const trialStart = new Date(sub.trialStart || sub.createdAt);
  const trialEnd = new Date(sub.trialEnd || sub.currentPeriodEnd);
  const now = new Date();
  const totalDays = Math.ceil((trialEnd - trialStart) / 86400000);
  const daysUsed = Math.ceil((now - trialStart) / 86400000);
  const daysLeft = Math.max(0, totalDays - daysUsed);

  // Menu tips
  const menuTips = _generateMenuTips(lead.tenantId, usage);

  return {
    lead: {
      id: lead.id,
      businessName: lead.businessName,
      businessType: lead.businessType,
      agentName: _getAgentName(lead.agentId)
    },

    trial: {
      status: trial ? trial.status : 'unknown',
      daysLeft,
      daysUsed,
      totalDays,
      trialEnd: sub.trialEnd,
      percentUsed: Math.round((daysUsed / totalDays) * 100)
    },

    kpis: {
      totalCalls: usage.totalCalls,
      totalOrders: usage.totalOrders,
      totalMinutes: usage.totalMinutes,
      conversionRate,
      totalRevenue,
      avgOrderValue,
      manuallySaved,
      roi: manuallySaved > 0 ? Math.round((manuallySaved / (plan.priceMonthly || 350000)) * 100) : 0
    },

    achievements,
    menuTips,

    plan: {
      id: plan.id,
      name: plan.name,
      price: plan.priceMonthly,
      minutesIncluded: plan.minutesIncluded,
      minutesUsed: usage.totalMinutes,
      minutesPercent: Math.round((usage.totalMinutes / plan.minutesIncluded) * 100)
    },

    suggestedPlan: _suggestPlan(usage, totalDays, daysUsed)
  };
}

/**
 * Gamification achievements
 */
function _calculateAchievements(usage, lead) {
  const list = [];

  // Calls milestones
  if (usage.totalCalls >= 1)   list.push({ id: 'first_call', icon: 'phone', label: 'Primera llamada', done: true, points: 100 });
  if (usage.totalCalls >= 10)  list.push({ id: 'calls_10', icon: 'star', label: '10 llamadas', done: true, points: 200 });
  if (usage.totalCalls >= 25)  list.push({ id: 'calls_25', icon: 'trophy', label: '25 llamadas', done: true, points: 400 });
  if (usage.totalCalls >= 50)  list.push({ id: 'calls_50', icon: 'medal', label: '50 llamadas', done: true, points: 800 });

  // Orders milestones
  if (usage.totalOrders >= 1)  list.push({ id: 'first_order', icon: 'bag', label: 'Primer pedido', done: true, points: 150 });
  if (usage.totalOrders >= 10) list.push({ id: 'orders_10', icon: 'fire', label: '10 pedidos', done: true, points: 300 });
  if (usage.totalOrders >= 25) list.push({ id: 'orders_25', icon: 'rocket', label: '25 pedidos', done: true, points: 600 });

  // Revenue milestones
  const rev = usage.totalOrders * 35000;
  if (rev >= 500000)   list.push({ id: 'rev_500k', icon: 'coin', label: '$500K en ventas', done: true, points: 500 });
  if (rev >= 1000000)  list.push({ id: 'rev_1m', icon: 'diamond', label: '$1M en ventas', done: true, points: 1000 });
  if (rev >= 3000000)  list.push({ id: 'rev_3m', icon: 'crown', label: '$3M en ventas', done: true, points: 2000 });

  // Pending achievements (not yet earned)
  const earnedIds = list.map(a => a.id);
  const pending = [
    { id: 'first_call', icon: 'phone', label: 'Primera llamada', done: false, points: 100 },
    { id: 'calls_10', icon: 'star', label: '10 llamadas', done: false, points: 200 },
    { id: 'calls_25', icon: 'trophy', label: '25 llamadas', done: false, points: 400 },
    { id: 'first_order', icon: 'bag', label: 'Primer pedido', done: false, points: 150 },
    { id: 'orders_10', icon: 'fire', label: '10 pedidos', done: false, points: 300 },
    { id: 'rev_500k', icon: 'coin', label: '$500K en ventas', done: false, points: 500 },
    { id: 'rev_1m', icon: 'diamond', label: '$1M en ventas', done: false, points: 1000 }
  ].filter(a => !earnedIds.includes(a.id));

  const totalPoints = list.reduce((sum, a) => sum + a.points, 0);
  const maxPoints = 6050;   // all achievements

  // Levels tied to plans — higher level = higher plan = more revenue for 7Group
  // Novato(0) → Starter $149K | Emprendedor(500) → Profesional $289K
  // Profesional(1500) → Empresarial $489K | Experto(3500) → Premium $789K
  const level = totalPoints < 500 ? 'Novato' : totalPoints < 1500 ? 'Emprendedor' : totalPoints < 3500 ? 'Profesional' : 'Experto';

  return { earned: list, pending, totalPoints, maxPoints, level };
}

/**
 * Menu improvement tips
 */
function _generateMenuTips(tenantId, usage) {
  const tips = [];
  const data = getTenantData(tenantId);
  if (!data) return tips;

  const products = data.products || [];
  const categories = data.categories || [];
  const promotions = data.promotions || [];

  // Tip: few products
  if (products.length < 5) {
    tips.push({
      id: 'add_products',
      priority: 'high',
      message: `Tu catalogo tiene solo ${products.length} productos. Agrega al menos 8 para que tu agente tenga mas opciones que ofrecer.`
    });
  }

  // Tip: no promotions
  if (promotions.length === 0) {
    tips.push({
      id: 'add_promos',
      priority: 'medium',
      message: 'No tienes promociones activas. Crea un combo o descuento para aumentar el ticket promedio.'
    });
  }

  // Tip: no categories
  if (categories.length < 2 && products.length > 5) {
    tips.push({
      id: 'add_categories',
      priority: 'low',
      message: 'Organiza tus productos en categorias para que el agente pueda guiar mejor al cliente.'
    });
  }

  // Tip: low conversion
  if (usage.totalCalls > 10 && usage.totalOrders < usage.totalCalls * 0.5) {
    tips.push({
      id: 'low_conversion',
      priority: 'high',
      message: 'Tu tasa de conversion esta por debajo del 50%. Revisa que los precios sean claros y que el agente tenga toda la informacion del menu.'
    });
  }

  // Tip: suggest accounting connection
  tips.push({
    id: 'connect_accounting',
    priority: 'low',
    message: 'Conecta tu software contable para que los pedidos se registren automaticamente en tu facturacion.'
  });

  return tips;
}

function _getAgentName(agentId) {
  if (!agentId) return 'Sin agente';
  try {
    const agents = listAgents();
    // fallback
  } catch(e) {}
  return agentId;
}


// ══════════════════════════════════════════════════════════════════
// 5. PLAN SUGGESTION — based on trial consumption
// ══════════════════════════════════════════════════════════════════

/**
 * Suggest optimal plan based on trial usage
 * Projects 15-day usage to 30 days
 */
function _suggestPlan(usage, totalTrialDays, daysUsed) {
  if (daysUsed < 1) daysUsed = 1;

  // Project to 30 days
  const dailyMinutes = usage.totalMinutes / daysUsed;
  const projectedMonthlyMinutes = Math.round(dailyMinutes * 30);
  const dailyCalls = usage.totalCalls / daysUsed;
  const projectedMonthlyCalls = Math.round(dailyCalls * 30);
  const dailyOrders = usage.totalOrders / daysUsed;
  const projectedMonthlyOrders = Math.round(dailyOrders * 30);

  // Find best plan
  const plans = listPlans();
  let suggested = plans[0];

  for (const plan of plans) {
    if (projectedMonthlyMinutes <= plan.minutesIncluded * 1.1) {
      suggested = plan;
      break;
    }
    suggested = plan;   // default to largest
  }

  return {
    planId: suggested.id,
    planName: suggested.name,
    planPrice: suggested.priceMonthly,
    projectedMinutes: projectedMonthlyMinutes,
    projectedCalls: projectedMonthlyCalls,
    projectedOrders: projectedMonthlyOrders,
    projectedRevenue: projectedMonthlyOrders * 35000,
    minutesFit: projectedMonthlyMinutes <= suggested.minutesIncluded,
    reason: projectedMonthlyMinutes <= suggested.minutesIncluded
      ? `Con tu ritmo actual, ${suggested.name} cubre tus ${projectedMonthlyMinutes} minutos proyectados.`
      : `Tu consumo proyectado (${projectedMonthlyMinutes} min) supera lo incluido. Considera el plan superior.`
  };
}


// ══════════════════════════════════════════════════════════════════
// 6. COST MODEL — 7Group internal (NEVER shown to client)
// ══════════════════════════════════════════════════════════════════

/**
 * Calculate 7Group's internal cost for a trial/client
 * This is the admin view — what the trial is costing 7Group
 */
export function get7GroupCostAnalysis(leadId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };

  const sub = lead.subscriptionId ? getSubscriptionByClient(lead.billingClientId) : null;
  if (!sub) return { error: 'Sin suscripcion' };

  const plan = getPlan(sub.planId);
  const usage = getUsageSummary(lead.tenantId, sub.trialStart || sub.currentPeriodStart, new Date().toISOString());

  // Costs
  const totalMinutes = usage.totalMinutes || 0;
  const aiCost = totalMinutes * COST_MODEL.aiPerMinute;
  const telephonyCost = totalMinutes * COST_MODEL.telephonyPerMinute;
  const infraCost = totalMinutes * COST_MODEL.infraPerMinute;
  const totalCost = totalMinutes * COST_MODEL.totalPerMinute;
  const setupCost = COST_MODEL.setupCostInternal;
  const totalInvestment = totalCost + setupCost;

  // Revenue if client converts
  const monthlyRevenue = plan.priceMonthly;
  const monthlyCost = (totalMinutes > 0 ? totalMinutes : plan.minutesIncluded * 0.6) * COST_MODEL.totalPerMinute;
  const monthlyMargin = monthlyRevenue - monthlyCost;
  const marginPercent = monthlyRevenue > 0 ? Math.round((monthlyMargin / monthlyRevenue) * 100) : 0;

  // Projection: if lead converts
  const trialStart = new Date(sub.trialStart || sub.createdAt);
  const now = new Date();
  const daysUsed = Math.max(1, Math.ceil((now - trialStart) / 86400000));
  const dailyCost = totalCost / daysUsed;
  const projected30DayCost = Math.round(dailyCost * 30);

  // Payback
  const paybackMonths = totalInvestment > 0 ? Math.ceil(totalInvestment / Math.max(1, monthlyMargin)) : 0;

  // Meets margin targets?
  const meetsMinMargin = marginPercent >= COST_MODEL.marginTarget * 100;
  const meetsIdealMargin = marginPercent >= COST_MODEL.marginIdeal * 100;

  // Suggested prices for both targets
  const suggestedMinPrice = Math.round(projected30DayCost / (1 - COST_MODEL.marginTarget));     // 45% min
  const suggestedIdealPrice = Math.round(projected30DayCost * (1 + COST_MODEL.marginIdeal));    // 100% ideal

  return {
    lead: { id: lead.id, businessName: lead.businessName },
    consumption: {
      totalMinutes,
      totalCalls: usage.totalCalls,
      totalOrders: usage.totalOrders,
      daysUsed
    },
    costs: {
      ai: aiCost,
      telephony: telephonyCost,
      infra: infraCost,
      totalOperating: totalCost,
      setup: setupCost,
      totalInvestment
    },
    projection: {
      dailyCost: Math.round(dailyCost),
      monthly30Day: projected30DayCost,
      currentPlan: plan.name,
      currentPlanPrice: plan.priceMonthly,
      monthlyMargin,
      marginPercent,
      meetsMinMargin,          // >= 45%
      meetsIdealMargin,        // >= 100%
      suggestedMinPrice,       // precio para 45% margen
      suggestedIdealPrice,     // precio para 100% margen (objetivo)
      paybackMonths
    },
    recommendation: meetsIdealMargin
      ? `Margen ${marginPercent}% supera objetivo ideal (100%). Plan ${plan.name} altamente rentable.`
      : meetsMinMargin
        ? `Margen ${marginPercent}% cumple minimo (45%+) pero debajo del ideal (100%). Plan ${plan.name} viable, buscar upsell.`
        : `Margen ${marginPercent}% bajo minimo (45%). Precio minimo: $${suggestedMinPrice.toLocaleString('es-CO')} COP. Ideal: $${suggestedIdealPrice.toLocaleString('es-CO')} COP.`
  };
}


// ══════════════════════════════════════════════════════════════════
// 7. PAYMENT ALERTS — 5 days, 3 days, same day
// ══════════════════════════════════════════════════════════════════

/**
 * Alert types and schedule
 */
export const ALERT_TYPES = {
  TRIAL_ENDING_5: 'TRIAL_ENDING_5',     // 5 días antes del fin del trial
  TRIAL_ENDING_3: 'TRIAL_ENDING_3',     // 3 días antes
  TRIAL_ENDING_1: 'TRIAL_ENDING_1',     // Último día
  TRIAL_ENDED: 'TRIAL_ENDED',           // Trial terminó
  PAYMENT_DUE_5: 'PAYMENT_DUE_5',       // 5 días antes del cobro mensual
  PAYMENT_DUE_3: 'PAYMENT_DUE_3',       // 3 días antes
  PAYMENT_DUE_0: 'PAYMENT_DUE_0',       // Día del cobro
  PAYMENT_FAILED: 'PAYMENT_FAILED',     // Cobro falló
  SUSPENDED: 'SUSPENDED'                // Cuenta suspendida
};

const _alerts = [];

/**
 * Check all leads/subscriptions and generate pending alerts
 */
export function checkAlerts() {
  const now = new Date();
  const pending = [];

  for (const [, lead] of _leads) {
    if (!lead.subscriptionId) continue;

    const sub = getSubscriptionByClient(lead.billingClientId);
    if (!sub) continue;

    // Trial alerts
    if (sub.status === SUB_STATES.TRIAL && sub.trialEnd) {
      const trialEnd = new Date(sub.trialEnd);
      const daysLeft = Math.ceil((trialEnd - now) / 86400000);

      if (daysLeft === 5) pending.push(_createAlert(lead, ALERT_TYPES.TRIAL_ENDING_5, { daysLeft: 5 }));
      if (daysLeft === 3) pending.push(_createAlert(lead, ALERT_TYPES.TRIAL_ENDING_3, { daysLeft: 3 }));
      if (daysLeft === 1) pending.push(_createAlert(lead, ALERT_TYPES.TRIAL_ENDING_1, { daysLeft: 1 }));
      if (daysLeft <= 0)  pending.push(_createAlert(lead, ALERT_TYPES.TRIAL_ENDED, { daysLeft: 0 }));
    }

    // Payment alerts
    if (sub.status === SUB_STATES.ACTIVE && sub.nextBillingDate) {
      const billingDate = new Date(sub.nextBillingDate);
      const daysUntil = Math.ceil((billingDate - now) / 86400000);

      if (daysUntil === 5) pending.push(_createAlert(lead, ALERT_TYPES.PAYMENT_DUE_5, { daysUntil: 5 }));
      if (daysUntil === 3) pending.push(_createAlert(lead, ALERT_TYPES.PAYMENT_DUE_3, { daysUntil: 3 }));
      if (daysUntil === 0) pending.push(_createAlert(lead, ALERT_TYPES.PAYMENT_DUE_0, { daysUntil: 0 }));
    }

    // Past due / suspended alerts
    if (sub.status === SUB_STATES.PAST_DUE) {
      pending.push(_createAlert(lead, ALERT_TYPES.PAYMENT_FAILED, {}));
    }
    if (sub.status === SUB_STATES.SUSPENDED) {
      pending.push(_createAlert(lead, ALERT_TYPES.SUSPENDED, {}));
    }
  }

  // Store alerts
  pending.forEach(a => _alerts.push(a));

  return pending;
}

function _createAlert(lead, type, data) {
  return {
    id: 'alert_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 3),
    leadId: lead.id,
    businessName: lead.businessName,
    email: lead.email,
    phone: lead.phone,
    type,
    data,
    createdAt: new Date().toISOString(),
    sent: false,
    channel: null   // email, sms, whatsapp — to be configured
  };
}

export function getAlerts(filter = {}) {
  let alerts = [..._alerts];
  if (filter.leadId) alerts = alerts.filter(a => a.leadId === filter.leadId);
  if (filter.type) alerts = alerts.filter(a => a.type === filter.type);
  if (filter.sent !== undefined) alerts = alerts.filter(a => a.sent === filter.sent);
  return alerts;
}

export function markAlertSent(alertId, channel) {
  const alert = _alerts.find(a => a.id === alertId);
  if (!alert) return { error: 'Alerta no encontrada' };
  alert.sent = true;
  alert.channel = channel;
  return { success: true };
}


// ══════════════════════════════════════════════════════════════════
// 8. ACTIVATION CHECKLIST
// ══════════════════════════════════════════════════════════════════

/**
 * Validate if agent can be activated
 */
export function getActivationChecklist(leadId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };

  const checks = [];
  let allPassed = true;

  // 1. Tenant exists
  const tenant = lead.tenantId ? getTenant(lead.tenantId) : null;
  checks.push({
    id: 'tenant',
    label: 'Negocio configurado',
    passed: !!tenant,
    detail: tenant ? tenant.name : 'No creado'
  });
  if (!tenant) allPassed = false;

  // 2. Agent exists
  const agents = lead.tenantId ? listAgents(lead.tenantId) : [];
  const hasAgent = agents.length > 0;
  checks.push({
    id: 'agent',
    label: 'Agente configurado',
    passed: hasAgent,
    detail: hasAgent ? agents[0].name : 'Sin agente'
  });
  if (!hasAgent) allPassed = false;

  // 3. Catalog
  const data = lead.tenantId ? getTenantData(lead.tenantId) : null;
  const hasProducts = data && data.products && data.products.length >= 3;
  checks.push({
    id: 'catalog',
    label: 'Catalogo cargado (min. 3 productos)',
    passed: !!hasProducts,
    detail: data && data.products ? `${data.products.length} productos` : '0 productos'
  });
  if (!hasProducts) allPassed = false;

  // 4. Prices configured
  const hasPrices = data && data.products && data.products.every(p => p.price > 0);
  checks.push({
    id: 'prices',
    label: 'Precios configurados',
    passed: !!hasPrices,
    detail: hasPrices ? 'Todos con precio' : 'Productos sin precio'
  });
  if (!hasPrices) allPassed = false;

  // 5. Schedule
  const config = data ? data.config : null;
  const hasSchedule = config && config.schedule && config.schedule.open && config.schedule.close;
  checks.push({
    id: 'schedule',
    label: 'Horarios configurados',
    passed: !!hasSchedule,
    detail: hasSchedule ? `${config.schedule.open} - ${config.schedule.close}` : 'Sin horario'
  });
  if (!hasSchedule) allPassed = false;

  // 6. Delivery zones (optional for dine-in only)
  const hasZones = data && data.zones && data.zones.length > 0;
  checks.push({
    id: 'delivery',
    label: 'Domicilios configurados',
    passed: hasZones || (config && config.delivery && !config.delivery.enabled),
    detail: hasZones ? `${data.zones.length} zonas` : (config && config.delivery && !config.delivery.enabled ? 'Solo en local' : 'Sin zonas'),
    required: false
  });

  // 7. Subscription active
  const sub = lead.billingClientId ? getSubscriptionByClient(lead.billingClientId) : null;
  const subActive = sub && (sub.status === SUB_STATES.TRIAL || sub.status === SUB_STATES.ACTIVE);
  checks.push({
    id: 'subscription',
    label: 'Suscripcion activa',
    passed: !!subActive,
    detail: sub ? `${sub.status} — Plan ${getPlan(sub.planId)?.name || sub.planId}` : 'Sin suscripcion'
  });
  if (!subActive) allPassed = false;

  // 8. Test completed
  const session = [..._onboardingSessions.values()].find(s => s.leadId === leadId);
  const testDone = session && session.completedSteps.includes('TEST');
  checks.push({
    id: 'test',
    label: 'Prueba completada',
    passed: !!testDone,
    detail: testDone ? 'Agente probado' : 'No se ha probado el agente'
  });
  if (!testDone) allPassed = false;

  // 9. Phone assigned
  const hasPhone = agents.length > 0 && agents[0].phone;
  checks.push({
    id: 'phone',
    label: 'Numero telefonico',
    passed: !!hasPhone,
    detail: hasPhone ? agents[0].phone : 'Sin numero asignado'
  });
  if (!hasPhone) allPassed = false;

  return {
    leadId,
    businessName: lead.businessName,
    checks,
    allPassed,
    passedCount: checks.filter(c => c.passed).length,
    totalCount: checks.length,
    canActivate: allPassed
  };
}


// ══════════════════════════════════════════════════════════════════
// 9. ACTIVATION / DEACTIVATION
// ══════════════════════════════════════════════════════════════════

/**
 * Activate agent after all checks pass
 */
export function activateAgent(leadId) {
  const checklist = getActivationChecklist(leadId);
  if (checklist.error) return checklist;

  if (!checklist.canActivate) {
    const failed = checklist.checks.filter(c => !c.passed).map(c => c.label);
    return {
      error: 'No se puede activar. Falta: ' + failed.join(', ')
    };
  }

  const lead = _leads.get(leadId);
  const agents = listAgents(lead.tenantId);

  // Set agent to ACTIVE
  setAgentStatus(agents[0].id, AGENT_STATES.ACTIVE);

  lead.status = LEAD_STATES.TRIAL;   // stays trial until payment

  return {
    success: true,
    agentId: agents[0].id,
    status: AGENT_STATES.ACTIVE,
    message: `Agente ${agents[0].name} activado para ${lead.businessName}`
  };
}

/**
 * Pause agent (temporary deactivation)
 */
export function pauseAgent(leadId) {
  const lead = _leads.get(leadId);
  if (!lead || !lead.tenantId) return { error: 'Lead no encontrado' };

  const agents = listAgents(lead.tenantId);
  if (agents.length === 0) return { error: 'Sin agente' };

  setAgentStatus(agents[0].id, AGENT_STATES.INACTIVE);

  return {
    success: true,
    agentId: agents[0].id,
    status: AGENT_STATES.INACTIVE,
    message: `Agente pausado. La configuracion se mantiene.`
  };
}

/**
 * Resume agent after pause
 */
export function resumeAgent(leadId) {
  const lead = _leads.get(leadId);
  if (!lead || !lead.tenantId) return { error: 'Lead no encontrado' };

  // Check billing is still valid
  const serviceStatus = getServiceStatus(lead.tenantId);
  if (!serviceStatus.allowed) {
    return { error: 'No se puede reactivar: ' + serviceStatus.reason };
  }

  const agents = listAgents(lead.tenantId);
  if (agents.length === 0) return { error: 'Sin agente' };

  setAgentStatus(agents[0].id, AGENT_STATES.ACTIVE);

  return {
    success: true,
    agentId: agents[0].id,
    status: AGENT_STATES.ACTIVE,
    message: `Agente reactivado.`
  };
}


// ══════════════════════════════════════════════════════════════════
// 10. TRIAL EVALUATION — determine conversion
// ══════════════════════════════════════════════════════════════════

/**
 * Minimum consumption thresholds to consider trial "active"
 */
const TRIAL_THRESHOLDS = {
  minCalls: 5,        // mínimo 5 llamadas en 15 días
  minOrders: 3,       // mínimo 3 pedidos
  minMinutes: 10      // mínimo 10 minutos
};

/**
 * Evaluate trial consumption and determine next action
 */
export function evaluateTrial(leadId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };
  if (!lead.subscriptionId) return { error: 'Sin suscripcion' };

  const sub = getSubscriptionByClient(lead.billingClientId);
  if (!sub) return { error: 'Suscripcion no encontrada' };

  const trial = getTrialStatus(lead.subscriptionId);
  const usage = getUsageSummary(lead.tenantId, sub.trialStart || sub.currentPeriodStart, new Date().toISOString());

  const meetsThreshold = {
    calls: usage.totalCalls >= TRIAL_THRESHOLDS.minCalls,
    orders: usage.totalOrders >= TRIAL_THRESHOLDS.minOrders,
    minutes: usage.totalMinutes >= TRIAL_THRESHOLDS.minMinutes
  };

  const overallMet = meetsThreshold.calls && meetsThreshold.orders && meetsThreshold.minutes;

  // Suggest action
  let action, message;
  if (overallMet) {
    action = 'CONVERT';
    message = `Tu agente atendio ${usage.totalCalls} llamadas y genero ${usage.totalOrders} pedidos. Elige un plan para seguir operando.`;
  } else if (usage.totalCalls > 0) {
    action = 'EXTEND';
    message = `Tu agente tiene actividad pero no alcanza el minimo. Te damos 5 dias mas para que lo pruebes.`;
  } else {
    action = 'CHURN';
    message = `Tu trial termino sin actividad. Contactanos si necesitas ayuda configurando tu agente.`;
  }

  const suggested = _suggestPlan(usage, 15, Math.max(1, Math.ceil((new Date() - new Date(sub.trialStart || sub.createdAt)) / 86400000)));

  return {
    leadId,
    businessName: lead.businessName,
    trialStatus: trial ? trial.status : 'unknown',
    usage: {
      calls: usage.totalCalls,
      orders: usage.totalOrders,
      minutes: usage.totalMinutes
    },
    thresholds: TRIAL_THRESHOLDS,
    meetsThreshold,
    overallMet,
    action,
    message,
    suggestedPlan: suggested
  };
}

/**
 * Convert trial to paid after plan selection
 */
export function convertTrialToPaid(leadId, planId) {
  const lead = _leads.get(leadId);
  if (!lead) return { error: 'Lead no encontrado' };

  const sub = getSubscriptionByClient(lead.billingClientId);
  if (!sub) return { error: 'Suscripcion no encontrada' };

  // Change plan if different
  if (planId && planId !== sub.planId) {
    changePlan(sub.id, planId);
  }

  // Convert trial to active
  const converted = convertTrial(sub.id);

  lead.status = LEAD_STATES.CONVERTED;
  lead.convertedAt = new Date().toISOString();

  return {
    success: true,
    subscription: converted,
    plan: getPlan(planId || sub.planId),
    message: `Bienvenido a ${getPlan(planId || sub.planId).name}. Tu agente sigue activo.`
  };
}


// ══════════════════════════════════════════════════════════════════
// 11. ADMIN VIEW — 7Group control panel
// ══════════════════════════════════════════════════════════════════

/**
 * Get admin overview of all leads and onboarding status
 */
export function getAdminOnboardingView() {
  const leads = [..._leads.values()];

  const stats = {
    totalLeads: leads.length,
    registered: leads.filter(l => l.status === LEAD_STATES.REGISTERED).length,
    demosDone: leads.filter(l => l.status === LEAD_STATES.DEMO_DONE).length,
    configuring: leads.filter(l => l.status === LEAD_STATES.CONFIGURING).length,
    inTrial: leads.filter(l => l.status === LEAD_STATES.TRIAL).length,
    converted: leads.filter(l => l.status === LEAD_STATES.CONVERTED).length,
    churned: leads.filter(l => l.status === LEAD_STATES.CHURNED).length
  };

  // Conversion funnel
  const funnel = {
    registerToDemo: stats.totalLeads > 0 ? Math.round(((stats.demosDone + stats.configuring + stats.inTrial + stats.converted) / stats.totalLeads) * 100) : 0,
    demoToTrial: (stats.demosDone + stats.configuring + stats.inTrial + stats.converted) > 0
      ? Math.round(((stats.inTrial + stats.converted) / (stats.demosDone + stats.configuring + stats.inTrial + stats.converted)) * 100) : 0,
    trialToConverted: (stats.inTrial + stats.converted) > 0 ? Math.round((stats.converted / (stats.inTrial + stats.converted)) * 100) : 0
  };

  // Cost totals
  let totalTrialCost = 0;
  let totalProjectedRevenue = 0;
  for (const lead of leads) {
    if (lead.tenantId) {
      const cost = get7GroupCostAnalysis(lead.id);
      if (!cost.error) {
        totalTrialCost += cost.costs.totalInvestment;
        totalProjectedRevenue += cost.projection.currentPlanPrice;
      }
    }
  }

  return {
    stats,
    funnel,
    financials: {
      totalTrialCost,
      totalProjectedRevenue,
      projectedMargin: totalProjectedRevenue > 0 ? Math.round(((totalProjectedRevenue - totalTrialCost) / totalProjectedRevenue) * 100) : 0
    },
    leads: leads.map(l => ({
      id: l.id,
      businessName: l.businessName,
      contactName: l.contactName,
      email: l.email,
      status: l.status,
      businessType: l.businessType,
      registeredAt: l.registeredAt,
      tenantId: l.tenantId,
      agentId: l.agentId
    })),
    alerts: getAlerts({ sent: false })
  };
}


// ══════════════════════════════════════════════════════════════════
// 12. RESET (for testing)
// ══════════════════════════════════════════════════════════════════

export function _resetOnboarding() {
  _leads.clear();
  _onboardingSessions.clear();
  _alerts.length = 0;
}
