
// Mobile sidebar drawer toggle helper
function toggleMobileSidebar(show) {
  const sidebar = document.getElementById("appSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!sidebar || !overlay) return;

  if (show) {
    sidebar.classList.add("active");
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  } else {
    sidebar.classList.remove("active");
    overlay.classList.remove("active");
    document.body.style.overflow = "";
  }
}

let customersOffset = 0;
const customersLimit = 50;
let customersTotal = 0;

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    // Handle SQLite UTC string e.g. "2026-10-19 19:59:00"
    const parsed = new Date(dateStr.replace(" ", "T") + "Z");
    if (isNaN(parsed.getTime())) return dateStr;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(parsed);
  } catch (e) {
    return dateStr;
  }
}

function showMessage(element, text, type = "") {
  if (!element) return;
  element.className = "message" + (type ? " " + type : "");
  element.textContent = text;
}

async function loadCustomers(offset = 0) {
  const message = document.getElementById("allCustomersMessage");
  const sortControl = document.getElementById("customersSort");
  const tbody = document.getElementById("customersTableBody");
  if (!message || !sortControl || !tbody) return;
  
  customersOffset = offset;
  showMessage(message, "Загружаем клиентов…");
  
  const [sort_by, order] = sortControl.value.split(":");
  const params = new URLSearchParams({
    limit: String(customersLimit),
    offset: String(customersOffset),
    sort_by,
    order
  });

  try {
    const response = await fetch("/api/customers?" + params);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Не удалось загрузить список клиентов.");
    
    customersTotal = result.total;
    tbody.replaceChildren();

    if (result.items.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.style.textAlign = "center";
      cell.style.padding = "30px";
      cell.style.color = "#6b7280";
      cell.textContent = "Клиенты не найдены.";
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      result.items.forEach(customer => {
        const row = document.createElement("tr");
        
        const cellId = document.createElement("td");
        cellId.textContent = customer.id;

        const cellName = document.createElement("td");
        cellName.className = "primary-cell";
        cellName.textContent = customer.full_name;

        const cellPhone = document.createElement("td");
        if (customer.phone) {
          const phoneLink = document.createElement("a");
          phoneLink.className = "badge badge-phone";
          phoneLink.href = "tel:" + customer.phone;
          phoneLink.textContent = customer.phone;
          cellPhone.appendChild(phoneLink);
        } else {
          cellPhone.textContent = "—";
        }

        const cellInsta = document.createElement("td");
        if (customer.instagram_username) {
          const instaLink = document.createElement("a");
          instaLink.className = "badge badge-insta";
          instaLink.href = "https://instagram.com/" + customer.instagram_username;
          instaLink.target = "_blank";
          instaLink.rel = "noopener noreferrer";
          instaLink.textContent = "@" + customer.instagram_username;
          cellInsta.appendChild(instaLink);
        } else {
          cellInsta.textContent = "—";
        }

        const cellUpdated = document.createElement("td");
        cellUpdated.textContent = formatDate(customer.updated_at);

        const actionCell = document.createElement("td");
        actionCell.style.textAlign = "right";
        const openLink = document.createElement("a");
        openLink.className = "button button-secondary";
        openLink.style.padding = "4px 10px";
        openLink.style.fontSize = "12px";
        openLink.textContent = "Карточка";
        openLink.href = "/customers/" + customer.id;
        actionCell.appendChild(openLink);

        row.append(cellId, cellName, cellPhone, cellInsta, cellUpdated, actionCell);
        tbody.appendChild(row);
      });
    }

    const count = document.getElementById("customersCount");
    if (count) {
      count.textContent = customersTotal === 0 
        ? "В базе пока нет клиентов." 
        : `Всего клиентов: ${customersTotal}. Показаны ${customersOffset + 1}–${customersOffset + result.items.length}.`;
    }
    
    renderCustomersPagination();
    showMessage(message, "");
  } catch (error) {
    showMessage(message, error.message || "Не удалось связаться с сервером.", "error");
  }
}

function renderCustomersPagination() {
  const pagination = document.getElementById("customersPagination");
  if (!pagination) return;
  pagination.replaceChildren();

  if (customersTotal <= customersLimit) return;

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "← Назад";
  previous.disabled = customersOffset === 0;
  previous.onclick = () => loadCustomers(Math.max(0, customersOffset - customersLimit));

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Далее →";
  next.disabled = customersOffset + customersLimit >= customersTotal;
  next.onclick = () => loadCustomers(customersOffset + customersLimit);

  pagination.append(previous, next);
}

async function searchCustomers(event) {
  if (event) event.preventDefault();
  const input = document.getElementById("search");
  const results = document.getElementById("searchResults");
  const message = document.getElementById("searchMessage");
  if (!input || !results || !message) return;

  const query = input.value.trim();
  results.replaceChildren();

  if (!query) {
    showMessage(message, "Введите имя, телефон или Instagram для поиска.", "error");
    return;
  }

  showMessage(message, "Ищем…");

  try {
    const response = await fetch("/api/customers/search?q=" + encodeURIComponent(query));
    const customers = await response.json();
    if (!response.ok) throw new Error(customers.detail || "Не удалось выполнить поиск.");

    if (!customers.length) {
      showMessage(message, "По вашему запросу клиенты не найдены.", "error");
      return;
    }

    showMessage(message, `Найдено совпадений: ${customers.length}.`, "success");

    customers.forEach(customer => {
      const item = document.createElement("div");
      item.className = "search-result";

      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.style.fontSize = "15px";
      name.textContent = customer.full_name;
      info.appendChild(name);

      const details = document.createElement("p");
      details.className = "muted";
      details.style.marginTop = "4px";
      details.textContent = `Тел: ${customer.phone || "—"} | IG: ${customer.instagram_username ? "@" + customer.instagram_username : "—"}`;
      info.appendChild(details);

      const link = document.createElement("a");
      link.className = "button button-secondary";
      link.href = "/customers/" + customer.id;
      link.textContent = "Открыть карточку";

      item.append(info, link);
      results.appendChild(item);
    });
  } catch (error) {
    showMessage(message, error.message || "Ошибка при поиске.", "error");
  }
}

async function submitCustomerForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("formMessage");
  const button = document.getElementById("saveCustomerButton");
  const mode = form.dataset.mode;
  const id = form.dataset.customerId;

  const data = {
    full_name: document.getElementById("fullName").value.trim(),
    phone: document.getElementById("phone").value.trim() || null,
    instagram_username: document.getElementById("instagram").value.trim() || null
  };

  showMessage(message, mode === "edit" ? "Сохраняем…" : "Создаём…");
  button.disabled = true;

  try {
    const response = await fetch(mode === "edit" ? "/api/customers/" + id : "/api/customers", {
      method: mode === "edit" ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Не удалось сохранить карточку.");
    
    showMessage(message, "Успешно сохранено!", "success");
    setTimeout(() => {
      window.location.href = "/customers/" + result.id;
    }, 400);
  } catch (error) {
    showMessage(message, error.message || "Не удалось связаться с сервером.", "error");
    button.disabled = false;
  }
}

async function deleteCustomer(id) {
  if (!id) return;
  
  if (!confirm(`Вы действительно хотите удалить карточку клиента #${id}? Это действие нельзя отменить.`)) {
    return;
  }

  try {
    const response = await fetch("/api/customers/" + id, { method: "DELETE" });
    if (!response.ok) {
      const err = await response.json();
      alert(err.detail || "Не удалось удалить клиента.");
      return;
    }
    window.location.href = "/customers";
  } catch (e) {
    alert("Ошибка соединения с сервером.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const sort = document.getElementById("customersSort");
  if (sort) {
    sort.addEventListener("change", () => loadCustomers(0));
    loadCustomers(0);
  }
  const searchForm = document.getElementById("searchForm");
  if (searchForm) searchForm.addEventListener("submit", searchCustomers);
  
  const customerForm = document.getElementById("customerForm");
  if (customerForm) customerForm.addEventListener("submit", submitCustomerForm);

  // Format dates in static rendered views
  document.querySelectorAll("[data-date]").forEach(el => {
    el.textContent = formatDate(el.getAttribute("data-date"));
  });
});


// ==========================================
// ORDERS & PRODUCTS CRM LOGIC
// ==========================================

let availableProducts = [];

async function fetchProducts() {
  if (availableProducts.length > 0) return availableProducts;
  try {
    const res = await fetch("/api/products");
    if (!res.ok) throw new Error("Ошибка загрузки каталога товаров.");
    availableProducts = await res.json();
    return availableProducts;
  } catch (e) {
    console.error("Failed to fetch products:", e);
    return [];
  }
}

async function searchCustomersForOrder(event) {
  if (event) event.preventDefault();

  const input = document.getElementById("customerSearchInput");
  const results = document.getElementById("customerSearchResults");
  const selectedBadge = document.getElementById("selectedCustomerBadge");
  const selectedInput = document.getElementById("selectedCustomerId");

  if (!input || !results) return;

  const query = input.value.trim();
  results.replaceChildren();

  if (!query) {
    results.innerHTML = "<div class='message error' style='display:block;'>Введите имя, телефон или Instagram клиента.</div>";
    return;
  }

  results.innerHTML = "<div class='muted' style='padding: 8px;'>Ищем в базе клиентов…</div>";

  try {
    const res = await fetch("/api/customers/search?q=" + encodeURIComponent(query));
    const customers = await res.json();

    if (!res.ok) throw new Error(customers.detail || "Не удалось найти клиентов.");

    results.replaceChildren();

    if (!customers.length) {
      results.innerHTML = "<div class='message error' style='display:block;'>Клиенты по вашему запросу не найдены.</div>";
      return;
    }

    customers.forEach(c => {
      const item = document.createElement("div");
      item.className = "search-result";
      item.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 8px; background: #ffffff; border: 1px solid var(--border-color); border-radius: var(--radius-sm);";

      const info = document.createElement("div");
      info.innerHTML = `<strong>${c.full_name}</strong><br><span class="muted" style="font-size: 12px;">Тел: ${c.phone || "—"} | IG: ${c.instagram_username ? "@" + c.instagram_username : "—"}</span>`;

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "button button-secondary";
      selectBtn.style.cssText = "padding: 5px 12px; font-size: 12px;";
      selectBtn.textContent = "Выбрать";

      selectBtn.onclick = (e) => {
        e.preventDefault();
        if (selectedInput) selectedInput.value = c.id;
        if (selectedBadge) {
          selectedBadge.innerHTML = `
            <div class="badge badge-phone" style="font-size: 14px; padding: 10px 14px; border-radius: 8px; margin-top: 10px;">
              👤 Выбран клиент: <strong>${c.full_name}</strong> (ID: #${c.id} | ${c.phone || "без телефона"})
            </div>
          `;
        }
        results.replaceChildren();
        input.value = "";
      };

      item.append(info, selectBtn);
      results.appendChild(item);
    });
  } catch (e) {
    results.innerHTML = `<div class='message error' style='display:block;'>${e.message || "Ошибка при поиске."}</div>`;
  }
}

async function addOrderItemRow() {
  const container = document.getElementById("orderItemsContainer");
  if (!container) return;

  const products = await fetchProducts();

  const row = document.createElement("div");
  row.className = "order-item-row";
  row.style.cssText = "display: grid; grid-template-columns: 2fr 1fr 90px 100px 40px; gap: 10px; align-items: center; padding: 10px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;";

  let productOptions = "<option value=''>-- Выберите товар DixonWR --</option>";
  products.forEach(p => {
    productOptions += `<option value="${p.id}" data-price="${p.price_byn}" data-sizes="${p.sizes || ''}">${p.name} (${p.price_byn} BYN)</option>`;
  });

  row.innerHTML = `
    <div>
      <select class="item-product-select" onchange="updateOrderItemRow(this)">
        ${productOptions}
      </select>
    </div>
    <div>
      <select class="item-size-select">
        <option value="">Размер</option>
      </select>
    </div>
    <div>
      <input type="number" class="item-qty-input" value="1" min="1" onchange="calculateOrderTotal()" oninput="calculateOrderTotal()">
    </div>
    <div class="item-price-display" style="font-weight: 700; text-align: right;">
      0 BYN
    </div>
    <div>
      <button type="button" class="button button-danger" style="padding: 6px; font-size: 14px; line-height: 1;" onclick="removeOrderItemRow(this)">✕</button>
    </div>
  `;

  container.appendChild(row);
}

function updateOrderItemRow(selectEl) {
  const row = selectEl.closest(".order-item-row");
  const selectedOption = selectEl.options[selectEl.selectedIndex];
  const sizeSelect = row.querySelector(".item-size-select");

  sizeSelect.replaceChildren();
  if (!selectedOption || !selectedOption.value) {
    sizeSelect.innerHTML = "<option value=''>Размер</option>";
    calculateOrderTotal();
    return;
  }

  const sizesStr = selectedOption.getAttribute("data-sizes") || "";
  const sizes = sizesStr.split(",").map(s => s.trim()).filter(Boolean);

  if (sizes.length > 0) {
    sizes.forEach(sz => {
      const opt = document.createElement("option");
      opt.value = sz;
      opt.textContent = sz;
      sizeSelect.appendChild(opt);
    });
  } else {
    sizeSelect.innerHTML = "<option value='one size'>one size</option>";
  }

  calculateOrderTotal();
}

function removeOrderItemRow(btn) {
  const row = btn.closest(".order-item-row");
  if (row) row.remove();
  calculateOrderTotal();
}

function calculateOrderTotal() {
  const rows = document.querySelectorAll(".order-item-row");
  let total = 0;

  rows.forEach(row => {
    const prodSelect = row.querySelector(".item-product-select");
    const qtyInput = row.querySelector(".item-qty-input");
    const priceDisplay = row.querySelector(".item-price-display");

    const option = prodSelect ? prodSelect.options[prodSelect.selectedIndex] : null;
    const price = option ? parseFloat(option.getAttribute("data-price") || 0) : 0;
    const qty = qtyInput ? (parseInt(qtyInput.value) || 1) : 1;

    const rowTotal = price * qty;
    if (priceDisplay) priceDisplay.textContent = rowTotal + " BYN";
    total += rowTotal;
  });

  const sumEl = document.getElementById("orderTotalSum");
  if (sumEl) sumEl.textContent = total;
}

async function submitOrderForm(e) {
  e.preventDefault();
  const customerId = document.getElementById("selectedCustomerId").value;
  const message = document.getElementById("orderFormMessage");
  const button = document.getElementById("saveOrderButton");

  if (!customerId) {
    showMessage(message, "Пожалуйста, выберите клиента из списка.", "error");
    return;
  }

  const itemRows = document.querySelectorAll(".order-item-row");
  const items = [];

  itemRows.forEach(row => {
    const prodSelect = row.querySelector(".item-product-select");
    const sizeSelect = row.querySelector(".item-size-select");
    const qtyInput = row.querySelector(".item-qty-input");

    if (prodSelect && prodSelect.value) {
      items.push({
        product_id: parseInt(prodSelect.value),
        size_selected: sizeSelect ? (sizeSelect.value || null) : null,
        quantity: qtyInput ? (parseInt(qtyInput.value) || 1) : 1
      });
    }
  });

  if (items.length === 0) {
    showMessage(message, "Добавьте хотя бы один товар в заказ.", "error");
    return;
  }

  const payload = {
    customer_id: parseInt(customerId),
    delivery_city: document.getElementById("deliveryCity").value.trim() || "Минск",
    status: document.getElementById("orderStatus").value,
    comment: document.getElementById("orderComment").value.trim() || null,
    items: items
  };

  showMessage(message, "Сохраняем заказ…");
  button.disabled = true;

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || "Не удалось создать заказ.");

    showMessage(message, "Заказ успешно создан!", "success");
    setTimeout(() => {
      window.location.href = "/orders/" + result.order_id;
    }, 400);
  } catch (err) {
    showMessage(message, err.message || "Ошибка при сохранении заказа.", "error");
    button.disabled = false;
  }
}

async function loadOrders() {
  const tbody = document.getElementById("ordersTableBody");
  const filter = document.getElementById("orderStatusFilter");
  const message = document.getElementById("ordersMessage");
  if (!tbody) return;

  showMessage(message, "Загрузка заказов…");
  const status = filter ? filter.value : "";
  const url = "/api/orders" + (status ? "?status=" + status : "");

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Не удалось загрузить заказы.");

    tbody.replaceChildren();

    if (data.items.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.style.textAlign = "center";
      cell.style.padding = "30px";
      cell.style.color = "#6b7280";
      cell.textContent = "Заказы не найдены.";
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      data.items.forEach(order => {
        const row = document.createElement("tr");

        const statusBadges = {
          "NEW": { label: "🟢 Новый", class: "badge-phone" },
          "IN_PROGRESS": { label: "🟠 В работе", class: "badge-insta" },
          "SHIPPED": { label: "🔵 Отправлен", class: "badge-phone" },
          "DELIVERED": { label: "✅ Доставлен", class: "badge-green" },
          "CANCELLED": { label: "🔴 Отменён", class: "badge" }
        };
        const st = statusBadges[order.status] || { label: order.status, class: "badge" };

        row.innerHTML = `
          <td><span class="id-tag">#${order.id}</span></td>
          <td class="primary-cell"><a href="/customers/${order.customer_id}" style="color: var(--primary);">${order.full_name}</a></td>
          <td>${order.delivery_city || "Минск"}</td>
          <td><strong>${order.total_price} BYN</strong></td>
          <td><span class="badge ${st.class}">${st.label}</span></td>
          <td><span data-date="${order.created_at}">${formatDate(order.created_at)}</span></td>
          <td style="text-align: right;"><a class="button button-secondary" style="padding: 4px 10px; font-size: 12px;" href="/orders/${order.id}">Открыть</a></td>
        `;
        tbody.appendChild(row);
      });
    }
    showMessage(message, "");
  } catch (error) {
    showMessage(message, error.message || "Ошибка загрузки заказов.", "error");
  }
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error("Не удалось обновить статус.");
    alert("Статус заказа обновлен!");
  } catch (e) {
    alert(e.message);
  }
}

async function deleteOrder(orderId) {
  if (!confirm("Вы действительно хотите удалить этот заказ?")) return;
  try {
    const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Не удалось удалить заказ.");
    window.location.href = "/orders";
  } catch (e) {
    alert(e.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const orderFilter = document.getElementById("orderStatusFilter");
  if (orderFilter) {
    orderFilter.addEventListener("change", loadOrders);
    loadOrders();
  }

  const orderForm = document.getElementById("orderForm");
  if (orderForm) {
    orderForm.addEventListener("submit", submitOrderForm);
    addOrderItemRow();
  }
});

// ==========================================

// ==========================================
// PRODUCTS CATALOG & INVENTORY MANAGEMENT
// ==========================================

let allProductsList = [];

async function loadProductsCatalog() {
  const tbody = document.getElementById("productsTableBody");
  const countLabel = document.getElementById("productsCountLabel");
  if (!tbody) return;

  try {
    const res = await fetch("/api/products");
    allProductsList = await res.json();
    renderProductsTable(allProductsList);
  } catch (e) {
    console.error("Error loading products:", e);
  }
}

function renderProductsTable(items) {
  const tbody = document.getElementById("productsTableBody");
  const countLabel = document.getElementById("productsCountLabel");
  if (!tbody) return;

  tbody.replaceChildren();

  if (countLabel) countLabel.textContent = `Всего позиций в каталоге: ${items.length}`;

  if (items.length === 0) {
    tbody.innerHTML = "<tr><td colspan='7' style='text-align:center; padding:30px; color:#6b7280;'>Товары не найдены.</td></tr>";
    return;
  }

  items.forEach(p => {
    const row = document.createElement("tr");

    // Format stock badges for each size
    let stockDisplay = "";
    if (p.sizes) {
      try {
        const stockMap = JSON.parse(p.sizes);
        let badgesHtml = "<div style='display:flex; gap:6px; flex-wrap:wrap;'>";
        let totalUnits = 0;
        for (const [sz, qty] of Object.entries(stockMap)) {
          totalUnits += qty;
          let badgeClass = "badge-green";
          if (qty === 0) badgeClass = "badge"; // Grey
          else if (qty <= 2) badgeClass = "badge-insta"; // Warning pink/orange
          badgesHtml += `<span class="badge ${badgeClass}" style="font-size:11px;">${sz}: <strong>${qty} шт.</strong></span>`;
        }
        badgesHtml += "</div>";
        stockDisplay = badgesHtml;
      } catch (e) {
        stockDisplay = `<span class="muted" style="font-size:12px;">${p.sizes}</span>`;
      }
    } else {
      stockDisplay = "<span class='badge' style='background:#fef2f2; color:#991b1b;'>Нет размеров</span>";
    }

    const mainStockBadge = p.in_stock 
      ? "<span class='badge badge-green' style='margin-bottom:4px;'>В наличии</span>" 
      : "<span class='badge' style='background:#fef2f2; color:#991b1b; margin-bottom:4px;'>Нет на складе</span>";

    row.innerHTML = `
      <td><span class="id-tag">#${p.id}</span></td>
      <td class="primary-cell">${p.name}</td>
      <td><span class="badge">${p.category || 'Каталог'}</span></td>
      <td><strong>${p.price_byn} BYN</strong></td>
      <td>${stockDisplay}</td>
      <td>${mainStockBadge}</td>
      <td style="text-align: right;"><a class="button button-secondary" style="padding: 4px 10px; font-size: 12px;" href="/products/${p.id}/edit">Изменить</a></td>
    `;
    tbody.appendChild(row);
  });
}

function filterProducts() {
  const searchInput = document.getElementById("productSearchInput");
  const catFilter = document.getElementById("productCategoryFilter");
  
  const search = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const category = catFilter ? catFilter.value : "";

  const filtered = allProductsList.filter(p => {
    const matchName = (p.name || "").toLowerCase().includes(search);
    const matchCat = !category || p.category === category;
    return matchName && matchCat;
  });

  renderProductsTable(filtered);
}

// Populate product sizes & stock rows on edit/create page
function initProductSizesStockForm() {
  const container = document.getElementById("sizesStockListContainer");
  if (!container) return;

  const rawInput = document.getElementById("rawProductSizes");
  const rawVal = rawInput ? rawInput.value.trim() : "";

  container.replaceChildren();

  if (rawVal) {
    try {
      // If sizes is already JSON string e.g. {"S": 5, "M": 2}
      const stockMap = JSON.parse(rawVal);
      for (const [sz, qty] of Object.entries(stockMap)) {
        addSizeStockRow(sz, qty);
      }
    } catch (e) {
      // If sizes was old plain text comma separated e.g. "S (Зип кроп-топ), S (Зип классика), M, L, XL"
      const sizesArray = rawVal.split(",").map(s => s.trim()).filter(Boolean);
      sizesArray.forEach(sz => addSizeStockRow(sz, 5)); // Default 5 units for legacy sizes
    }
  } else {
    // Default standard DixonWR sizes if creating a new product
    ["S", "M", "L", "XL"].forEach(sz => addSizeStockRow(sz, 5));
  }
}

function addSizeStockRow(sizeName = "", stockQty = 0) {
  const container = document.getElementById("sizesStockListContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "size-stock-row";
  row.style.cssText = "display: flex; gap: 10px; align-items: center; background: #ffffff; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);";

  row.innerHTML = `
    <div style="flex: 2;">
      <input type="text" class="size-name-input" placeholder="Размер (например, S или M)" value="${sizeName}" required style="font-size: 13px;">
    </div>
    <div style="flex: 1; min-width: 110px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <input type="number" class="size-qty-input" min="0" value="${stockQty}" required style="font-size: 13px; font-weight: 700; text-align: center;">
        <span style="font-size: 12px; color: #6b7280;">шт.</span>
      </div>
    </div>
    <div>
      <button type="button" class="button button-danger" style="padding: 5px 9px; font-size: 13px; line-height: 1;" onclick="removeSizeStockRow(this)">✕</button>
    </div>
  `;

  container.appendChild(row);
}

function removeSizeStockRow(btn) {
  const row = btn.closest(".size-stock-row");
  if (row) row.remove();
}

async function submitProductForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const mode = form.dataset.mode;
  const id = form.dataset.productId;
  const message = document.getElementById("productFormMessage");
  const btn = document.getElementById("saveProductButton");

  // Build sizes JSON dictionary from form rows
  const sizeRows = document.querySelectorAll(".size-stock-row");
  const sizesStockMap = {};
  let totalStockCount = 0;

  sizeRows.forEach(row => {
    const nameInput = row.querySelector(".size-name-input");
    const qtyInput = row.querySelector(".size-qty-input");
    if (nameInput && qtyInput) {
      const szName = nameInput.value.trim();
      const qty = Math.max(0, parseInt(qtyInput.value) || 0);
      if (szName) {
        sizesStockMap[szName] = qty;
        totalStockCount += qty;
      }
    }
  });

  if (Object.keys(sizesStockMap).length === 0) {
    showMessage(message, "Пожалуйста, добавьте хотя бы один размер и его остаток.", "error");
    return;
  }

  const payload = {
    name: document.getElementById("prodName").value.trim(),
    category: document.getElementById("prodCategory").value,
    price_byn: parseFloat(document.getElementById("prodPrice").value) || 0,
    sizes: JSON.stringify(sizesStockMap),
    in_stock: totalStockCount > 0
  };

  btn.disabled = true;
  showMessage(message, "Сохраняем параметры товара…");

  try {
    const url = mode === "edit" ? `/api/products/${id}` : "/api/products";
    const method = mode === "edit" ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Не удалось сохранить товар.");

    showMessage(message, "Товар успешно сохранён!", "success");
    setTimeout(() => { window.location.href = "/products"; }, 400);
  } catch (err) {
    showMessage(message, err.message, "error");
    btn.disabled = false;
  }
}

async function deleteProduct(id) {
  if (!id) return;
  if (!confirm("Вы действительно хотите удалить этот товар из каталога?")) return;

  try {
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Не удалось удалить товар.");
    window.location.href = "/products";
  } catch (e) {
    alert(e.message);
  }
}


// FINANCIAL ANALYTICS LOGIC (/analytics)
// ==========================================

async function loadAnalyticsData() {
  const chartContainer = document.getElementById("analyticsChartContainer");
  if (!chartContainer) return;

  const startInput = document.getElementById("startDate");
  const endInput = document.getElementById("endDate");

  const startVal = startInput ? startInput.value : "";
  const endVal = endInput ? endInput.value : "";

  const params = new URLSearchParams();
  if (startVal) params.append("start_date", startVal);
  if (endVal) params.append("end_date", endVal);

  try {
    const res = await fetch("/api/analytics?" + params.toString());
    if (!res.ok) throw new Error("Не удалось загрузить данные аналитики.");
    const data = await res.json();

    // 1. Fill KPI Cards
    const elRev = document.getElementById("kpiRevenue");
    const elPaidCount = document.getElementById("kpiPaidOrdersCount");
    const elTotOrders = document.getElementById("kpiTotalOrders");
    const elPotRev = document.getElementById("kpiPotentialRevenue");
    const elAvgOrd = document.getElementById("kpiAvgOrder");
    const elAvgLtv = document.getElementById("kpiAvgLtv");

    if (elRev) elRev.textContent = data.revenue_paid + " BYN";
    if (elPaidCount) elPaidCount.textContent = data.paid_orders_count + " доставленных заказов";
    if (elTotOrders) elTotOrders.textContent = data.total_orders_count + " шт.";
    if (elPotRev) elPotRev.textContent = "Общий оборот: " + data.potential_revenue + " BYN";
    if (elAvgOrd) elAvgOrd.textContent = data.avg_order + " BYN";
    if (elAvgLtv) elAvgLtv.textContent = data.avg_ltv + " BYN";

    // 2. Render Revenue Daily Chart
    chartContainer.replaceChildren();
    if (!data.daily_chart || data.daily_chart.length === 0) {
      chartContainer.innerHTML = "<div class='muted' style='margin: auto; padding: 40px;'>Нет данных по продажам за выбранный период.</div>";
    } else {
      const maxDaily = Math.max(...data.daily_chart.map(d => d.daily_sum || 0), 100);

      data.daily_chart.forEach(point => {
        const barWrap = document.createElement("div");
        barWrap.style.cssText = "display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 24px;";

        const heightPercent = Math.max(12, Math.round((point.daily_sum / maxDaily) * 200));

        const valLabel = document.createElement("span");
        valLabel.style.cssText = "font-size: 10px; font-weight: 700; color: var(--primary); margin-bottom: 4px;";
        valLabel.textContent = point.daily_sum > 0 ? point.daily_sum + " BYN" : "";

        const bar = document.createElement("div");
        bar.style.cssText = `width: 100%; max-width: 32px; height: ${heightPercent}px; background: ${point.daily_sum > 0 ? 'var(--primary)' : '#e5e7eb'}; border-radius: 4px 4px 0 0; transition: height 0.3s ease;`;
        bar.title = `${point.order_date}: ${point.daily_sum} BYN (${point.daily_count} зак.)`;

        const dateLabel = document.createElement("span");
        dateLabel.style.cssText = "font-size: 10px; color: #6b7280; margin-top: 6px; transform: rotate(-30deg); transform-origin: left top;";
        dateLabel.textContent = (point.order_date || "").slice(5);

        barWrap.append(valLabel, bar, dateLabel);
        chartContainer.appendChild(barWrap);
      });
    }

    // 3. Render Categories Breakdown
    const catContainer = document.getElementById("categoryStatsContainer");
    if (catContainer) {
      catContainer.replaceChildren();
      if (!data.category_sales || data.category_sales.length === 0) {
        catContainer.innerHTML = "<div class='muted' style='padding: 20px;'>Нет категорий.</div>";
      } else {
        const catTotal = data.category_sales.reduce((acc, c) => acc + (c.cat_sum || 0), 0) || 1;

        data.category_sales.forEach(cat => {
          const item = document.createElement("div");
          item.style.cssText = "padding: 10px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;";

          const share = Math.round(((cat.cat_sum || 0) / catTotal) * 100);

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 4px;">
              <span>${cat.category || 'Без категории'}</span>
              <span style="color: var(--primary);">${cat.cat_sum} BYN (${share}%)</span>
            </div>
            <div style="width: 100%; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden;">
              <div style="width: ${share}%; height: 100%; background: var(--primary); border-radius: 3px;"></div>
            </div>
          `;
          catContainer.appendChild(item);
        });
      }
    }

    // 4. Render Top LTV Leaderboard Table
    const ltvTbody = document.getElementById("topLtvTableBody");
    if (ltvTbody) {
      ltvTbody.replaceChildren();
      if (!data.top_customers || data.top_customers.length === 0) {
        ltvTbody.innerHTML = "<tr><td colspan='7' style='text-align:center; padding:24px;' class='muted'>Пока нет данных по ценности клиентов.</td></tr>";
      } else {
        data.top_customers.forEach((c, index) => {
          const row = document.createElement("tr");
          const rankBadges = ["🥇 1", "🥈 2", "🥉 3"];
          const rankStr = rankBadges[index] || `#${index + 1}`;

          const avgC = roundVal(c.ltv_val / maxOne(c.paid_orders));

          row.innerHTML = `
            <td><strong style="font-size: 14px;">${rankStr}</strong></td>
            <td class="primary-cell"><a href="/customers/${c.id}" style="color: var(--primary);">${c.full_name}</a></td>
            <td>${c.phone || "—"}</td>
            <td>${c.total_orders} / <strong style="color: #10b981;">${c.paid_orders} зак.</strong></td>
            <td><strong style="font-size: 15px; color: var(--primary);">${c.ltv_val} BYN</strong></td>
            <td>${avgC} BYN</td>
            <td style="text-align: right;"><a class="button button-secondary" style="padding: 4px 10px; font-size: 12px;" href="/customers/${c.id}">Карточка</a></td>
          `;
          ltvTbody.appendChild(row);
        });
      }
    }
  } catch (e) {
    console.error("Analytics load error:", e);
  }
}

function roundVal(v) {
  return Math.round((v || 0) * 100) / 100;
}

function maxOne(v) {
  return Math.max(1, v || 1);
}

function setAnalyticsPeriod(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - parseInt(days));

  const startInput = document.getElementById("startDate");
  const endInput = document.getElementById("endDate");

  if (startInput) startInput.value = start.toISOString().split("T")[0];
  if (endInput) endInput.value = end.toISOString().split("T")[0];

  loadAnalyticsData();
}


document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("productsTableBody")) {
    loadProductsCatalog();
  }
  if (document.getElementById("sizesStockListContainer")) {
    initProductSizesStockForm();
  }
  const prodForm = document.getElementById("productForm");
  if (prodForm) {
    prodForm.addEventListener("submit", submitProductForm);
  }
  if (document.getElementById("analyticsChartContainer")) {
    setAnalyticsPeriod("30");
  }
});
