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
    pisang: { id: "pisang", name: "Pisang Goreng", price: 2000, is_available: true, badge: "Best Seller", sort_order: 1 },
    singkong: { id: "singkong", name: "Singkong Goreng", price: 2000, is_available: true, badge: "Favorit", sort_order: 2 },
    tempe: { id: "tempe", name: "Tempe Goreng", price: 1000, is_available: true, badge: "", sort_order: 3 },
    tahu: { id: "tahu", name: "Tahu Goreng", price: 1000, is_available: true, badge: "", sort_order: 4 },
    bakwan: { id: "bakwan", name: "Bakwan Sayur", price: 2000, is_available: true, badge: "Best Seller", sort_order: 5 },
    ubi: { id: "ubi", name: "Ubi Goreng", price: 2000, is_available: true, badge: "", sort_order: 6 },
    risoles: { id: "risoles", name: "Risoles", price: 2500, is_available: true, badge: "Baru", sort_order: 7 },
    tahuisi: { id: "tahuisi", name: "Tahu Isi", price: 2500, is_available: true, badge: "", sort_order: 8 },
    paketkomplit: { id: "paketkomplit", name: "Paket Hemat Gorengan Komplit", price: 10000, is_available: true, badge: "Promo", sort_order: 9 }
  };

  const INITIAL_SETTINGS = {
    id: "main",
    open_time: "08:00:00",
    close_time: "18:00:00",
    min_delivery: 20000,
    delivery_note: "Ongkir dikonfirmasi melalui WhatsApp",
    address: "Jalan Mekarsari RT 20 No. 18, Balikpapan",
    whatsapp: "6289512340428",
    online_payment_enabled: false,
    payment_instructions: "",
    timezone: "Asia/Makassar"
  };

  function needsFirebase() {
    if (!auth || !database) {
      throw new Error("Firebase belum dapat dihubungkan. Periksa firebase-config.js dan koneksi internet.");
    }
  }

  function sortProducts(value) {
    return Object.values(value || {})
      .filter(product => product && product.id)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  function requireAdminSession(session) {
    if (!session || !session.user || session.user.uid !== cfg.adminUid) {
      throw new Error("Akun ini bukan admin Gorengan Mekarsari.");
    }
  }

  function sortSales(value) {
    return Object.entries(value || {})
      .map(([id, sale]) => ({ id, ...(sale || {}) }))
      .filter(sale => sale && sale.id)
      .sort((a, b) => {
        const aDate = `${a.paid_date || ""} ${a.created_at || ""}`;
        const bDate = `${b.paid_date || ""} ${b.created_at || ""}`;
        return bDate.localeCompare(aDate);
      });
  }

  function waitForAuthState() {
    return new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user || null);
      });
    });
  }

  function userMessage(error) {
    const code = error?.code || "";
    if (code === "auth/invalid-email") {
      return "Alamat email tidak valid.";
    }
    if (code === "auth/user-not-found") {
      return "Email ini belum terdaftar di Firebase.";
    }
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
      return "Email atau password salah.";
    }
    if (code === "auth/too-many-requests") {
      return "Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.";
    }
    if (String(code).toLowerCase() === "permission_denied") {
      return "Akses Firebase belum diizinkan. Masukkan firebase-rules.json ke menu Rules lalu Publish.";
    }
    return error?.message || String(error);
  }

  window.GM_DB = {
    enabled: Boolean(auth && database),
    client: { auth, database },
    errorMessage: userMessage,

    async getProducts() {
      needsFirebase();
      const snapshot = await database.ref("products").once("value");
      return sortProducts(snapshot.val());
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

    async signIn(email, password) {
      needsFirebase();
      const result = await auth.signInWithEmailAndPassword(email, password);
      return result.user;
    },

    async sendPasswordReset(email) {
      needsFirebase();
      await auth.sendPasswordResetEmail(email);
    },

    async signOut() {
      if (!auth) return;
      await auth.signOut();
    },

    async getSession() {
      needsFirebase();
      const user = auth.currentUser || await waitForAuthState();
      return user ? { user } : null;
    },

    async isAdmin(userId) {
      return Boolean(userId && userId === cfg.adminUid);
    },

    async ensureInitialData() {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);

      const [productsSnapshot, settingsSnapshot] = await Promise.all([
        database.ref("products").once("value"),
        database.ref("settings/main").once("value")
      ]);

      const tasks = [];
      if (!productsSnapshot.exists()) {
        const now = new Date().toISOString();
        const products = Object.fromEntries(
          Object.entries(INITIAL_PRODUCTS).map(([id, product]) => [id, { ...product, updated_at: now }])
        );
        tasks.push(database.ref("products").set(products));
      }
      if (!settingsSnapshot.exists()) {
        tasks.push(database.ref("settings/main").set({
          ...INITIAL_SETTINGS,
          updated_at: new Date().toISOString()
        }));
      }
      await Promise.all(tasks);
    },

    async updateProduct(id, changes) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const ref = database.ref(`products/${id}`);
      await ref.update({ ...changes, id, updated_at: new Date().toISOString() });
      return (await ref.once("value")).val();
    },

    async updateSettings(changes) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      const ref = database.ref("settings/main");
      await ref.update({ ...changes, id: "main", updated_at: new Date().toISOString() });
      return (await ref.once("value")).val();
    },

    async createSale(sale) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);

      const total = Math.round(Number(sale?.total || 0));
      if (!Number.isFinite(total) || total <= 0) {
        throw new Error("Total transaksi harus lebih dari Rp 0.");
      }

      const ref = database.ref("sales").push();
      const data = {
        invoice_number: String(sale?.invoice_number || "").trim(),
        buyer_name: String(sale?.buyer_name || "").trim(),
        payment_method: String(sale?.payment_method || "Tunai").trim() || "Tunai",
        note: String(sale?.note || "").trim(),
        paid_date: /^\d{4}-\d{2}-\d{2}$/.test(String(sale?.paid_date || ""))
          ? sale.paid_date
          : new Date().toISOString().slice(0, 10),
        total,
        status: "paid",
        created_at: new Date().toISOString(),
        created_by: session.user.uid
      };
      await ref.set(data);
      return { id: ref.key, ...data };
    },

    async removeSale(id) {
      needsFirebase();
      const session = await this.getSession();
      requireAdminSession(session);
      if (!id) throw new Error("Transaksi tidak ditemukan.");
      await database.ref(`sales/${id}`).remove();
    }
  };
})();
