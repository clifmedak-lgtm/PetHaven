/**
 * PETHAVEN - Master Frontend Controller
 
 */

const storage = {
    cart: 'pethaven-cart',
    auth: 'pethaven-auth',
    user: 'pethaven-user',
};

const pageName = document.body.dataset.page || 'index';
let currentAuth = loadAuth();
let selectedCategory = 'all';

// --- PERSISTENCE LAYER ---
function loadAuth() {
    try { return JSON.parse(localStorage.getItem(storage.auth) || 'null'); } catch { return null; }
}

function saveAuth(auth) {
    localStorage.setItem(storage.auth, JSON.stringify(auth));
}

function clearAuth() {
    localStorage.removeItem(storage.auth);
}

function setAuth(auth) {
    currentAuth = auth;
    if (auth) saveAuth(auth);
    else clearAuth();
}

function loadCart() {
    try { return JSON.parse(localStorage.getItem(storage.cart) || '[]'); } catch { return []; }
}

function saveCart(items) {
    localStorage.setItem(storage.cart, JSON.stringify(items));
}

// --- MONETARY FORMATTING ---
function formatMoney(value) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 })
        .format(value);
}

// --- BULKY API WRAPPER ---
function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (currentAuth?.token) headers.Authorization = `Bearer ${currentAuth.token}`;
    return fetch(path, { ...options, headers }).then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(body?.message || 'API error');
            err.body = body;
            throw err;
        }
        return body;
    });
}

function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- DYNAMIC HEADER STATE ---
function setUserDisplay() {
    const accountButton = document.getElementById('account-button');
    const mobileAccountButton = document.getElementById('mobile-account-button');
    const label = currentAuth?.user ? `Hi, ${currentAuth.user.fullName.split(' ')[0]}` : 'Sign in';
    if (accountButton) {
        accountButton.textContent = label;
        accountButton.href = 'account.html';
    }
    if (mobileAccountButton) {
        mobileAccountButton.textContent = label;
        mobileAccountButton.href = 'account.html';
    }
}

function updateCartCounter() {
    const count = loadCart().reduce((sum, item) => sum + item.quantity, 0);
    const cartCount = document.getElementById('cart-count');
    if (cartCount) cartCount.textContent = String(count);
}

function toggleCartDrawer(open) {
    const drawer = document.getElementById('cart-drawer');
    if (!drawer) return;
    if (open) {
        drawer.classList.remove('hidden');
        drawer.classList.add('open');
        drawer.removeAttribute('aria-hidden');
    } else {
        drawer.classList.remove('open');
        drawer.classList.add('hidden');
        drawer.setAttribute('aria-hidden', 'true');
    }
}

// --- CART RENDERER ---
function renderCartItems() {
    const cartItems = loadCart();
    const container = document.getElementById('cart-items');
    const totalLabel = document.getElementById('cart-total');
    if (!container || !totalLabel) return;
    if (cartItems.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 py-10 text-center">Your basket is empty. Add companions from the store.</p>';
        totalLabel.textContent = '0 CFA';
        return;
    }

    container.innerHTML = '';
    let total = 0;
    cartItems.forEach((item) => {
        total += item.price * item.quantity;
        const row = document.createElement('div');
        row.className = 'rounded-3xl border border-gray-200 p-4 mb-4';
        const imgHtml = item.image
            ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="w-16 h-16 rounded-2xl object-cover flex-shrink-0">`
            : `<div class="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-2xl">🐾</div>`;
        row.innerHTML = `
      <div class="flex items-start gap-4">
        ${imgHtml}
        <div class="flex-1 flex items-start justify-between gap-2">
          <div>
            <p class="text-[10px] uppercase font-black text-emerald-600">${escapeHtml(item.vendor)}</p>
            <h3 class="font-bold text-gray-900 text-sm leading-tight">${escapeHtml(item.name)}</h3>
            <p class="mt-1 text-xs text-gray-500">Qty: ${item.quantity}</p>
          </div>
          <div class="text-right flex-shrink-0">
            <p class="font-bold text-gray-900 text-sm">${formatMoney(item.price * item.quantity)}</p>
            <button data-id="${escapeHtml(item.id)}" class="remove-cart-item mt-2 text-xs text-red-600 font-bold hover:underline">Remove</button>
          </div>
        </div>
      </div>
    `;
        container.appendChild(row);
    });

    totalLabel.textContent = formatMoney(total);
    container.querySelectorAll('.remove-cart-item').forEach(button => {
        button.addEventListener('click', event => {
            const id = event.currentTarget.dataset.id;
            if (!id) return;
            const items = loadCart();
            saveCart(items.filter(it => String(it.id) !== String(id)));
            renderCartItems();
            updateCartCounter();
        });
    });
}

function addToCart(product) {
    const items = loadCart();
    const existing = items.find(item => item.id === product.id);
    if (existing) existing.quantity += 1;
    else items.push({ ...product, quantity: 1 });
    saveCart(items);
    updateCartCounter();
    renderCartItems();
}

// --- CLOUDINARY UPLOADER ---
function uploadImage(file) {
    if (!file) return Promise.reject(new Error('No file selected'));
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            apiFetch('/api/upload/image', {
                method: 'POST',
                body: JSON.stringify({ image: reader.result })
            }).then(resolve).catch(reject);
        };
        reader.onerror = () => reject(new Error('Unable to read file'));
        reader.readAsDataURL(file);
    });
}

// --- DYNAMIC CARD RENDERER ---
function renderProductCard(product) {
    const name = escapeHtml(product.name);
    const vendor = escapeHtml(product.vendor);
    const description = escapeHtml(product.description);
    const image = escapeHtml(product.image || '');
    const id = escapeHtml(product.id);
    const breed = escapeHtml(product.breed || '');

    const imageHtml = image
        ? `<img loading="lazy" src="${image}" alt="${name}" class="h-64 w-full object-cover transition duration-700 group-hover:scale-110">`
        : `<div class="h-64 w-full bg-gray-100 flex items-center justify-center text-4xl text-gray-400">🐾</div>`;

    return `
    <article class="group rounded-[2rem] overflow-hidden bg-white shadow-sm transition hover:shadow-2xl border border-slate-100 pet-card">
      <a href="product.html?id=${product.id}" class="block relative overflow-hidden">
        ${imageHtml}
        ${breed ? `<div class="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-black text-emerald-600 uppercase tracking-widest">${breed}</div>` : ''}
      </a>
      <div class="p-6">
        <a href="product.html?id=${id}" class="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-emerald-600">${vendor}</a>
        <h3 class="mt-2 text-xl font-bold text-gray-900 truncate"><a href="product.html?id=${id}">${name}</a></h3>
        <p class="mt-2 text-sm text-gray-500 line-clamp-2">${description}</p>
        <div class="mt-6 flex items-center justify-between gap-2">
          <div>
            <span class="text-2xl font-black text-emerald-600">${formatMoney(product.price)}</span>
            ${product.rating ? `<span class="ml-2 text-xs font-bold text-amber-500">★ ${product.rating.toFixed(1)}</span>` : ''}
          </div>
          <button data-id="${id}" class="add-cart-btn bg-emerald-600 text-white p-3 rounded-2xl hover:bg-emerald-700 transition shadow-lg shadow-emerald-100">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"/></svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

// --- MASSIVE PRODUCT LOADER ---
async function loadProducts(listNode, searchInput, category = 'all') {
    const query = searchInput?.value?.trim().toLowerCase() || '';
    const categoryQuery = category !== 'all' ? `&category=${encodeURIComponent(category)}` : '';
    const priceMin = document.getElementById('price-min-input')?.value;
    const priceMax = document.getElementById('price-max-input')?.value;
    const priceQuery = `${priceMin ? `&priceMin=${encodeURIComponent(priceMin)}` : ''}${priceMax ? `&priceMax=${encodeURIComponent(priceMax)}` : ''}`;

    if (listNode) {
        listNode.innerHTML = Array(4).fill('').map(() => `
      <div class="animate-pulse rounded-[2.5rem] overflow-hidden bg-white shadow-sm">
        <div class="h-64 w-full bg-gray-200"></div>
        <div class="p-8 space-y-4">
          <div class="h-3 bg-gray-200 rounded w-1/3"></div>
          <div class="h-4 bg-gray-200 rounded w-3/4"></div>
          <div class="h-10 bg-gray-200 rounded-2xl mt-4"></div>
        </div>
      </div>`).join('');
    }

    try {
        const products = await apiFetch(`/api/products?search=${encodeURIComponent(query)}${categoryQuery}${priceQuery}`);
        if (!listNode) return;
        if (products.length === 0) {
            listNode.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500 font-bold">No pets match your search criteria.</div>';
            return;
        }
        listNode.innerHTML = products.map(renderProductCard).join('');
    } catch (err) {
        if (listNode) listNode.innerHTML = '<div class="col-span-full text-center py-20 text-red-500 font-bold">Failed to load the kennel inventory.</div>';
    }
}

// --- DUAL-SEARCH HEADER LOGIC (1:1 FROM GLOBALMART) ---
function wireHeaderSearch(formId, inputId) {
    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    if (!form || !input) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const mainSearchInput = document.getElementById('search-input');
        if (mainSearchInput) {
            mainSearchInput.value = input.value;
            document.getElementById('search-panel')?.scrollIntoView({ behavior: 'smooth' });
            await loadProducts(document.getElementById('products-list'), mainSearchInput, selectedCategory);
        } else {
            window.location.href = `index.html?search=${encodeURIComponent(input.value)}#products`;
        }
    });
}

// --- PAGE INITIALIZERS ---
async function initIndexPage() {
    wireHeaderSearch('desktop-search', 'desktop-search-input');
    wireHeaderSearch('mobile-search', 'mobile-search-input');

    const searchInput = document.getElementById('search-input');
    const debounce = (fn, wait = 250) => {
        let t = null;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    };

    searchInput?.addEventListener('input', debounce(async () => {
        await loadProducts(document.getElementById('products-list'), searchInput, selectedCategory);
    }, 200));

    const rerunSearch = debounce(async () => {
        await loadProducts(document.getElementById('products-list'), searchInput, selectedCategory);
    }, 300);

    document.getElementById('price-min-input')?.addEventListener('input', rerunSearch);
    document.getElementById('price-max-input')?.addEventListener('input', rerunSearch);

    document.querySelectorAll('.category-filter').forEach(btn => {
        btn.addEventListener('click', async () => {
            selectedCategory = btn.dataset.category || 'all';
            document.querySelectorAll('.category-filter').forEach(el => {
                el.classList.toggle('bg-emerald-600', el === btn);
                el.classList.toggle('text-white', el === btn);
            });
            await loadProducts(document.getElementById('products-list'), searchInput, selectedCategory);
        });
    });

    // Initial Load
    const params = new URLSearchParams(window.location.search);
    if (params.get('search') && searchInput) searchInput.value = params.get('search');

    await loadProducts(document.getElementById('products-list'), searchInput, selectedCategory);

    // Bulky Collection Loading
    const dogsList = document.getElementById('dogs-list');
    if (dogsList) {
        const dogs = await apiFetch('/api/products?category=dogs');
        dogsList.innerHTML = dogs.map(renderProductCard).join('');
    }
}

// --- NOTCHPAY POLLING ENGINE ---
async function pollPaymentStatus(orderId, statusEl, attempt = 0) {
    try {
        const result = await apiFetch(`/api/payment/status/${encodeURIComponent(orderId)}`);
        if (result.paymentStatus === 'PAID') {
            saveCart([]);
            updateCartCounter();
            statusEl.textContent = 'Payment confirmed! Your puppy is waiting. 🎉';
            statusEl.className = 'mt-4 text-center text-emerald-600 font-bold';
            setTimeout(() => { window.location.href = 'account.html'; }, 2500);
            return;
        }
        if (result.paymentStatus === 'FAILED') {
            statusEl.textContent = 'Payment failed. Please try again.';
            statusEl.className = 'mt-4 text-center text-red-600 font-bold';
            return;
        }
        if (attempt < 24) {
            statusEl.textContent = 'Awaiting Mobile Money confirmation...';
            statusEl.className = 'mt-4 text-center text-amber-500 font-bold animate-pulse';
            setTimeout(() => pollPaymentStatus(orderId, statusEl, attempt + 1), 5000);
        } else {
            statusEl.textContent = 'Verification is taking long. Check your history shortly.';
        }
    } catch (e) { statusEl.textContent = 'Status verification error.'; }
}

// --- GLOBAL INIT ---
function initPage() {
    setUserDisplay();
    updateCartCounter();
    renderCartItems();

    document.getElementById('cart-open-button')?.addEventListener('click', () => { renderCartItems(); toggleCartDrawer(true); });
    document.getElementById('close-cart-drawer')?.addEventListener('click', () => toggleCartDrawer(false));
    document.getElementById('mobile-menu-button')?.addEventListener('click', () => {
        document.getElementById('mobile-menu').classList.toggle('hidden');
    });

    if (pageName === 'index') initIndexPage();
    if (pageName === 'checkout') initCheckoutPage();
    if (pageName === 'product') initProductPage();
}

window.addEventListener('DOMContentLoaded', initPage);