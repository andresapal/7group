// ============================================================
// 7Group Logistics -- Google Sheets Backend
// Apps Script API + localStorage cache for speed
// Sheet: 7Group Logistics DB
// ============================================================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyixJTQxqegAxF-XYpOe2Xn3M27ef7oxV55oraU5ffZTBxDr92MTYSiskRhl5mPwQWL/exec';

const SHEET_NAMES = {
  inventory: 'Inventario',
  receiving: 'Recepciones',
  orders: 'Pedidos',
  dispatches: 'Despachos',
  activity: 'Actividad'
};

// ============================================================
// SheetsAPI -- low-level fetch wrapper
// ============================================================
const SheetsAPI = {
  async post(data) {
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.warn('[7G] Sheets write failed, using local cache:', e.message);
      return { error: e.message, offline: true };
    }
  },

  async get(sheet, filters) {
    try {
      let url = APPS_SCRIPT_URL + '?sheet=' + encodeURIComponent(sheet);
      if (filters && filters.key) url += '&key=' + encodeURIComponent(filters.key) + '&value=' + encodeURIComponent(filters.value);
      const res = await fetch(url);
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.warn('[7G] Sheets read failed, using local cache:', e.message);
      return null;
    }
  }
};

// ============================================================
// LocalCache -- localStorage fallback + speed layer
// ============================================================
const LocalCache = {
  get(name) {
    try { return JSON.parse(localStorage.getItem('7g_' + name) || '[]'); }
    catch { return []; }
  },
  set(name, data) {
    localStorage.setItem('7g_' + name, JSON.stringify(data));
    this._notify(name);
  },
  _listeners: {},
  _notify(name) {
    if (this._listeners[name]) {
      const data = this.get(name);
      this._listeners[name].forEach(cb => cb(data));
    }
  },
  listen(name, cb) {
    if (!this._listeners[name]) this._listeners[name] = [];
    this._listeners[name].push(cb);
    cb(this.get(name));
    return () => { this._listeners[name] = this._listeners[name].filter(c => c !== cb); };
  },
  genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }
};

// ============================================================
// DB -- shared API used by all 5 modules
// Writes to both Sheets (persistent) and localStorage (speed)
// ============================================================
const DB = {

  // --- Receiving ---
  async createReceiving(data) {
    const id = LocalCache.genId();
    const now = new Date().toISOString();
    const record = {
      id, ...data,
      status: data.status || 'pending',
      items: data.items || [],
      createdAt: now
    };

    const col = LocalCache.get('receiving');
    col.unshift(record);
    LocalCache.set('receiving', col);

    await SheetsAPI.post({
      action: 'append',
      sheet: SHEET_NAMES.receiving,
      row: {
        id,
        poNumber: data.poNumber || '',
        blNumber: data.blNumber || '',
        supplier: data.supplier || '',
        container: data.container || '',
        totalUnits: data.totalUnits || 0,
        totalValue: data.totalValue || 0,
        status: data.status || 'completed',
        items: data.items || [],
        documentsUploaded: data.documentsUploaded || 0,
        createdAt: now
      }
    });

    await DB.logActivity('receiving', 'create', id, data.poNumber || id);
    return { id };
  },

  async updateReceiving(id, data) {
    const col = LocalCache.get('receiving');
    const idx = col.findIndex(r => r.id === id);
    if (idx !== -1) {
      col[idx] = { ...col[idx], ...data, updatedAt: new Date().toISOString() };
      LocalCache.set('receiving', col);
    }
    await SheetsAPI.post({
      action: 'update',
      sheet: SHEET_NAMES.receiving,
      key: 'id', keyValue: id,
      row: { ...data, updatedAt: new Date().toISOString() }
    });
    await DB.logActivity('receiving', 'update', id, data.status || 'updated');
  },

  async getReceivings(filters = {}) {
    const remote = await SheetsAPI.get(SHEET_NAMES.receiving);
    if (remote) {
      LocalCache.set('receiving', remote);
      let data = remote;
      if (filters.status) data = data.filter(r => r.status === filters.status);
      if (filters.limit) data = data.slice(0, filters.limit);
      return data;
    }
    let data = LocalCache.get('receiving');
    if (filters.status) data = data.filter(r => r.status === filters.status);
    if (filters.limit) data = data.slice(0, filters.limit);
    return data;
  },

  onReceivingsChange(callback) {
    return LocalCache.listen('receiving', callback);
  },

  // --- Inventory ---
  async upsertInventoryItem(sku, data) {
    const col = LocalCache.get('inventory');
    const idx = col.findIndex(r => r.sku === sku);
    const cleanData = { ...data };
    const addQty = cleanData.quantityAdd || 0;
    delete cleanData.quantityAdd;
    const now = new Date().toISOString();

    let finalQty;
    if (idx !== -1) {
      finalQty = (col[idx].quantity || 0) + addQty;
      col[idx] = { ...col[idx], ...cleanData, quantity: finalQty, updatedAt: now };
    } else {
      finalQty = addQty || cleanData.quantity || 0;
      col.push({ sku, ...cleanData, quantity: finalQty, createdAt: now, updatedAt: now });
    }
    col.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
    LocalCache.set('inventory', col);

    await SheetsAPI.post({
      action: 'upsert',
      sheet: SHEET_NAMES.inventory,
      key: 'sku', keyValue: sku,
      row: {
        sku,
        name: data.name || '',
        quantity: finalQty,
        unitCost: data.unitCost || 0,
        location: data.location || '',
        lot: data.lot || '',
        expiry: data.expiry || '',
        poNumber: data.poNumber || '',
        weight: data.weight || 0,
        hsCode: data.hsCode || '',
        minStock: data.minStock || 0,
        updatedAt: now
      }
    });

    await DB.logActivity('inventory', idx !== -1 ? 'update' : 'create', sku, data.name || sku);
  },

  async getInventory() {
    const remote = await SheetsAPI.get(SHEET_NAMES.inventory);
    if (remote) {
      LocalCache.set('inventory', remote);
      return remote;
    }
    return LocalCache.get('inventory');
  },

  onInventoryChange(callback) {
    return LocalCache.listen('inventory', callback);
  },

  // --- Orders ---
  async createOrder(data) {
    const meta = JSON.parse(localStorage.getItem('7g_meta') || '{"lastOrder":0}');
    meta.lastOrder = (meta.lastOrder || 0) + 1;
    localStorage.setItem('7g_meta', JSON.stringify(meta));
    const orderId = 'ORD-' + String(meta.lastOrder).padStart(4, '0');
    const now = new Date().toISOString();

    const record = {
      id: orderId, orderId, ...data,
      status: 'pending',
      createdAt: now, updatedAt: now
    };
    const col = LocalCache.get('orders');
    col.unshift(record);
    LocalCache.set('orders', col);

    await SheetsAPI.post({
      action: 'append',
      sheet: SHEET_NAMES.orders,
      row: {
        orderId,
        client: data.client || '',
        destination: data.destination || '',
        items: data.items || [],
        totalUnits: data.totalUnits || 0,
        totalValue: data.totalValue || 0,
        status: 'pending',
        carrier: data.carrier || '',
        createdAt: now,
        updatedAt: now
      }
    });

    await DB.logActivity('orders', 'create', orderId, (data.client || 'Order') + ' - ' + (data.items ? data.items.length : 0) + ' items');
    return orderId;
  },

  async updateOrder(id, data) {
    const col = LocalCache.get('orders');
    const idx = col.findIndex(r => r.id === id || r.orderId === id);
    const now = new Date().toISOString();
    if (idx !== -1) {
      col[idx] = { ...col[idx], ...data, updatedAt: now };
      LocalCache.set('orders', col);
    }
    await SheetsAPI.post({
      action: 'update',
      sheet: SHEET_NAMES.orders,
      key: 'orderId', keyValue: id,
      row: { ...data, updatedAt: now }
    });
    await DB.logActivity('orders', 'update', id, data.status || 'updated');
  },

  async getOrders(filters = {}) {
    const remote = await SheetsAPI.get(SHEET_NAMES.orders);
    if (remote) {
      LocalCache.set('orders', remote);
      let data = remote;
      if (filters.status) data = data.filter(r => r.status === filters.status);
      if (filters.limit) data = data.slice(0, filters.limit);
      return data;
    }
    let data = LocalCache.get('orders');
    if (filters.status) data = data.filter(r => r.status === filters.status);
    if (filters.limit) data = data.slice(0, filters.limit);
    return data;
  },

  onOrdersChange(callback) {
    return LocalCache.listen('orders', callback);
  },

  // --- Dispatches ---
  async createDispatch(data) {
    const col = LocalCache.get('dispatches');
    const id = 'SHP-' + String(7900 + col.length).padStart(4, '0');
    const now = new Date().toISOString();

    const record = { id, ...data, status: 'pickup', createdAt: now, updatedAt: now };
    col.unshift(record);
    LocalCache.set('dispatches', col);

    await SheetsAPI.post({
      action: 'append',
      sheet: SHEET_NAMES.dispatches,
      row: {
        shipmentId: id,
        orderId: data.orderId || '',
        carrier: data.carrier || '',
        destination: data.destination || '',
        origin: data.origin || 'Miami Warehouse',
        weight: data.weight || 0,
        cost: data.cost || 0,
        status: 'pickup',
        tracking: data.tracking || '',
        createdAt: now,
        updatedAt: now
      }
    });

    if (data.orderId) {
      await DB.updateOrder(data.orderId, { status: 'dispatched', dispatchId: id });
    }
    await DB.logActivity('dispatches', 'create', id, (data.carrier || '') + ' > ' + (data.destination || ''));
    return { id };
  },

  async updateDispatch(id, data) {
    const col = LocalCache.get('dispatches');
    const idx = col.findIndex(r => r.id === id);
    const now = new Date().toISOString();
    if (idx !== -1) {
      col[idx] = { ...col[idx], ...data, updatedAt: now };
      LocalCache.set('dispatches', col);
    }
    await SheetsAPI.post({
      action: 'update',
      sheet: SHEET_NAMES.dispatches,
      key: 'shipmentId', keyValue: id,
      row: { ...data, updatedAt: now }
    });
    await DB.logActivity('dispatches', 'update', id, data.status || 'updated');
  },

  async getDispatches(filters = {}) {
    const remote = await SheetsAPI.get(SHEET_NAMES.dispatches);
    if (remote) {
      LocalCache.set('dispatches', remote);
      let data = remote;
      if (filters.status) data = data.filter(r => r.status === filters.status);
      return data;
    }
    let data = LocalCache.get('dispatches');
    if (filters.status) data = data.filter(r => r.status === filters.status);
    return data;
  },

  onDispatchesChange(callback) {
    return LocalCache.listen('dispatches', callback);
  },

  // --- Documents ---
  async saveDocument(data) {
    const id = LocalCache.genId();
    const col = LocalCache.get('documents');
    col.unshift({ id, ...data, uploadedAt: new Date().toISOString() });
    LocalCache.set('documents', col);
    return { id };
  },

  // --- Activity Log ---
  async logActivity(module, action, refId, description) {
    const now = new Date().toISOString();
    const col = LocalCache.get('activity');
    col.unshift({ id: LocalCache.genId(), module, action, refId, description, timestamp: now });
    if (col.length > 100) col.length = 100;
    LocalCache.set('activity', col);

    SheetsAPI.post({
      action: 'append',
      sheet: SHEET_NAMES.activity,
      row: { module, action, refId, description, timestamp: now }
    });
  },

  onActivityChange(callback, limit = 20) {
    return LocalCache.listen('activity', (data) => callback(data.slice(0, limit)));
  },

  // --- Dashboard ---
  async getDashboardStats() {
    const inv = LocalCache.get('inventory');
    const orders = LocalCache.get('orders');
    const dispatches = LocalCache.get('dispatches');
    const receiving = LocalCache.get('receiving');

    let totalStock = 0, lowStock = 0, outOfStock = 0;
    inv.forEach(item => {
      const q = item.quantity || 0;
      totalStock += q;
      if (q === 0) outOfStock++;
      else if (q <= (item.minStock || 10)) lowStock++;
    });

    return {
      totalSKUs: inv.length, totalStock, lowStock, outOfStock,
      totalOrders: orders.length,
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      totalDispatches: dispatches.length,
      activeDispatches: dispatches.filter(d => ['pickup','in_transit','out_for_delivery'].includes(d.status)).length,
      totalReceivings: receiving.length,
      pendingReceivings: receiving.filter(r => r.status === 'pending').length
    };
  },

  // --- Sync from Sheets (pull remote into local) ---
  async syncFromSheets() {
    const collections = ['inventory', 'receiving', 'orders', 'dispatches'];
    const sheetKeys = ['inventory', 'receiving', 'orders', 'dispatches'];
    for (let i = 0; i < collections.length; i++) {
      const remote = await SheetsAPI.get(SHEET_NAMES[sheetKeys[i]]);
      if (remote && remote.length > 0) {
        LocalCache.set(collections[i], remote);
      }
    }
    console.log('[7G] Synced from Sheets');
  },

  // --- Reset ---
  async resetAll() {
    ['receiving','inventory','orders','dispatches','documents','activity'].forEach(c => {
      localStorage.removeItem('7g_' + c);
    });
    localStorage.removeItem('7g_meta');
    Object.keys(LocalCache._listeners).forEach(k => LocalCache._notify(k));
  }
};

// Cross-tab sync
window.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('7g_')) {
    LocalCache._notify(e.key.replace('7g_', ''));
  }
});

console.log('[7G] Sheets backend loaded. API:', APPS_SCRIPT_URL.substring(0, 60) + '...');
