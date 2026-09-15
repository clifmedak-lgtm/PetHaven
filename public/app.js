// ===== Shared state & helpers =====

let currentAuth = JSON.parse(localStorage.getItem('mypetshoppy-auth') || 'null');

function setAuth(data) {
  currentAuth = data;
  localStorage.setItem('mypetshoppy-auth', JSON.stringify(data));
}

function clearAuth() {
  currentAuth = null;
  localStorage.removeItem('mypetshoppy-auth');
}

function loadCart() {
  return JSON.parse(localStorage.getItem('mypetshoppy-cart') || '[]');
}

function saveCart(cart) {
  localStorage.setItem('mypetshoppy-cart', JSON.stringify(cart));
}

function formatMoney(amount) {
  return `${Number(amount || 0).toLocaleString()} CFA`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (currentAuth?.token) headers['Authorization'] = `Bearer ${currentAuth.token}`;

  const res = await fetch(path, { ...options, headers });
  let body;
  try { body = await res.json(); } catch { body = {}; }

  if (!res.ok) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

function setUserDisplay() {
  const accountButton = document.getElementById('account-button');
  const mobileAccountButton = document.getElementById('mobile-account-button');
  const label = currentAuth?.user ? `Hi, ${currentAuth.user.fullName.split(' ')[0]}` : 'Sign in';
  if (accountButton) { accountButton.textContent = label; accountButton.href = 'account.html'; }
  if (mobileAccountButton) { mobileAccountButton.textContent = label; mobileAccountButton.href = 'account.html'; }
}

function updateCartCounter() {
  const count = loadCart().reduce((sum, item) => sum + item.quantity, 0);
  const cartCount = document.getElementById('cart-count');
  if (cartCount) cartCount.textContent = String(count);
}

function toggleCartDrawer(open) {
  const drawer = document.getElementById('cart-drawer');
  if (!drawer) return;
  if (open) { renderCartDrawer(); drawer.classList.remove('hidden'); requestAnimationFrame(() => drawer.classList.add('open')); }
  else { drawer.classList.remove('open'); setTimeout(() => drawer.classList.add('hidden'), 200); }
}

function renderCartDrawer() {
  const container = document.getElementById('cart-items');
  const totalLabel = document.getElementById('cart-total');
  if (!container) return;

  const cart = loadCart();
  if (cart.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500">Your cart is empty. Add pets or supplies to get started.</p>';
    if (totalLabel) totalLabel.textContent = formatMoney(0);
    return;
  }

  let total = 0;
  container.innerHTML = cart.map(item => {
    total += item.price * item.quantity;
    return `
      <div class="flex items-center gap-3 border-b border-gray-100 pb-4 last:border-0">
        ${item.image ? `<img src="${escapeHtml(item.image)}" class="w-14 h-14 rounded-xl object-cover flex-shrink-0">` : '<div class="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">🐾</div>'}
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 truncate">${escapeHtml(item.name)}</p>
          <div class="flex items-center gap-2 mt-1">
            <button data-qty-change="${item.id}" data-delta="-1" class="w-6 h-6 rounded-full border text-sm">-</button>
            <span class="text-sm">${item.quantity}</span>
            <button data-qty-change="${item.id}" data-delta="1" class="w-6 h-6 rounded-full border text-sm">+</button>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-sm font-semibold text-gray-900">${formatMoney(item.price * item.quantity)}</p>
          <button data-remove-item="${item.id}" class="text-xs text-red-500 hover:underline mt-1">Remove</button>
        </div>
      </div>
    `;
  }).join('');

  if (totalLabel) totalLabel.textContent = formatMoney(total);

  container.querySelectorAll('[data-qty-change]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cart = loadCart();
      const item = cart.find(i => i.id === btn.dataset.qtyChange);
      if (!item) return;
      item.quantity = Math.max(1, item.quantity + parseInt(btn.dataset.delta));
      saveCart(cart);
      renderCartDrawer();
      updateCartCounter();
    });
  });
  container.querySelectorAll('[data-remove-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveCart(loadCart().filter(i => i.id !== btn.dataset.removeItem));
      renderCartDrawer();
      updateCartCounter();
    });
  });
}

function addToCart(product) {
  const cart = loadCart();
  const existing = cart.find(i => i.id === product.id);
  if (existing) existing.quantity += 1;
  else cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1 });
  saveCart(cart);
  updateCartCounter();
}

function initHeaderEvents() {
  document.getElementById('cart-open-button')?.addEventListener('click', () => toggleCartDrawer(true));
  document.getElementById('close-cart-drawer')?.addEventListener('click', () => toggleCartDrawer(false));
  document.getElementById('checkout-button')?.addEventListener('click', () => { window.location.href = 'checkout.html'; });

  function wireHeaderSearch(formId, inputId) {
    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = input?.value?.trim();
      window.location.href = `index.html${query ? `?search=${encodeURIComponent(query)}` : ''}#products`;
    });
  }
  wireHeaderSearch('desktop-search', 'desktop-search-input');
  wireHeaderSearch('mobile-search', 'mobile-search-input');

  const mobileButton = document.getElementById('mobile-menu-button');
  const mobileMenu = document.getElementById('mobile-menu');
  if (mobileButton && mobileMenu) {
    mobileButton.addEventListener('click', () => {
      const expanded = mobileButton.getAttribute('aria-expanded') === 'true';
      mobileButton.setAttribute('aria-expanded', String(!expanded));
      mobileMenu.classList.toggle('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.add-cart-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    apiFetch(`/api/products?id=${encodeURIComponent(id)}`).then(product => {
      addToCart(product);
      toggleCartDrawer(true);
    }).catch(() => {});
  });
}

// ===== Product rendering =====

function renderStars(rating) {
  const full = Math.round(rating || 0);
  return Array.from({ length: 5 }, (_, i) => i < full ? '★' : '☆').join('');
}

function renderProductCard(p) {
  const { id, name, price, image, category, breed, age, rating, stock } = p;
  const imageHtml = image
    ? `<img loading="lazy" src="${escapeHtml(image)}" alt="${escapeHtml(name)}" class="h-64 w-full object-cover transition duration-500 group-hover:scale-105">`
    : `<div class="h-64 w-full bg-gray-100 flex items-center justify-center text-5xl">🐾</div>`;
  const metaLine = [breed, age].filter(Boolean).map(escapeHtml).join(' · ');

  return `
    <a href="product.html?id=${encodeURIComponent(id)}" class="group rounded-3xl overflow-hidden bg-white shadow-sm hover:shadow-lg transition block">
      <div class="overflow-hidden">${imageHtml}</div>
      <div class="p-5">
        <p class="text-xs uppercase tracking-wide text-emerald-600 font-semibold">${escapeHtml(category)}</p>
        <h3 class="mt-1 font-bold text-gray-900 line-clamp-1">${escapeHtml(name)}</h3>
        ${metaLine ? `<p class="text-xs text-gray-500 mt-0.5">${metaLine}</p>` : ''}
        ${p.description ? `<p class="mt-2 text-sm text-gray-500 line-clamp-3">${escapeHtml(p.description)}</p>` : ''}
        <div class="mt-3 flex items-center justify-between">
          <span class="text-lg font-extrabold text-emerald-600">${formatMoney(price)}</span>
          ${rating ? `<span class="text-xs text-yellow-600">${rating.toFixed(1)} ★</span>` : ''}
        </div>
        ${stock <= 0 ? '<p class="mt-2 text-xs font-semibold text-red-600">Out of stock</p>' : ''}
        <button data-id="${id}" class="add-cart-btn mt-3 w-full rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition" ${stock <= 0 ? 'disabled' : ''}>Add to cart</button>
      </div>
    </a>
  `;
}

async function loadProducts(listNode, searchInput, category = 'all') {
  const query = searchInput?.value?.trim().toLowerCase() || getQueryParam('search') || '';
  const categoryQuery = category !== 'all' ? `&category=${encodeURIComponent(category)}` : '';
  const priceMin = document.getElementById('price-min-input')?.value;
  const priceMax = document.getElementById('price-max-input')?.value;
  const priceQuery = `${priceMin ? `&priceMin=${encodeURIComponent(priceMin)}` : ''}${priceMax ? `&priceMax=${encodeURIComponent(priceMax)}` : ''}`;
  let products = [];

  if (listNode) {
    listNode.innerHTML = Array(4).fill('').map(() => `
      <div class="animate-pulse rounded-3xl overflow-hidden bg-white shadow-sm">
        <div class="h-64 w-full bg-gray-200"></div>
        <div class="p-5 space-y-3">
          <div class="h-3 bg-gray-200 rounded w-1/3"></div>
          <div class="h-4 bg-gray-200 rounded w-3/4"></div>
          <div class="h-10 bg-gray-200 rounded-full mt-4"></div>
        </div>
      </div>
    `).join('');
  }

  try {
    products = await apiFetch(`/api/products?search=${encodeURIComponent(query)}${categoryQuery}${priceQuery}`);
  } catch (err) {
    if (listNode) listNode.innerHTML = '<div class="col-span-full rounded-3xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-red-500">Unable to load products.</div>';
    return;
  }

  if (!listNode) return;
  if (products.length === 0) {
    listNode.innerHTML = '<div class="col-span-full rounded-3xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">No pets or products matched your search.</div>';
    return;
  }
  listNode.innerHTML = products.map(renderProductCard).join('');
}

async function loadRecommendations(listNode, category) {
  if (!listNode) return;
  try {
    const products = await apiFetch(`/api/recommendations${category ? `?category=${encodeURIComponent(category)}` : ''}`);
    listNode.innerHTML = products.map(renderProductCard).join('');
  } catch (err) {
    listNode.innerHTML = '';
  }
}

let selectedCategory = 'all';
function attachCategoryFilters() {
  document.querySelectorAll('[data-category-filter]').forEach(btn => {
    btn.addEventListener('click', async () => {
      selectedCategory = btn.dataset.categoryFilter;
      document.querySelectorAll('[data-category-filter]').forEach(b => b.classList.toggle('bg-emerald-600', b === btn));
      document.querySelectorAll('[data-category-filter]').forEach(b => b.classList.toggle('text-white', b === btn));
      await loadProducts(document.getElementById('products-list'), document.getElementById('search-input'), selectedCategory);
    });
  });
}

// ===== Page initializers =====

async function initIndexPage() {
  attachCategoryFilters();
  const searchInput = document.getElementById('search-input');
  if (searchInput && getQueryParam('search')) searchInput.value = getQueryParam('search');

  const debounce = (fn, wait = 250) => {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  };
  searchInput?.addEventListener('input', debounce(async () => {
    await loadProducts(document.getElementById('products-list'), document.getElementById('search-input'), selectedCategory);
  }, 200));
  const rerunSearch = debounce(async () => {
    await loadProducts(document.getElementById('products-list'), document.getElementById('search-input'), selectedCategory);
  }, 300);
  document.getElementById('price-min-input')?.addEventListener('input', rerunSearch);
  document.getElementById('price-max-input')?.addEventListener('input', rerunSearch);

  await loadProducts(document.getElementById('products-list'), searchInput, selectedCategory);
  await loadRecommendations(document.getElementById('recommendations-list'));
}

async function initWishlistButton(productId) {
  const btn = document.getElementById('wishlist-toggle');
  if (!btn) return;
  if (!currentAuth?.token) {
    btn.addEventListener('click', () => { window.location.href = 'account.html'; });
    return;
  }
  let isSaved = false;
  try {
    const wishlist = await apiFetch('/api/wishlist');
    isSaved = wishlist.some(p => p.id === productId);
  } catch (err) { /* non-critical */ }

  const render = () => { btn.textContent = isSaved ? '❤️ Saved' : '🤍 Save'; };
  render();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (isSaved) await apiFetch(`/api/wishlist/${encodeURIComponent(productId)}`, { method: 'DELETE' });
      else await apiFetch(`/api/wishlist/${encodeURIComponent(productId)}`, { method: 'POST' });
      isSaved = !isSaved;
      render();
    } catch (err) {
      alert(err.body?.message || err.message || 'Something went wrong.');
    } finally {
      btn.disabled = false;
    }
  });
}

async function initProductReviews(productId) {
  const container = document.getElementById('product-reviews');
  if (!container) return;

  async function renderReviews() {
    let data;
    try { data = await apiFetch(`/api/products/${encodeURIComponent(productId)}/reviews`); }
    catch (err) { container.innerHTML = '<p class="text-sm text-red-600">Unable to load reviews.</p>'; return; }

    const summaryHtml = data.summary.count
      ? `<div class="flex items-center gap-2 mb-6">
           <span class="text-2xl text-yellow-500">${renderStars(data.summary.average)}</span>
           <span class="text-sm text-slate-600">${data.summary.average.toFixed(1)} out of 5 (${data.summary.count} review${data.summary.count > 1 ? 's' : ''})</span>
         </div>`
      : '<p class="text-sm text-slate-500 mb-6">No reviews yet — be the first to review this listing.</p>';

    const reviewsHtml = data.reviews.map(r => `
      <div class="border-b border-slate-100 py-4 last:border-0">
        <div class="flex items-center gap-2">
          <span class="text-yellow-500">${renderStars(r.rating)}</span>
          <span class="text-sm font-semibold text-slate-900">${escapeHtml(r.reviewerName)}</span>
          ${r.verifiedPurchase ? '<span class="text-xs text-green-600 bg-green-50 rounded-full px-2 py-0.5">Verified purchase</span>' : ''}
        </div>
        ${r.comment ? `<p class="mt-2 text-sm text-slate-600">${escapeHtml(r.comment)}</p>` : ''}
        <p class="mt-1 text-xs text-slate-400">${new Date(r.createdAt).toLocaleDateString()}</p>
      </div>
    `).join('');

    const formHtml = currentAuth?.token ? `
      <form id="review-form" class="mt-6 rounded-2xl border border-slate-200 p-4 space-y-3">
        <p class="text-sm font-semibold text-slate-900">Leave a review</p>
        <div class="flex gap-1" id="review-star-input">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-value="${n}" class="review-star text-2xl text-slate-300">★</button>`).join('')}
        </div>
        <input type="hidden" name="rating" required />
        <textarea name="comment" rows="3" placeholder="Optional comment..." class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"></textarea>
        <button type="submit" class="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Submit review</button>
        <p id="review-form-status" class="text-sm"></p>
      </form>
    ` : `<p class="mt-6 text-sm text-slate-500"><a href="account.html" class="text-emerald-600 underline">Sign in</a> to leave a review.</p>`;

    container.innerHTML = `<h2 class="text-lg font-semibold text-slate-900 mb-2">Customer reviews</h2>${summaryHtml}${reviewsHtml}${formHtml}`;

    const starButtons = container.querySelectorAll('.review-star');
    const ratingInput = container.querySelector('input[name="rating"]');
    starButtons.forEach(star => {
      star.addEventListener('click', () => {
        const value = parseInt(star.dataset.value);
        ratingInput.value = value;
        starButtons.forEach(s => {
          s.classList.toggle('text-yellow-500', parseInt(s.dataset.value) <= value);
          s.classList.toggle('text-slate-300', parseInt(s.dataset.value) > value);
        });
      });
    });

    container.querySelector('#review-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = container.querySelector('#review-form-status');
      if (!ratingInput.value) {
        status.textContent = 'Please select a star rating.';
        status.className = 'text-sm text-red-600';
        return;
      }
      try {
        await apiFetch(`/api/products/${encodeURIComponent(productId)}/reviews`, {
          method: 'POST',
          body: JSON.stringify({ rating: ratingInput.value, comment: e.target.querySelector('textarea[name="comment"]').value })
        });
        await renderReviews();
      } catch (err) {
        status.textContent = err.body?.message || err.message || 'Failed to submit review.';
        status.className = 'text-sm text-red-600';
      }
    });
  }

  await renderReviews();
}

async function initProductPage() {
  const productId = getQueryParam('id');
  const detailNode = document.getElementById('product-detail');
  if (!detailNode) return;
  if (!productId) {
    detailNode.innerHTML = '<p class="text-sm text-gray-500">Listing not found.</p>';
    return;
  }
  try {
    const product = await apiFetch(`/api/products?id=${encodeURIComponent(productId)}`);
    const imageHtml = product.image
      ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="h-96 w-full object-cover">`
      : `<div class="h-96 w-full bg-gray-100 flex items-center justify-center text-6xl text-gray-400">🐾</div>`;

    const featuresHtml = (product.features || []).length
      ? `<ul class="mt-4 space-y-1.5 list-disc list-inside text-sm text-slate-700">${product.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
      : '';
    const metaLine = [product.breed, product.age].filter(Boolean).map(escapeHtml).join(' · ');

    detailNode.innerHTML = `
      <div class="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] items-start">
        <div class="overflow-hidden rounded-3xl bg-white shadow-sm">${imageHtml}</div>
        <div class="space-y-6">
          <div class="rounded-3xl bg-white p-6 shadow-sm">
            <span class="badge-pill bg-emerald-50 text-emerald-700">${escapeHtml(product.category)}</span>
            <h1 class="mt-4 text-3xl font-bold text-slate-900">${escapeHtml(product.name)}</h1>
            ${metaLine ? `<p class="mt-1 text-sm text-slate-500">${metaLine}</p>` : ''}
            ${featuresHtml}
            <div class="mt-6 flex items-center gap-4">
              <span class="text-3xl font-extrabold text-emerald-600">${formatMoney(product.price)}</span>
              ${product.rating ? `<span class="text-sm text-yellow-600">${product.rating.toFixed(1)} ★</span>` : ''}
            </div>
            ${product.stock <= 0 ? '<p class="mt-2 text-sm font-semibold text-red-600">Currently unavailable</p>' : ''}
            <div class="mt-6 flex flex-wrap gap-3">
              <button id="product-add-cart" class="rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition" ${product.stock <= 0 ? 'disabled' : ''}>Add to cart</button>
              <button id="view-cart-button" class="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:border-emerald-600 hover:text-emerald-600 transition">View cart</button>
              <button id="wishlist-toggle" class="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:border-pink-500 hover:text-pink-600 transition">🤍 Save</button>
            </div>
          </div>
          <div class="rounded-3xl bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Seller details</h2>
            <p class="mt-3 text-sm text-slate-500">Listed by <strong>${escapeHtml(product.vendor)}</strong>. Secure payment, verified seller.</p>
          </div>
        </div>
      </div>
      <div class="mt-8 rounded-3xl bg-white p-6 shadow-sm">
        <h2 class="text-lg font-semibold text-slate-900 mb-3">Full description</h2>
        <p class="text-sm text-slate-600 leading-relaxed whitespace-pre-line">${escapeHtml(product.description) || 'No description provided.'}</p>
      </div>
      <div id="product-reviews" class="mt-10 rounded-3xl bg-white p-6 shadow-sm"></div>
    `;
    document.getElementById('product-add-cart')?.addEventListener('click', () => { addToCart(product); toggleCartDrawer(true); });
    document.getElementById('view-cart-button')?.addEventListener('click', () => toggleCartDrawer(true));
    initWishlistButton(productId);
    initProductReviews(productId);
    await loadRecommendations(document.getElementById('recommendations-list'), product.category);
  } catch (err) {
    detailNode.innerHTML = '<p class="text-sm text-red-600">Unable to load this listing.</p>';
  }
}

async function pollPaymentStatus(orderId, status, attempt = 0) {
  try {
    const result = await apiFetch(`/api/payment/status/${encodeURIComponent(orderId)}`);
    if (result.paymentStatus === 'PAID') {
      saveCart([]);
      updateCartCounter();
      if (status) { status.textContent = 'Payment confirmed! Your order is being prepared.'; status.className = 'mt-2 text-center text-sm font-medium text-green-600'; }
      setTimeout(() => { window.location.href = 'account.html'; }, 2500);
      return;
    }
    if (result.paymentStatus === 'FAILED') {
      if (status) { status.textContent = 'Payment failed or was cancelled. Please try again.'; status.className = 'mt-2 text-center text-sm font-medium text-red-600'; }
      return;
    }
    if (attempt < 24) {
      if (status) { status.textContent = 'Waiting for payment confirmation...'; status.className = 'mt-2 text-center text-sm font-medium text-blue-600'; }
      setTimeout(() => pollPaymentStatus(orderId, status, attempt + 1), 5000);
    } else if (status) {
      status.textContent = 'Still waiting for payment confirmation. Check your order history shortly.';
      status.className = 'mt-2 text-center text-sm font-medium text-yellow-600';
    }
  } catch (err) {
    if (status) { status.textContent = 'Unable to verify payment status.'; status.className = 'mt-2 text-center text-sm font-medium text-red-600'; }
  }
}

async function initCheckoutPage() {
  const itemsContainer = document.getElementById('checkout-items');
  const totalContainer = document.getElementById('checkout-total');
  const form = document.getElementById('checkout-form');
  const status = document.getElementById('checkout-status');
  if (!itemsContainer || !totalContainer) return;

  const returningOrderId = getQueryParam('order');
  if (returningOrderId) {
    if (form) form.classList.add('hidden');
    itemsContainer.innerHTML = '<p class="text-sm text-gray-500">Checking your payment...</p>';
    if (!currentAuth?.token) { if (status) status.textContent = 'Sign in to confirm your payment status.'; return; }
    await pollPaymentStatus(returningOrderId, status);
    return;
  }

  if (!currentAuth?.token) {
    itemsContainer.innerHTML = '<p class="text-sm text-gray-500">Please sign in to checkout.</p>';
    totalContainer.textContent = formatMoney(0);
    if (form) form.classList.add('hidden');
    if (status) { status.innerHTML = '<a href="account.html" class="text-emerald-600 underline">Sign in or create an account</a> to place your order.'; status.className = 'mt-2 text-center text-sm font-medium text-slate-600'; }
    return;
  }

  const cartItems = loadCart();
  if (cartItems.length === 0) {
    itemsContainer.innerHTML = '<p class="text-sm text-gray-500">Your cart is empty.</p>';
    totalContainer.textContent = formatMoney(0);
    if (form) { const btn = form.querySelector('button[type="submit"]'); if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); } }
    return;
  }

  let total = 0;
  itemsContainer.innerHTML = cartItems.map(item => {
    total += item.price * item.quantity;
    const imgHtml = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="w-14 h-14 rounded-xl object-cover flex-shrink-0">`
      : `<div class="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-xl">🐾</div>`;
    return `
      <div class="flex items-center gap-3 border-b border-gray-100 pb-4 last:border-0 last:pb-0">
        ${imgHtml}
        <div class="flex-1 flex items-center justify-between gap-2">
          <div><h3 class="font-semibold text-gray-900 text-sm leading-tight">${escapeHtml(item.name)}</h3><p class="text-xs text-gray-500 mt-0.5">Qty: ${item.quantity}</p></div>
          <p class="font-semibold text-gray-900 text-sm flex-shrink-0">${formatMoney(item.price * item.quantity)}</p>
        </div>
      </div>
    `;
  }).join('');

  let deliveryFee = 0;
  try {
    const config = await apiFetch('/api/config');
    deliveryFee = config.deliveryFeeXaf || 0;
  } catch (err) { /* fall back to items-only total */ }

  const deliveryFeeEl = document.getElementById('checkout-delivery-fee');
  if (deliveryFeeEl) deliveryFeeEl.textContent = formatMoney(deliveryFee);

  let appliedDiscount = 0;
  let appliedCouponCode = '';
  const discountRow = document.getElementById('checkout-discount-row');
  const discountAmountEl = document.getElementById('checkout-discount');

  function renderCheckoutTotal() { totalContainer.textContent = formatMoney(total - appliedDiscount + deliveryFee); }
  renderCheckoutTotal();

  document.getElementById('coupon-apply-button')?.addEventListener('click', async () => {
    const codeInput = document.getElementById('coupon-input');
    const code = codeInput?.value?.trim();
    const couponStatus = document.getElementById('coupon-status');
    if (!code) return;
    try {
      const result = await apiFetch('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code, itemsSubtotal: total }) });
      appliedDiscount = result.discountAmount;
      appliedCouponCode = code;
      if (discountRow) { discountRow.classList.remove('hidden'); discountRow.classList.add('flex'); }
      if (discountAmountEl) discountAmountEl.textContent = `- ${formatMoney(appliedDiscount)}`;
      if (couponStatus) { couponStatus.textContent = 'Coupon applied!'; couponStatus.className = 'mt-2 text-xs text-green-600'; }
      renderCheckoutTotal();
    } catch (err) {
      appliedDiscount = 0; appliedCouponCode = '';
      if (discountRow) { discountRow.classList.add('hidden'); discountRow.classList.remove('flex'); }
      if (couponStatus) { couponStatus.textContent = err.body?.message || err.message || 'Invalid coupon code'; couponStatus.className = 'mt-2 text-xs text-red-600'; }
      renderCheckoutTotal();
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    if (status) { status.textContent = 'Creating your order...'; status.className = 'mt-2 text-center text-sm font-medium text-blue-600'; }

    const shippingAddress = document.getElementById('shipping-address')?.value?.trim() || '';
    const shippingCity = document.getElementById('shipping-city')?.value?.trim() || '';
    const shippingPhone = document.getElementById('shipping-phone')?.value?.trim() || '';
    const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked')?.value || 'MOMO';

    try {
      const checkoutResult = await apiFetch('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ items: cartItems, shippingAddress, shippingCity, shippingPhone, couponCode: appliedCouponCode || undefined })
      });
      if (status) status.textContent = 'Redirecting to secure payment...';
      const paymentResult = await apiFetch('/api/payment/initiate', { method: 'POST', body: JSON.stringify({ orderId: checkoutResult.order.id, paymentMethod }) });
      window.location.href = paymentResult.paymentUrl;
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      if (status) {
        if (err.body?.outOfStock?.length) {
          const list = err.body.outOfStock.map(i => `${escapeHtml(i.name)} (only ${i.available} left, you asked for ${i.requested})`).join(', ');
          status.textContent = `Not available: ${list}. Please adjust your cart.`;
        } else {
          status.textContent = err.body?.message || err.message || 'Failed to place order. Try again.';
        }
        status.className = 'mt-2 text-center text-sm font-medium text-red-600';
      }
    }
  });
}

async function loadOrderHistory() {
  const ordersContainer = document.getElementById('order-history');
  if (!ordersContainer) return;
  if (!currentAuth?.token) { ordersContainer.innerHTML = '<p class="text-sm text-gray-500">Sign in to view your orders.</p>'; return; }
  try {
    const orders = await apiFetch('/api/orders');
    if (orders.length === 0) { ordersContainer.innerHTML = '<p class="text-sm text-gray-500">No orders yet.</p>'; return; }
    ordersContainer.innerHTML = orders.map(o => `
      <div class="border-b border-slate-100 py-4 last:border-0">
        <div class="flex justify-between items-center">
          <p class="text-sm font-semibold text-slate-900">Order #${o.id.slice(0, 10)}...</p>
          <span class="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-700">${o.status}</span>
        </div>
        <p class="text-xs text-slate-500 mt-1">${new Date(o.createdAt).toLocaleDateString()} — ${formatMoney(o.totalAmount)}</p>
        <p class="text-xs text-slate-400 mt-1">${o.items.map(i => `${i.product?.name || 'Item'} x${i.quantity}`).join(', ')}</p>
      </div>
    `).join('');
  } catch (error) {
    ordersContainer.innerHTML = '<p class="text-sm text-red-600">Unable to load orders at this time.</p>';
  }
}

async function loadWishlist() {
  const container = document.getElementById('wishlist-items');
  if (!container) return;
  if (!currentAuth?.token) { container.innerHTML = '<p class="text-sm text-gray-500">Sign in to view your wishlist.</p>'; return; }
  try {
    const products = await apiFetch('/api/wishlist');
    if (products.length === 0) { container.innerHTML = '<p class="text-sm text-gray-500 col-span-full">No saved listings yet.</p>'; return; }
    container.innerHTML = products.map(p => `
      <div class="rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
        ${p.image ? `<img src="${escapeHtml(p.image)}" class="w-16 h-16 rounded-xl object-cover flex-shrink-0">` : '<div class="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-2xl flex-shrink-0">🐾</div>'}
        <div class="flex-1 min-w-0">
          <a href="product.html?id=${encodeURIComponent(p.id)}" class="text-sm font-semibold text-slate-900 hover:text-emerald-600 truncate block">${escapeHtml(p.name)}</a>
          <p class="text-sm text-emerald-600 font-semibold mt-1">${formatMoney(p.price)}</p>
        </div>
        <button data-remove-wishlist="${p.id}" class="text-slate-400 hover:text-red-600 text-lg flex-shrink-0">✕</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-remove-wishlist]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await apiFetch(`/api/wishlist/${encodeURIComponent(btn.dataset.removeWishlist)}`, { method: 'DELETE' }); await loadWishlist(); }
        catch (err) { alert(err.body?.message || err.message || 'Failed to remove item.'); }
      });
    });
  } catch (error) {
    container.innerHTML = '<p class="text-sm text-red-600 col-span-full">Unable to load wishlist at this time.</p>';
  }
}

async function initAccountPage() {
  const authArea = document.getElementById('auth-area');
  const profileArea = document.getElementById('profile-area');

  if (currentAuth?.user && authArea && profileArea) {
    authArea.classList.add('hidden');
    profileArea.classList.remove('hidden');
    document.getElementById('profile-name').textContent = currentAuth.user.fullName;
    document.getElementById('profile-email').textContent = currentAuth.user.email;
    document.getElementById('signout-button')?.addEventListener('click', () => { clearAuth(); window.location.reload(); });
  }

  document.getElementById('login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const email = form.querySelector('input[name="email"]').value;
    const password = form.querySelector('input[name="password"]').value;
    try {
      const result = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setAuth(result);
      window.location.reload();
    } catch (err) { alert(err.body?.message || err.message || 'Login failed'); }
  });

  document.getElementById('signup-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const fullName = form.querySelector('input[name="fullName"]').value;
    const email = form.querySelector('input[name="email"]').value;
    const password = form.querySelector('input[name="password"]').value;
    try {
      const result = await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName, email, password }) });
      setAuth(result);
      window.location.reload();
    } catch (err) { alert(err.body?.message || err.message || 'Registration failed'); }
  });

  const forgotForm = document.getElementById('forgot-password-form');
  document.getElementById('forgot-password-toggle')?.addEventListener('click', () => forgotForm?.classList.toggle('hidden'));
  forgotForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const email = form.querySelector('input[name="email"]').value;
    const status = document.getElementById('forgot-password-status');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const result = await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      if (status) { status.textContent = result.message || 'If that email is registered, a reset link has been sent.'; status.className = 'text-sm text-center text-green-600'; }
    } catch (err) {
      if (status) { status.textContent = err.body?.message || err.message || 'Something went wrong. Try again.'; status.className = 'text-sm text-center text-red-600'; }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  loadOrderHistory();
  loadWishlist();
}

// ===== Router =====

async function initPage() {
  setUserDisplay();
  updateCartCounter();
  initHeaderEvents();

  const page = document.body.dataset.page;
  if (page === 'index') await initIndexPage();
  if (page === 'product') await initProductPage();
  if (page === 'checkout') await initCheckoutPage();
  if (page === 'account') await initAccountPage();
}

document.addEventListener('DOMContentLoaded', initPage);