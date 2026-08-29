/**
 * MOCK DATA — Datos del restaurante para pruebas
 *
 * Este archivo NO es el backend. Es la fuente de datos que el mock-tools.js
 * lee para simular respuestas del backend futuro.
 *
 * En producción, estos datos vienen de Supabase/PostgreSQL via API REST.
 * El motor conversacional NUNCA importa este archivo directamente.
 */

export const RESTAURANT_CONFIG = {
  id: 'rest_demo_001',
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

export const CATEGORIES = [
  { id: 'cat_pizza',    name: 'Pizzas' },
  { id: 'cat_burger',   name: 'Hamburguesas' },
  { id: 'cat_sides',    name: 'Acompañantes' },
  { id: 'cat_drinks',   name: 'Bebidas' },
  { id: 'cat_combos',   name: 'Combos' }
];

export const PRODUCTS = [
  {
    id: 'prod_001',
    name: 'Pizza Pepperoni Grande',
    short_name: 'pepperoni',
    description: 'Masa artesanal, pepperoni premium, queso mozzarella',
    price: 32000,
    category_id: 'cat_pizza',
    category_name: 'Pizzas',
    available: true,
    ingredients: ['masa artesanal', 'salsa de tomate', 'queso mozzarella', 'pepperoni'],
    available_modifiers: [
      { name: 'sin cebolla', type: 'remove', price_delta: 0 },
      { name: 'extra queso', type: 'add', price_delta: 4000 },
      { name: 'borde relleno', type: 'add', price_delta: 6000 }
    ],
    aliases: ['pepperoni', 'peperoni', 'la de pepperoni', 'pizza pepperoni']
  },
  {
    id: 'prod_002',
    name: 'Pizza Hawaiana Grande',
    short_name: 'hawaiana',
    description: 'Jamón, piña, queso mozzarella',
    price: 30000,
    category_id: 'cat_pizza',
    category_name: 'Pizzas',
    available: true,
    ingredients: ['masa artesanal', 'salsa de tomate', 'queso mozzarella', 'jamón', 'piña'],
    available_modifiers: [
      { name: 'sin piña', type: 'remove', price_delta: 0 },
      { name: 'extra queso', type: 'add', price_delta: 4000 },
      { name: 'doble jamón', type: 'add', price_delta: 5000 }
    ],
    aliases: ['hawaiana', 'la hawaiana', 'pizza hawaiana']
  },
  {
    id: 'prod_003',
    name: 'Pizza Margarita',
    short_name: 'margarita',
    description: 'Tomate fresco, albahaca, mozzarella de búfala',
    price: 28000,
    category_id: 'cat_pizza',
    category_name: 'Pizzas',
    available: true,
    ingredients: ['masa artesanal', 'tomate fresco', 'albahaca', 'mozzarella de búfala'],
    available_modifiers: [
      { name: 'extra queso', type: 'add', price_delta: 4000 }
    ],
    aliases: ['margarita', 'la margarita', 'pizza margarita']
  },
  {
    id: 'prod_004',
    name: 'Hamburguesa Clásica',
    short_name: 'clásica',
    description: 'Carne 200g, lechuga, tomate, cebolla, salsa especial',
    price: 22000,
    category_id: 'cat_burger',
    category_name: 'Hamburguesas',
    available: true,
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
    id: 'prod_005',
    name: 'Hamburguesa Doble Queso',
    short_name: 'doble queso',
    description: 'Doble carne 400g, doble queso cheddar, tocineta',
    price: 32000,
    category_id: 'cat_burger',
    category_name: 'Hamburguesas',
    available: true,
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
    id: 'prod_006',
    name: 'Hamburguesa BBQ',
    short_name: 'BBQ',
    description: 'Carne 200g, tocineta, cebolla caramelizada, salsa BBQ',
    price: 26000,
    category_id: 'cat_burger',
    category_name: 'Hamburguesas',
    available: false,
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
    id: 'prod_007',
    name: 'Papas Grandes',
    short_name: 'papas',
    description: 'Papas a la francesa porción grande',
    price: 10000,
    category_id: 'cat_sides',
    category_name: 'Acompañantes',
    available: true,
    ingredients: ['papas', 'sal'],
    available_modifiers: [
      { name: 'con queso', type: 'add', price_delta: 3000 },
      { name: 'con tocineta', type: 'add', price_delta: 4000 }
    ],
    aliases: ['papas', 'papas grandes', 'papas fritas', 'unas papas', 'papitas']
  },
  {
    id: 'prod_008',
    name: 'Aros de Cebolla',
    short_name: 'aros',
    description: '8 aros de cebolla crujientes',
    price: 12000,
    category_id: 'cat_sides',
    category_name: 'Acompañantes',
    available: true,
    ingredients: ['cebolla', 'masa crujiente'],
    available_modifiers: [],
    aliases: ['aros', 'aros de cebolla', 'aritos', 'onion rings']
  },
  {
    id: 'prod_009',
    name: 'Gaseosa 400ml',
    short_name: 'gaseosa',
    description: 'Coca-Cola, Sprite o Colombiana',
    price: 4000,
    category_id: 'cat_drinks',
    category_name: 'Bebidas',
    available: true,
    ingredients: [],
    available_modifiers: [],
    variants: ['Coca-Cola', 'Sprite', 'Colombiana'],
    aliases: ['gaseosa', 'coca', 'coca cola', 'sprite', 'colombiana', 'soda', 'refresco']
  },
  {
    id: 'prod_010',
    name: 'Malteada',
    short_name: 'malteada',
    description: 'Chocolate, vainilla o fresa',
    price: 14000,
    category_id: 'cat_drinks',
    category_name: 'Bebidas',
    available: true,
    ingredients: ['leche', 'helado'],
    available_modifiers: [],
    variants: ['chocolate', 'vainilla', 'fresa'],
    aliases: ['malteada', 'milkshake', 'batido']
  },
  {
    id: 'prod_011',
    name: 'Combo Personal',
    short_name: 'combo personal',
    description: 'Hamburguesa clásica + papas + gaseosa',
    price: 32000,
    category_id: 'cat_combos',
    category_name: 'Combos',
    available: true,
    ingredients: [],
    includes: ['Hamburguesa Clásica', 'Papas Grandes', 'Gaseosa 400ml'],
    available_modifiers: [
      { name: 'cambiar hamburguesa por BBQ', type: 'substitute', price_delta: 4000 },
      { name: 'cambiar hamburguesa por doble queso', type: 'substitute', price_delta: 10000 }
    ],
    aliases: ['combo personal', 'combo', 'el combo', 'combo hamburguesa', 'combo sencillo', 'el combo personal']
  },
  {
    id: 'prod_012',
    name: 'Combo Familiar Pizza',
    short_name: 'combo familiar',
    description: 'Pizza grande + papas x2 + gaseosa 1.5L',
    price: 52000,
    category_id: 'cat_combos',
    category_name: 'Combos',
    available: true,
    ingredients: [],
    includes: ['Pizza grande (a elegir)', 'Papas Grandes x2', 'Gaseosa 1.5L'],
    available_modifiers: [],
    aliases: ['combo familiar', 'familiar', 'combo familia', 'el familiar', 'combo de pizza', 'combo grande', 'combo para compartir']
  }
];

export const PROMOTIONS = [
  {
    id: 'promo_001',
    name: '2x1 en Pizzas los Martes',
    description: 'Todos los martes lleva 2 pizzas grandes y paga solo 1',
    type: 'bogo',
    applies_to_categories: ['cat_pizza'],
    conditions: 'Solo martes. Pizzas del mismo valor o menor.',
    active: true,
    valid_days: ['tuesday']
  },
  {
    id: 'promo_002',
    name: 'Combo + Malteada',
    description: 'Agrega una malteada a cualquier combo por solo $8.000 adicionales',
    type: 'addon_discount',
    applies_to_categories: ['cat_combos'],
    conditions: 'Aplica con cualquier combo del menu.',
    active: true,
    discount_amount: 6000
  },
  {
    id: 'promo_003',
    name: 'Domicilio gratis',
    description: 'En pedidos mayores a $80.000 el domicilio es gratis',
    type: 'free_delivery',
    applies_to_categories: [],
    conditions: 'Pedido minimo $80.000.',
    active: true,
    min_order: 80000
  }
];

export const DELIVERY_ZONES = [
  { id: 'zone_norte', name: 'Zona Norte', covered: true, extra_fee: 0 },
  { id: 'zone_centro', name: 'Centro', covered: true, extra_fee: 0 },
  { id: 'zone_sur', name: 'Zona Sur', covered: true, extra_fee: 2000 },
  { id: 'zone_occidente', name: 'Occidente', covered: true, extra_fee: 3000 },
  { id: 'zone_fuera', name: 'Fuera de cobertura', covered: false, extra_fee: 0 }
];

export const CUSTOMERS = [
  {
    id: 'cust_001',
    name: 'María González',
    phone: '3167890123',
    addresses: [
      { id: 'addr_001', address: 'Calle 53 #14-28, Apto 502', zone_id: 'zone_norte', label: 'Casa' }
    ],
    order_count: 5,
    last_order_date: '2026-08-25'
  },
  {
    id: 'cust_002',
    name: 'Roberto Sánchez',
    phone: '3134567890',
    addresses: [
      { id: 'addr_002', address: 'Cra 68 #45-12', zone_id: 'zone_occidente', label: 'Casa' }
    ],
    order_count: 2,
    last_order_date: '2026-08-20'
  }
];
