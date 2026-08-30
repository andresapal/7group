/**
 * TENANT ISOLATION TESTS — FASE 9
 *
 * Validates that the multi-tenant architecture works:
 *   1. Tenant A only sees Tenant A data
 *   2. Tenant B only sees Tenant B data
 *   3. Orders are scoped to tenant
 *   4. Customers don't leak between tenants
 *   5. Agents belong to the right tenant
 *   6. Roles and permissions work
 *   7. Phone → tenant routing works
 *   8. Two restaurants can operate simultaneously
 *
 * Run: open engine/index.html → click "Tenant Tests"
 */

import { getTenant, getAgent, getTenantData, getTenantConfig, resolvePhone, listTenants, listAgents, canAccess, getUser, getUserByEmail, getRolePermissions, canAgentOperate, setAgentStatus, ROLES, AGENT_STATES, getDefaultTenantId, getDefaultAgentId, _resetRegistry } from './tenant-registry.js';
import { createConversation, getGreeting, processMessage } from './conversation-manager.js';
import { _resetOrderStore } from './mock-tools.js';
import { clearAuditLog } from './tool-orchestrator.js';

const TENANT_A = 'tenant_donmario';
const TENANT_B = 'tenant_wokroll';

let _passed = 0;
let _failed = 0;
let _results = [];

function assert(condition, testName) {
  if (condition) {
    _passed++;
    _results.push({ name: testName, pass: true });
  } else {
    _failed++;
    _results.push({ name: testName, pass: false });
    console.error(`FAIL: ${testName}`);
  }
}

function reset() {
  _resetRegistry();
  _resetOrderStore();
  clearAuditLog();
}

// ── 1. TENANT REGISTRY ──────────────────────────────────────────────

function testTenantRegistry() {
  reset();

  // T1: Both tenants exist
  const tA = getTenant(TENANT_A);
  assert(tA !== null && tA.name === 'Pizzería Don Mario', 'T1: Tenant A exists');

  const tB = getTenant(TENANT_B);
  assert(tB !== null && tB.name === 'Wok & Roll', 'T2: Tenant B exists');

  // T3: List tenants returns both
  const all = listTenants();
  assert(all.length >= 2, 'T3: listTenants returns at least 2');

  // T4: Non-existent tenant returns null
  assert(getTenant('tenant_fake') === null, 'T4: Non-existent tenant returns null');

  // T5: Tenant status is ACTIVE
  assert(tA.status === 'ACTIVE', 'T5: Tenant A is ACTIVE');
  assert(tB.status === 'ACTIVE', 'T6: Tenant B is ACTIVE');
}

// ── 2. DATA ISOLATION ───────────────────────────────────────────────

function testDataIsolation() {
  reset();

  const dataA = getTenantData(TENANT_A);
  const dataB = getTenantData(TENANT_B);

  // T7: Both have data
  assert(dataA !== null, 'T7: Tenant A has data');
  assert(dataB !== null, 'T8: Tenant B has data');

  // T9: Different product catalogs
  const prodA = dataA.products.map(p => p.id);
  const prodB = dataB.products.map(p => p.id);
  const overlap = prodA.filter(id => prodB.includes(id));
  assert(overlap.length === 0, 'T9: No product ID overlap between tenants');

  // T10: Different product names
  const nameA = dataA.products.map(p => p.name);
  const nameB = dataB.products.map(p => p.name);
  const nameOverlap = nameA.filter(n => nameB.includes(n));
  assert(nameOverlap.length === 0, 'T10: No product name overlap between tenants');

  // T11: Tenant A has pizzas, Tenant B has woks
  const hasPizza = dataA.products.some(p => p.name.includes('Pizza'));
  const hasWok = dataB.products.some(p => p.name.includes('Wok'));
  assert(hasPizza, 'T11a: Tenant A has pizza');
  assert(hasWok, 'T11b: Tenant B has woks');

  // T12: Tenant B does NOT have pizza
  const bHasPizza = dataB.products.some(p => p.name.includes('Pizza'));
  assert(!bHasPizza, 'T12: Tenant B does NOT have pizza');

  // T13: Tenant A does NOT have woks
  const aHasWok = dataA.products.some(p => p.name.includes('Wok'));
  assert(!aHasWok, 'T13: Tenant A does NOT have woks');

  // T14: Different configs
  const configA = getTenantConfig(TENANT_A);
  const configB = getTenantConfig(TENANT_B);
  assert(configA.name !== configB.name, 'T14: Different restaurant names');
  assert(configA.agent_name !== configB.agent_name, 'T15: Different agent names');

  // T16: Different customers
  const custA = dataA.customers.map(c => c.phone);
  const custB = dataB.customers.map(c => c.phone);
  const custOverlap = custA.filter(p => custB.includes(p));
  assert(custOverlap.length === 0, 'T16: No customer overlap between tenants');

  // T17: Different promotions
  const promoA = dataA.promotions.map(p => p.id);
  const promoB = dataB.promotions.map(p => p.id);
  const promoOverlap = promoA.filter(id => promoB.includes(id));
  assert(promoOverlap.length === 0, 'T17: No promotion overlap between tenants');
}

// ── 3. AGENTS ───────────────────────────────────────────────────────

function testAgents() {
  reset();

  // T18: Agents exist and belong to correct tenant
  const ana = getAgent('agent_ana');
  assert(ana !== null && ana.tenant_id === TENANT_A, 'T18: Agent Ana belongs to Tenant A');

  const carlos = getAgent('agent_carlos');
  assert(carlos !== null && carlos.tenant_id === TENANT_B, 'T19: Agent Carlos belongs to Tenant B');

  // T20: List agents per tenant
  const agentsA = listAgents(TENANT_A);
  const agentsB = listAgents(TENANT_B);
  assert(agentsA.every(a => a.tenant_id === TENANT_A), 'T20: All Tenant A agents belong to Tenant A');
  assert(agentsB.every(a => a.tenant_id === TENANT_B), 'T21: All Tenant B agents belong to Tenant B');

  // T22: Agents don't cross tenants
  assert(!agentsA.some(a => a.tenant_id === TENANT_B), 'T22: No Tenant B agents in A list');

  // T23: Agent status
  assert(ana.status === AGENT_STATES.ACTIVE, 'T23: Agent Ana is ACTIVE');
  assert(carlos.status === AGENT_STATES.ACTIVE, 'T24: Agent Carlos is ACTIVE');

  // T25: Can change agent status
  setAgentStatus('agent_ana', AGENT_STATES.SUSPENDED);
  const anaSuspended = getAgent('agent_ana');
  assert(anaSuspended.status === AGENT_STATES.SUSPENDED, 'T25: Agent Ana suspended');

  // T26: Suspended agent cannot operate
  const canOp = canAgentOperate('agent_ana');
  assert(!canOp.canOperate, 'T26: Suspended agent cannot operate');

  // Restore
  setAgentStatus('agent_ana', AGENT_STATES.ACTIVE);
  const canOpRestore = canAgentOperate('agent_ana');
  assert(canOpRestore.canOperate, 'T27: Restored agent can operate');
}

// ── 4. PHONE ROUTING ────────────────────────────────────────────────

function testPhoneRouting() {
  reset();

  // T28: Phone resolves to correct tenant
  const routeA = resolvePhone('3209001001');
  assert(routeA !== null && routeA.tenantId === TENANT_A, 'T28: Phone A routes to Tenant A');

  const routeB = resolvePhone('3209002002');
  assert(routeB !== null && routeB.tenantId === TENANT_B, 'T29: Phone B routes to Tenant B');

  // T30: Unknown phone returns null
  const routeX = resolvePhone('3001111111');
  assert(routeX === null, 'T30: Unknown phone returns null');

  // T31: Phone routes to correct agent
  assert(routeA.agentId === 'agent_ana', 'T31: Phone A routes to agent_ana');
  assert(routeB.agentId === 'agent_carlos', 'T32: Phone B routes to agent_carlos');
}

// ── 5. USERS AND ROLES ─────────────────────────────────────────────

function testUsersAndRoles() {
  reset();

  // T33: 7Group admin exists
  const admin = getUser('user_7group_admin');
  assert(admin !== null && admin.role === ROLES.SEVEN_GROUP_ADMIN, 'T33: 7Group admin exists');

  // T34: Client admin exists
  const clientAdmin = getUser('user_donmario_owner');
  assert(clientAdmin !== null && clientAdmin.role === ROLES.CLIENT_ADMIN, 'T34: Client admin exists');

  // T35: 7Group admin can access both tenants
  assert(canAccess('user_7group_admin', TENANT_A), 'T35a: 7Group admin can access Tenant A');
  assert(canAccess('user_7group_admin', TENANT_B), 'T35b: 7Group admin can access Tenant B');

  // T36: Client admin can ONLY access own tenant
  assert(canAccess('user_donmario_owner', TENANT_A), 'T36a: Don Mario owner can access Tenant A');
  assert(!canAccess('user_donmario_owner', TENANT_B), 'T36b: Don Mario owner CANNOT access Tenant B');

  // T37: Wok & Roll admin CANNOT access Don Mario
  assert(canAccess('user_wokroll_owner', TENANT_B), 'T37a: Wok & Roll owner can access Tenant B');
  assert(!canAccess('user_wokroll_owner', TENANT_A), 'T37b: Wok & Roll owner CANNOT access Tenant A');

  // T38: Staff user has limited permissions
  const staffPerms = getRolePermissions(ROLES.CLIENT_USER);
  assert(!staffPerms.canModifyAgents, 'T38a: Staff cannot modify agents');
  assert(!staffPerms.canManageUsers, 'T38b: Staff cannot manage users');
  assert(staffPerms.canViewAllOrders, 'T38c: Staff can view orders');

  // T39: User by email
  const byEmail = getUserByEmail('admin@7group.co');
  assert(byEmail !== null && byEmail.role === ROLES.SEVEN_GROUP_ADMIN, 'T39: getUserByEmail works');
}

// ── 6. CONVERSATION ISOLATION ───────────────────────────────────────

function testConversationIsolation() {
  reset();

  // T40: Conversation for Tenant A gets Tenant A config
  const convA = createConversation('rest_donmario', '3167890123', TENANT_A, 'agent_ana');
  const greetA = getGreeting(convA);
  assert(greetA.includes('Ana'), 'T40: Greeting A uses agent Ana');
  assert(greetA.includes('Don Mario') || greetA.includes('Pizzería'), 'T41: Greeting A mentions Don Mario');

  // T42: Conversation for Tenant B gets Tenant B config
  const convB = createConversation('rest_wokroll', '3001234567', TENANT_B, 'agent_carlos');
  const greetB = getGreeting(convB);
  assert(greetB.includes('Carlos'), 'T42: Greeting B uses agent Carlos');
  assert(greetB.includes('Wok') || greetB.includes('Roll'), 'T43: Greeting B mentions Wok & Roll');

  // T44: Tenant A state has correct tenantId
  assert(convA.state.tenantId === TENANT_A, 'T44: Conv A state has tenantId A');
  assert(convB.state.tenantId === TENANT_B, 'T45: Conv B state has tenantId B');
}

// ── 7. ORDER ISOLATION ──────────────────────────────────────────────

function testOrderIsolation() {
  reset();

  // Create conversation A and make an order
  const convA = createConversation('rest_donmario', null, TENANT_A, 'agent_ana');
  getGreeting(convA);

  let r = processMessage(convA, 'Quiero una pizza pepperoni');
  assert(r.response.includes('Pepperoni') || r.response.includes('pepperoni'), 'T46: Tenant A can order pizza pepperoni');

  // Create conversation B and try to order pizza (should NOT find it)
  const convB = createConversation('rest_wokroll', null, TENANT_B, 'agent_carlos');
  getGreeting(convB);

  r = processMessage(convB, 'Quiero una pizza pepperoni');
  assert(r.response.includes('No encontré') || r.response.includes('menú'), 'T47: Tenant B CANNOT find pizza pepperoni');

  // Tenant B should find wok teriyaki
  r = processMessage(convB, 'Quiero un wok teriyaki');
  assert(r.response.includes('Teriyaki') || r.response.includes('teriyaki') || r.response.includes('Wok'), 'T48: Tenant B can order wok teriyaki');

  // Tenant A should NOT find wok teriyaki
  r = processMessage(convA, 'Quiero un wok teriyaki');
  assert(r.response.includes('No encontré') || r.response.includes('menú'), 'T49: Tenant A CANNOT find wok teriyaki');
}

// ── 8. FULL ORDER CYCLE ISOLATION ───────────────────────────────────

function testFullOrderCycle() {
  reset();

  // === Tenant A: Complete order ===
  const convA = createConversation('rest_donmario', null, TENANT_A, 'agent_ana');
  getGreeting(convA);

  processMessage(convA, 'Quiero una hamburguesa clásica');
  processMessage(convA, 'Nada mas');
  processMessage(convA, 'Para recoger');
  processMessage(convA, 'Efectivo');

  // Should be in WAITING_CONFIRMATION
  assert(convA.state.currentState === 'WAITING_CONFIRMATION', 'T50: Tenant A in WAITING_CONFIRMATION');

  let rA = processMessage(convA, 'Si confirmo');
  assert(convA.state.currentState === 'COMPLETED', 'T51: Tenant A order COMPLETED');
  assert(rA.response.includes('confirmado') || rA.response.includes('Perfecto'), 'T52: Tenant A got confirmation');

  // === Tenant B: Complete order ===
  const convB = createConversation('rest_wokroll', null, TENANT_B, 'agent_carlos');
  getGreeting(convB);

  processMessage(convB, 'Quiero un roll de salmón');
  processMessage(convB, 'Nada mas');
  processMessage(convB, 'Para recoger');
  processMessage(convB, 'Efectivo');

  assert(convB.state.currentState === 'WAITING_CONFIRMATION', 'T53: Tenant B in WAITING_CONFIRMATION');

  let rB = processMessage(convB, 'Si confirmo');
  assert(convB.state.currentState === 'COMPLETED', 'T54: Tenant B order COMPLETED');
  assert(rB.response.includes('confirmado') || rB.response.includes('Perfecto'), 'T55: Tenant B got confirmation');

  // === Verify orders don't cross ===
  // Tenant A order should contain hamburguesa, NOT roll
  const orderAId = convA.draft.orderId;
  const orderBId = convB.draft.orderId;
  assert(orderAId !== null, 'T56: Tenant A has orderId');
  assert(orderBId !== null, 'T57: Tenant B has orderId');
  assert(orderAId !== orderBId, 'T58: Different order IDs');

  // Orders have correct tenant_id (checked via order total matching expected product prices)
  // Hamburguesa Clásica = $22,000; Roll Salmón = $26,000
  const totalA = convA.draft.total;
  const totalB = convB.draft.total;
  assert(totalA >= 22000 && totalA < 30000, 'T59: Tenant A total matches hamburguesa price range');
  assert(totalB >= 26000 && totalB < 35000, 'T60: Tenant B total matches roll salmón price range');
}

// ── 9. CROSS-TENANT PRODUCT REJECTION ───────────────────────────────

function testCrossTenantRejection() {
  reset();

  // Try to use a Tenant A product ID in Tenant B context
  const convB = createConversation('rest_wokroll', null, TENANT_B, 'agent_carlos');
  getGreeting(convB);

  // prod_001 is pizza pepperoni (Tenant A only)
  // The search won't find it, so the user gets "not found"
  const r = processMessage(convB, 'Quiero una pizza pepperoni');
  assert(!r.response.includes('$32'), 'T61: Tenant B does not show Tenant A price');
  assert(r.response.includes('No encontré') || r.response.includes('menú'), 'T62: Tenant B rejects Tenant A product');
}

// ── 10. DEFAULT TENANT BACKWARD COMPATIBILITY ───────────────────────

function testBackwardCompatibility() {
  reset();

  // Without tenantId, should use default (Tenant A)
  const defaultId = getDefaultTenantId();
  assert(defaultId === TENANT_A, 'T63: Default tenant is Tenant A');

  // createConversation without tenantId should work
  const conv = createConversation('rest_demo_001', null);
  getGreeting(conv);

  const r = processMessage(conv, 'Quiero una pizza pepperoni');
  // Should find pizza because default tenant is Don Mario
  assert(r.response.includes('Pepperoni') || r.response.includes('pepperoni'), 'T64: Default tenant can find pizza');
}

// ── 11. MENU QUERIES ISOLATION ──────────────────────────────────────

function testMenuIsolation() {
  reset();

  const convA = createConversation('rest_donmario', null, TENANT_A, 'agent_ana');
  getGreeting(convA);
  const menuA = processMessage(convA, 'Que tienen en el menu');
  assert(menuA.response.includes('pizzas') || menuA.response.includes('hamburguesas'), 'T65: Tenant A menu has pizzas/burgers');

  const convB = createConversation('rest_wokroll', null, TENANT_B, 'agent_carlos');
  getGreeting(convB);
  const menuB = processMessage(convB, 'Que tienen en el menu');
  assert(menuB.response.includes('woks') || menuB.response.includes('rolls') || menuB.response.includes('entradas'), 'T66: Tenant B menu has woks/rolls');

  // Cross-check: A's menu should NOT mention woks
  assert(!menuA.response.includes('woks'), 'T67: Tenant A menu does NOT mention woks');
  // Cross-check: B's menu should NOT mention pizzas
  assert(!menuB.response.includes('pizzas'), 'T68: Tenant B menu does NOT mention pizzas');
}

// ── 12. PROMOTIONS ISOLATION ────────────────────────────────────────

function testPromotionsIsolation() {
  reset();

  const convA = createConversation('rest_donmario', null, TENANT_A, 'agent_ana');
  getGreeting(convA);
  const promoA = processMessage(convA, 'Tienen alguna promocion');

  const convB = createConversation('rest_wokroll', null, TENANT_B, 'agent_carlos');
  getGreeting(convB);
  const promoB = processMessage(convB, 'Tienen alguna promocion');

  // A has "2x1 en Pizzas los Martes", B has "Jueves de Rolls"
  assert(promoA.response.includes('Martes') || promoA.response.includes('pizza') || promoA.response.includes('2x1'), 'T69: Tenant A promo mentions pizza/martes');
  const promoBlc = promoB.response.toLowerCase();
  assert(promoBlc.includes('jueves') || promoBlc.includes('roll') || promoBlc.includes('happy'), 'T70: Tenant B promo mentions rolls/jueves');
}

// ── RUN ALL ──────────────────────────────────────────────────────────

export function runTenantTests() {
  _passed = 0;
  _failed = 0;
  _results = [];

  console.log('=== FASE 9: TENANT ISOLATION TESTS ===');

  testTenantRegistry();
  testDataIsolation();
  testAgents();
  testPhoneRouting();
  testUsersAndRoles();
  testConversationIsolation();
  testOrderIsolation();
  testFullOrderCycle();
  testCrossTenantRejection();
  testBackwardCompatibility();
  testMenuIsolation();
  testPromotionsIsolation();

  console.log(`\n=== RESULTS: ${_passed} passed, ${_failed} failed (${_passed + _failed} total) ===`);

  if (_failed > 0) {
    console.log('\nFailed tests:');
    _results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}`));
  }

  return { passed: _passed, failed: _failed, total: _passed + _failed, results: _results };
}
