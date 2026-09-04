(() => {
  const knownStaticIds = new Set(["pisang", "singkong", "tempe", "tahu", "bakwan", "ubi", "risoles", "tahuisi"]);
  const paidStatuses = new Set(["paid", "processing", "completed"]);
  let currentRows = [];
  let currentSettings = {};
  let stopRealtime = null;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function numberValue(value, fallback = 0) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? number : fallback;
  }

  function storeDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_SETTINGS.timezone || "Asia/Makassar",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  function productImage(product) {
    return product?.image_data || product?.image_url || "gorengan-mekarsari-preview.webp";
  }

  function categoryFor(product) {
    const id = String(product?.id || "").toLowerCase();
    if (id === "pisang") return "pisang";
    if (id === "singkong") return "singkong";
    if (["tahu", "tempe"].includes(id)) return "tahutempe";
    if (["bakwan", "ubi"].includes(id)) return "favorit";
    const category = String(product?.category || "").toLowerCase();
    if (category.includes("pisang")) return "pisang";
    if (category.includes("singkong")) return "singkong";
    if (category.includes("tahu") || category.includes("tempe")) return "tahutempe";
    if (category.includes("favorit")) return "favorit";
    return "lainnya";
  }

  function parseDeliveryZones(text) {
    return String(text || "").split(/\r?\n/).map(line => {
      const [nameRaw, priceRaw] = line.split("|");
      const name = String(nameRaw || "").trim();
      const fee = numberValue(String(priceRaw || "").replace(/[^0-9]/g, ""));
      return name ? { name, fee: Math.max(0, fee) } : null;
    }).filter(Boolean);
  }

  function getZones() {
    return parseDeliveryZones(currentSettings.delivery_zones);
  }

  function getSelectedZone(mode) {
    const element = document.getElementById(mode === "mobile" ? "deliveryZoneMobile" : "deliveryZoneDesktop");
    const index = Number(element?.value);
    return Number.isInteger(index) && getZones()[index] ? getZones()[index] : null;
  }

  function isDelivery(mode) {
    const element = document.getElementById(mode === "mobile" ? "deliveryTypeMobile" : "deliveryTypeDesktop");
    return element?.value === "Antar";
  }

  function deliveryFee(mode) {
    return isDelivery(mode) ? numberValue(getSelectedZone(mode)?.fee) : 0;
  }

  function rememberZone(value) {
    try { localStorage.setItem("gorengan_mekarsari_delivery_zone", value ?? ""); } catch (_) {}
  }

  function updateZoneOptions() {
    const zones = getZones();
    const saved = (() => { try { return localStorage.getItem("gorengan_mekarsari_delivery_zone") || ""; } catch (_) { return ""; } })();
    ["Desktop", "Mobile"].forEach(suffix => {
      const wrap = document.getElementById(`deliveryZoneWrap${suffix}`);
      const select = document.getElementById(`deliveryZone${suffix}`);
      if (!wrap || !select) return;
      const previous = select.value || saved;
      select.innerHTML = `<option value="">Pilih area pengantaran</option>${zones.map((zone, index) => `<option value="${index}">${escapeHTML(zone.name)} — ${formatRp(zone.fee)}</option>`).join("")}`;
      if (previous !== "" && zones[Number(previous)]) select.value = previous;
      wrap.classList.toggle("show", zones.length > 0 && isDelivery(suffix.toLowerCase()));
    });
  }

  function updateOrderBreakdown() {
    const productTotal = totalPrice();
    ["desktop", "mobile"].forEach(mode => {
      const suffix = mode === "mobile" ? "Mobile" : "Desktop";
      const element = document.getElementById(`orderBreakdown${suffix}`);
      if (!element) return;
      const fee = deliveryFee(mode);
      const zone = getSelectedZone(mode);
      const showFee = isDelivery(mode) && Boolean(zone);
      const grandTotal = productTotal + fee;
      element.classList.toggle("show", showFee);
      if (showFee) {
        element.innerHTML = `Subtotal menu: <strong>${formatRp(productTotal)}</strong><br>Ongkir ${escapeHTML(zone.name)}: <strong>${formatRp(fee)}</strong><br>Total tagihan: <strong>${formatRp(grandTotal)}</strong>`;
        document.getElementById(`total${suffix}`).textContent = formatRp(grandTotal);
      } else {
        element.innerHTML = "";
        document.getElementById(`total${suffix}`).textContent = formatRp(productTotal);
      }
    });
  }

  function updateCartWithLiveProducts() {
    let changed = false;
    cart.forEach(item => {
      const product = LIVE_PRODUCTS[item.id];
      if (!product) return;
      const price = numberValue(product.price, item.price);
      if (item.name !== product.name || item.price !== price) {
        item.name = product.name;
        item.price = price;
        changed = true;
      }
    });
    if (changed) saveCart();
  }

  function renderDynamicCard(product) {
    const badge = product.badge ? `<span class="product-badge">${escapeHTML(product.badge)}</span>` : "";
    const stock = product.is_available === false ? "HABIS" : "Tersedia";
    return `<article class="product-card live-added" data-cat="${escapeHTML(categoryFor(product))}" data-id="${escapeHTML(product.id)}" data-dynamic="true">
      <div class="product-image">${badge}<span class="stock-badge">${stock}</span><img src="${escapeHTML(productImage(product))}" alt="${escapeHTML(product.name)}" loading="lazy"></div>
      <div class="product-body">
        ${product.category ? `<div class="product-category">${escapeHTML(product.category)}</div>` : ""}
        <h3>${escapeHTML(product.name)}</h3>
        <div class="price">${formatRp(product.price)}</div>
        <p class="product-description">${escapeHTML(product.description || "Gorengan hangat dan lezat.")}</p>
        <div class="qty-row"><button class="qty-btn" data-live-action="qty-down" data-product-id="${escapeHTML(product.id)}" type="button">−</button><input id="qty-${escapeHTML(product.id)}" class="qty-input" type="number" min="0" value="0" readonly><button class="qty-btn" data-live-action="qty-up" data-product-id="${escapeHTML(product.id)}" type="button">+</button></div>
        <button class="add-btn" data-live-action="add-to-cart" data-product-id="${escapeHTML(product.id)}" type="button">+ Keranjang</button>
      </div>
    </article>`;
  }

  function applyProducts(rows) {
    currentRows = Array.isArray(rows) ? rows : [];
    const ids = new Set(currentRows.map(row => row.id));
    Object.keys(LIVE_PRODUCTS).forEach(id => { if (!ids.has(id)) delete LIVE_PRODUCTS[id]; });
    Object.keys(STOCK).forEach(id => { if (!ids.has(id)) delete STOCK[id]; });

    document.querySelectorAll(".product-card[data-id]:not([data-dynamic])").forEach(card => {
      card.classList.toggle("is-hidden-by-admin", !ids.has(card.dataset.id));
    });
    document.querySelectorAll(".product-card[data-dynamic]").forEach(card => card.remove());

    const grid = document.querySelector(".products-grid");
    currentRows.forEach(row => {
      LIVE_PRODUCTS[row.id] = row;
      STOCK[row.id] = row.is_available !== false;
      const safeId = window.CSS?.escape ? CSS.escape(row.id) : String(row.id).replace(/[^a-zA-Z0-9_-]/g, "\\$");
      const card = document.querySelector(`.product-card[data-id="${safeId}"]:not([data-dynamic])`);
      if (card) {
        card.classList.remove("is-hidden-by-admin");
        card.dataset.cat = categoryFor(row);
        const title = card.querySelector(".product-body h3");
        const description = card.querySelector(".product-body p");
        const price = card.querySelector(".price");
        const badge = card.querySelector(".product-badge");
        const image = card.querySelector("img");
        const add = card.querySelector(".add-btn");
        if (title) title.textContent = row.name;
        if (description && row.description) description.textContent = row.description;
        if (price) price.textContent = formatRp(row.price);
        if (row.badge) {
          if (badge) badge.textContent = row.badge;
          else card.querySelector(".product-image")?.insertAdjacentHTML("afterbegin", `<span class="product-badge">${escapeHTML(row.badge)}</span>`);
        } else if (badge) badge.remove();
        if (image && (row.image_data || row.image_url)) image.src = productImage(row);
        if (add) add.setAttribute("onclick", `addFromQty(${JSON.stringify(row.id)}, ${JSON.stringify(row.name)}, ${numberValue(row.price)})`);
      } else if (row.id !== "paketkomplit" && grid) {
        grid.insertAdjacentHTML("beforeend", renderDynamicCard(row));
      }
      if (row.id === "paketkomplit") {
        const combo = document.querySelector(".combo-price");
        if (combo) combo.textContent = formatRp(row.price);
      }
    });
    updateCartWithLiveProducts();
    applyStockStatus();
  }

  function validHttpUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (_) { return ""; }
  }

  function applySettings(settings) {
    currentSettings = settings || {};
    STORE_SETTINGS.openTime = formatTimeShort(settings.open_time, "08:00");
    STORE_SETTINGS.closeTime = formatTimeShort(settings.close_time, "18:00");
    STORE_SETTINGS.timezone = settings.timezone || "Asia/Makassar";
    STORE_SETTINGS.deliveryNote = settings.delivery_note || "Ongkir dikonfirmasi melalui WhatsApp";
    MIN_DELIVERY = Math.max(0, numberValue(settings.min_delivery, 20000));
    ONLINE_PAYMENT_ENABLED = Boolean(settings.online_payment_enabled);
    PAYMENT_INSTRUCTIONS = String(settings.payment_instructions || "").trim();
    if (settings.whatsapp) WHATSAPP = normalizeWhatsApp(settings.whatsapp);

    const address = String(settings.address || "").trim();
    if (address) {
      document.getElementById("storeAddressText").textContent = address;
      document.getElementById("heroAddress").textContent = address;
      const mapLink = validHttpUrl(settings.map_url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      document.getElementById("storeMapLink").href = mapLink;
      document.getElementById("storeMapFrame").src = `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
    }

    const promo = String(settings.promo_text || "").trim();
    const promoElement = document.getElementById("livePromo");
    promoElement.textContent = promo ? `🎉 ${promo}` : "";
    promoElement.classList.toggle("hidden", !promo);

    const instagram = validHttpUrl(settings.instagram_url);
    const instagramElement = document.getElementById("instagramContact");
    if (instagram) {
      instagramElement.innerHTML = `<span>📸</span><a href="${escapeHTML(instagram)}" target="_blank" rel="noopener">Instagram kami</a>`;
    } else {
      instagramElement.innerHTML = "<span>📸</span><span>Instagram: segera hadir</span>";
    }

    const hours = document.getElementById("hoursText");
    if (hours) hours.textContent = `${STORE_SETTINGS.openTime} - ${STORE_SETTINGS.closeTime} WITA`;
    document.querySelectorAll(".min-delivery-text").forEach(el => el.textContent = formatRp(MIN_DELIVERY));
    document.querySelectorAll(".delivery-note-text").forEach(el => el.textContent = STORE_SETTINGS.deliveryNote + ".");
    syncWhatsAppLinks();
    syncPaymentOptions();
    updateZoneOptions();
    updateOpenStatus();
  }

  function applySnapshot(snapshot) {
    applyProducts(snapshot.products || []);
    applySettings(snapshot.settings || {});
    renderCart();
    updateOrderBreakdown();
  }

  function enhancedToggleDeliveryAddress(mode) {
    const original = enhancedToggleDeliveryAddress.original;
    if (typeof original === "function") original(mode);
    const suffix = mode === "mobile" ? "Mobile" : "Desktop";
    const wrap = document.getElementById(`deliveryZoneWrap${suffix}`);
    if (wrap) wrap.classList.toggle("show", getZones().length > 0 && isDelivery(mode));
    if (!isDelivery(mode)) {
      const select = document.getElementById(`deliveryZone${suffix}`);
      if (select) select.value = "";
    }
    updateOrderBreakdown();
  }

  function checkout(mode) {
    if (!cart.length) return alert("Keranjang masih kosong.");
    const isMobile = mode === "mobile";
    const suffix = isMobile ? "Mobile" : "Desktop";
    const buyerName = document.getElementById(`buyerName${suffix}`).value.trim();
    const buyerPhone = document.getElementById(`buyerPhone${suffix}`).value.trim();
    const deliveryType = document.getElementById(`deliveryType${suffix}`).value;
    const deliveryAddress = document.getElementById(`deliveryAddress${suffix}`).value.trim();
    const paymentMethod = document.getElementById(`paymentMethod${suffix}`).value;
    const note = document.getElementById(`note${suffix}`).value.trim();
    const subtotal = totalPrice();
    const zone = getSelectedZone(mode);
    const fee = deliveryType === "Antar" ? numberValue(zone?.fee) : 0;

    if (!buyerName) return alert("Nama pembeli belum diisi.");
    if (deliveryType === "Antar" && !deliveryAddress) return alert("Alamat pengantaran belum diisi.");
    if (deliveryType === "Antar" && subtotal < MIN_DELIVERY) return alert(`Minimal pesanan untuk diantar adalah ${formatRp(MIN_DELIVERY)}.`);
    if (deliveryType === "Antar" && getZones().length && !zone) return alert("Pilih area pengantaran terlebih dahulu.");
    if (onlinePaymentSelected(paymentMethod) && !ONLINE_PAYMENT_ENABLED) return alert("Pembayaran online belum diaktifkan oleh toko.");

    const orderStatus = STORE_IS_OPEN ? "Pesanan hari ini" : "PRE-ORDER";
    const order = {
      receiptNumber: createReceiptNumber(),
      createdAt: new Date().toISOString(),
      orderStatus,
      buyerName,
      buyerPhone,
      deliveryType,
      deliveryAddress,
      deliveryZone: zone?.name || "",
      deliveryFee: fee,
      paymentMethod,
      paymentInstructions: onlinePaymentSelected(paymentMethod) ? PAYMENT_INSTRUCTIONS : "",
      note,
      items: cart.map(item => ({ ...item })),
      subtotal,
      total: subtotal + fee
    };
    if (window.GM_DB?.createPublicOrder) {
      GM_DB.createPublicOrder({
        invoice_number: order.receiptNumber,
        buyer_name: order.buyerName,
        buyer_phone: order.buyerPhone,
        payment_method: order.paymentMethod,
        delivery_type: order.deliveryType,
        delivery_address: order.deliveryAddress,
        delivery_zone: order.deliveryZone,
        delivery_fee: order.deliveryFee,
        paid_date: storeDate(),
        note: order.note,
        items: order.items,
        total: order.total
      }).catch(error => console.warn("Pesanan belum tersimpan ke riwayat Firebase.", error));
    }
    const lines = [
      STORE_IS_OPEN ? "Halo Gorengan Mekarsari, saya mau pesan:" : "Halo Gorengan Mekarsari, saya mau PRE-ORDER:",
      "",
      `*No. Nota:* ${order.receiptNumber}`,
      `*Status:* ${orderStatus}`,
      `*Nama:* ${buyerName}`,
      buyerPhone ? `*No. HP:* ${buyerPhone}` : "",
      `*Metode:* ${deliveryType}`,
      deliveryType === "Antar" ? `*Alamat:* ${deliveryAddress}` : "",
      deliveryType === "Antar" && zone ? `*Area / Ongkir:* ${zone.name} — ${formatRp(fee)}` : "",
      deliveryType === "Antar" && !zone ? `*Ongkir:* ${STORE_SETTINGS.deliveryNote}` : "",
      `*Pembayaran:* ${paymentMethod}`,
      ""
    ].filter(Boolean);
    order.items.forEach((item, index) => lines.push(`${index + 1}. ${item.name} - ${item.qty} x ${formatRp(item.price)} = ${formatRp(item.price * item.qty)}`));
    lines.push("", `*Subtotal menu: ${formatRp(subtotal)}*`);
    if (deliveryType === "Antar" && zone) lines.push(`*Ongkir: ${formatRp(fee)}*`);
    lines.push(`*Total tagihan: ${formatRp(order.total)}*`);
    if (note) lines.push("", `*Catatan:* ${note}`);
    if (order.paymentInstructions) lines.push("", `*Info pembayaran:* ${order.paymentInstructions}`);
    if (!STORE_IS_OPEN) lines.push("", "*Catatan Toko:* Saat ini toko sedang tutup. Pesanan dicatat sebagai pre-order dan dikonfirmasi melalui WhatsApp.");
    lines.push("", "Terima kasih.");

    saveCheckoutFields();
    window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
    showReceipt(order);
  }

  function enhancedReceiptText(order) {
    const lines = ["GORENGAN MEKARSARI", "NOTA PESANAN", `No. Nota: ${order.receiptNumber}`, `Tanggal: ${displayReceiptDate(order.createdAt)}`, `Status: ${order.orderStatus} - menunggu konfirmasi toko`, "", `Nama: ${order.buyerName}`, order.buyerPhone ? `No. HP: ${order.buyerPhone}` : "", `Metode Pesanan: ${order.deliveryType}`, order.deliveryType === "Antar" ? `Alamat: ${order.deliveryAddress}` : "", order.deliveryZone ? `Area: ${order.deliveryZone}` : "", `Pembayaran: ${order.paymentMethod}`, "", "PESANAN:"].filter(Boolean);
    order.items.forEach((item, index) => lines.push(`${index + 1}. ${item.name} - ${item.qty} x ${formatRp(item.price)} = ${formatRp(item.price * item.qty)}`));
    lines.push("", `SUBTOTAL MENU: ${formatRp(order.subtotal ?? order.total - numberValue(order.deliveryFee))}`);
    if (numberValue(order.deliveryFee)) lines.push(`ONGKIR: ${formatRp(order.deliveryFee)}`);
    lines.push(`TOTAL: ${formatRp(order.total)}`);
    if (order.note) lines.push(`Catatan: ${order.note}`);
    if (order.paymentInstructions) lines.push("", `Info pembayaran: ${order.paymentInstructions}`);
    lines.push("", "Nota ini belum bukti pembayaran. Pesanan diproses setelah dikonfirmasi toko.");
    return lines.join("\n");
  }

  function enhancedShowReceipt(order) {
    LAST_RECEIPT = order;
    const status = order.orderStatus === "PRE-ORDER" ? "PRE-ORDER • menunggu konfirmasi" : "MENUNGGU KONFIRMASI";
    const delivery = order.deliveryType === "Antar" ? `<div><strong>Alamat:</strong> ${escapeHTML(order.deliveryAddress)}</div>${order.deliveryZone ? `<div><strong>Area:</strong> ${escapeHTML(order.deliveryZone)}</div>` : ""}` : "";
    const phone = order.buyerPhone ? `<div><strong>No. HP:</strong> ${escapeHTML(order.buyerPhone)}</div>` : "";
    const notes = order.note ? `<div style="margin-top:8px"><strong>Catatan:</strong> ${escapeHTML(order.note)}</div>` : "";
    const paymentInfo = order.paymentInstructions ? `<div class="receipt-payment"><strong>💳 Info pembayaran online</strong><br>${escapeMultiline(order.paymentInstructions)}</div>` : "";
    const items = order.items.map(item => `<div class="receipt-item"><div><strong>${escapeHTML(item.name)}</strong><small>${item.qty} x ${formatRp(item.price)}</small></div><strong>${formatRp(item.price * item.qty)}</strong></div>`).join("");
    const subtotal = numberValue(order.subtotal, numberValue(order.total) - numberValue(order.deliveryFee));
    const fee = numberValue(order.deliveryFee);
    document.getElementById("receiptContent").innerHTML = `<div class="receipt-paper"><div class="receipt-brand"><h2 id="receiptTitle">Gorengan Mekarsari</h2><p>Hangat • Gurih • Bersahabat</p></div><div class="receipt-number">NOTA #${escapeHTML(order.receiptNumber)}</div><div class="receipt-date">${escapeHTML(displayReceiptDate(order.createdAt))}</div><div style="text-align:center"><span class="receipt-status">${status}</span></div><div class="receipt-info"><div><strong>Nama:</strong> ${escapeHTML(order.buyerName)}</div>${phone}<div><strong>Pesanan:</strong> ${escapeHTML(order.deliveryType)}</div>${delivery}<div><strong>Pembayaran:</strong> ${escapeHTML(order.paymentMethod)}</div>${notes}</div><div class="receipt-items">${items}</div><div class="receipt-item"><span>Subtotal menu</span><strong>${formatRp(subtotal)}</strong></div>${fee ? `<div class="receipt-item"><span>Ongkir</span><strong>${formatRp(fee)}</strong></div>` : ""}<div class="receipt-total"><span>Total tagihan</span><span>${formatRp(order.total)}</span></div>${paymentInfo}<div class="receipt-footer">Nota ini belum menjadi bukti pembayaran. Pesanan diproses setelah toko mengonfirmasi melalui WhatsApp.</div></div>`;
    document.getElementById("receiptOverlay").classList.add("show");
  }

  function enhanceFunctions() {
    const oldRenderCart = window.renderCart;
    window.renderCart = function() {
      oldRenderCart();
      updateOrderBreakdown();
    };
    const oldAddFromQty = window.addFromQty;
    window.addFromQty = function(id, name, price) {
      const product = LIVE_PRODUCTS[id];
      const result = oldAddFromQty(id, product?.name || name, Number(product?.price ?? price));
      updateOrderBreakdown();
      return result;
    };
    window.addCombo = function() {
      const product = LIVE_PRODUCTS.paketkomplit;
      if (STOCK.paketkomplit === false) return alert("Maaf, Paket Hemat sedang tidak tersedia.");
      const existing = findItem("paketkomplit");
      const price = numberValue(product?.price, 10000);
      const name = product?.name || "Paket Hemat Gorengan Komplit";
      if (existing) { existing.qty += 1; existing.price = price; existing.name = name; }
      else cart.push({ id: "paketkomplit", name, price, qty: 1 });
      saveCart();
      renderCart();
      updateOrderBreakdown();
    };
    ["updateItem", "removeItem", "clearCart"].forEach(name => {
      const original = window[name];
      if (typeof original !== "function") return;
      window[name] = function(...args) {
        const result = original(...args);
        updateOrderBreakdown();
        return result;
      };
    });
    enhancedToggleDeliveryAddress.original = window.toggleDeliveryAddress;
    window.toggleDeliveryAddress = enhancedToggleDeliveryAddress;
    const oldSaveFields = window.saveCheckoutFields;
    window.saveCheckoutFields = function() {
      oldSaveFields();
      try {
        const raw = JSON.parse(localStorage.getItem("gorengan_mekarsari_checkout") || "{}");
        raw.deliveryZone = document.getElementById("deliveryZoneDesktop")?.value || "";
        localStorage.setItem("gorengan_mekarsari_checkout", JSON.stringify(raw));
      } catch (_) {}
    };
    window.checkoutWA = checkout;
    window.receiptText = enhancedReceiptText;
    window.showReceipt = enhancedShowReceipt;
  }

  function bindEnhancements() {
    ["Desktop", "Mobile"].forEach(suffix => {
      const select = document.getElementById(`deliveryZone${suffix}`);
      if (!select) return;
      select.addEventListener("change", () => {
        const other = document.getElementById(`deliveryZone${suffix === "Desktop" ? "Mobile" : "Desktop"}`);
        if (other) other.value = select.value;
        rememberZone(select.value);
        updateOrderBreakdown();
        saveCheckoutFields();
      });
      const deliveryType = document.getElementById(`deliveryType${suffix}`);
      deliveryType?.addEventListener("change", () => enhancedToggleDeliveryAddress(suffix.toLowerCase()));
    });
    document.querySelectorAll(".filter-btn").forEach(button => {
      button.addEventListener("click", () => {
        const filter = button.dataset.filter;
        document.querySelectorAll(".product-card").forEach(card => {
          card.style.display = filter === "all" || card.dataset.cat === filter ? "" : "none";
        });
      });
    });
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-live-action]");
      if (!button) return;
      const product = LIVE_PRODUCTS[button.dataset.productId];
      if (!product) return;
      if (button.dataset.liveAction === "qty-down") changeQty(product.id, -1);
      if (button.dataset.liveAction === "qty-up") changeQty(product.id, 1);
      if (button.dataset.liveAction === "add-to-cart") addFromQty(product.id, product.name, product.price);
    });
  }

  async function refreshStore() {
    if (!window.GM_DB?.enabled) return;
    try {
      const [products, settings] = await Promise.all([GM_DB.getProducts(), GM_DB.getSettings()]);
      applySnapshot({ products, settings });
    } catch (error) {
      console.warn("Data Firebase belum dapat dimuat.", error);
    }
  }

  function startRealtime() {
    if (!window.GM_DB?.enabled || !GM_DB.watchStoreChanges) return;
    if (stopRealtime) stopRealtime();
    stopRealtime = GM_DB.watchStoreChanges(snapshot => applySnapshot(snapshot), error => console.warn("Perubahan realtime belum tersambung.", error));
  }

  enhanceFunctions();
  bindEnhancements();
  updateZoneOptions();
  refreshStore();
  startRealtime();
})();
