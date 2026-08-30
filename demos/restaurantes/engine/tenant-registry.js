/**
 * TENANT REGISTRY — FASE 9: Multi-Tenant
 *
 * Central registry for 7Group's multi-restaurant voice agent platform.
 * 7Group is the PROVIDER. Each restaurant is a TENANT (client).
 *
 * This file is the single source of truth for:
 *   - Tenants (businesses)
 *   - Agents (voice agents per tenant)
 *   - Users and roles
 *   - Menu data per tenant
 *   - Phone → tenant routing
 *
 * In production, this is replaced by Supabase/PostgreSQL.
 * The interface (getTenant, getTenantData, etc.) stays identical.
 */

// ── ROLES ────────────────────────────────────────────────────────────

export const ROLES = {
  SEVEN_GROUP_ADMIN: 'SEVEN_GROUP_ADMIN',   // 7Group platform admin — sees ALL tenants
  CLIENT_ADMIN: 'CLIENT_ADMIN',             // Restaurant owner — sees only their tenant
  CLIENT_USER: 'CLIENT_USER'                // Restaurant staff — limited access within tenant
};

const ROLE_PERMISSIONS = {
  [ROLES.SEVEN_GROUP_ADMIN]: {
    canViewAllTenants: true,
    canCreateTenant: true,
    canModifyTenant: true,
    canSuspendTenant: true,
    canViewAllOrders: true,
    canModifyAgents: true,
    canManageUsers: true,
    canViewBilling: true
  },
  [ROLES.CLIENT_ADMIN]: {
    canViewAllTenants: false,
    canCreateTenant: false,
    canModifyTenant: true,    // own tenant only
    canSuspendTenant: false,
    canViewAllOrders: true,   // own tenant only
    canModifyAgents: true,    // own tenant only
    canManageUsers: true,     // own tenant only
    canViewBilling: true      // own tenant only
  },
  [ROLES.CLIENT_USER]: {
    canViewAllTenants: false,
    canCreateTenant: false,
    canModifyTenant: false,
    canSuspendTenant: false,
    canViewAllOrders: true,   // own tenant only
    canModifyAgents: false,
    canManageUsers: false,
    canViewBilling: false
  }
};

// ── AGENT STATES ─────────────────────────────────────────────────────

export const AGENT_STATES = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  ERROR: 'ERROR'
};

// ── IN-MEMORY STORES ─────────────────────────────────────────────────

const _tenants = new Map();
const _agents = new Map();
const _users = new Map();
const _phoneIndex = new Map();   // phone → { tenantId, agentId }
const _tenantData = new Map();   // tenantId → { products, categories, promotions, zones, customers, config }

// ── TENANT A: Pizzería Don Mario ─────────────────────────────────────

const TENANT_A_ID = 'tenant_donmario';

const TENANT_A_CONFIG = {
  id: 'rest_donmario',
  name: 'Pizzería Don Mario',
  agent_name: 'Ana',
  personality: 'fast_food_friendly',
  tone: 'casual_warm',
  formality: 'tu',
  language: 'es-CO',
  currency: 'COP',
  greeting: 'Hola, soy {agent_name}, asistente virtual de {business_name}. ¿Qué te gustaría pedir?',
  farewell: 'Gracias por tu pedido. ¡Buen provecho!',
  business_hours: {
    monday:    { open: '10:00', close: '23:00' },
    tuesday:   { open: '10:00', close: '23:00' },
    wednesday: { open: '10:00', close: '23:00' },
    thursday:  { open: '10:00', close: '23:00' },
    friday:    { open: '10:00', close: '00:00' },
    saturday:  { open: '10:00', close: '00:00' },
    sunday:    { open: '11:00', close: '22:00' }
  },
  delivery: {
    available: true,
    base_fee: 5000,
    free_delivery_above: 80000,
    estimated_time_min: 20,
    estimated_time_max: 35,
    max_distance_km: 8
  },
  payment_methods: ['efectivo', 'nequi', 'daviplata', 'tarjeta'],
  policies: [
    'Pedido mínimo para domicilio: $20.000',
    'Tiempo de cancelación: hasta que el pedido entre en preparación',
    'Propinas no incluidas'
  ]
};

const TENANT_A_CATEGORIES = [
  { id: 'cat_pizza',    name: 'Pizzas' },
  { id: 'cat_burger',   name: 'Hamburguesas' },
  { id: 'cat_sides',    name: 'Acompañantes' },
  { id: 'cat_drinks',   name: 'Bebidas' },
  { id: 'cat_combos',   name: 'Combos' }
];

const TENANT_A_PRODUCTS = [
  {
    id: 'prod_001', name: 'Pizza Pepperoni Grande', short_name: 'pepperoni',
    description: 'Masa artesanal, pepperoni premium, queso mozzarella',
    price: 32000, category_id: 'cat_pizza', category_name: 'Pizzas', available: true,
    ingredients: ['masa artesanal', 'salsa de tomate', 'queso mozzarella', 'pepperoni'],
    available_modifiers: [
      { name: 'sin cebolla', type: 'remove', price_delta: 0 },
      { name: 'extra queso', type: 'add', price_delta: 4000 },
      { name: 'borde relleno', type: 'add', price_delta: 6000 }
    ],
    aliases: ['pepperoni', 'peperoni', 'la de pepperoni', 'pizza pepperoni']
  },
  {
    id: 'prod_002', name: 'Pizza Hawaiana Grande', short_name: 'hawaiana',
    description: 'Jamón, piña, queso mozzarella',
    price: 30000, category_id: 'cat_pizza', category_name: 'Pizzas', available: true,
    ingredients: ['masa artesanal', 'salsa de tomate', 'queso mozzarella', 'jamón', 'piña'],
    available_modifiers: [
      { name: 'sin piña', type: 'remove', price_delta: 0 },
      { name: 'extra queso', type: 'add', price_delta: 4000 },
      { name: 'doble jamón', type: 'add', price_delta: 5000 }
    ],
    aliases: ['hawaiana', 'la hawaiana', 'pizza hawaiana']
  },
  {
    id: 'prod_003', name: 'Pizza Margarita', short_name: 'margarita',
    description: 'Tomate fresco, albahaca, mozzarella de búfala',
    price: 28000, category_id: 'cat_pizza', category_name: 'Pizzas', available: true,
    ingredients: ['masa artesanal', 'tomate fresco', 'albahaca', 'mozzarella de búfala'],
    available_modifiers: [{ name: 'extra queso', type: 'add', price_delta: 4000 }],
    aliases: ['margarita', 'la margarita', 'pizza margarita']
  },
  {
    id: 'prod_004', name: 'Hamburguesa Clásica', short_name: 'clásica',
    description: 'Carne 200g, lechuga, tomate, cebolla, salsa especial',
    price: 22000, category_id: 'cat_burger', category_name: 'Hamburguesas', available: true,
    ingredients: ['pan', 'carne 200g', 'lechuga', 'tomate', 'cebolla', 'salsa especial'],
    available_modifiers: [
      { name: 'sin cebolla', type: 'remove', price_delta: 0 },
      { name: 'sin tomate', type: 'remove', price_delta: 0 },
      { name: 'sin lechuga', type: 'remove', price_delta: 0 },
      { name: 'sin salsa', type: 'remove', price_delta: 0 },
      { name: 'extra queso', type: 'add', price_delta: 3000 },
      { name: 'doble carne', type: 'add', price_delta: 8000 },
      { name: 'tocineta', type: 'add', price_delta: 4000 }
    ],
    aliases: ['clásica', 'clasica', 'la clásica', 'hamburguesa clásica', 'hamburguesa clasica', 'la normal', 'la sencilla', 'hamburguesa sencilla', 'hamburguesa normal', 'hamburguesa simple']
  },
  {
    id: 'prod_005', name: 'Hamburguesa Doble Queso', short_name: 'doble queso',
    description: 'Doble carne 400g, doble queso cheddar, tocineta',
    price: 32000, category_id: 'cat_burger', category_name: 'Hamburguesas', available: true,
    ingredients: ['pan', 'doble carne 400g', 'doble queso cheddar', 'tocineta', 'lechuga', 'tomate'],
    available_modifiers: [
      { name: 'sin cebolla', type: 'remove', price_delta: 0 },
      { name: 'sin tomate', type: 'remove', price_delta: 0 },
      { name: 'extra queso', type: 'add', price_delta: 3000 },
      { name: 'sin tocineta', type: 'remove', price_delta: 0 }
    ],
    aliases: ['doble queso', 'la doble', 'la doble queso', 'hamburguesa doble queso', 'la de doble carne', 'la especial', 'hamburguesa especial', 'la grande']
  },
  {
    id: 'prod_006', name: 'Hamburguesa BBQ', short_name: 'BBQ',
    description: 'Carne 200g, tocineta, cebolla caramelizada, salsa BBQ',
    price: 26000, category_id: 'cat_burger', category_name: 'Hamburguesas', available: false,
    ingredients: ['pan', 'carne 200g', 'tocineta', 'cebolla caramelizada', 'salsa BBQ', 'lechuga'],
    available_modifiers: [
      { name: 'sin cebolla', type: 'remove', price_delta: 0 },
      { name: 'extra tocineta', type: 'add', price_delta: 4000 },
      { name: 'extra queso', type: 'add', price_delta: 3000 },
      { name: 'doble carne', type: 'add', price_delta: 8000 }
    ],
    aliases: ['bbq', 'la bbq', 'la de bbq', 'hamburguesa bbq', 'la de tocineta', 'la de salsa bbq']
  },
  {
    id: 'prod_007', name: 'Papas Grandes', short_name: 'papas',
    description: 'Papas a la francesa porción grande', price: 10000,
    category_id: 'cat_sides', category_name: 'Acompañantes', available: true,
    ingredients: ['papas', 'sal'],
    available_modifiers: [
      { name: 'con queso', type: 'add', price_delta: 3000 },
      { name: 'con tocineta', type: 'add', price_delta: 4000 }
    ],
    aliases: ['papas', 'papas grandes', 'papas fritas', 'unas papas', 'papitas']
  },
  {
    id: 'prod_008', name: 'Aros de Cebolla', short_name: 'aros',
    description: '8 aros de cebolla crujientes', price: 12000,
    category_id: 'cat_sides', category_name: 'Acompañantes', available: true,
    ingredients: ['cebolla', 'masa crujiente'],
    available_modifiers: [],
    aliases: ['aros', 'aros de cebolla', 'aritos', 'onion rings']
  },
  {
    id: 'prod_009', name: 'Gaseosa 400ml', short_name: 'gaseosa',
    description: 'Coca-Cola, Sprite o Colombiana', price: 4000,
    category_id: 'cat_drinks', category_name: 'Bebidas', available: true,
    ingredients: [], available_modifiers: [],
    variants: ['Coca-Cola', 'Sprite', 'Colombiana'],
    aliases: ['gaseosa', 'coca', 'coca cola', 'sprite', 'colombiana', 'soda', 'refresco']
  },
  {
    id: 'prod_010', name: 'Malteada', short_name: 'malteada',
    description: 'Chocolate, vainilla o fresa', price: 14000,
    category_id: 'cat_drinks', category_name: 'Bebidas', available: true,
    ingredients: ['leche', 'helado'], available_modifiers: [],
    variants: ['chocolate', 'vainilla', 'fresa'],
    aliases: ['malteada', 'milkshake', 'batido']
  },
  {
    id: 'prod_011', name: 'Combo Personal', short_name: 'combo personal',
    description: 'Hamburguesa clásica + papas + gaseosa', price: 32000,
    category_id: 'cat_combos', category_name: 'Combos', available: true,
    ingredients: [], includes: ['Hamburguesa Clásica', 'Papas Grandes', 'Gaseosa 400ml'],
    available_modifiers: [
      { name: 'cambiar hamburguesa por BBQ', type: 'substitute', price_delta: 4000 },
      { name: 'cambiar hamburguesa por doble queso', type: 'substitute', price_delta: 10000 }
    ],
    aliases: ['combo personal', 'combo', 'el combo', 'combo hamburguesa', 'combo sencillo', 'el combo personal']
  },
  {
    id: 'prod_012', name: 'Combo Familiar Pizza', short_name: 'combo familiar',
    description: 'Pizza grande + papas x2 + gaseosa 1.5L', price: 52000,
    category_id: 'cat_combos', category_name: 'Combos', available: true,
    ingredients: [], includes: ['Pizza grande (a elegir)', 'Papas Grandes x2', 'Gaseosa 1.5L'],
    available_modifiers: [],
    aliases: ['combo familiar', 'familiar', 'combo familia', 'el familiar', 'combo de pizza', 'combo grande', 'combo para compartir']
  }
];

const TENANT_A_PROMOTIONS = [
  { id: 'promo_001', name: '2x1 en Pizzas los Martes', description: 'Todos los martes lleva 2 pizzas grandes y paga solo 1', type: 'bogo', applies_to_categories: ['cat_pizza'], conditions: 'Solo martes. Pizzas del mismo valor o menor.', active: true, valid_days: ['tuesday'] },
  { id: 'promo_002', name: 'Combo + Malteada', description: 'Agrega una malteada a cualquier combo por solo $8.000 adicionales', type: 'addon_discount', applies_to_categories: ['cat_combos'], conditions: 'Aplica con cualquier combo del menu.', active: true, discount_amount: 6000 },
  { id: 'promo_003', name: 'Domicilio gratis', description: 'En pedidos mayores a $80.000 el domicilio es gratis', type: 'free_delivery', applies_to_categories: [], conditions: 'Pedido minimo $80.000.', active: true, min_order: 80000 }
];

const TENANT_A_ZONES = [
  { id: 'zone_norte', name: 'Zona Norte', covered: true, extra_fee: 0 },
  { id: 'zone_centro', name: 'Centro', covered: true, extra_fee: 0 },
  { id: 'zone_sur', name: 'Zona Sur', covered: true, extra_fee: 2000 },
  { id: 'zone_occidente', name: 'Occidente', covered: true, extra_fee: 3000 },
  { id: 'zone_fuera', name: 'Fuera de cobertura', covered: false, extra_fee: 0 }
];

const TENANT_A_CUSTOMERS = [
  { id: 'cust_001', name: 'María González', phone: '3167890123', addresses: [{ id: 'addr_001', address: 'Calle 53 #14-28, Apto 502', zone_id: 'zone_norte', label: 'Casa' }], order_count: 5, last_order_date: '2026-08-25' },
  { id: 'cust_002', name: 'Roberto Sánchez', phone: '3134567890', addresses: [{ id: 'addr_002', address: 'Cra 68 #45-12', zone_id: 'zone_occidente', label: 'Casa' }], order_count: 2, last_order_date: '2026-08-20' }
];

// ── TENANT B: Wok & Roll ─────────────────────────────────────────────

const TENANT_B_ID = 'tenant_wokroll';

const TENANT_B_CONFIG = {
  id: 'rest_wokroll',
  name: 'Wok & Roll',
  agent_name: 'Carlos',
  personality: 'trendy_casual',
  tone: 'casual_cool',
  formality: 'tu',
  language: 'es-CO',
  currency: 'COP',
  greeting: 'Hola, soy {agent_name} de {business_name}. ¿Qué te antoja hoy?',
  farewell: 'Listo, tu pedido va en camino. ¡Que lo disfrutes!',
  business_hours: {
    monday:    { open: '11:00', close: '22:00' },
    tuesday:   { open: '11:00', close: '22:00' },
    wednesday: { open: '11:00', close: '22:00' },
    thursday:  { open: '11:00', close: '22:00' },
    friday:    { open: '11:00', close: '23:00' },
    saturday:  { open: '11:00', close: '23:00' },
    sunday:    { open: '12:00', close: '21:00' }
  },
  delivery: {
    available: true,
    base_fee: 6000,
    free_delivery_above: 70000,
    estimated_time_min: 25,
    estimated_time_max: 40,
    max_distance_km: 6
  },
  payment_methods: ['efectivo', 'nequi', 'daviplata'],
  policies: [
    'Pedido mínimo para domicilio: $25.000',
    'No hacemos cambios una vez el pedido entra en preparación',
    'Salsas adicionales: $2.000 c/u'
  ]
};

const TENANT_B_CATEGORIES = [
  { id: 'cat_wok',      name: 'Woks' },
  { id: 'cat_rolls',    name: 'Rolls' },
  { id: 'cat_entradas', name: 'Entradas' },
  { id: 'cat_drinks',   name: 'Bebidas' },
  { id: 'cat_combos',   name: 'Combos' }
];

const TENANT_B_PRODUCTS = [
  {
    id: 'prod_b001', name: 'Wok de Pollo Teriyaki', short_name: 'teriyaki',
    description: 'Pollo, vegetales salteados, arroz, salsa teriyaki',
    price: 25000, category_id: 'cat_wok', category_name: 'Woks', available: true,
    ingredients: ['pollo', 'arroz', 'zanahoria', 'brócoli', 'cebollín', 'salsa teriyaki'],
    available_modifiers: [
      { name: 'sin brócoli', type: 'remove', price_delta: 0 },
      { name: 'extra pollo', type: 'add', price_delta: 6000 },
      { name: 'cambiar arroz por fideos', type: 'substitute', price_delta: 0 }
    ],
    aliases: ['teriyaki', 'wok teriyaki', 'pollo teriyaki', 'wok de pollo']
  },
  {
    id: 'prod_b002', name: 'Wok de Res Thai', short_name: 'thai',
    description: 'Res, fideos, vegetales, salsa thai picante',
    price: 28000, category_id: 'cat_wok', category_name: 'Woks', available: true,
    ingredients: ['res', 'fideos', 'pimentón', 'cebolla', 'brotes de soya', 'salsa thai'],
    available_modifiers: [
      { name: 'sin picante', type: 'remove', price_delta: 0 },
      { name: 'extra res', type: 'add', price_delta: 7000 },
      { name: 'cambiar fideos por arroz', type: 'substitute', price_delta: 0 }
    ],
    aliases: ['thai', 'wok thai', 'res thai', 'wok de res']
  },
  {
    id: 'prod_b003', name: 'Wok Vegetariano', short_name: 'vegetariano',
    description: 'Tofu, vegetales mixtos, arroz jazmín, soya',
    price: 22000, category_id: 'cat_wok', category_name: 'Woks', available: true,
    ingredients: ['tofu', 'arroz jazmín', 'zanahoria', 'brócoli', 'champiñones', 'soya'],
    available_modifiers: [
      { name: 'sin tofu', type: 'remove', price_delta: 0 },
      { name: 'extra tofu', type: 'add', price_delta: 4000 }
    ],
    aliases: ['vegetariano', 'wok vegetariano', 'wok vegetal', 'wok vegano']
  },
  {
    id: 'prod_b004', name: 'Roll Salmón Clásico', short_name: 'salmón clásico',
    description: '8 piezas, salmón, queso crema, aguacate',
    price: 26000, category_id: 'cat_rolls', category_name: 'Rolls', available: true,
    ingredients: ['arroz', 'nori', 'salmón', 'queso crema', 'aguacate'],
    available_modifiers: [
      { name: 'sin queso crema', type: 'remove', price_delta: 0 },
      { name: 'doble salmón', type: 'add', price_delta: 8000 },
      { name: 'tempura', type: 'add', price_delta: 4000 }
    ],
    aliases: ['salmón', 'roll salmón', 'roll de salmón', 'salmón clásico']
  },
  {
    id: 'prod_b005', name: 'Roll Camarón Tempura', short_name: 'camarón tempura',
    description: '8 piezas, camarón tempura, aguacate, salsa anguila',
    price: 30000, category_id: 'cat_rolls', category_name: 'Rolls', available: true,
    ingredients: ['arroz', 'nori', 'camarón tempura', 'aguacate', 'salsa anguila'],
    available_modifiers: [
      { name: 'extra camarón', type: 'add', price_delta: 8000 },
      { name: 'sin aguacate', type: 'remove', price_delta: 0 }
    ],
    aliases: ['camarón', 'roll camarón', 'tempura', 'camarón tempura']
  },
  {
    id: 'prod_b006', name: 'Roll Veggie', short_name: 'veggie',
    description: '8 piezas, aguacate, pepino, zanahoria, queso crema',
    price: 20000, category_id: 'cat_rolls', category_name: 'Rolls', available: true,
    ingredients: ['arroz', 'nori', 'aguacate', 'pepino', 'zanahoria', 'queso crema'],
    available_modifiers: [
      { name: 'tempura', type: 'add', price_delta: 4000 }
    ],
    aliases: ['veggie', 'roll veggie', 'roll vegetariano', 'roll vegetal']
  },
  {
    id: 'prod_b007', name: 'Gyozas x6', short_name: 'gyozas',
    description: 'Empanaditas japonesas de cerdo, salsa ponzu',
    price: 16000, category_id: 'cat_entradas', category_name: 'Entradas', available: true,
    ingredients: ['masa', 'cerdo', 'cebollín', 'jengibre', 'salsa ponzu'],
    available_modifiers: [
      { name: 'de pollo', type: 'substitute', price_delta: 0 },
      { name: 'de vegetales', type: 'substitute', price_delta: 0 }
    ],
    aliases: ['gyozas', 'empanaditas', 'dumplings', 'gyoza']
  },
  {
    id: 'prod_b008', name: 'Edamames', short_name: 'edamames',
    description: 'Edamames con sal marina y limón',
    price: 12000, category_id: 'cat_entradas', category_name: 'Entradas', available: true,
    ingredients: ['edamames', 'sal marina', 'limón'],
    available_modifiers: [],
    aliases: ['edamames', 'edamame']
  },
  {
    id: 'prod_b009', name: 'Limonada de Maracuyá', short_name: 'limonada maracuyá',
    description: 'Limonada natural con maracuyá', price: 8000,
    category_id: 'cat_drinks', category_name: 'Bebidas', available: true,
    ingredients: ['limón', 'maracuyá', 'azúcar'], available_modifiers: [],
    aliases: ['limonada', 'maracuyá', 'limonada de maracuyá']
  },
  {
    id: 'prod_b010', name: 'Té Helado', short_name: 'té helado',
    description: 'Té verde, té negro o de durazno', price: 7000,
    category_id: 'cat_drinks', category_name: 'Bebidas', available: true,
    ingredients: [], available_modifiers: [],
    variants: ['verde', 'negro', 'durazno'],
    aliases: ['té', 'té helado', 'te helado', 'te', 'iced tea']
  },
  {
    id: 'prod_b011', name: 'Combo Wok + Roll', short_name: 'combo wok roll',
    description: 'Wok a elegir + Roll a elegir + Limonada',
    price: 48000, category_id: 'cat_combos', category_name: 'Combos', available: true,
    ingredients: [], includes: ['Wok (a elegir)', 'Roll (a elegir)', 'Limonada de Maracuyá'],
    available_modifiers: [],
    aliases: ['combo', 'combo wok', 'combo roll', 'el combo', 'combo wok roll']
  }
];

const TENANT_B_PROMOTIONS = [
  { id: 'promo_b001', name: 'Jueves de Rolls 2x1', description: 'Los jueves lleva 2 rolls y paga 1', type: 'bogo', applies_to_categories: ['cat_rolls'], conditions: 'Solo jueves. Rolls del mismo precio o menor.', active: true, valid_days: ['thursday'] },
  { id: 'promo_b002', name: 'Happy Hour', description: 'De 3pm a 5pm, las entradas a mitad de precio', type: 'time_discount', applies_to_categories: ['cat_entradas'], conditions: 'Lunes a viernes, 3pm-5pm.', active: true }
];

const TENANT_B_ZONES = [
  { id: 'zone_norte', name: 'Zona Norte', covered: true, extra_fee: 0 },
  { id: 'zone_centro', name: 'Centro', covered: true, extra_fee: 0 },
  { id: 'zone_chapinero', name: 'Chapinero', covered: true, extra_fee: 0 },
  { id: 'zone_fuera', name: 'Fuera de cobertura', covered: false, extra_fee: 0 }
];

const TENANT_B_CUSTOMERS = [
  { id: 'cust_b001', name: 'Camila Torres', phone: '3001234567', addresses: [{ id: 'addr_b001', address: 'Calle 85 #15-20, Apto 1201', zone_id: 'zone_norte', label: 'Casa' }], order_count: 8, last_order_date: '2026-08-28' },
  { id: 'cust_b002', name: 'Andrés Mejía', phone: '3159876543', addresses: [{ id: 'addr_b002', address: 'Cra 7 #67-10', zone_id: 'zone_chapinero', label: 'Oficina' }], order_count: 3, last_order_date: '2026-08-22' }
];

// ── INITIALIZATION ───────────────────────────────────────────────────

function _init() {
  // --- Tenant A ---
  _tenants.set(TENANT_A_ID, {
    id: TENANT_A_ID,
    name: 'Pizzería Don Mario',
    status: 'ACTIVE',
    created_at: '2026-08-01T00:00:00Z',
    plan: 'pro',
    contact_email: 'donmario@email.com',
    contact_phone: '3101234567'
  });

  _agents.set('agent_ana', {
    id: 'agent_ana',
    tenant_id: TENANT_A_ID,
    name: 'Ana',
    voice: 'shimmer',
    phone: '3209001001',
    status: AGENT_STATES.ACTIVE,
    config: TENANT_A_CONFIG
  });

  _phoneIndex.set('3209001001', { tenantId: TENANT_A_ID, agentId: 'agent_ana' });

  _tenantData.set(TENANT_A_ID, {
    config: TENANT_A_CONFIG,
    products: TENANT_A_PRODUCTS,
    categories: TENANT_A_CATEGORIES,
    promotions: TENANT_A_PROMOTIONS,
    zones: TENANT_A_ZONES,
    customers: [...TENANT_A_CUSTOMERS]
  });

  // --- Tenant B ---
  _tenants.set(TENANT_B_ID, {
    id: TENANT_B_ID,
    name: 'Wok & Roll',
    status: 'ACTIVE',
    created_at: '2026-08-15T00:00:00Z',
    plan: 'starter',
    contact_email: 'wokroll@email.com',
    contact_phone: '3207654321'
  });

  _agents.set('agent_carlos', {
    id: 'agent_carlos',
    tenant_id: TENANT_B_ID,
    name: 'Carlos',
    voice: 'echo',
    phone: '3209002002',
    status: AGENT_STATES.ACTIVE,
    config: TENANT_B_CONFIG
  });

  _phoneIndex.set('3209002002', { tenantId: TENANT_B_ID, agentId: 'agent_carlos' });

  _tenantData.set(TENANT_B_ID, {
    config: TENANT_B_CONFIG,
    products: TENANT_B_PRODUCTS,
    categories: TENANT_B_CATEGORIES,
    promotions: TENANT_B_PROMOTIONS,
    zones: TENANT_B_ZONES,
    customers: [...TENANT_B_CUSTOMERS]
  });

  // --- Users ---
  _users.set('user_7group_admin', {
    id: 'user_7group_admin',
    email: 'admin@7group.co',
    name: 'Admin 7Group',
    role: ROLES.SEVEN_GROUP_ADMIN,
    tenant_id: null    // sees all tenants
  });

  _users.set('user_donmario_owner', {
    id: 'user_donmario_owner',
    email: 'mario@donmario.com',
    name: 'Mario Gutiérrez',
    role: ROLES.CLIENT_ADMIN,
    tenant_id: TENANT_A_ID
  });

  _users.set('user_donmario_staff', {
    id: 'user_donmario_staff',
    email: 'cocina@donmario.com',
    name: 'Equipo Cocina Don Mario',
    role: ROLES.CLIENT_USER,
    tenant_id: TENANT_A_ID
  });

  _users.set('user_wokroll_owner', {
    id: 'user_wokroll_owner',
    email: 'admin@wokroll.com',
    name: 'Daniela Vargas',
    role: ROLES.CLIENT_ADMIN,
    tenant_id: TENANT_B_ID
  });

  _users.set('user_wokroll_staff', {
    id: 'user_wokroll_staff',
    email: 'cocina@wokroll.com',
    name: 'Equipo Cocina Wok & Roll',
    role: ROLES.CLIENT_USER,
    tenant_id: TENANT_B_ID
  });
}

// ── PUBLIC API ────────────────────────────────────────────────────────

/**
 * Get a tenant by ID
 */
export function getTenant(tenantId) {
  return _tenants.get(tenantId) || null;
}

/**
 * List all tenants (admin only)
 */
export function listTenants() {
  return [..._tenants.values()];
}

/**
 * Get an agent by ID
 */
export function getAgent(agentId) {
  return _agents.get(agentId) || null;
}

/**
 * List agents for a tenant
 */
export function listAgents(tenantId) {
  return [..._agents.values()].filter(a => a.tenant_id === tenantId);
}

/**
 * Get all data for a tenant (products, categories, etc.)
 * This is the key isolation function.
 */
export function getTenantData(tenantId) {
  const data = _tenantData.get(tenantId);
  if (!data) return null;
  return data;
}

/**
 * Get restaurant config for a tenant
 */
export function getTenantConfig(tenantId) {
  const data = _tenantData.get(tenantId);
  if (!data) return null;
  return data.config;
}

/**
 * Resolve a phone number to tenant + agent
 */
export function resolvePhone(phone) {
  const normalized = (phone || '').replace(/\D/g, '').slice(-10);
  return _phoneIndex.get(normalized) || null;
}

/**
 * Get user by ID
 */
export function getUser(userId) {
  return _users.get(userId) || null;
}

/**
 * Get user by email
 */
export function getUserByEmail(email) {
  for (const [, user] of _users) {
    if (user.email === email) return user;
  }
  return null;
}

/**
 * List users for a tenant
 */
export function listUsers(tenantId) {
  return [..._users.values()].filter(u =>
    u.tenant_id === tenantId || u.role === ROLES.SEVEN_GROUP_ADMIN
  );
}

/**
 * Check if a user can access a tenant's data
 */
export function canAccess(userId, tenantId) {
  const user = _users.get(userId);
  if (!user) return false;
  if (user.role === ROLES.SEVEN_GROUP_ADMIN) return true;
  return user.tenant_id === tenantId;
}

/**
 * Get permissions for a role
 */
export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || {};
}

/**
 * Get agent status
 */
export function getAgentStatus(agentId) {
  const agent = _agents.get(agentId);
  if (!agent) return null;
  return agent.status;
}

/**
 * Set agent status
 */
export function setAgentStatus(agentId, status) {
  const agent = _agents.get(agentId);
  if (!agent) return { error: 'AGENT_NOT_FOUND' };
  if (!Object.values(AGENT_STATES).includes(status)) return { error: 'INVALID_STATUS' };
  agent.status = status;
  return { success: true, agent_id: agentId, status };
}

/**
 * Check if agent can operate (active + tenant active)
 */
export function canAgentOperate(agentId) {
  const agent = _agents.get(agentId);
  if (!agent) return { canOperate: false, reason: 'AGENT_NOT_FOUND' };
  if (agent.status !== AGENT_STATES.ACTIVE) return { canOperate: false, reason: 'AGENT_' + agent.status };

  const tenant = _tenants.get(agent.tenant_id);
  if (!tenant) return { canOperate: false, reason: 'TENANT_NOT_FOUND' };
  if (tenant.status !== 'ACTIVE') return { canOperate: false, reason: 'TENANT_' + tenant.status };

  return { canOperate: true, tenantId: agent.tenant_id, agentId };
}

/**
 * Create a new tenant (for onboarding)
 */
export function createTenant({ id, name, contact_email, contact_phone, config, products, categories, promotions, zones }) {
  if (_tenants.has(id)) return { error: 'TENANT_EXISTS' };

  _tenants.set(id, {
    id,
    name,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    plan: 'starter',
    contact_email: contact_email || null,
    contact_phone: contact_phone || null
  });

  _tenantData.set(id, {
    config: config || {},
    products: products || [],
    categories: categories || [],
    promotions: promotions || [],
    zones: zones || [],
    customers: []
  });

  return { success: true, tenant_id: id };
}

/**
 * Create an agent for a tenant
 */
export function createAgent({ id, tenant_id, name, voice, phone, config }) {
  if (!_tenants.has(tenant_id)) return { error: 'TENANT_NOT_FOUND' };
  if (_agents.has(id)) return { error: 'AGENT_EXISTS' };

  const agent = {
    id,
    tenant_id,
    name: name || 'Agente',
    voice: voice || 'shimmer',
    phone: phone || null,
    status: AGENT_STATES.INACTIVE,
    config: config || getTenantConfig(tenant_id)
  };

  _agents.set(id, agent);

  if (phone) {
    const normalized = phone.replace(/\D/g, '').slice(-10);
    _phoneIndex.set(normalized, { tenantId: tenant_id, agentId: id });
  }

  return { success: true, agent_id: id };
}

/**
 * Get the default tenant ID (for backward compatibility)
 */
export function getDefaultTenantId() {
  return TENANT_A_ID;
}

/**
 * Get the default agent ID for a tenant
 */
export function getDefaultAgentId(tenantId) {
  const agents = listAgents(tenantId);
  if (agents.length === 0) return null;
  const active = agents.find(a => a.status === AGENT_STATES.ACTIVE);
  return active ? active.id : agents[0].id;
}

/**
 * Reset registry (for testing)
 */
export function _resetRegistry() {
  _tenants.clear();
  _agents.clear();
  _users.clear();
  _phoneIndex.clear();
  _tenantData.clear();
  _init();
}

// ── BOOT ─────────────────────────────────────────────────────────────

_init();
