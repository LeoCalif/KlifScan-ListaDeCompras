const DB_NAME = 'BarcodeShoppingListDB';
const DB_VERSION = 2;

let dbInstance = null;

export function getDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Products store (barcode is key)
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'barcode' });
        productStore.createIndex('name', 'name', { unique: false });
        productStore.createIndex('category', 'category', { unique: false });
      }

      // Shopping lists store (id is autoIncrement or custom timestamp)
      if (!db.objectStoreNames.contains('shoppingLists')) {
        db.createObjectStore('shoppingLists', { keyPath: 'id' });
      }

      // Settings store (key is key)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Stock store (barcode is key)
      if (!db.objectStoreNames.contains('stock')) {
        const stockStore = db.createObjectStore('stock', { keyPath: 'barcode' });
        stockStore.createIndex('name', 'name', { unique: false });
        stockStore.createIndex('category', 'category', { unique: false });
      }
    };
  });
}

// --- PRODUCT OPERATIONS ---

export async function getProduct(barcode) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readonly');
    const store = transaction.objectStore('products');
    const request = store.get(barcode);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProduct(product) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readwrite');
    const store = transaction.objectStore('products');
    
    // Ensure structure
    const updatedProduct = {
      barcode: String(product.barcode),
      name: product.name || 'Produto Sem Nome',
      brand: product.brand || '',
      category: product.category || 'Outros',
      image: product.image || '',
      price: typeof product.price === 'number' ? product.price : 0,
      source: product.source || 'Manual',
      lastUpdated: Date.now()
    };

    const request = store.put(updatedProduct);

    request.onsuccess = () => resolve(updatedProduct);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllProducts() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readonly');
    const store = transaction.objectStore('products');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteProduct(barcode) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readwrite');
    const store = transaction.objectStore('products');
    const request = store.delete(barcode);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// --- SHOPPING LIST OPERATIONS ---

export async function getShoppingList(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('shoppingLists', 'readonly');
    const store = transaction.objectStore('shoppingLists');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveShoppingList(list) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('shoppingLists', 'readwrite');
    const store = transaction.objectStore('shoppingLists');
    
    const request = store.put(list);

    request.onsuccess = () => resolve(list);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteShoppingList(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('shoppingLists', 'readwrite');
    const store = transaction.objectStore('shoppingLists');
    const request = store.delete(id);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllShoppingLists() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('shoppingLists', 'readonly');
    const store = transaction.objectStore('shoppingLists');
    const request = store.getAll();

    request.onsuccess = () => {
      // Sort lists by date descending (newest first)
      const lists = request.result || [];
      lists.sort((a, b) => b.id - a.id);
      resolve(lists);
    };
    request.onerror = () => reject(request.error);
  });
}

// --- SETTINGS OPERATIONS ---

export async function getSetting(key, defaultValue = null) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : defaultValue);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function setSetting(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.put({ key, value });

    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

// --- STOCK OPERATIONS ---

export async function getStockItem(barcode) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('stock', 'readonly');
    const store = transaction.objectStore('stock');
    const request = store.get(barcode);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStockItem(item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('stock', 'readwrite');
    const store = transaction.objectStore('stock');
    
    const updatedItem = {
      barcode: String(item.barcode),
      name: item.name || 'Produto Sem Nome',
      brand: item.brand || '',
      category: item.category || 'Outros',
      image: item.image || '',
      quantity: typeof item.quantity === 'number' ? item.quantity : 0,
      lastUpdated: Date.now()
    };

    const request = store.put(updatedItem);

    request.onsuccess = () => resolve(updatedItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllStockItems() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('stock', 'readonly');
    const store = transaction.objectStore('stock');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteStockItem(barcode) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('stock', 'readwrite');
    const store = transaction.objectStore('stock');
    const request = store.delete(barcode);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllProducts() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readwrite');
    const store = transaction.objectStore('products');
    const request = store.clear();

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
