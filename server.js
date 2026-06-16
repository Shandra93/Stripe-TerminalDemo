const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const Stripe = require('stripe');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4242;

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY in .env');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function sendError(res, error, status = 400) {
  const message =
    error?.raw?.message ||
    error?.message ||
    'Something went wrong.';
  res.status(status).json({ error: message });
}

function getStripeMode() {
  return process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test';
}

function getStripeAccount(req) {
  return String(
    req.query.stripe_account ||
      req.body?.stripe_account ||
      req.headers['x-stripe-account'] ||
      ''
  ).trim();
}

function getRequestOptions(req) {
  const stripeAccount = getStripeAccount(req);
  return stripeAccount ? { stripeAccount } : null;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function stripeList(resource, params, req) {
  const options = getRequestOptions(req);
  return options ? resource.list(params, options) : resource.list(params);
}

function stripeCreate(resource, params, req) {
  const options = getRequestOptions(req);
  return options ? resource.create(params, options) : resource.create(params);
}

function stripeUpdate(resource, id, params, req) {
  const options = getRequestOptions(req);
  return options ? resource.update(id, params, options) : resource.update(id, params);
}

function stripeRetrieve(resource, id, req) {
  const options = getRequestOptions(req);
  return options ? resource.retrieve(id, options) : resource.retrieve(id);
}

function stripeRetrieveWithParams(resource, id, params, req) {
  const options = getRequestOptions(req);
  return options
    ? resource.retrieve(id, params, options)
    : resource.retrieve(id, params);
}

function stripeProcessReaderPaymentIntent(readerId, paymentIntentId, req) {
  const options = getRequestOptions(req);
  const params = { payment_intent: paymentIntentId };

  return options
    ? stripe.terminal.readers.processPaymentIntent(readerId, params, options)
    : stripe.terminal.readers.processPaymentIntent(readerId, params);
}

function stripePresentTestCard(readerId, cardNumber, req) {
  const options = getRequestOptions(req);
  const params = {
    type: 'card_present',
    card_present: {
      number: cardNumber,
    },
  };

  return options
    ? stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId, params, options)
    : stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId, params);
}

function stripeCancelReaderAction(readerId, req) {
  const options = getRequestOptions(req);
  return options
    ? stripe.terminal.readers.cancelAction(readerId, options)
    : stripe.terminal.readers.cancelAction(readerId);
}

function stripeCancelPaymentIntent(paymentIntentId, req) {
  const options = getRequestOptions(req);
  return options
    ? stripe.paymentIntents.cancel(paymentIntentId, {}, options)
    : stripe.paymentIntents.cancel(paymentIntentId);
}

function stripeIncrementAuthorization(paymentIntentId, params, req) {
  const options = getRequestOptions(req);
  return options
    ? stripe.paymentIntents.incrementAuthorization(paymentIntentId, params, options)
    : stripe.paymentIntents.incrementAuthorization(paymentIntentId, params);
}

function stripeCapturePaymentIntent(paymentIntentId, req) {
  const options = getRequestOptions(req);
  return options
    ? stripe.paymentIntents.capture(paymentIntentId, {}, options)
    : stripe.paymentIntents.capture(paymentIntentId);
}

function formatCatalogItem(product, price) {
  return {
    product_id: product.id,
    price_id: price.id,
    name: product.name,
    description: product.description || '',
    unit_amount: price.unit_amount,
    currency: price.currency,
    image_url: product.images?.[0] || '',
    category: product.metadata?.category || '',
    active: product.active,
  };
}

function formatCustomerItem(customer) {
  return {
    id: customer.id,
    name: customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    created: customer.created,
  };
}

function formatReaderItem(reader) {
  return {
    id: reader.id,
    label: reader.label || '',
    serial_number: reader.serial_number || '',
    device_type: reader.device_type || '',
    location:
      typeof reader.location === 'string'
        ? reader.location
        : reader.location?.id || '',
    status: reader.status || '',
    simulated: String(reader.serial_number || '').startsWith('simulated_'),
    action: reader.action || null,
  };
}

function formatLocationItem(location) {
  return {
    id: location.id,
    display_name: location.display_name || '',
    livemode: !!location.livemode,
    address: location.address || {},
    metadata: location.metadata || {},
  };
}

function formatPaymentIntent(pi) {
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status: pi.status,
    capture_method: pi.capture_method,
    amount_capturable: pi.amount_capturable,
    amount_received: pi.amount_received,
    customer:
      typeof pi.customer === 'string'
        ? pi.customer
        : pi.customer?.id || '',
    base_amount: Number(pi.metadata?.base_amount || pi.amount || 0),
    tip_amount: Number(pi.metadata?.tip_amount || 0),
    metadata: pi.metadata || {},
  };
}

function readerMatchesQuery(reader, query) {
  const q = query.toLowerCase();

  return [
    reader.id,
    reader.label,
    reader.serial_number,
    reader.device_type,
    reader.location,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

async function listCatalogItems(req) {
  const [productsResp, pricesResp] = await Promise.all([
    stripeList(stripe.products, { active: true, limit: 100 }, req),
    stripeList(stripe.prices, { active: true, limit: 100 }, req),
  ]);

  const pricesByProductId = new Map();

  for (const price of pricesResp.data) {
    if (!price.active) continue;
    if (price.type !== 'one_time') continue;
    if (price.unit_amount == null) continue;

    const productId =
      typeof price.product === 'string'
        ? price.product
        : price.product?.id;

    if (!productId) continue;

    if (!pricesByProductId.has(productId)) {
      pricesByProductId.set(productId, []);
    }

    pricesByProductId.get(productId).push(price);
  }

  const items = productsResp.data
    .map((product) => {
      const prices = pricesByProductId.get(product.id) || [];
      if (!prices.length) return null;

      const defaultPriceId =
        typeof product.default_price === 'string'
          ? product.default_price
          : product.default_price?.id || null;

      let selectedPrice = null;

      if (defaultPriceId) {
        selectedPrice = prices.find((p) => p.id === defaultPriceId) || null;
      }

      if (!selectedPrice) {
        selectedPrice = prices[0];
      }

      return formatCatalogItem(product, selectedPrice);
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  return items;
}

app.get('/api/products', async (req, res) => {
  try {
    const items = await listCatalogItems(req);
    res.json(items);
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/catalog/products', async (req, res) => {
  try {
    const {
      name,
      description = '',
      unit_amount,
      currency = 'usd',
      category = '',
      image_url = '',
    } = req.body;

    const parsedAmount = Number(unit_amount);

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Product name is required.' });
    }

    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: 'unit_amount must be a positive integer in cents.',
      });
    }

    if (image_url && !isValidHttpUrl(image_url)) {
      return res.status(400).json({
        error: 'image_url must be a valid http or https URL.',
      });
    }

    const product = await stripeCreate(
      stripe.products,
      {
        name: name.trim(),
        description: description.trim(),
        images: image_url ? [image_url.trim()] : [],
        metadata: {
          category: category.trim(),
        },
      },
      req
    );

    const price = await stripeCreate(
      stripe.prices,
      {
        product: product.id,
        currency: currency.trim().toLowerCase(),
        unit_amount: parsedAmount,
      },
      req
    );

    await stripeUpdate(
      stripe.products,
      product.id,
      { default_price: price.id },
      req
    );

    const updatedProduct = await stripeRetrieve(stripe.products, product.id, req);

    res.json(formatCatalogItem(updatedProduct, price));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/customers/search', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const result = await stripeList(
      stripe.customers,
      {
        email,
        limit: 20,
      },
      req
    );

    const customers = result.data
      .map(formatCustomerItem)
      .sort((a, b) => b.created - a.created);

    res.json({
      found: customers.length > 0,
      count: customers.length,
      customers,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/customer', async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: 'Missing customer name or email.',
      });
    }

    const customer = await stripeCreate(
      stripe.customers,
      {
        name: name.trim(),
        email: email.trim(),
      },
      req
    );

    res.json(formatCustomerItem(customer));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/readers', async (req, res) => {
  try {
    const location = String(req.query.location || '').trim();
    const limit = Number(req.query.limit || 100);

    const readersResp = await stripeList(
      stripe.terminal.readers,
      {
        limit: Number.isInteger(limit) && limit > 0 ? limit : 100,
        ...(location ? { location } : {}),
      },
      req
    );

    const readers = readersResp.data
      .map(formatReaderItem)
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));

    res.json({
      mode: getStripeMode(),
      stripe_account: getStripeAccount(req) || null,
      location_filter: location || null,
      count: readers.length,
      readers,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/readers/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const location = String(req.query.location || '').trim();

    if (!query) {
      return res.status(400).json({ error: 'Search query is required.' });
    }

    const readersResp = await stripeList(
      stripe.terminal.readers,
      {
        limit: 100,
        ...(location ? { location } : {}),
      },
      req
    );

    const readers = readersResp.data
      .map(formatReaderItem)
      .filter((reader) => readerMatchesQuery(reader, query))
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));

    res.json({
      mode: getStripeMode(),
      stripe_account: getStripeAccount(req) || null,
      location_filter: location || null,
      query,
      count: readers.length,
      readers,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/locations', async (req, res) => {
  try {
    const locationsResp = await stripeList(
      stripe.terminal.locations,
      {
        limit: 100,
      },
      req
    );

    res.json({
      mode: getStripeMode(),
      stripe_account: getStripeAccount(req) || null,
      count: locationsResp.data.length,
      locations: locationsResp.data.map(formatLocationItem),
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/readers/:readerId', async (req, res) => {
  try {
    const reader = await stripeRetrieve(
      stripe.terminal.readers,
      req.params.readerId,
      req
    );
    res.json(formatReaderItem(reader));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/debug/stripe-context', async (req, res) => {
  try {
    const stripeAccount = getStripeAccount(req);

    let account;
    if (stripeAccount) {
      account = await stripe.accounts.retrieve(stripeAccount);
    } else {
      account = await stripe.accounts.retrieve();
    }

    res.json({
      mode: getStripeMode(),
      stripe_account: stripeAccount || null,
      account_id: account.id,
      business_profile_name: account.business_profile?.name || '',
      country: account.country || '',
      email: account.email || '',
      charges_enabled: !!account.charges_enabled,
      details_submitted: !!account.details_submitted,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/location', async (req, res) => {
  try {
    const {
      display_name,
      line1,
      city,
      state,
      country,
      postal_code,
    } = req.body;

    if (!display_name || !line1 || !city || !state || !country || !postal_code) {
      return res.status(400).json({
        error: 'Missing required location fields.',
      });
    }

    const location = await stripeCreate(
      stripe.terminal.locations,
      {
        display_name,
        address: {
          line1,
          city,
          state,
          country,
          postal_code,
        },
      },
      req
    );

    res.json({
      id: location.id,
      display_name: location.display_name,
      address: location.address,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/reader', async (req, res) => {
  try {
    const { registration_code, label, location } = req.body;

    if (!registration_code || !label || !location) {
      return res.status(400).json({
        error: 'Missing required reader fields.',
      });
    }

    const reader = await stripeCreate(
      stripe.terminal.readers,
      {
        registration_code,
        label,
        location,
      },
      req
    );

    res.json(formatReaderItem(reader));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/payment-intent', async (req, res) => {
  try {
    const {
      items,
      customer,
      description,
      store_id,
      register_id,
      employee_name,
      order_id,
    } = req.body;

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({
        error: 'Cart items are required.',
      });
    }

    let amount = 0;
    let currency = null;
    const normalizedItems = [];

    for (const item of items) {
      const qty = Number(item.qty);

      if (!item.price_id || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          error: 'Each item must include a valid price_id and qty.',
        });
      }

      const price = await stripeRetrieveWithParams(
        stripe.prices,
        item.price_id,
        { expand: ['product'] },
        req
      );

      if (!price.active) {
        return res.status(400).json({
          error: `Price ${item.price_id} is not active.`,
        });
      }

      if (price.type !== 'one_time') {
        return res.status(400).json({
          error: `Price ${item.price_id} is not a one-time price.`,
        });
      }

      if (price.unit_amount == null) {
        return res.status(400).json({
          error: `Price ${item.price_id} has no unit_amount.`,
        });
      }

      const product = price.product;

      if (item.product_id && item.product_id !== product.id) {
        return res.status(400).json({
          error: `product_id does not match price_id for ${item.price_id}.`,
        });
      }

      if (!currency) {
        currency = price.currency;
      } else if (currency !== price.currency) {
        return res.status(400).json({
          error: 'All cart items must use the same currency.',
        });
      }

      const lineTotal = price.unit_amount * qty;
      amount += lineTotal;

      normalizedItems.push({
        product_id: product.id,
        price_id: price.id,
        name: product.name,
        qty,
        unit_amount: price.unit_amount,
        currency: price.currency,
        line_total: lineTotal,
      });
    }

    const paymentIntent = await stripeCreate(
      stripe.paymentIntents,
      {
        amount,
        currency,
        description: description || 'Easy checkout',
        customer: customer || undefined,
        payment_method_types: ['card_present'],
        capture_method: 'manual',
        payment_method_options: {
          card_present: {
            request_incremental_authorization_support: true,
          },
        },
        metadata: {
          store_id: store_id || '',
          register_id: register_id || '',
          employee_name: employee_name || '',
          order_id: order_id || `ORDER-${Date.now()}`,
          item_count: String(
            normalizedItems.reduce((sum, item) => sum + item.qty, 0)
          ),
          base_amount: String(amount),
          tip_amount: '0',
        },
      },
      req
    );

    res.json({
      ...formatPaymentIntent(paymentIntent),
      client_secret: paymentIntent.client_secret,
      items: normalizedItems,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/payment-intents/:paymentIntentId', async (req, res) => {
  try {
    const paymentIntent = await stripeRetrieve(
      stripe.paymentIntents,
      req.params.paymentIntentId,
      req
    );

    res.json(formatPaymentIntent(paymentIntent));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/process-payment', async (req, res) => {
  try {
    const { readerId, paymentIntentId } = req.body;

    if (!readerId || !paymentIntentId) {
      return res.status(400).json({
        error: 'readerId and paymentIntentId are required.',
      });
    }

    const reader = await stripeProcessReaderPaymentIntent(
      readerId,
      paymentIntentId,
      req
    );

    res.json(formatReaderItem(reader));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/present-card', async (req, res) => {
  try {
    const { readerId, cardNumber } = req.body;

    if (!readerId || !cardNumber) {
      return res.status(400).json({
        error: 'readerId and cardNumber are required.',
      });
    }

    const result = await stripePresentTestCard(readerId, cardNumber, req);
    res.json(result);
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/increment-payment-intent', async (req, res) => {
  try {
    const { paymentIntentId, tip_amount } = req.body;
    const tipAmount = Number(tip_amount);

    if (!paymentIntentId) {
      return res.status(400).json({
        error: 'paymentIntentId is required.',
      });
    }

    if (!Number.isInteger(tipAmount) || tipAmount <= 0) {
      return res.status(400).json({
        error: 'tip_amount must be a positive integer in cents.',
      });
    }

    const current = await stripeRetrieveWithParams(
      stripe.paymentIntents,
      paymentIntentId,
      { expand: ['latest_charge'] },
      req
    );

    if (current.capture_method !== 'manual') {
      return res.status(400).json({
        error: 'PaymentIntent must use manual capture to increment authorization.',
      });
    }

    if (current.status !== 'requires_capture') {
      return res.status(400).json({
        error: `PaymentIntent must be requires_capture before adding tip. Current status: ${current.status}`,
      });
    }

    const incrementalSupported =
      current.latest_charge?.payment_method_details?.card_present?.incremental_authorization_supported;

    if (!incrementalSupported) {
      return res.status(400).json({
        error: 'This PaymentIntent does not support incremental authorization. Create a new one with request_incremental_authorization_support.',
      });
    }

    const baseAmount = Number(current.metadata?.base_amount || current.amount || 0);
    const newTotal = baseAmount + tipAmount;

    await stripeIncrementAuthorization(
      paymentIntentId,
      { amount: newTotal },
      req
    );

    await stripeUpdate(
      stripe.paymentIntents,
      paymentIntentId,
      {
        metadata: {
          ...current.metadata,
          base_amount: String(baseAmount),
          tip_amount: String(tipAmount),
        },
      },
      req
    );

    const refreshed = await stripeRetrieve(
      stripe.paymentIntents,
      paymentIntentId,
      req
    );

    res.json(formatPaymentIntent(refreshed));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/capture-payment-intent', async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        error: 'paymentIntentId is required.',
      });
    }

    const paymentIntent = await stripeCapturePaymentIntent(paymentIntentId, req);
    res.json(formatPaymentIntent(paymentIntent));
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.post('/api/cancel-payment', async (req, res) => {
  try {
    const {
      readerId,
      paymentIntentId,
      cancel_reader_action = true,
      cancel_payment_intent = true,
    } = req.body;

    if (!readerId && !paymentIntentId) {
      return res.status(400).json({
        error: 'readerId or paymentIntentId is required.',
      });
    }

    const warnings = [];
    let reader = null;
    let paymentIntent = null;

    if (cancel_reader_action && readerId) {
      try {
        reader = await stripeCancelReaderAction(readerId, req);
      } catch (error) {
        warnings.push(`Reader cancel warning: ${error?.message || 'Failed to cancel reader action.'}`);
      }
    }

    if (cancel_payment_intent && paymentIntentId) {
      try {
        paymentIntent = await stripeCancelPaymentIntent(paymentIntentId, req);
      } catch (error) {
        warnings.push(`PaymentIntent cancel warning: ${error?.message || 'Failed to cancel payment intent.'}`);
      }
    }

    res.json({
      cancelled_reader_action: !!reader,
      cancelled_payment_intent: !!paymentIntent,
      reader_id: reader?.id || readerId || null,
      payment_intent_id: paymentIntent?.id || paymentIntentId || null,
      payment_intent_status: paymentIntent?.status || null,
      warnings,
    });
  } catch (error) {
    sendError(res, error, 500);
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});