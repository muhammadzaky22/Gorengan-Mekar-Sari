(() => {
  const $ = id => document.getElementById(id);
  const paidStatuses = new Set(["paid", "processing", "completed"]);
  const statusLabel = {
    pending: "Menunggu pembayaran",
    paid: "Sudah dibayar",
    processing: "Sedang diproses",
    completed: "Selesai",
    cancelled: "Dibatalkan"
  };
  const state = {
    products: [],
    settings: {},
    sales: [],
    expenses: [],
    orderLines: [{ productId: "", qty: 1 }],
    manualSaleTotal: false,
    pendingImages: new Map(),
    deferredPrompt: null,
    stopSalesWatch: null,
    stopExpensesWatch: null
  };

  function rupiah(value) {
    return "Rp " + Math.round(Number(value) || 0).toLocaleString("id-ID");
  }

  function numberValue(value, fallback = 0) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? number : fallback;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function todayStore() {
    const timezone = state.settings?.timezone || "Asia/Makassar";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  function displayDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Tanggal belum diisi";
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  }

  function makeInvoice() {
    return `GM-${todayStore().replaceAll("-", "")}-${String(Date.now()).slice(-6)}`;
  }

  function setMessage(target, text = "", type = "") {
    const element = typeof target === "string" ? $(target) : target;
    if (!element) return;
    if (!text) {
      element.className = "";
      element.textContent = "";
      return;
    }
    element.className = `msg ${type}`.trim();
    element.textContent = text;
  }

  function appError(error) {
    return window.GM_DB?.errorMessage?.(error) || error?.message || String(error);
  }

  function setBusy(button, isBusy, label) {
    if (!button) return;
    if (isBusy) {
      button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = label || "Memproses…";
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || button.textContent;
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setMessage("adminMsg", "Browser ini belum mendukung notifikasi pesanan.", "error");
      return;
    }
    if (Notification.permission === "denied") {
      setMessage("adminMsg", "Notifikasi diblokir. Aktifkan izin Notifikasi untuk situs ini di pengaturan browser.", "error");
      return;
    }
    if (Notification.permission !== "granted") await Notification.requestPermission();
    if (Notification.permission === "granted") {
      setMessage("adminMsg", "Notifikasi pesanan aktif saat aplikasi Admin sedang terbuka.", "ok");
    } else {
      setMessage("adminMsg", "Izin notifikasi belum diberikan.", "error");
    }
  }

  async function showOrderNotification(sale) {
    const body = `${sale.buyer_name || "Pelanggan"} · ${rupiah(sale.total)} · ${sale.items?.length || 0} menu`;
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification("Pesanan baru Gorengan", { body, tag: `order-${sale.id}`, renotify: true });
        } else {
          new Notification("Pesanan baru Gorengan", { body });
        }
      } catch (_) {}
    }
    navigator.vibrate?.([100, 60, 100]);
  }

  function stopLiveAdmin() {
    state.stopSalesWatch?.();
    state.stopExpensesWatch?.();
    state.stopSalesWatch = null;
    state.stopExpensesWatch = null;
  }

  async function startLiveAdmin() {
    stopLiveAdmin();
    let knownSales = new Set(state.sales.map(sale => sale.id));
    let initialSales = true;
    try {
      state.stopSalesWatch = await GM_DB.watchSales(sales => {
        const newWebsiteOrders = initialSales ? [] : sales.filter(sale => !knownSales.has(sale.id) && sale.source === "website");
        knownSales = new Set(sales.map(sale => sale.id));
        initialSales = false;
        state.sales = sales;
        renderSales();
        renderSummary();
        if (newWebsiteOrders.length) {
          const first = newWebsiteOrders[0];
          setMessage("adminMsg", `${newWebsiteOrders.length} pesanan baru masuk dari website.`, "ok");
          showOrderNotification(first);
        }
      }, error => console.warn("Pesanan realtime belum tersambung.", error));
      state.stopExpensesWatch = await GM_DB.watchExpenses(expenses => {
        state.expenses = expenses;
        renderExpenses();
        renderSummary();
      }, error => console.warn("Pengeluaran realtime belum tersambung.", error));
    } catch (error) {
      console.warn("Pembaruan Admin realtime belum aktif.", error);
    }
  }

  function imageSource(product) {
    return product?.image_data || product?.image_url || "gorengan-mekarsari-preview.webp";
  }

  function getProduct(id) {
    return state.products.find(product => product.id === id) || null;
  }

  function fieldValue(id, fallback = "") {
    return $(id)?.value ?? fallback;
  }

  function setField(id, value) {
    const element = $(id);
    if (element) element.value = value ?? "";
  }

  async function compressImage(file) {
    if (!file) return "";
    if (!/^image\//.test(file.type || "")) throw new Error("Pilih file foto (JPG, PNG, atau WebP).");
    if (file.size > 8 * 1024 * 1024) throw new Error("Ukuran foto terlalu besar. Pilih foto di bawah 8 MB.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Foto tidak dapat diproses."));
        image.onload = () => {
          const longest = Math.max(image.width, image.height);
          const scale = longest > 1000 ? 1000 / longest : 1;
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          let result = canvas.toDataURL("image/jpeg", 0.78);
          if (result.length > 600000) result = canvas.toDataURL("image/jpeg", 0.58);
          if (result.length > 700000) return reject(new Error("Foto masih terlalu besar setelah diperkecil. Pilih foto lain yang lebih sederhana."));
          resolve(result);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function clearNewProductForm() {
    ["new_name", "new_category", "new_price", "new_cost", "new_badge", "new_description", "new_image_url"].forEach(id => setField(id, ""));
    setField("new_sort", "99");
    if ($("new_image_file")) $("new_image_file").value = "";
  }

  function renderSettings() {
    const settings = { ...GM_DB.initialSettings, ...(state.settings || {}) };
    setField("open_time", String(settings.open_time || "08:00").slice(0, 5));
    setField("close_time", String(settings.close_time || "18:00").slice(0, 5));
    setField("min_delivery", settings.min_delivery ?? 0);
    setField("whatsapp", settings.whatsapp || "");
    setField("address", settings.address || "");
    setField("map_url", settings.map_url || "");
    setField("delivery_zones", settings.delivery_zones || "");
    setField("delivery_note", settings.delivery_note || "");
    setField("promo_text", settings.promo_text || "");
    setField("instagram_url", settings.instagram_url || "");
    setField("payment_instructions", settings.payment_instructions || "");
    if ($("online_payment_enabled")) $("online_payment_enabled").checked = Boolean(settings.online_payment_enabled);
  }

  function renderProducts() {
    const holder = $("products");
    if (!holder) return;
    if (!state.products.length) {
      holder.innerHTML = '<div class="empty">Belum ada menu. Tambahkan menu pertama di atas.</div>';
      return;
    }
    holder.innerHTML = state.products.map(product => {
      const image = imageSource(product);
      return `<article class="product" data-product-id="${escapeHTML(product.id)}">
        <div class="product-top">
          <img class="product-photo" data-preview="${escapeHTML(product.id)}" src="${escapeHTML(image)}" alt="Foto ${escapeHTML(product.name)}">
          <div class="product-main">
            <label>Nama menu</label><input class="p-name" value="${escapeHTML(product.name)}">
            <div class="two-col">
              <div><label>Harga jual</label><input class="p-price" type="number" min="0" step="500" value="${numberValue(product.price)}"></div>
              <div><label>Modal / HPP</label><input class="p-cost" type="number" min="0" step="500" value="${numberValue(product.cost_price)}"></div>
              <div><label>Kategori</label><input class="p-category" value="${escapeHTML(product.category || "")}" placeholder="Gorengan"></div>
              <div><label>Badge</label><input class="p-badge" value="${escapeHTML(product.badge || "")}" placeholder="Promo"></div>
              <div><label>Urutan</label><input class="p-sort" type="number" min="0" step="1" value="${numberValue(product.sort_order, 99)}"></div>
              <div><label class="switch"><input class="p-available" type="checkbox" ${product.is_available !== false ? "checked" : ""}><span>Tersedia</span></label></div>
            </div>
          </div>
        </div>
        <label>Keterangan</label><textarea class="p-description" placeholder="Keterangan menu">${escapeHTML(product.description || "")}</textarea>
        <div class="two-col">
          <div><label>Ganti foto dari galeri</label><input class="p-image-file" type="file" accept="image/*"><span class="help">Maks. 8 MB sebelum diperkecil.</span></div>
          <div><label>Atau link foto</label><input class="p-image-url" type="url" value="${escapeHTML(product.image_url || "")}" placeholder="https://..."></div>
        </div>
        <div class="mini-actions">
          <button class="btn green" data-action="save-product" type="button">Simpan menu</button>
          <button class="btn ghost" data-action="clear-image" type="button">Hapus foto</button>
          <button class="btn red" data-action="delete-product" type="button">Hapus menu</button>
        </div>
      </article>`;
    }).join("");
  }

  function productOptions(selected = "") {
    const available = state.products.filter(product => product.is_available !== false);
    return `<option value="">Pilih menu</option>${available.map(product => `<option value="${escapeHTML(product.id)}" ${product.id === selected ? "selected" : ""}>${escapeHTML(product.name)} — ${rupiah(product.price)}</option>`).join("")}`;
  }

  function renderOrderLines() {
    const holder = $("orderItems");
    if (!holder) return;
    holder.innerHTML = state.orderLines.map((line, index) => {
      const product = getProduct(line.productId);
      const info = product ? `${rupiah(product.price)} / porsi · modal ${rupiah(product.cost_price)}` : "Pilih menu untuk menghitung total dan modal.";
      return `<div class="order-line" data-line-index="${index}">
        <div><label>Menu</label><select class="line-product">${productOptions(line.productId)}</select></div>
        <div><label>Jumlah</label><input class="line-qty" type="number" min="1" step="1" value="${Math.max(1, numberValue(line.qty, 1))}"></div>
        <button class="btn red" data-action="remove-order-line" type="button" title="Hapus baris">×</button>
        <small>${escapeHTML(info)}</small>
      </div>`;
    }).join("");
  }

  function orderData() {
    return state.orderLines.map(line => {
      const product = getProduct(line.productId);
      if (!product) return null;
      const qty = Math.max(1, numberValue(line.qty, 1));
      const price = Math.max(0, numberValue(product.price));
      const cost = Math.max(0, numberValue(product.cost_price));
      return {
        id: product.id,
        name: product.name,
        qty,
        price,
        cost_price: cost,
        subtotal: price * qty,
        cost_total: cost * qty
      };
    }).filter(Boolean);
  }

  function updateOrderTotals() {
    const items = orderData();
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const costTotal = items.reduce((sum, item) => sum + item.cost_total, 0);
    const delivery = Math.max(0, numberValue(fieldValue("sale_delivery_fee")));
    const automatic = subtotal + delivery;
    const totalField = $("sale_total");
    if (totalField && !state.manualSaleTotal) totalField.value = automatic || "";
    if ($("orderCalculation")) $("orderCalculation").textContent = `Subtotal menu ${rupiah(subtotal)} · Modal ${rupiah(costTotal)} · Ongkir ${rupiah(delivery)}`;
  }

  function statusOptions(selected) {
    return Object.entries(statusLabel).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
  }

  function saleItemsText(sale) {
    if (!Array.isArray(sale.items) || !sale.items.length) return "Tanpa rincian menu";
    return sale.items.map(item => `${item.qty}× ${item.name}`).join(", ");
  }

  function renderSales() {
    const holder = $("salesList");
    if (!holder) return;
    if (!state.sales.length) {
      holder.innerHTML = '<div class="empty">Belum ada pesanan yang dicatat.</div>';
      return;
    }
    holder.innerHTML = state.sales.map(sale => `<article class="list-row" data-sale-id="${escapeHTML(sale.id)}">
      <div>
        <strong>${escapeHTML(sale.invoice_number || "Pesanan tanpa nomor nota")}</strong>
        <div class="meta">${escapeHTML(displayDate(sale.paid_date))} · ${escapeHTML(sale.buyer_name || "Pelanggan")}${sale.buyer_phone ? ` · ${escapeHTML(sale.buyer_phone)}` : ""}\n${sale.source === "website" ? "Pesanan dari website" : "Dicatat dari Admin"} · ${escapeHTML(saleItemsText(sale))}\n${escapeHTML(sale.payment_method || "Tunai")}${sale.note ? ` · ${escapeHTML(sale.note)}` : ""}</div>
      </div>
      <div class="list-right">
        <strong>${rupiah(sale.total)}</strong>
        <div class="meta">Modal ${rupiah(sale.cost_total)}${sale.delivery_fee ? ` · Ongkir ${rupiah(sale.delivery_fee)}` : ""}</div>
        <span class="badge ${escapeHTML(sale.status || "pending")}">${escapeHTML(statusLabel[sale.status] || "Menunggu pembayaran")}</span>
        <select class="sale-status-select" aria-label="Status pesanan">${statusOptions(sale.status || "pending")}</select>
        <div><button class="btn ghost" data-action="print-sale" type="button">Cetak nota</button> <button class="btn red" data-action="delete-sale" type="button">Hapus</button></div>
      </div>
    </article>`).join("");
  }

  function renderExpenses() {
    const holder = $("expensesList");
    if (!holder) return;
    if (!state.expenses.length) {
      holder.innerHTML = '<div class="empty">Belum ada pengeluaran yang dicatat.</div>';
      return;
    }
    holder.innerHTML = state.expenses.map(expense => `<article class="list-row" data-expense-id="${escapeHTML(expense.id)}">
      <div><strong>${escapeHTML(expense.category || "Pengeluaran")}</strong><div class="meta">${escapeHTML(displayDate(expense.date))}${expense.description ? ` · ${escapeHTML(expense.description)}` : ""}</div></div>
      <div class="list-right"><strong>${rupiah(expense.amount)}</strong><button class="btn red" data-action="delete-expense" type="button">Hapus</button></div>
    </article>`).join("");
  }

  function dateTotals(datePrefix) {
    const sales = state.sales.filter(sale => paidStatuses.has(sale.status) && String(sale.paid_date || "").startsWith(datePrefix));
    const expenses = state.expenses.filter(expense => String(expense.date || "").startsWith(datePrefix));
    const income = sales.reduce((sum, sale) => sum + numberValue(sale.total), 0);
    const cost = sales.reduce((sum, sale) => sum + numberValue(sale.cost_total), 0);
    const outgo = expenses.reduce((sum, expense) => sum + numberValue(expense.amount), 0);
    return { income, cost, outgo, profit: income - cost - outgo, count: sales.length };
  }

  function renderSummary() {
    const today = dateTotals(todayStore());
    const month = dateTotals(todayStore().slice(0, 7));
    const pending = state.sales.filter(sale => ["pending", "processing"].includes(sale.status)).length;
    $("incomeToday").textContent = rupiah(today.income);
    $("incomeTodayInfo").textContent = `${today.count} pesanan dibayar`;
    $("profitToday").textContent = rupiah(today.profit);
    $("profitTodayInfo").textContent = `Modal ${rupiah(today.cost)} · Keluar ${rupiah(today.outgo)}`;
    $("incomeMonth").textContent = rupiah(month.income);
    $("incomeMonthInfo").textContent = `${month.count} pesanan dibayar`;
    $("profitMonth").textContent = rupiah(month.profit);
    $("profitMonthInfo").textContent = `Modal ${rupiah(month.cost)} · Keluar ${rupiah(month.outgo)}`;
    $("pendingCount").textContent = String(pending);
    $("pendingInfo").textContent = pending ? "Periksa status pesanan" : "Semua sudah ditangani";
  }

  function renderAll() {
    renderSettings();
    renderProducts();
    renderOrderLines();
    updateOrderTotals();
    renderSales();
    renderExpenses();
    renderSummary();
  }

  async function loadAll({ quiet = false } = {}) {
    if (!quiet) setMessage("adminMsg", "Memuat data toko…");
    try {
      const [products, settings, sales, expenses] = await Promise.all([
        GM_DB.getAdminProducts(), GM_DB.getSettings(), GM_DB.getSales(), GM_DB.getExpenses()
      ]);
      state.products = products;
      state.settings = settings || {};
      state.sales = sales;
      state.expenses = expenses;
      renderAll();
      if (!quiet) setMessage("adminMsg", "Data toko sudah dimuat.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    }
  }

  async function enterAdmin() {
    try {
      const session = await GM_DB.getSession();
      if (!session) return;
      if (!await GM_DB.isAdmin(session.user.uid)) {
        await GM_DB.signOut();
        throw new Error("Akun ini bukan admin Gorengan Mekarsari.");
      }
      await GM_DB.ensureInitialData();
      $("loginView").classList.add("hidden");
      $("adminView").classList.remove("hidden");
      $("accountInfo").textContent = session.user.email || "Admin";
      if (!fieldValue("sale_paid_date")) setField("sale_paid_date", todayStore());
      if (!fieldValue("expense_date")) setField("expense_date", todayStore());
      await loadAll();
      await startLiveAdmin();
    } catch (error) {
      setMessage("loginMsg", appError(error), "error");
    }
  }

  async function login() {
    const button = $("loginBtn");
    if (!/^https?:$/.test(window.location.protocol)) {
      setMessage("loginMsg", "Halaman Admin dibuka dari file HP. Upload folder ke GitHub lalu buka admin dari link website.", "error");
      return;
    }
    setBusy(button, true, "Memproses…");
    setMessage("loginMsg", "");
    try {
      if (!GM_DB.enabled) throw new Error("Firebase belum siap. Periksa firebase-config.js.");
      const email = fieldValue("email").trim();
      const password = fieldValue("password");
      if (!email || !password) throw new Error("Email dan password wajib diisi.");
      await GM_DB.signIn(email, password);
      await enterAdmin();
    } catch (error) {
      setMessage("loginMsg", appError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function resetPassword() {
    const email = fieldValue("email").trim();
    if (!email) return setMessage("loginMsg", "Isi email Admin terlebih dahulu.", "error");
    setMessage("loginMsg", "Mengirim link reset password…");
    try {
      await GM_DB.sendPasswordReset(email);
      setMessage("loginMsg", "Link reset password sudah dikirim. Cek Inbox dan folder Spam.", "ok");
    } catch (error) {
      setMessage("loginMsg", appError(error), "error");
    }
  }

  async function logout() {
    stopLiveAdmin();
    await GM_DB.signOut();
    $("adminView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    setField("password", "");
    setMessage("loginMsg", "");
  }

  async function addProduct() {
    const button = $("addProductBtn");
    setBusy(button, true, "Menyimpan menu…");
    try {
      const file = $("new_image_file")?.files?.[0];
      const imageData = file ? await compressImage(file) : "";
      await GM_DB.createProduct({
        name: fieldValue("new_name"),
        category: fieldValue("new_category"),
        price: fieldValue("new_price"),
        cost_price: fieldValue("new_cost"),
        badge: fieldValue("new_badge"),
        sort_order: fieldValue("new_sort"),
        description: fieldValue("new_description"),
        image_data: imageData,
        image_url: fieldValue("new_image_url")
      });
      clearNewProductForm();
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Menu baru berhasil ditambahkan. Website pelanggan akan ikut berubah otomatis.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function saveProduct(card) {
    const id = card?.dataset.productId;
    const current = getProduct(id);
    if (!id || !current) return;
    const button = card.querySelector('[data-action="save-product"]');
    setBusy(button, true, "Menyimpan…");
    try {
      const imageUrl = card.querySelector(".p-image-url").value.trim();
      const imageData = state.pendingImages.has(id)
        ? state.pendingImages.get(id)
        : (imageUrl ? "" : (current.image_data || ""));
      await GM_DB.updateProduct(id, {
        name: card.querySelector(".p-name").value,
        price: card.querySelector(".p-price").value,
        cost_price: card.querySelector(".p-cost").value,
        category: card.querySelector(".p-category").value,
        badge: card.querySelector(".p-badge").value,
        sort_order: card.querySelector(".p-sort").value,
        description: card.querySelector(".p-description").value,
        is_available: card.querySelector(".p-available").checked,
        image_data: imageData,
        image_url: imageUrl
      });
      state.pendingImages.delete(id);
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Menu berhasil disimpan.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function chooseProductPhoto(input) {
    const card = input.closest(".product");
    const id = card?.dataset.productId;
    const file = input.files?.[0];
    if (!id || !file) return;
    try {
      setMessage("adminMsg", "Memproses foto…");
      const imageData = await compressImage(file);
      state.pendingImages.set(id, imageData);
      const preview = card.querySelector(".product-photo");
      if (preview) preview.src = imageData;
      setMessage("adminMsg", "Foto siap. Tekan “Simpan menu” untuk mengunggahnya.", "ok");
    } catch (error) {
      input.value = "";
      setMessage("adminMsg", appError(error), "error");
    }
  }

  function clearProductPhoto(card) {
    const id = card?.dataset.productId;
    if (!id) return;
    state.pendingImages.set(id, "");
    const url = card.querySelector(".p-image-url");
    if (url) url.value = "";
    const preview = card.querySelector(".product-photo");
    if (preview) preview.src = "gorengan-mekarsari-preview.webp";
    setMessage("adminMsg", "Foto akan dihapus setelah Anda menekan “Simpan menu” .", "ok");
  }

  async function deleteProduct(card) {
    const id = card?.dataset.productId;
    const name = card?.querySelector(".p-name")?.value || "menu ini";
    if (!id || !window.confirm(`Hapus ${name}? Menu akan hilang dari website pelanggan.`)) return;
    try {
      await GM_DB.removeProduct(id);
      state.pendingImages.delete(id);
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Menu telah dihapus.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    }
  }

  async function saveSettings() {
    const button = $("saveSettingsBtn");
    setBusy(button, true, "Menyimpan…");
    try {
      await GM_DB.updateSettings({
        open_time: fieldValue("open_time"),
        close_time: fieldValue("close_time"),
        min_delivery: fieldValue("min_delivery"),
        whatsapp: fieldValue("whatsapp"),
        address: fieldValue("address"),
        map_url: fieldValue("map_url"),
        delivery_zones: fieldValue("delivery_zones"),
        delivery_note: fieldValue("delivery_note"),
        promo_text: fieldValue("promo_text"),
        instagram_url: fieldValue("instagram_url"),
        online_payment_enabled: $("online_payment_enabled").checked,
        payment_instructions: fieldValue("payment_instructions")
      });
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Pengaturan toko berhasil disimpan.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function saveSale() {
    const button = $("saveSaleBtn");
    const total = Math.max(0, numberValue(fieldValue("sale_total")));
    if (total <= 0) return setMessage("adminMsg", "Isi menu atau total tagihan terlebih dahulu.", "error");
    setBusy(button, true, "Menyimpan pesanan…");
    try {
      const items = orderData();
      await GM_DB.createSale({
        invoice_number: fieldValue("sale_invoice_number").trim() || makeInvoice(),
        buyer_name: fieldValue("sale_buyer_name"),
        buyer_phone: fieldValue("sale_buyer_phone"),
        payment_method: fieldValue("sale_payment_method"),
        paid_date: fieldValue("sale_paid_date"),
        status: fieldValue("sale_status"),
        delivery_fee: fieldValue("sale_delivery_fee"),
        total,
        cost_total: items.reduce((sum, item) => sum + item.cost_total, 0),
        items,
        note: fieldValue("sale_note")
      });
      ["sale_buyer_name", "sale_buyer_phone", "sale_invoice_number", "sale_delivery_fee", "sale_note"].forEach(id => setField(id, id === "sale_delivery_fee" ? "0" : ""));
      setField("sale_status", "pending");
      setField("sale_payment_method", "Tunai");
      setField("sale_paid_date", todayStore());
      state.orderLines = [{ productId: "", qty: 1 }];
      state.manualSaleTotal = false;
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Pesanan berhasil disimpan. Gunakan tombol “Cetak nota” bila ingin membuat struk.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function changeSaleStatus(row) {
    const id = row?.dataset.saleId;
    const select = row?.querySelector(".sale-status-select");
    if (!id || !select) return;
    try {
      select.disabled = true;
      const sale = state.sales.find(item => item.id === id);
      const estimatedCost = Array.isArray(sale?.items)
        ? sale.items.reduce((sum, item) => {
            const qty = Math.max(1, numberValue(item.qty, 1));
            const recorded = numberValue(item.cost_total, 0);
            if (recorded > 0) return sum + recorded;
            return sum + numberValue(getProduct(item.id)?.cost_price, 0) * qty;
          }, 0)
        : numberValue(sale?.cost_total, 0);
      await GM_DB.updateSale(id, { status: select.value, cost_total: estimatedCost });
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Status pesanan diperbarui.", "ok");
    } catch (error) {
      select.disabled = false;
      setMessage("adminMsg", appError(error), "error");
    }
  }

  async function deleteSale(row) {
    const id = row?.dataset.saleId;
    if (!id || !window.confirm("Hapus pesanan ini? Riwayat dan laporan ikut berubah.")) return;
    try {
      await GM_DB.removeSale(id);
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Pesanan telah dihapus.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    }
  }

  function printSale(row) {
    const id = row?.dataset.saleId;
    const sale = state.sales.find(item => item.id === id);
    if (!sale) return;
    const items = Array.isArray(sale.items) && sale.items.length ? sale.items : [];
    const lines = items.length ? items.map(item => `<tr><td>${escapeHTML(item.name)}</td><td>${item.qty}×</td><td style="text-align:right">${rupiah(item.subtotal)}</td></tr>`).join("") : '<tr><td colspan="3">Rincian menu tidak dicatat</td></tr>';
    const popup = window.open("", "_blank", "width=430,height=680");
    if (!popup) return setMessage("adminMsg", "Popup diblokir browser. Izinkan popup untuk mencetak nota.", "error");
    popup.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Nota ${escapeHTML(sale.invoice_number || "GM")}</title><style>body{font-family:Arial,sans-serif;padding:22px;color:#222}h1{font-size:20px;margin:0 0 6px}p{margin:4px 0;color:#555}table{width:100%;border-collapse:collapse;margin:17px 0}td{padding:7px 0;border-bottom:1px solid #ddd;vertical-align:top}.total{font-size:20px;font-weight:bold;text-align:right;margin-top:12px}.small{font-size:12px;color:#666;margin-top:20px}</style></head><body><h1>Gorengan Mekarsari</h1><p>Nota: ${escapeHTML(sale.invoice_number || "—")}</p><p>${escapeHTML(displayDate(sale.paid_date))} · ${escapeHTML(sale.buyer_name || "Pelanggan")}</p><p>Status: ${escapeHTML(statusLabel[sale.status] || "Menunggu pembayaran")}</p><table>${lines}</table>${sale.delivery_fee ? `<p style="text-align:right">Ongkir: ${rupiah(sale.delivery_fee)}</p>` : ""}<div class="total">Total: ${rupiah(sale.total)}</div><p>Metode: ${escapeHTML(sale.payment_method || "Tunai")}</p>${sale.note ? `<p>Catatan: ${escapeHTML(sale.note)}</p>` : ""}<p class="small">Terima kasih sudah berbelanja.</p><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  async function saveExpense() {
    const button = $("saveExpenseBtn");
    setBusy(button, true, "Menyimpan…");
    try {
      await GM_DB.createExpense({
        date: fieldValue("expense_date"),
        category: fieldValue("expense_category"),
        amount: fieldValue("expense_amount"),
        description: fieldValue("expense_description")
      });
      setField("expense_category", "");
      setField("expense_amount", "");
      setField("expense_description", "");
      setField("expense_date", todayStore());
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Pengeluaran berhasil dicatat.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteExpense(row) {
    const id = row?.dataset.expenseId;
    if (!id || !window.confirm("Hapus pengeluaran ini?")) return;
    try {
      await GM_DB.removeExpense(id);
      await loadAll({ quiet: true });
      setMessage("adminMsg", "Pengeluaran telah dihapus.", "ok");
    } catch (error) {
      setMessage("adminMsg", appError(error), "error");
    }
  }

  function exportCSV() {
    const rows = [["Jenis", "Tanggal", "Status", "Nomor Nota", "Pelanggan", "Telepon", "Metode", "Pemasukan", "Modal/HPP", "Pengeluaran", "Laba Kotor", "Catatan", "Rincian Menu"]];
    state.sales.forEach(sale => {
      const income = paidStatuses.has(sale.status) ? numberValue(sale.total) : 0;
      const cost = paidStatuses.has(sale.status) ? numberValue(sale.cost_total) : 0;
      rows.push(["Pesanan", sale.paid_date || "", statusLabel[sale.status] || sale.status || "", sale.invoice_number || "", sale.buyer_name || "", sale.buyer_phone || "", sale.payment_method || "", income, cost, "", income - cost, sale.note || "", saleItemsText(sale)]);
    });
    state.expenses.forEach(expense => rows.push(["Pengeluaran", expense.date || "", "", "", "", "", "", "", "", numberValue(expense.amount), -numberValue(expense.amount), expense.description || "", expense.category || ""]));
    const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = "\ufeff" + rows.map(row => row.map(quote).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Laporan-Gorengan-${todayStore()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("adminMsg", "Laporan CSV berhasil diunduh. File ini dapat dibuka dengan Microsoft Excel atau Google Sheets.", "ok");
  }

  function installAdmin() {
    if (state.deferredPrompt) {
      state.deferredPrompt.prompt();
      state.deferredPrompt.userChoice.finally(() => {
        state.deferredPrompt = null;
        $("installAdminBtn").classList.add("hidden");
      });
    } else {
      $("installAdminHint").textContent = "Di Chrome Android: tekan ⋮ lalu pilih “Install app” atau “Tambahkan ke layar utama”.";
    }
  }

  function bindEvents() {
    $("loginBtn").addEventListener("click", login);
    $("resetBtn").addEventListener("click", resetPassword);
    $("logoutBtn").addEventListener("click", logout);
    $("refreshBtn").addEventListener("click", () => loadAll());
    $("installAdminBtn").addEventListener("click", installAdmin);
    $("addProductBtn").addEventListener("click", addProduct);
    $("saveSettingsBtn").addEventListener("click", saveSettings);
    $("addOrderItemBtn").addEventListener("click", () => { state.orderLines.push({ productId: "", qty: 1 }); renderOrderLines(); updateOrderTotals(); });
    $("saveSaleBtn").addEventListener("click", saveSale);
    $("saveExpenseBtn").addEventListener("click", saveExpense);
    $("exportBtn").addEventListener("click", exportCSV);
    $("enableNotificationsBtn").addEventListener("click", enableNotifications);
    $("password").addEventListener("keydown", event => { if (event.key === "Enter") login(); });
    $("sale_delivery_fee").addEventListener("input", () => { state.manualSaleTotal = false; updateOrderTotals(); });
    $("sale_total").addEventListener("input", () => { state.manualSaleTotal = true; });

    $("products").addEventListener("change", event => {
      if (event.target.matches(".p-image-file")) chooseProductPhoto(event.target);
    });
    $("orderItems").addEventListener("change", event => {
      const row = event.target.closest("[data-line-index]");
      if (!row) return;
      const index = numberValue(row.dataset.lineIndex, -1);
      if (!state.orderLines[index]) return;
      if (event.target.matches(".line-product")) state.orderLines[index].productId = event.target.value;
      if (event.target.matches(".line-qty")) state.orderLines[index].qty = Math.max(1, numberValue(event.target.value, 1));
      state.manualSaleTotal = false;
      updateOrderTotals();
      const product = getProduct(state.orderLines[index].productId);
      row.querySelector("small").textContent = product ? `${rupiah(product.price)} / porsi · modal ${rupiah(product.cost_price)}` : "Pilih menu untuk menghitung total dan modal.";
    });
    $("salesList").addEventListener("change", event => {
      if (event.target.matches(".sale-status-select")) changeSaleStatus(event.target.closest("[data-sale-id]"));
    });
    document.addEventListener("click", event => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const card = action.closest(".product");
      const saleRow = action.closest("[data-sale-id]");
      const expenseRow = action.closest("[data-expense-id]");
      if (action.dataset.action === "save-product") saveProduct(card);
      if (action.dataset.action === "clear-image") clearProductPhoto(card);
      if (action.dataset.action === "delete-product") deleteProduct(card);
      if (action.dataset.action === "remove-order-line") {
        const orderRow = action.closest("[data-line-index]");
        const index = numberValue(orderRow?.dataset.lineIndex, -1);
        if (state.orderLines.length === 1) state.orderLines[0] = { productId: "", qty: 1 };
        else if (index >= 0) state.orderLines.splice(index, 1);
        state.manualSaleTotal = false;
        renderOrderLines();
        updateOrderTotals();
      }
      if (action.dataset.action === "print-sale") printSale(saleRow);
      if (action.dataset.action === "delete-sale") deleteSale(saleRow);
      if (action.dataset.action === "delete-expense") deleteExpense(expenseRow);
    });
  }

  async function boot() {
    bindEvents();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      state.deferredPrompt = event;
      $("installAdminBtn").classList.remove("hidden");
    });
    window.addEventListener("appinstalled", () => {
      state.deferredPrompt = null;
      $("installAdminBtn").classList.add("hidden");
      $("installAdminHint").textContent = "Aplikasi Admin sudah terpasang di layar utama HP.";
    });
    if (!GM_DB.enabled) return setMessage("loginMsg", "Firebase belum siap. Periksa file firebase-config.js.", "error");
    try {
      const session = await GM_DB.getSession();
      if (session) await enterAdmin();
    } catch (error) {
      setMessage("loginMsg", appError(error), "error");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
