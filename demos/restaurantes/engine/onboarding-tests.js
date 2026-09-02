/**
 * ONBOARDING TESTS — FASE 11
 *
 * Tests de aceptación para el flujo de autoservicio.
 */

import { _resetRegistry, getTenant, getTenantData, listAgents, getAgent, AGENT_STATES } from './tenant-registry.js';
import { _resetBilling, getSubscriptionByClient, getTrialStatus, SUB_STATES, listPlans, recordUsage, USAGE_TYPES } from './billing.js';
import {
  registerLead, getLead, getLeadByEmail, listLeads, markDemoCompleted,
  startOnboarding, getOnboardingSession, completeStep, getOnboardingProgress,
  provisionTenant,
  getTrialDashboard, get7GroupCostAnalysis,
  checkAlerts, getAlerts, ALERT_TYPES,
  getActivationChecklist, activateAgent, pauseAgent, resumeAgent,
  evaluateTrial, convertTrialToPaid,
  getAdminOnboardingView,
  LEAD_STATES, ONBOARDING_STEPS,
  _resetOnboarding
} from './onboarding.js';


function assert(condition, msg) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + msg);
}

function resetAll() {
  _resetRegistry();
  _resetBilling();
  _resetOnboarding();
}

// ── Helper: create a fully registered lead with demo done ────────

function setupLead() {
  const result = registerLead({
    businessName: 'Pizzeria El Horno',
    contactName: 'Carlos Gomez',
    email: 'carlos@elhorno.co',
    phone: '3101234567',
    businessType: 'pizza',
    country: 'CO',
    city: 'Bogota'
  });
  return result;
}

function setupLeadWithDemo() {
  const reg = setupLead();
  markDemoCompleted(reg.leadId);
  return reg;
}

function setupLeadWithOnboarding() {
  const reg = setupLeadWithDemo();
  const onb = startOnboarding(reg.leadId);

  // Complete all config steps
  completeStep(onb.sessionId, 'BUSINESS', {
    address: 'Cra 15 #80-20',
    city: 'Bogota',
    nit: '900123456-1',
    primaryColor: '#D32F2F'
  });

  completeStep(onb.sessionId, 'AGENT', {
    name: 'Valentina',
    voice: 'shimmer',
    personality: 'amigable',
    greeting: 'Hola, soy Valentina de Pizzeria El Horno.',
    language: 'es'
  });

  completeStep(onb.sessionId, 'CATALOG', {
    products: [
      { id: 'p1', name: 'Pizza Margarita', price: 28000, category: 'pizzas' },
      { id: 'p2', name: 'Pizza Pepperoni', price: 32000, category: 'pizzas' },
      { id: 'p3', name: 'Pizza Hawaiana', price: 30000, category: 'pizzas' },
      { id: 'p4', name: 'Gaseosa 400ml', price: 4000, category: 'bebidas' },
      { id: 'p5', name: 'Jugo Natural', price: 6000, category: 'bebidas' }
    ],
    categories: [
      { id: 'pizzas', name: 'Pizzas' },
      { id: 'bebidas', name: 'Bebidas' }
    ]
  });

  completeStep(onb.sessionId, 'OPERATIONS', {
    schedule: { open: '11:00', close: '23:00' },
    deliveryEnabled: true,
    zones: [{ name: 'Chapinero', fee: 5000, time: 30 }],
    minOrder: 20000,
    deliveryFee: 5000
  });

  return { ...reg, sessionId: onb.sessionId };
}


// ══════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════

const tests = [];

function test(id, name, fn) {
  tests.push({ id, name, fn });
}


// ── OB1: Registro de lead ────────────────────────────────────────

test('OB1', 'Registro de lead con datos completos', () => {
  resetAll();
  const r = registerLead({
    businessName: 'Burger House',
    contactName: 'Ana Lopez',
    email: 'ana@burgerhouse.co',
    phone: '3209876543',
    businessType: 'hamburguesas',
    country: 'CO'
  });
  assert(r.success, 'Debe registrar exitosamente');
  assert(r.leadId, 'Debe tener leadId');

  const lead = getLead(r.leadId);
  assert(lead.businessName === 'Burger House', 'Nombre correcto');
  assert(lead.status === LEAD_STATES.REGISTERED, 'Estado REGISTERED');
});


// ── OB2: Registro duplicado ──────────────────────────────────────

test('OB2', 'No permite email duplicado', () => {
  resetAll();
  registerLead({ businessName: 'A', contactName: 'B', email: 'x@y.co', phone: '1', businessType: 'pizza' });
  const r2 = registerLead({ businessName: 'C', contactName: 'D', email: 'x@y.co', phone: '2', businessType: 'sushi' });
  assert(r2.error, 'Debe rechazar duplicado');
});


// ── OB3: Campos requeridos ───────────────────────────────────────

test('OB3', 'Valida campos requeridos', () => {
  resetAll();
  assert(registerLead({}).error, 'Sin datos debe fallar');
  assert(registerLead({ businessName: 'X' }).error, 'Sin contactName debe fallar');
  assert(registerLead({ businessName: 'X', contactName: 'Y' }).error, 'Sin email debe fallar');
});


// ── OB4: Demo completado ─────────────────────────────────────────

test('OB4', 'Demo se marca como completado', () => {
  resetAll();
  const r = setupLead();
  markDemoCompleted(r.leadId);
  const lead = getLead(r.leadId);
  assert(lead.status === LEAD_STATES.DEMO_DONE, 'Estado DEMO_DONE');
  assert(lead.demoCompletedAt, 'Tiene fecha de demo');
});


// ── OB5: Onboarding session ─────────────────────────────────────

test('OB5', 'Inicia sesion de onboarding', () => {
  resetAll();
  const r = setupLeadWithDemo();
  const onb = startOnboarding(r.leadId);
  assert(onb.success, 'Debe iniciar');
  assert(onb.session.completedSteps.includes('REGISTER'), 'Registro ya completado');
  assert(onb.session.completedSteps.includes('DEMO'), 'Demo ya completado');
  assert(onb.session.currentStep === 'BUSINESS', 'Siguiente paso: BUSINESS');
});


// ── OB6: Progreso del wizard ─────────────────────────────────────

test('OB6', 'Progreso avanza correctamente', () => {
  resetAll();
  const r = setupLeadWithDemo();
  const onb = startOnboarding(r.leadId);

  completeStep(onb.sessionId, 'BUSINESS', { address: 'Calle 1' });
  const progress = getOnboardingProgress(onb.sessionId);

  assert(progress.completed === 3, '3 pasos completados');
  assert(progress.currentStep === 'AGENT', 'Siguiente: AGENT');
  assert(progress.percent > 0, 'Porcentaje > 0');
});


// ── OB7: Provisioning completo ───────────────────────────────────

test('OB7', 'Provisioning crea tenant + agente + billing + trial', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();

  const result = provisionTenant(setup.sessionId);
  assert(result.success, 'Provisioning exitoso');
  assert(result.tenantId, 'Tiene tenantId');
  assert(result.agentId, 'Tiene agentId');
  assert(result.billingClientId, 'Tiene billingClientId');
  assert(result.subscriptionId, 'Tiene subscriptionId');
  assert(result.trialEnds, 'Tiene fecha fin trial');

  // Verify tenant was created
  const tenant = getTenant(result.tenantId);
  assert(tenant, 'Tenant existe');
  assert(tenant.name === 'Pizzeria El Horno', 'Nombre correcto');

  // Verify agent
  const agents = listAgents(result.tenantId);
  assert(agents.length === 1, '1 agente creado');
  assert(agents[0].name === 'Valentina', 'Agente se llama Valentina');

  // Verify subscription is TRIAL
  const sub = getSubscriptionByClient(result.billingClientId);
  assert(sub.status === SUB_STATES.TRIAL, 'Suscripcion en TRIAL');
});


// ── OB8: Provisioning incompleto ─────────────────────────────────

test('OB8', 'Provisioning falla sin pasos requeridos', () => {
  resetAll();
  const r = setupLeadWithDemo();
  const onb = startOnboarding(r.leadId);
  // Only completed REGISTER and DEMO, missing BUSINESS, AGENT, CATALOG
  const result = provisionTenant(onb.sessionId);
  assert(result.error, 'Debe fallar');
  assert(result.error.includes('incompletos'), 'Indica pasos faltantes');
});


// ── OB9: Checklist de activacion ─────────────────────────────────

test('OB9', 'Checklist detecta requisitos faltantes', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  provisionTenant(setup.sessionId);

  const checklist = getActivationChecklist(setup.leadId);
  assert(!checklist.error, 'Sin error');
  assert(checklist.checks.length >= 7, 'Minimo 7 checks');

  // Phone not assigned yet — should fail
  const phoneCheck = checklist.checks.find(c => c.id === 'phone');
  assert(!phoneCheck.passed, 'Phone no asignado');
  assert(!checklist.canActivate, 'No puede activar sin telefono');
});


// ── OB10: Activacion bloqueada ───────────────────────────────────

test('OB10', 'Activar sin cumplir checklist falla', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  provisionTenant(setup.sessionId);

  const result = activateAgent(setup.leadId);
  assert(result.error, 'Debe fallar');
  assert(result.error.includes('No se puede activar'), 'Mensaje claro');
});


// ── OB11: Trial dashboard con KPIs ──────────────────────────────

test('OB11', 'Trial dashboard muestra ROI y KPIs', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  // Simulate usage
  for (let i = 0; i < 15; i++) {
    recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 180 });
  }
  for (let i = 0; i < 10; i++) {
    recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.ORDER, durationSeconds: 0 });
  }

  const dash = getTrialDashboard(setup.leadId);
  assert(!dash.error, 'Sin error');
  assert(dash.kpis.totalCalls === 15, '15 llamadas');
  assert(dash.kpis.totalOrders === 10, '10 pedidos');
  assert(dash.kpis.conversionRate > 0, 'Tasa conversion > 0');
  assert(dash.kpis.roi > 0, 'ROI > 0');
  assert(dash.trial.daysLeft >= 0, 'Dias restantes');
});


// ── OB12: Gamificacion ───────────────────────────────────────────

test('OB12', 'Gamificacion genera logros por consumo', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  // 25 calls, 15 orders
  for (let i = 0; i < 25; i++) recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 120 });
  for (let i = 0; i < 15; i++) recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.ORDER, durationSeconds: 0 });

  const dash = getTrialDashboard(setup.leadId);
  const ach = dash.achievements;

  assert(ach.earned.length > 0, 'Tiene logros ganados');
  assert(ach.earned.find(a => a.id === 'first_call'), 'Logro: primera llamada');
  assert(ach.earned.find(a => a.id === 'calls_10'), 'Logro: 10 llamadas');
  assert(ach.earned.find(a => a.id === 'calls_25'), 'Logro: 25 llamadas');
  assert(ach.earned.find(a => a.id === 'first_order'), 'Logro: primer pedido');
  assert(ach.earned.find(a => a.id === 'orders_10'), 'Logro: 10 pedidos');
  assert(ach.totalPoints > 0, 'Puntos > 0');
  assert(ach.level, 'Tiene nivel');
});


// ── OB13: Consejos de menu ───────────────────────────────────────

test('OB13', 'Genera consejos de mejora del menu', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  provisionTenant(setup.sessionId);

  const dash = getTrialDashboard(setup.leadId);
  assert(dash.menuTips.length > 0, 'Tiene tips');

  // Should suggest accounting connection
  const accTip = dash.menuTips.find(t => t.id === 'connect_accounting');
  assert(accTip, 'Sugiere conectar software contable');
});


// ── OB14: Costos internos 7Group ─────────────────────────────────

test('OB14', 'Calcula costos internos de 7Group', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  // Simulate 30 min of usage
  for (let i = 0; i < 10; i++) {
    recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 180 });
  }

  const cost = get7GroupCostAnalysis(setup.leadId);
  assert(!cost.error, 'Sin error');
  assert(cost.costs.ai > 0, 'Costo IA > 0');
  assert(cost.costs.telephony > 0, 'Costo telefonia > 0');
  assert(cost.costs.totalOperating > 0, 'Costo total > 0');
  assert(cost.projection.marginPercent !== undefined, 'Tiene margen');
  assert(cost.projection.suggestedMinPrice > 0, 'Precio minimo sugerido');
  assert(cost.recommendation, 'Tiene recomendacion');
});


// ── OB15: Sugerencia de plan ─────────────────────────────────────

test('OB15', 'Sugiere plan segun consumo', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  for (let i = 0; i < 20; i++) {
    recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 300 });
  }

  const dash = getTrialDashboard(setup.leadId);
  assert(dash.suggestedPlan, 'Tiene plan sugerido');
  assert(dash.suggestedPlan.planId, 'Plan tiene ID');
  assert(dash.suggestedPlan.projectedMinutes > 0, 'Minutos proyectados > 0');
  assert(dash.suggestedPlan.reason, 'Tiene razon');
});


// ── OB16: Evaluacion de trial ────────────────────────────────────

test('OB16', 'Evaluacion determina conversion si cumple minimo', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  // Meet thresholds: 5+ calls, 3+ orders, 10+ minutes
  for (let i = 0; i < 8; i++) recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 180 });
  for (let i = 0; i < 5; i++) recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.ORDER, durationSeconds: 0 });

  const ev = evaluateTrial(setup.leadId);
  assert(!ev.error, 'Sin error');
  assert(ev.overallMet, 'Cumple minimo');
  assert(ev.action === 'CONVERT', 'Accion: CONVERT');
});


// ── OB17: Trial sin consumo suficiente ───────────────────────────

test('OB17', 'Trial sin consumo sugiere extension o churn', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  // Only 2 calls — below threshold
  recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 60 });
  recordUsage({ tenantId: prov.tenantId, type: USAGE_TYPES.CALL, durationSeconds: 60 });

  const ev = evaluateTrial(setup.leadId);
  assert(!ev.overallMet, 'No cumple minimo');
  assert(ev.action === 'EXTEND', 'Sugiere extension');
});


// ── OB18: Conversion de trial a pagado ───────────────────────────

test('OB18', 'Conversion de trial a plan pagado', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  const result = convertTrialToPaid(setup.leadId, 'plan_profesional');
  assert(result.success, 'Conversion exitosa');
  assert(result.plan.id === 'plan_profesional', 'Plan Pro');

  const lead = getLead(setup.leadId);
  assert(lead.status === LEAD_STATES.CONVERTED, 'Lead CONVERTED');
  assert(lead.convertedAt, 'Tiene fecha conversion');
});


// ── OB19: Alertas de pago ────────────────────────────────────────

test('OB19', 'Sistema de alertas genera notificaciones', () => {
  resetAll();
  // Verify alert types exist
  assert(ALERT_TYPES.TRIAL_ENDING_5, 'Alerta 5 dias');
  assert(ALERT_TYPES.TRIAL_ENDING_3, 'Alerta 3 dias');
  assert(ALERT_TYPES.TRIAL_ENDING_1, 'Alerta 1 dia');
  assert(ALERT_TYPES.PAYMENT_DUE_5, 'Pago 5 dias');
  assert(ALERT_TYPES.PAYMENT_DUE_3, 'Pago 3 dias');
  assert(ALERT_TYPES.PAYMENT_DUE_0, 'Pago mismo dia');
  assert(ALERT_TYPES.PAYMENT_FAILED, 'Pago fallido');
  assert(ALERT_TYPES.SUSPENDED, 'Suspendido');
});


// ── OB20: Pausa y reactivacion ───────────────────────────────────

test('OB20', 'Pausa y reactiva agente sin perder config', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  const prov = provisionTenant(setup.sessionId);

  // Need to manually set agent as active first
  const agents = listAgents(prov.tenantId);
  const agent = agents[0];

  // Pause
  const paused = pauseAgent(setup.leadId);
  assert(paused.success, 'Pausa exitosa');
  assert(paused.status === AGENT_STATES.INACTIVE, 'Estado INACTIVE');

  // Config still exists
  const data = getTenantData(prov.tenantId);
  assert(data.products.length > 0, 'Productos siguen ahi');

  // Resume
  const resumed = resumeAgent(setup.leadId);
  assert(resumed.success, 'Reactivacion exitosa');
  assert(resumed.status === AGENT_STATES.ACTIVE, 'Estado ACTIVE');
});


// ── OB21: Segundo cliente aislado ────────────────────────────────

test('OB21', 'Segundo cliente esta aislado del primero', () => {
  resetAll();

  // Client 1
  const r1 = registerLead({ businessName: 'Pizza A', contactName: 'X', email: 'a@a.co', phone: '1', businessType: 'pizza' });
  markDemoCompleted(r1.leadId);
  const onb1 = startOnboarding(r1.leadId);
  completeStep(onb1.sessionId, 'BUSINESS', { address: 'Calle 1' });
  completeStep(onb1.sessionId, 'AGENT', { name: 'Ana' });
  completeStep(onb1.sessionId, 'CATALOG', { products: [{ id: 'x1', name: 'P1', price: 10000 }, { id: 'x2', name: 'P2', price: 20000 }, { id: 'x3', name: 'P3', price: 30000 }], categories: [] });
  completeStep(onb1.sessionId, 'OPERATIONS', { schedule: { open: '10:00', close: '22:00' } });
  const prov1 = provisionTenant(onb1.sessionId);

  // Client 2
  const r2 = registerLead({ businessName: 'Sushi B', contactName: 'Y', email: 'b@b.co', phone: '2', businessType: 'sushi' });
  markDemoCompleted(r2.leadId);
  const onb2 = startOnboarding(r2.leadId);
  completeStep(onb2.sessionId, 'BUSINESS', { address: 'Calle 2' });
  completeStep(onb2.sessionId, 'AGENT', { name: 'Kenji' });
  completeStep(onb2.sessionId, 'CATALOG', { products: [{ id: 'y1', name: 'Roll A', price: 25000 }, { id: 'y2', name: 'Roll B', price: 30000 }, { id: 'y3', name: 'Roll C', price: 35000 }], categories: [] });
  completeStep(onb2.sessionId, 'OPERATIONS', { schedule: { open: '12:00', close: '23:00' } });
  const prov2 = provisionTenant(onb2.sessionId);

  // Verify isolation
  assert(prov1.tenantId !== prov2.tenantId, 'Tenants diferentes');
  assert(prov1.agentId !== prov2.agentId, 'Agentes diferentes');

  const data1 = getTenantData(prov1.tenantId);
  const data2 = getTenantData(prov2.tenantId);
  assert(data1.products[0].name !== data2.products[0].name, 'Productos diferentes');
});


// ── OB22: Admin view ─────────────────────────────────────────────

test('OB22', 'Admin view muestra todos los leads y funnel', () => {
  resetAll();
  registerLead({ businessName: 'A', contactName: 'A', email: 'a@a.co', phone: '1', businessType: 'pizza' });
  registerLead({ businessName: 'B', contactName: 'B', email: 'b@b.co', phone: '2', businessType: 'sushi' });

  const admin = getAdminOnboardingView();
  assert(admin.stats.totalLeads === 2, '2 leads');
  assert(admin.funnel, 'Tiene funnel');
  assert(admin.leads.length === 2, '2 leads en lista');
});


// ── OB23: Buscar lead por email ──────────────────────────────────

test('OB23', 'Busca lead por email', () => {
  resetAll();
  registerLead({ businessName: 'Test', contactName: 'T', email: 'test@test.co', phone: '1', businessType: 'pizza' });
  const found = getLeadByEmail('test@test.co');
  assert(found, 'Encuentra lead');
  assert(found.businessName === 'Test', 'Nombre correcto');
});


// ── OB24: Branding del cliente ───────────────────────────────────

test('OB24', 'Branding se guarda en la configuracion del tenant', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();

  // Override business data with branding
  const session = getOnboardingSession(setup.sessionId);
  session.stepData.BUSINESS.primaryColor = '#1B5E20';
  session.stepData.BUSINESS.tagline = 'La mejor pizza de Bogota';

  const prov = provisionTenant(setup.sessionId);
  const data = getTenantData(prov.tenantId);

  assert(data.config.branding.primaryColor === '#1B5E20', 'Color de marca guardado');
  assert(data.config.branding.tagline === 'La mejor pizza de Bogota', 'Tagline guardado');
});


// ── OB25: Trial sin actividad → churn ────────────────────────────

test('OB25', 'Trial sin ninguna actividad sugiere churn', () => {
  resetAll();
  const setup = setupLeadWithOnboarding();
  provisionTenant(setup.sessionId);

  // No usage at all
  const ev = evaluateTrial(setup.leadId);
  assert(!ev.overallMet, 'No cumple minimo');
  assert(ev.action === 'CHURN', 'Sugiere churn');
});


// ══════════════════════════════════════════════════════════════════
// RUNNER
// ══════════════════════════════════════════════════════════════════

export function runOnboardingTests() {
  const results = [];

  for (const t of tests) {
    try {
      t.fn();
      results.push({ id: t.id, name: t.name, pass: true });
    } catch (e) {
      results.push({ id: t.id, name: t.name, pass: false, error: e.message });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  return { total: results.length, passed, failed, results };
}
