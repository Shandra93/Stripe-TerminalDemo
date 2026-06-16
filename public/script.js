const state = {
  platformCatalog: [],
  connectedCatalog: [],
  catalog: [],

  cart: [],

  platformReaders: [],
  connectedReaders: [],
  readers: [],

  customers: [],

  stripeMode: '',
  appliedAccountLabel: 'Platform',
  resolvedAccountId: '',
  appliedAccountId: '',

  saleSource: 'platform', // 'platform' or 'connected'

  locationId: '',
  readerId: '',
  readerLabel: '',
  readerIsSimulated: false,
  readerSource: 'platform',

  customerId: '',
  customerLabel: '',

  paymentIntentId: '',
  paymentStatus: '',
  baseAmount: 0,
  tipAmount: 0,
  totalAmount: 0,

  busy: false,
};

const $ = (id) => document.getElementById(id);

function now() {
  return new Date().toLocaleTimeString();
}

function money(cents, currency = 'usd') {
  const value = Number(cents || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(value / 100);
}

function toast(message, type = 'info') {
  const stack = $('toastStack');
  if (!stack) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2800);
}

function log(message, type = 'info') {
  const box = $('logBox');
  if (!box) return;

  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${now()}] ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;

  while (box.children.length > 200) {
    box.removeChild(box.firstChild);
  }
}

function clearLog() {
  $('logBox').innerHTML = '';
}

function setApiResponse(data) {
  $('apiResponse').textContent =
    typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function getStagePillLabel(tone) {
  const labels = {
    neutral: 'Idle',
    info: 'In progress',
    success: 'Success',
    warning: 'Action needed',
    danger: 'Attention',
  };

  return labels[tone] || 'Idle';
}

function setStage(title, text, tone = 'neutral') {
  $('stageTitle').textContent = title;
  $('stageText').textContent = text;

  const card = $('statusCard');
  const pill = $('statusPill');

  if (card) card.dataset.tone = tone;

  if (pill) {
    pill.textContent = state.paymentStatus || getStagePillLabel(tone);
    pill.className = `status-pill ${tone === 'neutral' ? '' : tone}`.trim();
  }
}

function getConnectedAccountId() {
  return $('connectedAccountId').value.trim();
}

function updateAccountDraft() {
  const draft = getConnectedAccountId() || 'Platform';
  if ($('accountDraftBox')) {
    $('accountDraftBox').textContent = draft;
  }
}

function appendStripeAccount(path) {
  const accountId = getConnectedAccountId();
  if (!accountId) return path;

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}stripe_account=${encodeURIComponent(accountId)}`;
}

function withStripeAccount(input = {}) {
  const accountId = getConnectedAccountId();

  if (input.method && input.method !== 'GET') {
    return {
      ...input,
      body: {
        ...(input.body || {}),
        ...(accountId ? { stripe_account: accountId } : {}),
      },
    };
  }

  return input;
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body;

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(path, config);
  const contentType = response.headers.get('content-type') || '';

  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    throw new Error(
      `Expected JSON from ${path}, got ${contentType || 'non-JSON response'}: ${text.slice(0, 200)}`
    );
  }

  setApiResponse(data);

  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }

  return data;
}

function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = value;
  });

  if (!value) {
    updateActionStates();
  }
}

function hasConnectedAccount() {
  return !!getConnectedAccountId();
}

function getSaleSourceLabel() {
  return state.saleSource === 'connected' ? 'Connected account' : 'Platform';
}

function pathForSource(path, source) {
  if (source === 'connected' && hasConnectedAccount()) {
    return appendStripeAccount(path);
  }
  return path;
}

function optionsForSource(options = {}, source) {
  if (source === 'connected' && hasConnectedAccount()) {
    return withStripeAccount(options);
  }
  return options;
}

async function runTask(task) {
  if (state.busy) return;

  try {
    setBusy(true);
    await task();
  } catch (error) {
    log(error.message, 'bad');
    toast(error.message, 'error');
    setStage('Something went wrong', error.message, 'danger');
    setApiResponse(error.message);
  } finally {
    setBusy(false);
  }
}

function cartCount() {
  return state.cart.reduce((sum, item) => sum + item.qty, 0);
}

function cartTotal() {
  return state.cart.reduce((sum, item) => sum + item.unit_amount * item.qty, 0);
}

function toneFromPaymentStatus(status) {
  if (status === 'succeeded') return 'success';
  if (status === 'requires_capture') return 'warning';
  if (status === 'canceled') return 'danger';
  if (status === 'processing' || status === 'requires_confirmation' || status === 'requires_action') {
    return 'info';
  }
  return 'neutral';
}

function updateSummary() {
  const currentAccount = state.appliedAccountLabel || 'Platform';

  $('modeBox').textContent = state.stripeMode || '—';
  $('modeBoxRail').textContent = state.stripeMode || '—';

  $('accountBox').textContent = currentAccount;
  $('accountBoxRail').textContent = currentAccount;
  $('resolvedAccountBox').textContent = state.resolvedAccountId || '—';

  $('locationBox').textContent = state.locationId || '—';
  $('readerBox').textContent = state.readerLabel || state.readerId || '—';
  $('customerBox').textContent = state.customerLabel || state.customerId || '—';
  $('paymentIntentBox').textContent = state.paymentIntentId || '—';

  $('paymentStatusBox').textContent = state.paymentStatus || '—';
  $('paymentStatusBoxRail').textContent = state.paymentStatus || '—';

  $('baseAmountBox').textContent = state.baseAmount ? money(state.baseAmount) : '—';
  $('tipAmountBox').textContent = money(state.tipAmount || 0);
  $('totalAmountBox').textContent = state.totalAmount ? money(state.totalAmount) : '—';

  $('cartCount').textContent = cartCount();
  $('cartTotal').textContent = money(cartTotal());

  updateAccountDraft();
 
  const saleSourceBox = $('saleSourceBox');
if (saleSourceBox) {
  saleSourceBox.textContent = getSaleSourceLabel();
}
}

function updateProgress() {
  const productDone = state.cart.length > 0;
  const readerDone = !!state.readerId;

  const customerName = $('customerName')?.value.trim() || '';
  const customerEmail = $('customerEmail')?.value.trim() || '';
  const customerDone = !!state.customerId || (!customerName && !customerEmail);

  const paymentDone = !!state.paymentIntentId;
  const finalDone = state.paymentStatus === 'succeeded';

  const steps = [
    { el: $('progressProducts'), done: productDone },
    { el: $('progressReader'), done: readerDone },
    { el: $('progressCustomer'), done: customerDone },
    { el: $('progressPayment'), done: paymentDone },
    { el: $('progressDone'), done: finalDone },
  ];

  steps.forEach((step) => {
    if (!step.el) return;
    step.el.classList.remove('is-active', 'is-done');
  });

  let activeIndex = steps.findIndex((step) => !step.done);
  if (activeIndex === -1) activeIndex = steps.length - 1;

  steps.forEach((step, index) => {
    if (!step.el) return;

    if (step.done) {
      step.el.classList.add('is-done');
    }

    if (index === activeIndex && !step.done) {
      step.el.classList.add('is-active');
    }
  });

  if (finalDone && $('progressDone')) {
    $('progressDone').classList.add('is-active', 'is-done');
  }
}

function updateSmartHint() {
  let message = 'Add products to begin.';

  if (!state.cart.length) {
    message = 'Add at least one product to the cart.';
  } else if (!state.readerId) {
    message = 'Select a reader before starting payment.';
  } else if (!state.paymentIntentId) {
    message = 'Create the payment intent next.';
  } else if (state.paymentStatus === 'requires_capture' && !state.tipAmount) {
    message = 'Payment is authorized. Add a tip or capture the payment.';
  } else if (state.paymentStatus === 'requires_capture' && state.tipAmount > 0) {
    message = 'Tip is already added. Capture the payment to finish.';
  } else if (state.paymentStatus === 'succeeded') {
    message = 'Payment finished. Start a new sale when ready.';
  } else if (state.paymentStatus === 'canceled') {
    message = 'Payment canceled. Start again with a new payment.';
  } else if (state.paymentIntentId) {
    message = 'Refresh status or continue the payment flow.';
  }

  $('smartHint').textContent = message;
}

function updateActionStates() {
  const map = {
    quickCheckoutBtn: state.busy || state.cart.length === 0,
    reloadProductsBtn: state.busy,
    createProductBtn: state.busy,
    listReadersBtn: state.busy,
    searchReadersBtn: state.busy,
    createLocationBtn: state.busy,
    createReaderBtn: state.busy,
    findCustomerBtn: state.busy,
    createCustomerBtn: state.busy,
    createPiBtn: state.busy || state.cart.length === 0,
    sendToReaderBtn: state.busy || !state.readerId || !state.paymentIntentId,
    refreshPiBtn: state.busy || !state.paymentIntentId,
    presentCardBtn: state.busy || !state.readerId || !state.paymentIntentId || !state.readerIsSimulated,
    addTipBtn: state.busy || state.paymentStatus !== 'requires_capture',
    captureBtn: state.busy || state.paymentStatus !== 'requires_capture',
    cancelBtn: state.busy || (!state.readerId && !state.paymentIntentId),
    resetSaleBtn: state.busy,
    applyAccountBtn: state.busy,
    clearCartBtn: state.busy,
    clearLogBtn: state.busy,
  };

  Object.entries(map).forEach(([id, disabled]) => {
    const el = $(id);
    if (el) el.disabled = !!disabled;
  });
}

function syncUI() {
  updateSummary();
  updateProgress();
  updateSmartHint();
  updateActionStates();
  renderRightCart();
}

function renderRightCart() {
  const box = $('rightCartList');
  box.innerHTML = '';

  if (!state.cart.length) {
    box.innerHTML = '<div class="empty-box">Cart is empty.</div>';
    return;
  }

  state.cart.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'mini-cart-item';

    row.innerHTML = `
      <div class="mini-cart-item-top">
        <div class="mini-cart-name">${item.name}</div>
        <strong>${money(item.unit_amount * item.qty, item.currency)}</strong>
      </div>
      <div class="mini-cart-meta">
        Qty: ${item.qty} • Each: ${money(item.unit_amount, item.currency)}
      </div>
      <div class="mini-cart-actions">
        <button class="btn tiny secondary minus-btn">−</button>
        <button class="btn tiny secondary plus-btn">+</button>
        <button class="btn tiny danger remove-btn">Remove</button>
      </div>
    `;

    row.querySelector('.minus-btn').addEventListener('click', () => {
      changeQty(item.product_id, -1);
    });

    row.querySelector('.plus-btn').addEventListener('click', () => {
      changeQty(item.product_id, 1);
    });

    row.querySelector('.remove-btn').addEventListener('click', () => {
      removeFromCart(item.product_id);
    });

    box.appendChild(row);
  });
}

function clearPaymentState() {
  state.paymentIntentId = '';
  state.paymentStatus = '';
  state.baseAmount = 0;
  state.tipAmount = 0;
  state.totalAmount = 0;
  syncUI();
}

function invalidatePaymentIntent() {
  if (state.paymentIntentId) {
    log('Cart changed. Previous payment intent was cleared.', 'warn');
    toast('Cart changed. Previous payment was cleared.', 'warn');
  }
  clearPaymentState();
}

function applyPaymentIntentState(data) {
  if (!data) return;

  state.paymentIntentId = data.id || state.paymentIntentId;
  state.paymentStatus = data.status || '';
  state.baseAmount = Number(data.base_amount || 0);
  state.tipAmount = Number(data.tip_amount || 0);
  state.totalAmount = Number(data.amount || 0);

  syncUI();

  if (data.status === 'requires_capture') {
    if (state.tipAmount > 0) {
      setStage('Payment approved', 'Tip added. Capture the payment when ready.', 'warning');
    } else {
      setStage('Payment approved', 'Card is authorized. Add a tip or capture the payment.', 'warning');
    }
  } else if (data.status === 'succeeded') {
    setStage('Payment finished', 'Payment captured successfully.', 'success');
  } else if (data.status === 'canceled') {
    setStage('Payment canceled', 'This payment is no longer active.', 'danger');
  } else if (data.status) {
    setStage(`Status: ${data.status}`, 'This is the current PaymentIntent status.', toneFromPaymentStatus(data.status));
  }
}

function productImage(product) {
  return `
    <div class="product-image-wrap">
      ${
        product.image_url
          ? `<img class="product-image" src="${product.image_url}" alt="${product.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';" />`
          : ''
      }
      <div class="product-placeholder" style="${product.image_url ? 'display:none;' : 'display:grid;'}">📦</div>
    </div>
  `;
}

function renderProducts() {
  const box = $('productList');
  const term = ($('productSearchInput')?.value || '').trim().toLowerCase();

  const products = state.catalog.filter((product) => {
    if (!term) return true;

    return [
      product.name,
      product.description,
      product.category,
      product.product_id,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  box.innerHTML = '';

  if (!products.length) {
    box.innerHTML = '<div class="empty-box">No products match your search.</div>';
    return;
  }

  products.forEach((product) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'product-card';
    card.innerHTML = `
      ${productImage(product)}
      <div class="card-title">${product.name}</div>
      <div class="card-text">${product.description || 'No description'}</div>
      <div class="badge-row">
        <span class="inline-badge">${product.category || 'Uncategorized'}</span>
      </div>
      <div class="meta-list">
        <div>Product ID: ${product.product_id}</div>
        <div>Price ID: ${product.price_id}</div>
      </div>
      <div class="price-row">
        <strong>${money(product.unit_amount, product.currency)}</strong>
        <span class="inline-badge active">Add to cart</span>
      </div>
    `;

    card.addEventListener('click', () => {
      addToCart(product.product_id);
    });

    box.appendChild(card);
  });
}

function renderReaders() {
  const box = $('readerList');
  box.innerHTML = '';

  if (!state.readers.length) {
    box.innerHTML = '<div class="empty-box">No readers found.</div>';
    return;
  }

  state.readers.forEach((reader) => {
    const selected = reader.id === state.readerId;
    const statusBadgeClass = reader.simulated ? 'success' : 'active';

    const card = document.createElement('div');
    card.className = `reader-card ${selected ? 'card-selected' : ''}`;
    card.innerHTML = `
      <div class="card-title">${reader.label || 'Unnamed reader'}</div>
      <div class="badge-row">
        <span class="inline-badge ${selected ? 'active' : ''}">${selected ? 'Selected' : 'Available'}</span>
        <span class="inline-badge ${statusBadgeClass}">${reader.simulated ? 'Simulated' : 'Physical'}</span>
      </div>
      <div class="meta-list">
        <div>Reader ID: ${reader.id}</div>
        <div>Serial: ${reader.serial_number || '—'}</div>
        <div>Type: ${reader.device_type || '—'}</div>
        <div>Status: ${reader.status || '—'}</div>
        <div>Location: ${reader.location || '—'}</div>
      </div>
      <div class="price-row">
        <strong>${selected ? 'Ready to use' : 'Select this reader'}</strong>
        <button class="btn primary">Use reader</button>
      </div>
    `;

    card.querySelector('button').addEventListener('click', () => {
      useReader(reader.id);
    });

    box.appendChild(card);
  });
}

function renderCustomers() {
  const box = $('customerList');
  box.innerHTML = '';

  if (!state.customers.length) {
    box.innerHTML = '<div class="empty-box">No customer selected. Guest checkout is also okay.</div>';
    return;
  }

  state.customers.forEach((customer) => {
    const selected = customer.id === state.customerId;

    const card = document.createElement('div');
    card.className = `customer-card ${selected ? 'card-selected' : ''}`;
    card.innerHTML = `
      <div class="card-title">${customer.name || 'Unnamed customer'}</div>
      <div class="badge-row">
        <span class="inline-badge ${selected ? 'active' : ''}">${selected ? 'Selected' : 'Available'}</span>
      </div>
      <div class="meta-list">
        <div>Customer ID: ${customer.id}</div>
        <div>Email: ${customer.email || '—'}</div>
      </div>
      <div class="price-row">
        <strong>${selected ? 'Using this customer' : 'Use this customer'}</strong>
        <button class="btn primary">Use customer</button>
      </div>
    `;

    card.querySelector('button').addEventListener('click', () => {
      useCustomer(customer.id);
    });

    box.appendChild(card);
  });
}

function addToCart(productId) {
  const product = state.catalog.find((item) => item.product_id === productId);
  if (!product) return;

  const existing = state.cart.find((item) => item.product_id === productId);

  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      product_id: product.product_id,
      price_id: product.price_id,
      name: product.name,
      unit_amount: product.unit_amount,
      currency: product.currency,
      qty: 1,
    });
  }

  invalidatePaymentIntent();
  syncUI();
  setStage('Cart ready', 'Next, select a reader.', 'info');
  log(`Added to cart: ${product.name}`, 'good');
}

function changeQty(productId, delta) {
  const item = state.cart.find((entry) => entry.product_id === productId);
  if (!item) return;

  item.qty += delta;

  if (item.qty <= 0) {
    state.cart = state.cart.filter((entry) => entry.product_id !== productId);
  }

  invalidatePaymentIntent();
  syncUI();

  if (state.cart.length) {
    setStage('Cart updated', 'If a payment existed before, it was cleared.', 'warning');
  } else {
    setStage('Cart empty', 'Add products to begin.', 'neutral');
  }
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((entry) => entry.product_id !== productId);
  invalidatePaymentIntent();
  syncUI();

  if (state.cart.length) {
    setStage('Cart updated', 'If a payment existed before, it was cleared.', 'warning');
  } else {
    setStage('Cart empty', 'Add products to begin.', 'neutral');
  }
}

function useReader(readerId) {
  const reader = state.readers.find((item) => item.id === readerId);
  if (!reader) {
    throw new Error('Reader not found.');
  }

  state.readerId = reader.id;
  state.readerLabel = reader.label || reader.id;
  state.readerIsSimulated = !!reader.simulated;
  state.locationId = reader.location || state.locationId || '';

  $('readerLocationId').value = state.locationId || $('readerLocationId').value;

  renderReaders();
  syncUI();

  if (state.readerIsSimulated) {
    setStage('Reader selected', 'This is a simulated reader. You can use the test card button.', 'info');
  } else {
    setStage('Reader selected', 'This is a physical reader. The customer must use the device.', 'info');
  }

  log(`Using reader: ${state.readerLabel}`, 'good');
  toast(`Reader selected: ${state.readerLabel}`, 'success');
}

function useCustomer(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) {
    throw new Error('Customer not found.');
  }

  state.customerId = customer.id;
  state.customerLabel = customer.name || customer.email || customer.id;

  if (customer.name) $('customerName').value = customer.name;
  if (customer.email) $('customerEmail').value = customer.email;

  renderCustomers();
  syncUI();
  setStage('Customer selected', 'You can now create a payment.', 'info');
  log(`Using customer: ${state.customerLabel}`, 'good');
}

async function loadContext() {
  log('Loading Stripe context...', 'info');

  const data = await api(appendStripeAccount('/api/debug/stripe-context'));
  state.stripeMode = data.mode || '';
  state.appliedAccountLabel = data.stripe_account || 'Platform';
  state.resolvedAccountId = data.account_id || '';

  syncUI();

  log(
    `Stripe mode: ${data.mode}. Account: ${data.account_id}. Connected: ${data.stripe_account || 'platform'}`,
    'good'
  );
}

async function loadProducts() {
  log('Loading products...', 'info');
  const products = await api(appendStripeAccount('/api/products'));
  state.catalog = products;
  renderProducts();
  syncUI();
  log(`Loaded ${products.length} product(s).`, 'good');
}

async function createProduct() {
  const payload = {
    name: $('newProductName').value.trim(),
    description: $('newProductDescription').value.trim(),
    unit_amount: Number($('newProductAmount').value),
    currency: $('newProductCurrency').value.trim() || 'usd',
    category: $('newProductCategory').value.trim(),
    image_url: $('newProductImageUrl').value.trim(),
  };

  if (!payload.name) {
    throw new Error('Product name is required.');
  }

  if (!Number.isInteger(payload.unit_amount) || payload.unit_amount <= 0) {
    throw new Error('Amount must be a positive integer in cents.');
  }

  log('Creating product...', 'info');

  const data = await api(
    '/api/catalog/products',
    withStripeAccount({
      method: 'POST',
      body: payload,
    })
  );

  log(`Product created: ${data.name}`, 'good');
  toast(`Created product: ${data.name}`, 'success');
  await loadProducts();
}

async function listReaders() {
  const location = $('readerLocationId').value.trim();
  let path = '/api/readers';

  if (location) {
    path += `?location=${encodeURIComponent(location)}`;
  }

  log(location ? `Listing readers for location ${location}...` : 'Listing readers...', 'info');

  const data = await api(appendStripeAccount(path));
  state.readers = data.readers || [];
  renderReaders();
  syncUI();

  if (state.readers.length) {
    log(`Found ${state.readers.length} reader(s).`, 'good');
  } else {
    log('No readers found.', 'warn');
  }
}

async function searchReaders() {
  const query = $('readerSearchQuery').value.trim();
  const location = $('readerLocationId').value.trim();

  if (!query) {
    throw new Error('Enter text to search readers.');
  }

  let path = `/api/readers/search?q=${encodeURIComponent(query)}`;
  if (location) {
    path += `&location=${encodeURIComponent(location)}`;
  }

  log(`Searching readers for "${query}"...`, 'info');

  const data = await api(appendStripeAccount(path));
  state.readers = data.readers || [];
  renderReaders();
  syncUI();

  if (state.readers.length === 1) {
    useReader(state.readers[0].id);
  }

  log(`Search found ${state.readers.length} reader(s).`, state.readers.length ? 'good' : 'warn');
}

async function createLocation() {
  log('Creating demo location...', 'info');

  const data = await api(
    '/api/location',
    withStripeAccount({
      method: 'POST',
      body: {
        display_name: 'Easy Demo Store',
        line1: '123 Main Street',
        city: 'San Francisco',
        state: 'CA',
        country: 'US',
        postal_code: '94111',
      },
    })
  );

  state.locationId = data.id;
  $('readerLocationId').value = data.id;
  syncUI();

  log(`Location created: ${data.id}`, 'good');
  toast('Demo location created.', 'success');
  return data;
}

async function createReader() {
  let location = $('readerLocationId').value.trim();

  if (!location) {
    const newLocation = await createLocation();
    location = newLocation.id;
  }

  const label = $('readerLabel').value.trim() || 'Front Desk Demo Reader';
  const registrationCode = $('readerRegistrationCode').value.trim() || 'simulated-wpe';

  log('Creating simulated reader...', 'info');

  const data = await api(
    '/api/reader',
    withStripeAccount({
      method: 'POST',
      body: {
        registration_code: registrationCode,
        label,
        location,
      },
    })
  );

  log(`Simulated reader created: ${data.id}`, 'good');
  toast('Simulated reader created.', 'success');

  await listReaders();
  useReader(data.id);
}

async function findCustomers() {
  const email = $('customerEmail').value.trim().toLowerCase();

  if (!email) {
    throw new Error('Enter a customer email first.');
  }

  log(`Searching customer by email: ${email}`, 'info');

  const data = await api(
    appendStripeAccount(`/api/customers/search?email=${encodeURIComponent(email)}`)
  );

  state.customers = data.customers || [];
  renderCustomers();
  syncUI();

  if (state.customers.length === 1) {
    useCustomer(state.customers[0].id);
  }

  log(`Found ${state.customers.length} customer(s).`, state.customers.length ? 'good' : 'warn');
}

async function createCustomer() {
  const name = $('customerName').value.trim();
  const email = $('customerEmail').value.trim();

  if (!name || !email) {
    throw new Error('Customer name and email are required.');
  }

  log('Creating customer...', 'info');

  const data = await api(
    '/api/customer',
    withStripeAccount({
      method: 'POST',
      body: {
        name,
        email,
      },
    })
  );

  state.customers = [data];
  renderCustomers();
  useCustomer(data.id);

  log(`Customer created: ${data.id}`, 'good');
  toast('Customer created.', 'success');
}

async function ensureCustomerIfNeeded() {
  if (state.customerId) return;

  const name = $('customerName').value.trim();
  const email = $('customerEmail').value.trim();

  if (!name && !email) return;

  if (email) {
    const data = await api(
      appendStripeAccount(`/api/customers/search?email=${encodeURIComponent(email.toLowerCase())}`)
    );

    state.customers = data.customers || [];
    renderCustomers();
    syncUI();

    if (state.customers.length === 1) {
      useCustomer(state.customers[0].id);
      return;
    }

    if (state.customers.length > 1) {
      throw new Error('More than one customer matched that email. Please choose one.');
    }
  }

  if (name && email) {
    await createCustomer();
  }
}

async function createPaymentIntent() {
  if (!state.cart.length) {
    throw new Error('Add products to the cart first.');
  }

  await ensureCustomerIfNeeded();

  log('Creating payment...', 'info');

  const data = await api(
    '/api/payment-intent',
    withStripeAccount({
      method: 'POST',
      body: {
        customer: state.customerId || '',
        description: `Easy checkout (${cartCount()} items)`,
        store_id: 'EasyStore001',
        register_id: 'Register01',
        employee_name: 'Cashier',
        order_id: `ORDER-${Date.now()}`,
        items: state.cart.map((item) => ({
          product_id: item.product_id,
          price_id: item.price_id,
          qty: item.qty,
        })),
      },
    })
  );

  applyPaymentIntentState(data);
  setStage('Payment created', 'Now send it to the reader.', 'info');
  log(`Payment created: ${data.id}`, 'good');
  toast('Payment intent created.', 'success');
  return data;
}

async function sendToReader() {
  if (!state.readerId) {
    throw new Error('Choose a reader first.');
  }

  if (!state.paymentIntentId) {
    throw new Error('Create the payment first.');
  }

  log(`Sending payment to reader ${state.readerId}...`, 'info');

  await api(
    '/api/process-payment',
    withStripeAccount({
      method: 'POST',
      body: {
        readerId: state.readerId,
        paymentIntentId: state.paymentIntentId,
      },
    })
  );

  if (state.readerIsSimulated) {
    setStage('Reader is ready', 'Now click "Present test card".', 'info');
  } else {
    setStage('Reader is ready', 'Customer can now tap or insert card on the reader.', 'info');
  }

  log('Payment sent to reader.', 'good');
  toast('Payment sent to reader.', 'info');
}

async function refreshPaymentIntent(showLog = true) {
  if (!state.paymentIntentId) {
    throw new Error('No payment to refresh.');
  }

  if (showLog) {
    log(`Refreshing payment ${state.paymentIntentId}...`, 'info');
  }

  const data = await api(
    appendStripeAccount(`/api/payment-intents/${encodeURIComponent(state.paymentIntentId)}`)
  );

  applyPaymentIntentState(data);

  if (showLog) {
    log(`Payment status: ${data.status}`, 'good');
  }

  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReaderToFinish() {
  const usefulStatuses = new Set(['requires_capture', 'succeeded', 'canceled']);

  for (let i = 0; i < 10; i += 1) {
    const pi = await refreshPaymentIntent(false);

    if (usefulStatuses.has(pi.status)) {
      log(`Reader finished. Status: ${pi.status}`, 'good');
      return pi;
    }

    await sleep(1500);
  }

  log('Still waiting. Try clicking Refresh status.', 'warn');
  toast('Still waiting for the reader. Try Refresh status.', 'warn');
  return null;
}

async function presentTestCard() {
  if (!state.readerId) {
    throw new Error('Choose a reader first.');
  }

  if (!state.readerIsSimulated) {
    throw new Error('Present test card only works with a simulated reader.');
  }

  const cardNumber = $('presentCardNumber').value.trim();
  if (!cardNumber) {
    throw new Error('Enter a test card number first.');
  }

  log(`Presenting test card ${cardNumber}...`, 'info');

  await api(
    '/api/present-card',
    withStripeAccount({
      method: 'POST',
      body: {
        readerId: state.readerId,
        cardNumber,
      },
    })
  );

  setStage('Test card presented', 'Waiting for Stripe to update the payment...', 'info');
  log('Test card presented successfully.', 'good');
  toast('Test card presented.', 'info');

  await waitForReaderToFinish();
}

async function addTip() {
  if (!state.paymentIntentId) {
    throw new Error('Create and authorize a payment first.');
  }

  const tipAmount = Number($('tipAmountInput').value);

  if (!Number.isInteger(tipAmount) || tipAmount <= 0) {
    throw new Error('Tip amount must be a positive integer in cents.');
  }

  log(`Adding tip: ${tipAmount} cents...`, 'info');

  const data = await api(
    '/api/increment-payment-intent',
    withStripeAccount({
      method: 'POST',
      body: {
        paymentIntentId: state.paymentIntentId,
        tip_amount: tipAmount,
      },
    })
  );

  applyPaymentIntentState(data);
  setStage('Tip added', 'Now capture the payment.', 'warning');
  log(`Tip added. New total: ${money(data.amount)}`, 'good');
  toast('Tip added successfully.', 'success');
}

async function capturePayment() {
  if (!state.paymentIntentId) {
    throw new Error('No payment to capture.');
  }

  log(`Capturing payment ${state.paymentIntentId}...`, 'info');

  const data = await api(
    '/api/capture-payment-intent',
    withStripeAccount({
      method: 'POST',
      body: {
        paymentIntentId: state.paymentIntentId,
      },
    })
  );

  applyPaymentIntentState(data);
  setStage('Payment finished', 'You can start a new sale now.', 'success');
  log(`Payment captured. Status: ${data.status}`, 'good');
  toast('Payment captured successfully.', 'success');
}

async function cancelPayment() {
  if (!state.readerId && !state.paymentIntentId) {
    throw new Error('There is no active payment to cancel.');
  }

  log('Canceling payment flow...', 'warn');

  const data = await api(
    '/api/cancel-payment',
    withStripeAccount({
      method: 'POST',
      body: {
        readerId: state.readerId || '',
        paymentIntentId: state.paymentIntentId || '',
        cancel_reader_action: true,
        cancel_payment_intent: true,
      },
    })
  );

  if (Array.isArray(data.warnings) && data.warnings.length) {
    data.warnings.forEach((warning) => log(warning, 'warn'));
  }

  clearPaymentState();
  setStage('Payment canceled', 'You can start again.', 'danger');
  log('Cancel request finished.', 'good');
  toast('Payment canceled.', 'warn');
}

function resetSale() {
  state.cart = [];
  state.customers = [];
  state.customerId = '';
  state.customerLabel = '';
  clearPaymentState();

  $('customerName').value = '';
  $('customerEmail').value = '';
  $('tipAmountInput').value = '500';

  renderCustomers();
  syncUI();

  setStage('New sale', 'Ready for the next customer.', 'neutral');
  log('Started a new sale.', 'good');
  toast('Ready for a new sale.', 'info');
}

async function quickCheckout() {
  if (!state.cart.length) {
    throw new Error('Add products to the cart first.');
  }

  if (!state.readerId) {
    await listReaders();

    if (!state.readers.length) {
      await createReader();
    } else {
      useReader(state.readers[0].id);
    }
  }

  await createPaymentIntent();
  await sendToReader();

  if (state.readerIsSimulated) {
    await presentTestCard();
  } else {
    setStage(
      'Waiting for customer',
      'Customer should complete payment on the physical reader, then click Refresh status.',
      'info'
    );
  }
}

function setConsoleTab(tab) {
  const isLog = tab === 'log';

  $('consoleTabLog').classList.toggle('is-active', isLog);
  $('consoleTabApi').classList.toggle('is-active', !isLog);

  $('consolePanelLog').hidden = !isLog;
  $('consolePanelApi').hidden = isLog;
}

function bindEvents() {
  $('applyAccountBtn').addEventListener('click', () => {
    runTask(async () => {
      state.catalog = [];
      state.readers = [];
      state.customers = [];
      state.locationId = '';
      state.readerId = '';
      state.readerLabel = '';
      state.readerIsSimulated = false;
      state.customerId = '';
      state.customerLabel = '';
      state.paymentIntentId = '';
      state.paymentStatus = '';
      state.baseAmount = 0;
      state.tipAmount = 0;
      state.totalAmount = 0;

      setStage('Switching account', 'Loading the selected Stripe account...', 'info');
      syncUI();

      await loadContext();
      await loadProducts();
      await listReaders();

      setStage('Account ready', 'You can now continue in this Stripe account.', 'success');
      log('Account context applied.', 'good');
      toast('Account context applied.', 'success');
    });
  });

  $('connectedAccountId').addEventListener('input', () => {
    updateAccountDraft();
    updateProgress();
  });

  $('productSearchInput').addEventListener('input', renderProducts);

  $('reloadProductsBtn').addEventListener('click', () => runTask(loadProducts));
  $('createProductBtn').addEventListener('click', () => runTask(createProduct));

  $('clearCartBtn').addEventListener('click', () => {
    runTask(async () => {
      state.cart = [];
      invalidatePaymentIntent();
      syncUI();
      setStage('Cart cleared', 'Add products to begin.', 'neutral');
      log('Cart cleared.', 'good');
    });
  });

  $('listReadersBtn').addEventListener('click', () => runTask(listReaders));
  $('searchReadersBtn').addEventListener('click', () => runTask(searchReaders));
  $('createLocationBtn').addEventListener('click', () => runTask(createLocation));
  $('createReaderBtn').addEventListener('click', () => runTask(createReader));

  $('findCustomerBtn').addEventListener('click', () => runTask(findCustomers));
  $('createCustomerBtn').addEventListener('click', () => runTask(createCustomer));

  $('quickCheckoutBtn').addEventListener('click', () => runTask(quickCheckout));
  $('createPiBtn').addEventListener('click', () => runTask(createPaymentIntent));
  $('sendToReaderBtn').addEventListener('click', () => runTask(sendToReader));
  $('refreshPiBtn').addEventListener('click', () => runTask(() => refreshPaymentIntent(true)));
  $('presentCardBtn').addEventListener('click', () => runTask(presentTestCard));
  $('addTipBtn').addEventListener('click', () => runTask(addTip));
  $('captureBtn').addEventListener('click', () => runTask(capturePayment));
  $('cancelBtn').addEventListener('click', () => runTask(cancelPayment));
  $('resetSaleBtn').addEventListener('click', () => runTask(() => Promise.resolve(resetSale())));

  $('clearLogBtn').addEventListener('click', clearLog);

  $('consoleTabLog').addEventListener('click', () => setConsoleTab('log'));
  $('consoleTabApi').addEventListener('click', () => setConsoleTab('api'));
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  renderProducts();
  renderReaders();
  renderCustomers();
  renderRightCart();
  updateAccountDraft();
  syncUI();
  setConsoleTab('log');
  setStage('Waiting', 'Add products to begin.', 'neutral');

  try {
    await loadContext();
    await loadProducts();
    log('App loaded and ready.', 'good');
    toast('App loaded and ready.', 'success');
  } catch (error) {
    log(`Failed to load app: ${error.message}`, 'bad');
    setStage('Could not load app', error.message, 'danger');
    setApiResponse(error.message);
    toast(error.message, 'error');
  }
});