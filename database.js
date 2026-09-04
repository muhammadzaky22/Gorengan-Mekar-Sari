(() => {
  const cfg = window.FIREBASE_CONFIG || {};
  const valid =
    typeof cfg.apiKey === "string" &&
    typeof cfg.authDomain === "string" &&
    typeof cfg.databaseURL === "string" &&
    typeof cfg.adminUid === "string" &&
    cfg.databaseURL.startsWith("https://") &&
    window.firebase;

  let auth = null;
  let database = null;

  if (valid) {
    try {
      const app = window.firebase.apps?.length
        ? window.firebase.app()
        : window.firebase.initializeApp(cfg);
      auth = window.firebase.auth(app);
      database = window.firebase.database(app);
    } catch (error) {
      console.warn("Firebase tidak dapat diinisialisasi.", error);
    }
  }

  const INITIAL_PRODUCTS = {
    pisang: { id: "pisang", name: "Pisang Goreng", description: "Manis, lembut di dalam, renyah di luar.", category: "Gorengan manis", price: 2000, is_available: true, badge: "Best Seller", sort_order: 1 },
    singkong: { id: "singkong", name: "Singkong Goreng", description: "Gurih, empuk, dan cocok untuk teman ngopi.", category: "Gorengan", price: 2000, is_available: true, badge: "Favorit", sort_order: 2 },
    tempe: { id: "tempe", name: "Tempe Goreng", description: "Tempe goreng gurih dan renyah.", category: "Gorengan", price: 1000, is_available: true, badge: "", sort_order: 3 },
    tahu: { id: "tahu", name: "Tahu Goreng", description: "Tahu goreng hangat yang gurih.", category: "Gorengan", price: 1000, is_available: true, badge: "", sort_order: 4 },
    bakwan: { id: "bakwan", name: "Bakwan Sayur", description: "Bakwan sayur renyah dan hangat.", category: "Gorengan", price: 2000, is_available: true, badge: "Best Seller", sort_order: 5 },
    ubi: { id: "ubi", name: "Ubi Goreng", description: "Ubi goreng manis dan lembut.", category: "Gorengan manis", price: 2000, is_available: true, badge: "", sort_order: 6 },
    risoles: { id: "risoles", name: "Risoles", description: "Risoles gurih dengan isian lezat.", category: "Gorengan", price: 2500, is_available: true, badge: "Baru", sort_order: 7 },
    tahuisi: { id: "tahuisi", name: "Tahu Isi", description: "Tahu isi hangat dengan rasa gurih.", category: "Gorengan", price: 2500, is_available: true, badge: "", sort_order: 8 },
    paketkomplit: { id: "paketkomplit", name: "Paket Hemat Gorengan Komplit", description: "Pilihan gorengan untuk dinikmati bersama.", category: "Paket hemat", price: 10000, is_available: true, badge: "Promo", sort_order: 9 }
  };

  const INITIAL_SETTINGS = {
    id: "main",
    open_time: "08:00:00",
    close_time: "18:00:00",
    min_delivery: 20000,
    delivery_note: "Ongkir dikonfirmasi melalui WhatsApp",
    delivery_zones: "",
    address: "Jalan Mekarsari RT 20 No. 18, Balikpapan",
    map_url: "",
    whatsapp: "6289512340428",
    promo_text: "",
    instagram_url: "",
    online_payment_enabled: false,
    payment_instructions: "",
    timezone: "Asia/Makassar"
  };

  const SALE_STATUSES = ["pending", "paid", "processing", "completed", "cancelled"];

  function needsFirebase() {
    if (!auth || !database) {
      throw new Error("Firebase belum dapat dihubungkan. Periksa firebase-config.js dan koneksi internet.");
    }
  }

  function sortProducts(value) {
    return Object.values(value || {})
      .filter(product => product && product.id)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "id"));
  }

  function sortEntries(value, dateFields) {
    return Object.entries(value || {})
      .map(([id, item]) => ({ id, ...(item || {}) }))
      .filter(item => item && item.id)
      .sort((a, b) => {
        const aDate = dateFields.map(key => a[key] || "").join(" ");
        const bDate = dateFields.map(key => b[key] || "").join(" ");
        return bDate.localeCompare(aDate);
      });
  }

  function sortSales(value) { return sortEntries(value, ["paid_date", "created_at"]); }
  function sortExpenses(value) { return sortEntries(value, ["date", "created_at"]); }

  function requireAdminSession(session) {
    if (!session || !session.user || session.user.uid !== cfg.adminUid) {
      throw new Error("Akun ini bukan admin Gorengan Mekarsari.");
    }
  }

  function waitForAuthState() {
    return new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user || null);
      });
    });
  }

  function numberValue(value, fallback = 0) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? number : fallback;
  }

  function cleanText(value, max = 2000) { return String(value ?? "").trim().slice(0, max); }

  function safeId(value) {
    const id = cleanText(value, 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) throw new Error("Nama atau ID menu belum valid.");
    return id;
  }

  function cleanProduct(product, id) {
    const cleanId = safeId(id || product?.id || product?.name);
    const name = cleanText(product?.name, 100);
    if (!name) throw new Error("Nama menu wajib diisi.");
    const price = numberValue(product?.price, -1);
    if (price < 0) throw new Error("Harga menu belum valid.");
    const sortOrder = numberValue(product?.sort_order, 999);
    return {
      id: cleanId,
      name,
      description: cleanText(product?.description, 500),
      category: cleanText(product?.category, 80),
      price,
      cost_price: Math.max(0, numberValue(product?.cost_price, 0)),
      is_available: product?.is_available !== false,
      badge: cleanText(product?.badge, 40),
      sort_order: Math.max(0, sortOrder),
      image_data: cleanText(product?.image_data, 700000),
      image_url: cleanText(product?.image_url, 1500)
    };
  }

  function cleanItems(items) {
    return Array.isArray(items)
      ? items.map(item => {
          const qty = Math.max(1, numberValue(item?.qty, 1));
          const price = Math.max(0, numberValue(item?.price, 0));
          const cost = Math.max(0, numberValue(item?.cost_price, 0));
          return {
            id: cleanText(item?.id, 80),
            name: cleanText(item?.name, 140),
            qty,
            price,
            cost_price: cost,
            subtotal: Math.max(0, numberValue(item?.subtotal, price * qty)),
            cost_total: Math.max(0, numberValue(item?.cost_total, cost * qty))
          };
        }).filter(item => item.name)
      : [];
  }

  function normaliseStatus(value) {
    const status = cleanText(value, 30).toLowerCase();
    return SALE_STATUSES.includes(status) ? status : "pending";
  }

  function userMessage(error) {
    const code = error?.code || "";
    if (code === "auth/invalid-email") return "Alamat email tidak valid.";
    if (code === "auth/user-not-found") return "Email ini belum terdaftar di Firebase.";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "Email atau password salah.";
    if (code === "auth/too-many-requests") return "Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.";
    if (String(code).toLowerCase() === "permission_denied") return "Akses Firebase belum diizinkan. Masukkan firebase-rules.json ke menu Rules lalu Publish.";
    return error?.message || String(error);
  }

  window.GM_DB = {
    enabled: Boolean(auth && database),
    client: { auth, database },
    initialProducts: INITIAL_PRODUCTS,
    initialSettings: INITIAL_SETTINGS,
    saleStatuses: SALE_STATUSES,
    errorMessage: userMessage,

    async getProducts() {
      needsFirebase();
      const snapshot = await database.ref("products").once("value");
      return sortProducts(snapshot.val());
    },

    async getAdminProducts() {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const [products, costsSnapshot] = await Promise.all([
        this.getProducts(),
        database.ref("product_costs").once("value")
      ]);
      const costs = costsSnapshot.val() || {};
      return products.map(product => ({
        ...product,
        cost_price: Math.max(0, numberValue(costs[product.id]?.cost_price, 0))
      }));
    },

    async getSettings() {
      needsFirebase();
      const snapshot = await database.ref("settings/main").once("value");
      return snapshot.val() || null;
    },

    async getSales() {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const snapshot = await database.ref("sales").once("value");
      return sortSales(snapshot.val());
    },

    async getExpenses() {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const snapshot = await database.ref("expenses").once("value");
      return sortExpenses(snapshot.val());
    },

    async watchSales(callback, onError) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const ref = database.ref("sales");
      const listener = snapshot => {
        if (typeof callback === "function") callback(sortSales(snapshot.val()));
      };
      const errorListener = error => { if (typeof onError === "function") onError(error); };
      ref.on("value", listener, errorListener);
      return () => ref.off("value", listener);
    },

    async watchExpenses(callback, onError) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const ref = database.ref("expenses");
      const listener = snapshot => {
        if (typeof callback === "function") callback(sortExpenses(snapshot.val()));
      };
      const errorListener = error => { if (typeof onError === "function") onError(error); };
      ref.on("value", listener, errorListener);
      return () => ref.off("value", listener);
    },

    async signIn(email, password) {
      needsFirebase();
      const result = await auth.signInWithEmailAndPassword(email, password);
      return result.user;
    },

    async sendPasswordReset(email) {
      needsFirebase();
      await auth.sendPasswordResetEmail(email);
    },

    async signOut() { if (auth) await auth.signOut(); },

    async getSession() {
      needsFirebase();
      const user = auth.currentUser || await waitForAuthState();
      return user ? { user } : null;
    },

    async isAdmin(userId) { return Boolean(userId && userId === cfg.adminUid); },

    async ensureInitialData() {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const [productsSnapshot, settingsSnapshot, costsSnapshot] = await Promise.all([
        database.ref("products").once("value"),
        database.ref("settings/main").once("value"),
        database.ref("product_costs").once("value")
      ]);
      const tasks = [];
      const now = new Date().toISOString();
      if (!productsSnapshot.exists()) {
        const products = Object.fromEntries(Object.entries(INITIAL_PRODUCTS).map(([id, product]) => [id, { ...product, updated_at: now }]));
        tasks.push(database.ref("products").set(products));
      } else {
        const existing = productsSnapshot.val() || {};
        const costs = costsSnapshot.val() || {};
        const fillMissing = {};
        Object.entries(INITIAL_PRODUCTS).forEach(([id, defaults]) => {
          if (!existing[id]) return;
          Object.entries(defaults).forEach(([key, value]) => {
            if (typeof existing[id][key] === "undefined") fillMissing[`products/${id}/${key}`] = value;
          });
        });
        Object.entries(existing).forEach(([id, product]) => {
          if (!product || typeof product.cost_price === "undefined") return;
          if (typeof costs[id]?.cost_price === "undefined") {
            fillMissing[`product_costs/${id}`] = { cost_price: Math.max(0, numberValue(product.cost_price, 0)), updated_at: now };
          }
          fillMissing[`products/${id}/cost_price`] = null;
        });
        if (Object.keys(fillMissing).length) tasks.push(database.ref().update(fillMissing));
      }
      if (!settingsSnapshot.exists()) {
        tasks.push(database.ref("settings/main").set({ ...INITIAL_SETTINGS, updated_at: now }));
      } else {
        const current = settingsSnapshot.val() || {};
        const fillMissing = {};
        Object.entries(INITIAL_SETTINGS).forEach(([key, value]) => {
          if (typeof current[key] === "undefined") fillMissing[key] = value;
        });
        if (Object.keys(fillMissing).length) tasks.push(database.ref("settings/main").update(fillMissing));
      }
      await Promise.all(tasks);
    },

    async createProduct(product) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const data = cleanProduct(product);
      const ref = database.ref(`products/${data.id}`);
      const existing = await ref.once("value");
      if (existing.exists()) throw new Error("ID menu sudah ada. Ganti nama atau ID menu.");
      const { cost_price, ...publicProduct } = data;
      const now = new Date().toISOString();
      const complete = { ...publicProduct, created_at: now, updated_at: now };
      await database.ref().update({
        [`products/${data.id}`]: complete,
        [`product_costs/${data.id}`]: { cost_price, updated_at: now }
      });
      return { ...complete, cost_price };
    },

    async updateProduct(id, changes) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const cleanId = safeId(id);
      const ref = database.ref(`products/${cleanId}`);
      const costsRef = database.ref(`product_costs/${cleanId}`);
      const [productSnapshot, costsSnapshot] = await Promise.all([ref.once("value"), costsRef.once("value")]);
      const current = productSnapshot.val() || { id: cleanId };
      const currentCost = numberValue(costsSnapshot.val()?.cost_price, 0);
      const data = cleanProduct({ ...current, ...changes, cost_price: typeof changes?.cost_price === "undefined" ? currentCost : changes.cost_price, id: cleanId }, cleanId);
      const { cost_price, ...publicProduct } = data;
      const now = new Date().toISOString();
      await Promise.all([
        ref.update({ ...publicProduct, updated_at: now }),
        costsRef.set({ cost_price, updated_at: now })
      ]);
      return { ...publicProduct, cost_price };
    },

    async removeProduct(id) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const cleanId = safeId(id);
      await database.ref().update({ [`products/${cleanId}`]: null, [`product_costs/${cleanId}`]: null });
    },

    async updateSettings(changes) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const ref = database.ref("settings/main");
      const data = { ...changes, id: "main", min_delivery: Math.max(0, numberValue(changes?.min_delivery, 0)), updated_at: new Date().toISOString() };
      await ref.update(data);
      return (await ref.once("value")).val();
    },

    async createSale(sale) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const total = numberValue(sale?.total, 0);
      if (total <= 0) throw new Error("Total transaksi harus lebih dari Rp 0.");
      const items = cleanItems(sale?.items);
      const ref = database.ref("sales").push();
      const data = {
        invoice_number: cleanText(sale?.invoice_number, 100),
        buyer_name: cleanText(sale?.buyer_name, 120),
        buyer_phone: cleanText(sale?.buyer_phone, 50),
        payment_method: cleanText(sale?.payment_method || "Tunai", 80) || "Tunai",
        note: cleanText(sale?.note, 1000),
        paid_date: /^\d{4}-\d{2}-\d{2}$/.test(String(sale?.paid_date || "")) ? sale.paid_date : new Date().toISOString().slice(0, 10),
        total,
        delivery_fee: Math.max(0, numberValue(sale?.delivery_fee, 0)),
        cost_total: Math.max(0, numberValue(sale?.cost_total, items.reduce((sum, item) => sum + item.cost_total, 0))),
        items,
        status: normaliseStatus(sale?.status || "paid"),
        source: cleanText(sale?.source || "admin", 30) || "admin",
        created_at: new Date().toISOString(),
        created_by: session.user.uid
      };
      await ref.set(data);
      return { id: ref.key, ...data };
    },

    async createPublicOrder(order) {
      needsFirebase();
      const total = numberValue(order?.total, 0);
      if (total <= 0 || total > 10000000) throw new Error("Total pesanan belum valid.");
      const buyerName = cleanText(order?.buyer_name, 120);
      if (!buyerName) throw new Error("Nama pembeli wajib diisi.");
      const items = cleanItems(order?.items);
      if (!items.length) throw new Error("Pesanan belum memiliki menu.");
      const ref = database.ref("sales").push();
      const data = {
        invoice_number: cleanText(order?.invoice_number, 100),
        buyer_name: buyerName,
        buyer_phone: cleanText(order?.buyer_phone, 50),
        payment_method: cleanText(order?.payment_method || "Bayar saat ambil/diantar", 80),
        delivery_type: cleanText(order?.delivery_type || "Ambil Sendiri", 30),
        delivery_address: cleanText(order?.delivery_address, 500),
        delivery_zone: cleanText(order?.delivery_zone, 100),
        note: cleanText(order?.note, 1000),
        paid_date: /^\d{4}-\d{2}-\d{2}$/.test(String(order?.paid_date || "")) ? order.paid_date : new Date().toISOString().slice(0, 10),
        total,
        delivery_fee: Math.max(0, numberValue(order?.delivery_fee, 0)),
        cost_total: 0,
        items,
        status: "pending",
        source: "website",
        created_at: new Date().toISOString()
      };
      await ref.set(data);
      return { id: ref.key, ...data };
    },

    async updateSale(id, changes) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      if (!id) throw new Error("Pesanan tidak ditemukan.");
      const update = { updated_at: new Date().toISOString() };
      if (typeof changes?.status !== "undefined") update.status = normaliseStatus(changes.status);
      if (typeof changes?.payment_method !== "undefined") update.payment_method = cleanText(changes.payment_method, 80) || "Tunai";
      if (typeof changes?.note !== "undefined") update.note = cleanText(changes.note, 1000);
      if (typeof changes?.total !== "undefined") update.total = Math.max(0, numberValue(changes.total, 0));
      if (typeof changes?.cost_total !== "undefined") update.cost_total = Math.max(0, numberValue(changes.cost_total, 0));
      if (typeof changes?.paid_date !== "undefined" && /^\d{4}-\d{2}-\d{2}$/.test(String(changes.paid_date))) update.paid_date = changes.paid_date;
      await database.ref(`sales/${id}`).update(update);
      return (await database.ref(`sales/${id}`).once("value")).val();
    },

    async removeSale(id) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      if (!id) throw new Error("Transaksi tidak ditemukan.");
      await database.ref(`sales/${id}`).remove();
    },

    async createExpense(expense) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const amount = numberValue(expense?.amount, 0);
      if (amount <= 0) throw new Error("Nominal pengeluaran harus lebih dari Rp 0.");
      const ref = database.ref("expenses").push();
      const data = {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(expense?.date || "")) ? expense.date : new Date().toISOString().slice(0, 10),
        category: cleanText(expense?.category || "Lainnya", 80) || "Lainnya",
        description: cleanText(expense?.description, 500),
        amount,
        created_at: new Date().toISOString(),
        created_by: session.user.uid
      };
      await ref.set(data);
      return { id: ref.key, ...data };
    },

    async removeExpense(id) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      if (!id) throw new Error("Pengeluaran tidak ditemukan.");
      await database.ref(`expenses/${id}`).remove();
    },

    watchStoreChanges(callback, onError) {
      needsFirebase();
      const productsRef = database.ref("products");
      const settingsRef = database.ref("settings/main");
      let products = {};
      let settings = null;
      let productsReady = false;
      let settingsReady = false;
      const notify = () => {
        if (productsReady && settingsReady && typeof callback === "function") callback({ products: sortProducts(products), settings: settings || null });
      };
      const productsListener = snapshot => { products = snapshot.val() || {}; productsReady = true; notify(); };
      const settingsListener = snapshot => { settings = snapshot.val() || null; settingsReady = true; notify(); };
      const errorListener = error => { if (typeof onError === "function") onError(error); };
      productsRef.on("value", productsListener, errorListener);
      settingsRef.on("value", settingsListener, errorListener);
      return () => {
        productsRef.off("value", productsListener);
        settingsRef.off("value", settingsListener);
      };
    }
  };
})();
