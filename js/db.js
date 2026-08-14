// db.js - IndexedDB wrapper for the expense tracker
// Stores: categories, accounts, recipients, transactions
// Each list item: { id, name, order, isDefault }
// Transaction: { id, type, amount, categoryId, recipientIds[], accountId,
//                merchant, itemName, note, date, updatedAt, deviceId, isDeleted }

const DB_NAME = 'expenseTrackerDB';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('recipients')) {
        db.createObjectStore('recipients', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('date', 'date');
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return promisifyRequest(store.getAll());
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return promisifyRequest(store.get(id));
  },
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return promisifyRequest(store.put(value));
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return promisifyRequest(store.delete(id));
  },
  uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
  deviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = DB.uuid();
      localStorage.setItem('deviceId', id);
    }
    return id;
  },
  async seedDefaults() {
    let categories = await DB.getAll('categories');
    const accounts = await DB.getAll('accounts');
    const recipients = await DB.getAll('recipients');

    // Migration: older records may not have a `type` field yet — treat them as expense.
    for (const cat of categories) {
      if (cat.type !== 'expense' && cat.type !== 'income') {
        cat.type = 'expense';
        await DB.put('categories', cat);
      }
    }

    if (categories.length === 0) {
      const defaults = ['餐飲', '交通', '購物', '居家', '娛樂', '其他'];
      for (let i = 0; i < defaults.length; i++) {
        await DB.put('categories', { id: DB.uuid(), name: defaults[i], order: i, type: 'expense', isDefault: false });
      }
    }
    const hasIncomeCategory = categories.some((c) => c.type === 'income');
    if (!hasIncomeCategory) {
      const incomeDefaults = ['薪資', '退款', '其他收入'];
      for (let i = 0; i < incomeDefaults.length; i++) {
        await DB.put('categories', { id: DB.uuid(), name: incomeDefaults[i], order: i, type: 'income', isDefault: false });
      }
    }

    if (accounts.length === 0) {
      await DB.put('accounts', { id: DB.uuid(), name: '現金', order: 0, isDefault: true });
    }
    if (recipients.length === 0) {
      await DB.put('recipients', { id: DB.uuid(), name: '全家', order: 0, isDefault: true });
    }
  },
};

window.DB = DB;
