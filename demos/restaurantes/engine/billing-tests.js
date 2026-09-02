/**
 * BILLING TESTS — FASE 10
 *
 * 14 escenarios de prueba (B1–B14) + extras de cobertura
 * Total target: 20+ tests
 */

import {
  // Plans
  getPlan, listPlans, createPlan, updatePlan, PLAN_STATES,
  // Clients
  createBillingClient, getBillingClient, getBillingClientByTenant, listBillingClients,
  // Subscriptions
  createSubscription, getSubscription, getSubscriptionByClient, listSubscriptions,
  transitionSubscription, getTrialStatus, convertTrial, cancelSubscription,
  changePlan, renewSubscription, SUB_STATES,
  // Usage
  recordUsage, getUsageSummary, calculateOverage, USAGE_TYPES,
  // Invoices
  generateInvoice, getInvoice, listInvoices, markInvoicePaid, markInvoiceFailed,
  INVOICE_STATES,
  // Payments
  recordPayment, getPayment, listPayments, PAYMENT_STATES,
  // Checkout
  initiateCheckout,
  // Webhooks
  handleWebhookEvent, getWebhookLog,
  // Service state
  getServiceStatus,
  // Admin
  getAdminDashboard, getClientDetail,
  // Reset
  _resetBilling
} from './billing.js';

function assert(condition, message) {
  if (!condition) throw new Error('ASSERT FAILED: ' + message);
}

export async function runBillingTests() {
  const results = [];

  function test(name, fn) {
    _resetBilling();
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e.message });
    }
  }

  // ─── HELPERS ────────────────────────────────────────────
  function setupClient(tenantId = 'tenant_donmario') {
    return createBillingClient({
      tenantId,
      businessName: 'Pizzeria Don Mario',
      contactName: 'Mario',
      contactEmail: 'mario@donmario.com',
      contactPhone: '3209001001'
    });
  }

  function setupClientWithSub(planId = 'plan_starter', tenantId = 'tenant_donmario') {
    const client = setupClient(tenantId);
    const sub = createSubscription({ clientId: client.id, planId });
    return { client, sub };
  }

  // ─── B1: PLANES CONFIGURABLES ──────────────────────────
  test('B1: Planes configurables — lista, crea, modifica', () => {
    const plans = listPlans();
    assert(plans.length === 4, 'Debe haber 4 planes activos');
    assert(plans[0].id === 'plan_starter', 'Primer plan es Starter');
    assert(plans[1].id === 'plan_profesional', 'Segundo plan es Profesional');
    assert(plans[2].id === 'plan_empresarial', 'Tercer plan es Empresarial');
    assert(plans[3].id === 'plan_premium', 'Cuarto plan es Premium');

    // Crear plan custom
    const custom = createPlan({
      id: 'plan_custom',
      name: 'Custom',
      priceMonthly: 1200000,
      currency: 'COP',
      minutesIncluded: 5000,
      agentsIncluded: 10,
      features: ['all'],
      overagePerMinute: 800,
      trialDays: 0,
      setupFee: 0,
      sortOrder: 4
    });
    assert(custom.id === 'plan_custom', 'Plan custom creado');
    assert(listPlans().length === 5, '5 planes activos');

    // Deprecar plan
    updatePlan('plan_custom', { status: PLAN_STATES.DEPRECATED });
    assert(listPlans().length === 4, '4 planes activos tras deprecar');
    assert(listPlans(true).length === 5, '5 planes incluyendo inactivos');
  });

  // ─── B2: SUSCRIPCIONES — CICLO DE ESTADOS ──────────────
  test('B2: Subscription state machine — TRIAL → ACTIVE → PAST_DUE → SUSPENDED → CANCELLED', () => {
    const { sub } = setupClientWithSub();

    // Starts in TRIAL
    assert(sub.status === SUB_STATES.TRIAL, 'Inicia en TRIAL');
    assert(sub.trialStart !== null, 'trialStart asignado');
    assert(sub.trialEnd !== null, 'trialEnd asignado');

    // TRIAL → ACTIVE
    transitionSubscription(sub.id, SUB_STATES.ACTIVE);
    assert(getSubscription(sub.id).status === SUB_STATES.ACTIVE, 'Transiciona a ACTIVE');

    // ACTIVE → PAST_DUE
    transitionSubscription(sub.id, SUB_STATES.PAST_DUE);
    const pdSub = getSubscription(sub.id);
    assert(pdSub.status === SUB_STATES.PAST_DUE, 'Transiciona a PAST_DUE');
    assert(pdSub.pastDueSince !== null, 'pastDueSince asignado');

    // PAST_DUE → SUSPENDED
    transitionSubscription(sub.id, SUB_STATES.SUSPENDED);
    assert(getSubscription(sub.id).status === SUB_STATES.SUSPENDED, 'Transiciona a SUSPENDED');

    // SUSPENDED → CANCELLED
    transitionSubscription(sub.id, SUB_STATES.CANCELLED);
    const cSub = getSubscription(sub.id);
    assert(cSub.status === SUB_STATES.CANCELLED, 'Transiciona a CANCELLED');
    assert(cSub.cancelledAt !== null, 'cancelledAt asignado');
  });

  // ─── B3: TRANSICIONES INVALIDAS ────────────────────────
  test('B3: Transiciones invalidas rechazadas', () => {
    const { sub } = setupClientWithSub();

    // TRIAL → PAST_DUE (not allowed)
    let threw = false;
    try { transitionSubscription(sub.id, SUB_STATES.PAST_DUE); } catch (e) { threw = true; }
    assert(threw, 'TRIAL → PAST_DUE rechazado');

    // CANCELLED → ACTIVE (not allowed)
    transitionSubscription(sub.id, SUB_STATES.CANCELLED);
    threw = false;
    try { transitionSubscription(sub.id, SUB_STATES.ACTIVE); } catch (e) { threw = true; }
    assert(threw, 'CANCELLED → ACTIVE rechazado');
  });

  // ─── B4: TRIAL CONFIGURABLE ────────────────────────────
  test('B4: Trial configurable por plan', () => {
    const { sub } = setupClientWithSub('plan_starter');
    const plan = getPlan('plan_starter');

    const trial = getTrialStatus(sub.id);
    assert(trial.status === 'active', 'Trial activo');
    assert(trial.daysLeft === plan.trialDays, `Trial ${plan.trialDays} dias`);

    // Plan sin trial
    createPlan({
      id: 'plan_notrial',
      name: 'No Trial',
      priceMonthly: 100000,
      currency: 'COP',
      minutesIncluded: 100,
      agentsIncluded: 1,
      features: [],
      overagePerMinute: 2000,
      trialDays: 0,
      setupFee: 0,
      sortOrder: 5
    });

    const client2 = createBillingClient({ tenantId: 'tenant_b', businessName: 'B' });
    const sub2 = createSubscription({ clientId: client2.id, planId: 'plan_notrial' });
    assert(sub2.status === SUB_STATES.ACTIVE, 'Sin trial → empieza ACTIVE');
    assert(sub2.trialStart === null, 'No trial start');
  });

  // ─── B5: BILLING — CHECKOUT ────────────────────────────
  test('B5: Checkout session generado con montos correctos', () => {
    const client = setupClient();
    const session = initiateCheckout({ clientId: client.id, planId: 'plan_starter' });

    const plan = getPlan('plan_starter');
    assert(session.clientId === client.id, 'clientId correcto');
    assert(session.planId === 'plan_starter', 'planId correcto');
    assert(session.monthlyAmount === plan.priceMonthly, 'Monto mensual correcto');
    assert(session.setupFee === plan.setupFee, 'Setup fee correcto');
    assert(session.amount === plan.priceMonthly + plan.setupFee, 'Total correcto');
    assert(session.id.startsWith('cs_'), 'ID con prefijo cs_');
  });

  // ─── B6: WEBHOOKS — PAYMENT SUCCESS ────────────────────
  test('B6: Webhook payment_success → activa suscripcion + registra pago', () => {
    const { client, sub } = setupClientWithSub();
    assert(sub.status === SUB_STATES.TRIAL, 'Empieza en TRIAL');

    const inv = generateInvoice(sub.id);

    const result = handleWebhookEvent({
      id: 'evt_001',
      type: 'payment_success',
      data: {
        subscriptionId: sub.id,
        invoiceId: inv.id,
        paymentIntentId: 'pi_stripe_123',
        amount: inv.total,
        cardLast4: '4242'
      }
    });

    assert(result.handled === true, 'Evento procesado');
    assert(result.action === 'payment_recorded', 'Accion: payment_recorded');

    // Subscription now ACTIVE
    assert(getSubscription(sub.id).status === SUB_STATES.ACTIVE, 'Sub activada');

    // Invoice paid
    assert(getInvoice(inv.id).status === INVOICE_STATES.PAID, 'Factura pagada');

    // Payment recorded (no card number stored, just last4)
    const pays = listPayments({ clientId: client.id });
    assert(pays.length === 1, 'Pago registrado');
    assert(pays[0].cardLast4 === '4242', 'Solo last4');
    assert(pays[0].stripePaymentIntentId === 'pi_stripe_123', 'PaymentIntent guardado');
  });

  // ─── B7: WEBHOOKS — PAYMENT FAILED ─────────────────────
  test('B7: Webhook payment_failed → marca PAST_DUE', () => {
    const { sub } = setupClientWithSub();
    // Activate first
    transitionSubscription(sub.id, SUB_STATES.ACTIVE);

    const result = handleWebhookEvent({
      id: 'evt_002',
      type: 'payment_failed',
      data: {
        subscriptionId: sub.id,
        reason: 'insufficient_funds'
      }
    });

    assert(result.handled === true, 'Evento procesado');
    assert(getSubscription(sub.id).status === SUB_STATES.PAST_DUE, 'Sub en PAST_DUE');
    assert(getSubscription(sub.id).pastDueSince !== null, 'pastDueSince registrado');
  });

  // ─── B8: IDEMPOTENCIA DE WEBHOOKS ──────────────────────
  test('B8: Webhooks idempotentes — mismo evento ignorado', () => {
    const { sub } = setupClientWithSub();
    const inv = generateInvoice(sub.id);

    const event = {
      id: 'evt_idem_001',
      type: 'payment_success',
      data: { subscriptionId: sub.id, invoiceId: inv.id, amount: inv.total }
    };

    const r1 = handleWebhookEvent(event);
    assert(r1.handled === true, 'Primera vez procesado');

    const r2 = handleWebhookEvent(event);
    assert(r2.handled === false, 'Segunda vez ignorado');
    assert(r2.action === 'duplicate', 'Marcado como duplicado');

    // Only one payment created
    const log = getWebhookLog();
    const dupes = log.filter(l => l.id === 'evt_idem_001' && l.result === 'duplicate');
    assert(dupes.length === 1, 'Solo un duplicado en log');
  });

  // ─── B9: CONSUMO — USO POR TENANT ─────────────────────
  test('B9: Usage metering — registra y agrega por tenant', () => {
    const { client, sub } = setupClientWithSub();

    // Record usage
    recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.CALL, durationSeconds: 180, metadata: { callId: 'c1' } });
    recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.CALL, durationSeconds: 240, metadata: { callId: 'c2' } });
    recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.ORDER, metadata: { orderId: 'P-DON-001' } });

    // Different tenant
    recordUsage({ tenantId: 'tenant_wokroll', type: USAGE_TYPES.CALL, durationSeconds: 120 });

    // Summary for Don Mario
    const summary = getUsageSummary('tenant_donmario', sub.currentPeriodStart, sub.currentPeriodEnd);
    assert(summary.totalCalls === 2, '2 llamadas Don Mario');
    assert(summary.totalMinutes === 7, '3+4=7 min (ceil)');
    assert(summary.totalOrders === 1, '1 orden');

    // Summary for Wok (should not include Don Mario)
    const wokSummary = getUsageSummary('tenant_wokroll', sub.currentPeriodStart, sub.currentPeriodEnd);
    assert(wokSummary.totalCalls === 1, '1 llamada Wok');
    assert(wokSummary.totalMinutes === 2, '2 min Wok');
  });

  // ─── B10: EXCEDENTES ───────────────────────────────────
  test('B10: Overage calculation — minutos sobre el plan', () => {
    const { client, sub } = setupClientWithSub('plan_starter');  // 120 min included

    // Record 140 minutes of calls (over by 20)
    for (let i = 0; i < 140; i++) {
      recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.CALL, durationSeconds: 60 });
    }

    const overage = calculateOverage(sub.id);
    assert(overage.minutesIncluded === 120, 'Plan incluye 120 min');
    assert(overage.minutesUsed === 140, '140 min usados');
    assert(overage.minutesOver === 20, '20 min excedente');

    const plan = getPlan('plan_starter');
    assert(overage.overageCost === 20 * plan.overagePerMinute, 'Costo excedente correcto');
  });

  // ─── B11: FACTURACIÓN ──────────────────────────────────
  test('B11: Factura generada con plan + excedente + IVA', () => {
    const { client, sub } = setupClientWithSub('plan_starter');

    // Record 130 min of usage (10 over the 120 min Starter plan)
    for (let i = 0; i < 130; i++) {
      recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.CALL, durationSeconds: 60 });
    }

    const inv = generateInvoice(sub.id);

    assert(inv.invoiceNumber.startsWith('INV-7G-'), 'Numero con prefijo 7G');
    assert(inv.lineItems.length === 2, '2 line items (plan + excedente)');
    assert(inv.lineItems[0].description.includes('Starter'), 'Line item del plan');
    assert(inv.lineItems[1].description.includes('adicionales'), 'Line item excedente');

    const plan = getPlan('plan_starter');
    const expectedSubtotal = plan.priceMonthly + (10 * plan.overagePerMinute);  // 10 min over
    assert(inv.subtotal === expectedSubtotal, 'Subtotal correcto');
    assert(inv.taxRate === 0.19, 'IVA 19%');
    assert(inv.taxes === Math.round(expectedSubtotal * 0.19), 'IVA calculado');
    assert(inv.total === expectedSubtotal + inv.taxes, 'Total = subtotal + IVA');
  });

  // ─── B12: ESTADO DE SERVICIO ───────────────────────────
  test('B12: Service state — billing controla agente', () => {
    // Tenant sin billing client (demo)
    let status = getServiceStatus('tenant_demo');
    assert(status.allowed === true, 'Demo tenant siempre permitido');
    assert(status.reason === 'no_billing_client', 'Razon: no billing client');

    // Tenant with trial
    const { sub } = setupClientWithSub();
    status = getServiceStatus('tenant_donmario');
    assert(status.allowed === true, 'Trial activo → permitido');
    assert(status.warning !== undefined, 'Muestra dias restantes');

    // Activate
    transitionSubscription(sub.id, SUB_STATES.ACTIVE);
    status = getServiceStatus('tenant_donmario');
    assert(status.allowed === true, 'Active → permitido');

    // Past due (in grace period)
    transitionSubscription(sub.id, SUB_STATES.PAST_DUE);
    status = getServiceStatus('tenant_donmario');
    assert(status.allowed === true, 'Past due dentro de gracia → permitido');
    assert(status.warning !== undefined, 'Warning de pago pendiente');

    // Suspended
    transitionSubscription(sub.id, SUB_STATES.SUSPENDED);
    status = getServiceStatus('tenant_donmario');
    assert(status.allowed === false, 'Suspended → bloqueado');

    // Cancelled
    transitionSubscription(sub.id, SUB_STATES.CANCELLED);
    status = getServiceStatus('tenant_donmario');
    assert(status.allowed === false, 'Cancelled → bloqueado');
  });

  // ─── B13: CAMBIO DE PLAN ───────────────────────────────
  test('B13: Cambio de plan — upgrade y downgrade', () => {
    const { sub } = setupClientWithSub('plan_starter');
    transitionSubscription(sub.id, SUB_STATES.ACTIVE);

    // Upgrade
    const upgrade = changePlan(sub.id, 'plan_profesional');
    assert(upgrade.changeType === 'upgrade', 'Detecta upgrade');
    assert(upgrade.oldPlanId === 'plan_starter', 'Plan anterior correcto');
    assert(upgrade.newPlanId === 'plan_profesional', 'Plan nuevo correcto');
    assert(getSubscription(sub.id).planId === 'plan_profesional', 'Plan actualizado en sub');

    // Downgrade
    const downgrade = changePlan(sub.id, 'plan_starter');
    assert(downgrade.changeType === 'downgrade', 'Detecta downgrade');
  });

  // ─── B14: CANCELACION ──────────────────────────────────
  test('B14: Cancelacion — inmediata vs fin de periodo', () => {
    // Cancel at period end
    const { sub: sub1 } = setupClientWithSub();
    transitionSubscription(sub1.id, SUB_STATES.ACTIVE);

    cancelSubscription(sub1.id, false);
    const s1 = getSubscription(sub1.id);
    assert(s1.status === SUB_STATES.ACTIVE, 'Sigue activa hasta fin de periodo');
    assert(s1.cancelAtPeriodEnd === true, 'Marcada para cancelar');

    // Renewal should cancel
    renewSubscription(sub1.id);
    assert(getSubscription(sub1.id).status === SUB_STATES.CANCELLED, 'Al renovar, se cancela');

    // Immediate cancel
    const client2 = createBillingClient({ tenantId: 'tenant_b2', businessName: 'B2' });
    const sub2 = createSubscription({ clientId: client2.id, planId: 'plan_starter' });
    transitionSubscription(sub2.id, SUB_STATES.ACTIVE);

    cancelSubscription(sub2.id, true);
    assert(getSubscription(sub2.id).status === SUB_STATES.CANCELLED, 'Cancelacion inmediata');
  });

  // ─── B15: ADMIN DASHBOARD ──────────────────────────────
  test('B15: Admin dashboard — datos consolidados', () => {
    // Create 2 clients with subs
    const c1 = createBillingClient({ tenantId: 'tenant_a', businessName: 'A' });
    const c2 = createBillingClient({ tenantId: 'tenant_b', businessName: 'B' });
    const s1 = createSubscription({ clientId: c1.id, planId: 'plan_starter' });
    const s2 = createSubscription({ clientId: c2.id, planId: 'plan_profesional' });

    // Activate s1
    transitionSubscription(s1.id, SUB_STATES.ACTIVE);

    // Record a payment for s1
    const inv = generateInvoice(s1.id);
    recordPayment({
      invoiceId: inv.id,
      clientId: c1.id,
      amount: inv.total,
      status: PAYMENT_STATES.SUCCESS
    });
    markInvoicePaid(inv.id);

    const dash = getAdminDashboard();
    assert(dash.clients.total === 2, '2 clientes');
    assert(dash.subscriptions.total === 2, '2 subs');
    assert(dash.subscriptions.active === 1, '1 activa');
    assert(dash.subscriptions.trial === 1, '1 en trial');
    assert(dash.revenue.total === inv.total, 'Revenue = pago');
    assert(dash.invoices.paid === 1, '1 factura pagada');
    assert(dash.payments.successful === 1, '1 pago exitoso');
  });

  // ─── B16: CLIENT DETAIL ────────────────────────────────
  test('B16: Client detail — vista completa de cliente', () => {
    const { client, sub } = setupClientWithSub();
    recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.CALL, durationSeconds: 300 });
    recordUsage({ tenantId: 'tenant_donmario', type: USAGE_TYPES.ORDER, metadata: { orderId: 'o1' } });

    const inv = generateInvoice(sub.id);

    const detail = getClientDetail(client.id);
    assert(detail.client.id === client.id, 'Client correcto');
    assert(detail.plan.id === 'plan_starter', 'Plan correcto');
    assert(detail.subscription.id === sub.id, 'Sub correcta');
    assert(detail.trial.status === 'active', 'Trial activo');
    assert(detail.usage.totalCalls === 1, '1 llamada');
    assert(detail.usage.totalMinutes === 5, '5 min');
    assert(detail.usage.totalOrders === 1, '1 orden');
    assert(detail.usage.minutesRemaining === 115, '115 min restantes');
    assert(detail.invoices.length === 1, '1 factura');
  });

  // ─── B17: SECURITY — NO CARD DATA ─────────────────────
  test('B17: Seguridad — no almacena datos completos de tarjeta', () => {
    const { client, sub } = setupClientWithSub();

    const pay = recordPayment({
      invoiceId: null,
      clientId: client.id,
      amount: 169000,
      status: PAYMENT_STATES.SUCCESS,
      cardLast4: '4242',
      stripePaymentIntentId: 'pi_test'
    });

    // Verify no full card data in payment
    assert(pay.cardLast4 === '4242', 'Solo ultimos 4 digitos');
    assert(!pay.cardNumber, 'Sin numero completo');
    assert(!pay.cvv, 'Sin CVV');
    assert(!pay.expiry, 'Sin fecha de expiracion');

    // Verify reference to external payment
    assert(pay.stripePaymentIntentId === 'pi_test', 'Referencia a Stripe');
  });

  // ─── B18: WEBHOOK INVALIDO ─────────────────────────────
  test('B18: Webhook invalido rechazado', () => {
    const r1 = handleWebhookEvent(null);
    assert(r1.handled === false, 'Null event rechazado');

    const r2 = handleWebhookEvent({ id: null, type: null });
    assert(r2.handled === false, 'Event sin id rechazado');

    const r3 = handleWebhookEvent({ id: 'evt_x', type: 'unknown_type', data: {} });
    assert(r3.handled === false, 'Tipo desconocido no handled');
  });

  // ─── B19: MULTIPLES PERIODOS ───────────────────────────
  test('B19: Renewal reset de periodo', () => {
    const { sub } = setupClientWithSub();
    transitionSubscription(sub.id, SUB_STATES.ACTIVE);

    // Force an old period start to verify renewal updates it
    const s = getSubscription(sub.id);
    s.currentPeriodStart = '2025-01-01T00:00:00.000Z';
    s.currentPeriodEnd = '2025-02-01T00:00:00.000Z';

    renewSubscription(sub.id);

    const renewed = getSubscription(sub.id);
    assert(renewed.currentPeriodStart !== '2025-01-01T00:00:00.000Z', 'Periodo nuevo iniciado');
    assert(renewed.status === SUB_STATES.ACTIVE, 'Sigue activa');
    assert(renewed.nextBillingDate !== null, 'Next billing date asignado');
  });

  // ─── B20: BILLING CLIENT BY TENANT ─────────────────────
  test('B20: Lookup billing client por tenantId', () => {
    const c = setupClient();
    const found = getBillingClientByTenant('tenant_donmario');
    assert(found !== null, 'Encontrado por tenant');
    assert(found.id === c.id, 'Mismo client');

    const notFound = getBillingClientByTenant('tenant_noexiste');
    assert(notFound === null, 'No encontrado para tenant inexistente');
  });

  // ─── B21: CONVERTIR TRIAL ──────────────────────────────
  test('B21: Convert trial — solo desde TRIAL', () => {
    const { sub } = setupClientWithSub();
    assert(sub.status === SUB_STATES.TRIAL, 'Empieza en TRIAL');

    convertTrial(sub.id);
    assert(getSubscription(sub.id).status === SUB_STATES.ACTIVE, 'Convertida a ACTIVE');

    // Try again — should fail
    let threw = false;
    try { convertTrial(sub.id); } catch (e) { threw = true; }
    assert(threw, 'No se puede convertir si ya no esta en TRIAL');
  });

  // ─── B22: FACTURA SIN EXCEDENTE ────────────────────────
  test('B22: Factura sin excedente — solo plan', () => {
    const { sub } = setupClientWithSub();
    // No usage recorded
    const inv = generateInvoice(sub.id);

    assert(inv.lineItems.length === 1, 'Solo 1 line item');
    assert(inv.minutesOver === 0, '0 minutos excedente');
    assert(inv.subtotal === getPlan('plan_starter').priceMonthly, 'Subtotal = precio plan');
  });

  // ─── SUMMARY ───────────────────────────────────────────
  return results;
}
