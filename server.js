import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const port = process.env.PORT || 3000;

const app = express();
const prisma = new PrismaClient();

// NotchPay config (Mobile Money + Orange Money + cards, Cameroon + international)
const NOTCHPAY_PUBLIC_KEY = process.env.NOTCHPAY_PUBLIC_KEY;
const NOTCHPAY_PRIVATE_KEY = process.env.NOTCHPAY_PRIVATE_KEY;
const NOTCHPAY_BASE_URL = 'https://api.notchpay.co';
const APP_URL = process.env.APP_URL || `http://localhost:${port}`;

// Brevo (transactional email)
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'MyPetshoppy';

// Business parameters
const DELIVERY_FEE_XAF = Math.max(0, parseInt(process.env.DELIVERY_FEE_XAF) || 1500);
const COMMISSION_RATE_PERCENT = Math.min(100, Math.max(0, parseFloat(process.env.COMMISSION_RATE_PERCENT) || 10));

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const addUserToRequest = async (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  req.user = null;
  if (!token) return next();

  try {
    const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (session && new Date(session.expiresAt) >= new Date()) {
      req.user = session.user;
    } else if (session) {
      await prisma.session.delete({ where: { token } }).catch(() => { });
    }
  } catch (e) {
    console.error('Auth middleware error:', e);
  }
  next();
};

app.use(addUserToRequest);

const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  next();
};

const requireVendor = (req, res, next) => {
  if (!req.user || req.user.role !== 'vendor') {
    return res.status(403).json({ success: false, message: 'Vendor access required' });
  }
  next();
};

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!ADMIN_SECRET || !token || token !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function vendorProductsWhere(user) {
  return { OR: [{ vendorId: user.id }, { vendor: user.fullName }] };
}

async function getVendorBalance(vendorUser) {
  const vendorWhere = vendorProductsWhere(vendorUser);
  const isMine = (item) => item.product?.vendorId === vendorUser.id || item.product?.vendor === vendorUser.fullName;

  const paidOrders = await prisma.order.findMany({
    where: { paymentStatus: 'PAID', items: { some: { product: vendorWhere } } },
    include: { items: { include: { product: true } } }
  });
  const totalEarned = paidOrders.reduce((sum, o) => sum + o.items.filter(isMine).reduce((s, i) => s + i.vendorEarning, 0), 0);

  const payouts = await prisma.payout.findMany({ where: { vendorId: vendorUser.id } });
  const totalPaidOut = payouts.reduce((sum, p) => sum + p.amount, 0);

  return { totalEarned, totalPaidOut, balance: totalEarned - totalPaidOut };
}

// ===== EMAIL (Brevo) =====

async function sendEmail({ to, subject, htmlContent }) {
  if (!BREVO_API_KEY || !EMAIL_FROM) {
    console.warn('BREVO_API_KEY/EMAIL_FROM not set — email not sent. Would have sent:', { to, subject });
    return;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM }, to: [{ email: to }], subject, htmlContent }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error('Brevo send error:', errBody);
    throw new Error('Failed to send email');
  }
}

// ===== CUSTOMER ENDPOINTS =====

app.get('/api/products', asyncHandler(async (req, res) => {
  const { category, search, id, priceMin, priceMax, sort } = req.query;

  if (id) {
    const product = await prisma.product.findUnique({ where: { id: String(id) } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    return res.json(product);
  }

  const where = {};
  if (category && category !== 'all') {
    where.category = String(category);
  }
  if (search) {
    const searchTerm = String(search).trim();
    where.OR = [
      { name: { contains: searchTerm, mode: 'insensitive' } },
      { breed: { contains: searchTerm, mode: 'insensitive' } },
      { vendor: { contains: searchTerm, mode: 'insensitive' } },
      { category: { contains: searchTerm, mode: 'insensitive' } },
      { description: { contains: searchTerm, mode: 'insensitive' } },
    ];
  }
  if (priceMin || priceMax) {
    where.price = {};
    if (priceMin) where.price.gte = Math.max(0, parseInt(priceMin) || 0);
    if (priceMax) where.price.lte = Math.max(0, parseInt(priceMax) || 0);
  }

  let orderBy = { createdAt: 'desc' };
  if (sort === 'price_asc') orderBy = { price: 'asc' };
  if (sort === 'price_desc') orderBy = { price: 'desc' };
  if (sort === 'rating') orderBy = { rating: 'desc' };

  const products = await prisma.product.findMany({ where, orderBy, take: 100 });
  res.json(products);
}));

app.get('/api/recommendations', asyncHandler(async (req, res) => {
  const { category } = req.query;
  const where = category && category !== 'all' ? { category: String(category) } : {};
  const products = await prisma.product.findMany({ where, orderBy: { rating: 'desc' }, take: 8 });
  res.json(products);
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body;
  if (!fullName?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ success: false, message: 'Missing registration fields' });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { fullName, email: email.toLowerCase(), password: hashed, role: 'customer' }
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId: user.id, expiresAt } });

  res.json({ token, user: { fullName: user.fullName, email: user.email, role: user.role } });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
  if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid email or password' });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId: user.id, expiresAt } });

  res.json({ token, user: { fullName: user.fullName, email: user.email, role: user.role } });
}));

app.post('/api/auth/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  const genericResponse = { success: true, message: 'If that email is registered, a reset link has been sent.' };
  if (!email?.trim()) return res.json(genericResponse);

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return res.json(genericResponse);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.passwordResetToken.create({ data: { token, userId: user.id, expiresAt } });

  const resetUrl = `${APP_URL}/reset-password.html?token=${token}`;
  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your MyPetshoppy password',
      htmlContent: `<p>Hi ${user.fullName},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });
  } catch (e) {
    console.error('Failed to send reset email:', e);
  }

  res.json(genericResponse);
}));

app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'A valid token and a password of at least 6 characters are required' });
  }

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken || resetToken.usedAt || new Date(resetToken.expiresAt) < new Date()) {
    return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashed } });
  await prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } });
  await prisma.session.deleteMany({ where: { userId: resetToken.userId } });

  res.json({ success: true, message: 'Password updated. You can now sign in with your new password.' });
}));

app.get('/api/orders', requireAuth, asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { product: true } } }
  });
  res.json(orders);
}));

app.get('/api/orders/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: { include: { product: true } } }
  });
  if (!order || order.userId !== req.user.id) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  res.json(order);
}));

app.get('/api/config', (req, res) => {
  res.json({ deliveryFeeXaf: DELIVERY_FEE_XAF, commissionRatePercent: COMMISSION_RATE_PERCENT });
});

async function validateCoupon(code, itemsSubtotal) {
  if (!code?.trim()) return { valid: false, message: 'Enter a coupon code' };

  const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon || !coupon.active) return { valid: false, message: 'Invalid or inactive coupon code' };
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return { valid: false, message: 'This coupon has expired' };
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) return { valid: false, message: 'This coupon has reached its usage limit' };
  if (itemsSubtotal < coupon.minOrderAmount) {
    return { valid: false, message: `This coupon requires a minimum order of ${coupon.minOrderAmount.toLocaleString()} CFA` };
  }

  const discountAmount = coupon.discountType === 'PERCENT'
    ? Math.round(itemsSubtotal * (coupon.discountValue / 100))
    : Math.min(coupon.discountValue, itemsSubtotal);

  return { valid: true, coupon, discountAmount };
}

app.post('/api/coupons/validate', asyncHandler(async (req, res) => {
  const { code, itemsSubtotal } = req.body;
  const result = await validateCoupon(code, Math.max(0, parseInt(itemsSubtotal) || 0));
  if (!result.valid) return res.status(400).json({ success: false, message: result.message });
  res.json({ success: true, discountAmount: result.discountAmount, discountType: result.coupon.discountType, discountValue: result.coupon.discountValue });
}));

app.post('/api/checkout', requireAuth, asyncHandler(async (req, res) => {
  const { items, shippingAddress, shippingCity, shippingPhone, couponCode } = req.body;

  if (!items?.length) {
    return res.status(400).json({ success: false, message: 'Cart is empty' });
  }
  if (!shippingAddress?.trim() || !shippingCity?.trim() || !shippingPhone?.trim()) {
    return res.status(400).json({ success: false, message: 'Shipping address, city and phone are required' });
  }

  const productIds = items.map(i => String(i.id || i.productId)).filter(Boolean);
  const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const productById = Object.fromEntries(dbProducts.map(p => [p.id, p]));

  const requestedItems = items
    .filter(i => productById[String(i.id || i.productId)] !== undefined)
    .map(i => ({
      productId: String(i.id || i.productId),
      quantity: Math.max(1, parseInt(i.quantity) || 1),
    }));

  if (!requestedItems.length) {
    return res.status(400).json({ success: false, message: 'No valid products in cart' });
  }

  const outOfStock = requestedItems
    .map(i => ({ ...i, product: productById[i.productId] }))
    .filter(i => i.product.stock < i.quantity);

  if (outOfStock.length) {
    return res.status(409).json({
      success: false,
      message: 'Some items in your cart are no longer available',
      outOfStock: outOfStock.map(i => ({
        productId: i.productId, name: i.product.name, requested: i.quantity, available: i.product.stock,
      })),
    });
  }

  const commissionRate = COMMISSION_RATE_PERCENT / 100;
  const orderItems = requestedItems.map(i => {
    const price = productById[i.productId].price;
    const lineTotal = price * i.quantity;
    const platformFee = Math.round(lineTotal * commissionRate);
    return { productId: i.productId, quantity: i.quantity, price, commissionRate, platformFee, vendorEarning: lineTotal - platformFee };
  });

  const itemsSubtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const deliveryFee = DELIVERY_FEE_XAF;

  let discountAmount = 0;
  let appliedCouponCode = null;
  if (couponCode?.trim()) {
    const couponResult = await validateCoupon(couponCode, itemsSubtotal);
    if (!couponResult.valid) {
      return res.status(400).json({ success: false, message: couponResult.message });
    }
    discountAmount = couponResult.discountAmount;
    appliedCouponCode = couponResult.coupon.code;
  }

  const totalAmount = itemsSubtotal - discountAmount + deliveryFee;

  const order = await prisma.order.create({
    data: {
      userId: req.user.id, itemsSubtotal, deliveryFee, couponCode: appliedCouponCode, discountAmount, totalAmount,
      status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID',
      shippingAddress: shippingAddress.trim(), shippingCity: shippingCity.trim(), shippingPhone: shippingPhone.trim(),
      items: { create: orderItems }
    },
    include: { items: { include: { product: true } } }
  });

  res.json({ success: true, order });
}));

// ===== PAYMENT (NotchPay) =====

app.post('/api/payment/initiate', requireAuth, asyncHandler(async (req, res) => {
  if (!NOTCHPAY_PUBLIC_KEY) {
    return res.status(503).json({ success: false, message: 'Payment provider is not configured yet (missing NOTCHPAY_PUBLIC_KEY)' });
  }

  const { orderId, paymentMethod } = req.body;
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== req.user.id) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  if (order.paymentStatus === 'PAID') {
    return res.status(400).json({ success: false, message: 'Order already paid' });
  }

  const channels = paymentMethod === 'CARD' ? ['card'] : ['mobile_money'];

  const payload = {
    amount: order.totalAmount, currency: 'XAF', email: req.user.email, phone: order.shippingPhone || undefined,
    reference: order.id, description: `MyPetshoppy order #${order.id}`,
    callback: `${APP_URL}/checkout.html?order=${order.id}`, channels,
  };

  const notchpayRes = await fetch(`${NOTCHPAY_BASE_URL}/payments/initialize`, {
    method: 'POST',
    headers: { 'Authorization': NOTCHPAY_PUBLIC_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await notchpayRes.json();

  if (!notchpayRes.ok || !data.authorization_url) {
    console.error('NotchPay initiate error:', data);
    return res.status(502).json({ success: false, message: data.message || 'Unable to start payment' });
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { paymentMethod: paymentMethod || 'MOMO', paymentProvider: 'notchpay', paymentReference: data.transaction?.reference || order.id }
  });

  res.json({ success: true, paymentUrl: data.authorization_url });
}));

async function verifyNotchpayTransaction(reference) {
  const notchpayRes = await fetch(`${NOTCHPAY_BASE_URL}/payments/${encodeURIComponent(reference)}`, {
    headers: { 'Authorization': NOTCHPAY_PUBLIC_KEY, 'Accept': 'application/json' },
  });
  return notchpayRes.json();
}

async function markOrderFromNotchpayResult(orderId, result) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paymentStatus === 'PAID') return order;

  const status = result?.transaction?.status;
  if (status === 'complete') {
    const updated = await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: 'PAID', status: 'PROCESSING' } });
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      await prisma.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } }
      }).catch(() => {});
    }
    if (order.couponCode) {
      await prisma.coupon.update({ where: { code: order.couponCode }, data: { usesCount: { increment: 1 } } }).catch(() => {});
    }
    return updated;
  }
  if (status === 'failed' || status === 'canceled' || status === 'expired') {
    return prisma.order.update({ where: { id: orderId }, data: { paymentStatus: 'FAILED' } });
  }
  return order;
}

app.post('/api/payment/notify', asyncHandler(async (req, res) => {
  const reference = req.body?.data?.reference || req.body?.reference || req.body?.transaction?.reference;
  if (!reference) return res.sendStatus(400);
  try {
    const result = await verifyNotchpayTransaction(reference);
    await markOrderFromNotchpayResult(reference, result);
  } catch (e) {
    console.error('NotchPay notify error:', e);
  }
  res.sendStatus(200);
}));

app.get('/api/payment/status/:orderId', requireAuth, asyncHandler(async (req, res) => {
  let order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
  if (!order || order.userId !== req.user.id) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  if (order.paymentStatus === 'UNPAID' && NOTCHPAY_PUBLIC_KEY) {
    try {
      const result = await verifyNotchpayTransaction(order.paymentReference || order.id);
      order = await markOrderFromNotchpayResult(order.id, result) || order;
    } catch (e) {
      console.error('NotchPay status check error:', e);
    }
  }
  res.json({ success: true, status: order.status, paymentStatus: order.paymentStatus, order });
}));

// ===== REVIEWS =====

app.get('/api/products/:id/reviews', asyncHandler(async (req, res) => {
  const reviews = await prisma.review.findMany({ where: { productId: req.params.id }, orderBy: { createdAt: 'desc' }, include: { user: true } });
  const summary = { count: reviews.length, average: reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null };
  res.json({
    summary,
    reviews: reviews.map(r => ({ id: r.id, rating: r.rating, comment: r.comment, verifiedPurchase: r.verifiedPurchase, reviewerName: r.user.fullName, createdAt: r.createdAt }))
  });
}));

app.post('/api/products/:id/reviews', requireAuth, asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const ratingNum = parseInt(rating);
  if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
  }

  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const hasPurchased = await prisma.orderItem.findFirst({ where: { productId: req.params.id, order: { userId: req.user.id, paymentStatus: 'PAID' } } });

  const review = await prisma.review.upsert({
    where: { productId_userId: { productId: req.params.id, userId: req.user.id } },
    update: { rating: ratingNum, comment: comment?.trim() || null, verifiedPurchase: !!hasPurchased },
    create: { productId: req.params.id, userId: req.user.id, rating: ratingNum, comment: comment?.trim() || null, verifiedPurchase: !!hasPurchased }
  });

  const agg = await prisma.review.aggregate({ where: { productId: req.params.id }, _avg: { rating: true } });
  await prisma.product.update({ where: { id: req.params.id }, data: { rating: agg._avg.rating || null } });

  res.json({ success: true, review });
}));

// ===== WISHLIST =====

app.get('/api/wishlist', requireAuth, asyncHandler(async (req, res) => {
  const items = await prisma.wishlistItem.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, include: { product: true } });
  res.json(items.map(i => i.product));
}));

app.post('/api/wishlist/:productId', requireAuth, asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId: req.user.id, productId: req.params.productId } },
    update: {}, create: { userId: req.user.id, productId: req.params.productId },
  });
  res.json({ success: true });
}));

app.delete('/api/wishlist/:productId', requireAuth, asyncHandler(async (req, res) => {
  await prisma.wishlistItem.deleteMany({ where: { userId: req.user.id, productId: req.params.productId } });
  res.json({ success: true });
}));

// ===== IMAGE UPLOAD (Cloudinary) =====

app.post('/api/upload/image', requireVendor, asyncHandler(async (req, res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(503).json({ success: false, message: 'Image upload is not configured yet' });
  }
  const { image } = req.body;
  if (!image?.startsWith('data:')) {
    return res.status(400).json({ success: false, message: 'Send a base64 data URL in the "image" field' });
  }
  const result = await cloudinary.uploader.upload(image, {
    folder: 'mypetshoppy/products',
    transformation: [{ width: 1000, height: 1000, crop: 'fill', gravity: 'auto', quality: 'auto' }],
  });
  res.json({ success: true, url: result.secure_url });
}));

// ===== VENDOR ENDPOINTS =====

app.post('/api/vendor/auth/register', asyncHandler(async (req, res) => {
  const { fullName, email, password, businessName } = req.body;
  if (!fullName?.trim() || !email?.trim() || !password?.trim() || !businessName?.trim()) {
    return res.status(400).json({ success: false, message: 'Missing vendor registration fields' });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 10);
  const vendor = await prisma.user.create({ data: { fullName, email: email.toLowerCase(), password: hashed, role: 'vendor', businessName } });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId: vendor.id, expiresAt } });

  res.json({ token, vendor: { fullName: vendor.fullName, email: vendor.email, role: vendor.role } });
}));

app.post('/api/vendor/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const vendor = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
  if (!vendor || vendor.role !== 'vendor') {
    return res.status(401).json({ success: false, message: 'Invalid vendor credentials' });
  }

  const ok = await bcrypt.compare(password, vendor.password);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid vendor credentials' });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId: vendor.id, expiresAt } });

  res.json({ token, vendor: { fullName: vendor.fullName, email: vendor.email, role: vendor.role } });
}));

app.get('/api/vendor/momo', requireVendor, asyncHandler(async (req, res) => {
  res.json({ momoProvider: req.user.momoProvider, momoPhone: req.user.momoPhone });
}));

app.put('/api/vendor/momo', requireVendor, asyncHandler(async (req, res) => {
  const { momoProvider, momoPhone } = req.body;
  if (!['MTN', 'ORANGE'].includes(momoProvider)) {
    return res.status(400).json({ success: false, message: 'momoProvider must be MTN or ORANGE' });
  }
  if (!momoPhone?.trim() || !/^\+?[0-9]{8,15}$/.test(momoPhone.trim())) {
    return res.status(400).json({ success: false, message: 'Enter a valid phone number, e.g. +237600000000' });
  }

  const changed = req.user.momoProvider !== momoProvider || req.user.momoPhone !== momoPhone.trim();
  await prisma.user.update({
    where: { id: req.user.id },
    data: { momoProvider, momoPhone: momoPhone.trim(), notchpayRecipientId: changed ? null : req.user.notchpayRecipientId }
  });
  res.json({ success: true });
}));

app.get('/api/vendor/products', requireVendor, asyncHandler(async (req, res) => {
  const { search } = req.query;
  const where = { ...vendorProductsWhere(req.user) };
  if (search) {
    const term = String(search).trim();
    where.AND = [{ OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { category: { contains: term, mode: 'insensitive' } },
      { breed: { contains: term, mode: 'insensitive' } },
    ] }];
  }
  const products = await prisma.product.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(products);
}));

app.post('/api/vendor/products', requireVendor, asyncHandler(async (req, res) => {
  const { name, description, price, category, image, stock, features, breed, age } = req.body;
  if (!name?.trim() || !price || !category?.trim()) {
    return res.status(400).json({ success: false, message: 'Missing product fields' });
  }

  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const uniqueSuffix = crypto.randomBytes(3).toString('hex');
  const cleanFeatures = Array.isArray(features) ? features.map(f => String(f).trim()).filter(Boolean).slice(0, 12) : [];

  const product = await prisma.product.create({
    data: {
      id: `${category.toLowerCase()}-${slug}-${uniqueSuffix}`,
      name: name.trim(), description: description?.trim() || '', features: cleanFeatures,
      price: Math.max(1, parseInt(price)), category: category.toLowerCase(),
      breed: breed?.trim() || null, age: age?.trim() || null, image: image || '',
      stock: stock !== undefined ? Math.max(0, parseInt(stock) || 0) : 1,
      vendor: req.user.fullName, vendorId: req.user.id, rating: null,
    }
  });

  res.json({ success: true, product });
}));

app.put('/api/vendor/products/:id', requireVendor, asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({ where: { id: req.params.id, ...vendorProductsWhere(req.user) } });
  if (!product) return res.status(403).json({ success: false, message: 'Not your product' });

  const updated = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      name: req.body.name || product.name,
      description: req.body.description !== undefined ? req.body.description : product.description,
      features: Array.isArray(req.body.features) ? req.body.features.map(f => String(f).trim()).filter(Boolean).slice(0, 12) : product.features,
      price: req.body.price ? Math.max(1, parseInt(req.body.price)) : product.price,
      breed: req.body.breed !== undefined ? req.body.breed : product.breed,
      age: req.body.age !== undefined ? req.body.age : product.age,
      image: req.body.image || product.image,
      stock: req.body.stock !== undefined ? Math.max(0, parseInt(req.body.stock) || 0) : product.stock,
      vendorId: product.vendorId || req.user.id,
    }
  });

  res.json({ success: true, product: updated });
}));

app.delete('/api/vendor/products/:id', requireVendor, asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({ where: { id: req.params.id, ...vendorProductsWhere(req.user) } });
  if (!product) return res.status(403).json({ success: false, message: 'Not your product' });

  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Product deleted' });
}));

const VENDOR_ALLOWED_STATUSES = ['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

app.put('/api/vendor/orders/:id/status', requireVendor, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!VENDOR_ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: `Status must be one of: ${VENDOR_ALLOWED_STATUSES.join(', ')}` });
  }

  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } } } });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const ownsAnItem = order.items.some(i => i.product?.vendorId === req.user.id || i.product?.vendor === req.user.fullName);
  if (!ownsAnItem) return res.status(403).json({ success: false, message: 'Not your order' });

  const updated = await prisma.order.update({ where: { id: order.id }, data: { status } });
  res.json({ success: true, order: updated });
}));

app.get('/api/vendor/stats', requireVendor, asyncHandler(async (req, res) => {
  const vendorWhere = vendorProductsWhere(req.user);
  const products = await prisma.product.findMany({ where: vendorWhere });

  const orders = await prisma.order.findMany({
    where: { items: { some: { product: vendorWhere } } },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { product: true } }, user: true }
  });

  const isMine = (item) => item.product?.vendorId === req.user.id || item.product?.vendor === req.user.fullName;

  const totalRevenue = orders.filter(order => order.paymentStatus === 'PAID')
    .reduce((sum, order) => sum + order.items.filter(isMine).reduce((s, i) => s + i.vendorEarning, 0), 0);

  const payouts = await prisma.payout.findMany({ where: { vendorId: req.user.id }, orderBy: { createdAt: 'desc' } });
  const totalPaidOut = payouts.reduce((sum, p) => sum + p.amount, 0);

  res.json({
    productCount: products.length, orderCount: orders.length, totalRevenue, totalPaidOut,
    availableBalance: totalRevenue - totalPaidOut, payouts, commissionRatePercent: COMMISSION_RATE_PERCENT, products,
    orders: orders.map(o => {
      const myItems = o.items.filter(isMine);
      const vendorAmount = myItems.reduce((sum, item) => sum + item.vendorEarning, 0);
      return {
        id: o.id, customerName: o.user.fullName, vendorAmount, status: o.status, paymentStatus: o.paymentStatus,
        shippingAddress: o.shippingAddress, shippingCity: o.shippingCity, shippingPhone: o.shippingPhone, createdAt: o.createdAt,
        items: myItems.map(i => ({ productName: i.product?.name || 'Item', quantity: i.quantity, price: i.price, platformFee: i.platformFee, vendorEarning: i.vendorEarning })),
      };
    })
  });
}));

// ===== ADMIN =====

app.post('/api/admin/login', asyncHandler(async (req, res) => {
  const { secret } = req.body;
  if (!ADMIN_SECRET || !secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Invalid admin password' });
  }
  res.json({ success: true, token: ADMIN_SECRET });
}));

app.get('/api/admin/stats', requireAdmin, asyncHandler(async (req, res) => {
  const [userCount, vendorCount, productCount, orderCount] = await Promise.all([
    prisma.user.count({ where: { role: 'customer' } }),
    prisma.user.count({ where: { role: 'vendor' } }),
    prisma.product.count(),
    prisma.order.count(),
  ]);

  const paidOrders = await prisma.order.findMany({ where: { paymentStatus: 'PAID' }, include: { items: true } });
  const totalGMV = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const platformRevenue = paidOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.platformFee, 0), 0);

  res.json({ userCount, vendorCount, productCount, orderCount, totalGMV, platformRevenue, paidOrderCount: paidOrders.length });
}));

app.get('/api/admin/customers', requireAdmin, asyncHandler(async (req, res) => {
  const { search } = req.query;
  const where = { role: 'customer' };
  if (search) {
    const term = String(search).trim();
    where.OR = [{ fullName: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }];
  }
  const customers = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  const withStats = await Promise.all(customers.map(async (c) => {
    const orders = await prisma.order.findMany({ where: { userId: c.id } });
    const paidOrders = orders.filter(o => o.paymentStatus === 'PAID');
    return { id: c.id, fullName: c.fullName, email: c.email, createdAt: c.createdAt, orderCount: orders.length, totalSpent: paidOrders.reduce((sum, o) => sum + o.totalAmount, 0) };
  }));
  res.json(withStats);
}));

app.get('/api/admin/vendors', requireAdmin, asyncHandler(async (req, res) => {
  const vendors = await prisma.user.findMany({ where: { role: 'vendor' }, orderBy: { createdAt: 'desc' } });
  const vendorsWithCounts = await Promise.all(vendors.map(async (v) => {
    const productCount = await prisma.product.count({ where: { OR: [{ vendorId: v.id }, { vendor: v.fullName }] } });
    const { totalEarned, totalPaidOut, balance } = await getVendorBalance(v);
    return {
      id: v.id, fullName: v.fullName, email: v.email, businessName: v.businessName, createdAt: v.createdAt,
      productCount, totalEarned, totalPaidOut, balance, momoProvider: v.momoProvider, momoPhone: v.momoPhone,
    };
  }));
  res.json(vendorsWithCounts);
}));

app.get('/api/admin/vendors/:id/payouts', requireAdmin, asyncHandler(async (req, res) => {
  const vendor = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!vendor || vendor.role !== 'vendor') return res.status(404).json({ success: false, message: 'Vendor not found' });

  const payouts = await prisma.payout.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: 'desc' } });
  const balance = await getVendorBalance(vendor);
  res.json({ vendor: { id: vendor.id, fullName: vendor.fullName, businessName: vendor.businessName }, ...balance, payouts });
}));

app.post('/api/admin/vendors/:id/payouts', requireAdmin, asyncHandler(async (req, res) => {
  const { amount, method, reference, notes } = req.body;
  const amountNum = parseInt(amount);
  if (!amountNum || amountNum <= 0) {
    return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
  }

  const vendor = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!vendor || vendor.role !== 'vendor') return res.status(404).json({ success: false, message: 'Vendor not found' });

  const { balance } = await getVendorBalance(vendor);
  if (amountNum > balance) {
    return res.status(400).json({ success: false, message: `Amount exceeds vendor's current balance (${balance.toLocaleString()} CFA owed)` });
  }

  const payout = await prisma.payout.create({
    data: { vendorId: vendor.id, amount: amountNum, method: method?.trim() || null, reference: reference?.trim() || null, notes: notes?.trim() || null }
  });
  res.json({ success: true, payout });
}));

app.post('/api/admin/vendors/:id/payouts/send', requireAdmin, asyncHandler(async (req, res) => {
  if (!NOTCHPAY_PUBLIC_KEY || !NOTCHPAY_PRIVATE_KEY) {
    return res.status(503).json({ success: false, message: 'NOTCHPAY_PRIVATE_KEY is not configured — real transfers are unavailable until it is set.' });
  }

  const { amount } = req.body;
  const amountNum = parseInt(amount);
  if (!amountNum || amountNum <= 0) {
    return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
  }

  const vendor = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!vendor || vendor.role !== 'vendor') return res.status(404).json({ success: false, message: 'Vendor not found' });
  if (!vendor.momoProvider || !vendor.momoPhone) {
    return res.status(400).json({ success: false, message: 'This vendor has not registered a Mobile Money number yet.' });
  }

  const { balance } = await getVendorBalance(vendor);
  if (amountNum > balance) {
    return res.status(400).json({ success: false, message: `Amount exceeds vendor's current balance (${balance.toLocaleString()} CFA owed)` });
  }

  const channel = vendor.momoProvider === 'MTN' ? 'cm.mtn' : 'cm.orange';
  const notchpayHeaders = { 'Authorization': NOTCHPAY_PUBLIC_KEY, 'X-Grant': NOTCHPAY_PRIVATE_KEY, 'Content-Type': 'application/json' };

  let recipientId = vendor.notchpayRecipientId;
  if (!recipientId) {
    const recRes = await fetch(`${NOTCHPAY_BASE_URL}/recipients`, {
      method: 'POST', headers: notchpayHeaders,
      body: JSON.stringify({ channel, name: vendor.businessName || vendor.fullName, phone: vendor.momoPhone, account_number: vendor.momoPhone }),
    });
    const recData = await recRes.json();
    if (!recRes.ok || !recData.recipient?.id) {
      console.error('NotchPay recipient error:', recData);
      return res.status(502).json({ success: false, message: recData.message || 'Unable to register this vendor\'s Mobile Money account with NotchPay.' });
    }
    recipientId = recData.recipient.id;
    await prisma.user.update({ where: { id: vendor.id }, data: { notchpayRecipientId: recipientId } });
  }

  const transferReference = `payout-${vendor.id}-${Date.now()}`;
  const transferRes = await fetch(`${NOTCHPAY_BASE_URL}/transfers`, {
    method: 'POST', headers: notchpayHeaders,
    body: JSON.stringify({
      amount: amountNum, currency: 'XAF', beneficiary: recipientId, recipient: recipientId, channel,
      description: `MyPetshoppy payout to ${vendor.businessName || vendor.fullName}`, reference: transferReference,
    }),
  });
  const transferData = await transferRes.json();
  if (!transferRes.ok) {
    console.error('NotchPay transfer error:', transferData);
    return res.status(502).json({ success: false, message: transferData.message || 'Transfer failed. Check that your business account is verified and your server IP is whitelisted with NotchPay.' });
  }

  const payout = await prisma.payout.create({
    data: {
      vendorId: vendor.id, amount: amountNum,
      method: vendor.momoProvider === 'MTN' ? 'MTN Mobile Money' : 'Orange Money',
      reference: transferReference, automated: true, notes: 'Sent automatically via NotchPay Transfers',
    }
  });

  res.json({ success: true, payout, transfer: transferData.transfer || transferData });
}));

app.get('/api/admin/products', requireAdmin, asyncHandler(async (req, res) => {
  const { search } = req.query;
  const where = {};
  if (search) {
    const term = String(search).trim();
    where.OR = [{ name: { contains: term, mode: 'insensitive' } }, { vendor: { contains: term, mode: 'insensitive' } }];
  }
  const products = await prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(products);
}));

app.delete('/api/admin/products/:id', requireAdmin, asyncHandler(async (req, res) => {
  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

app.get('/api/admin/orders', requireAdmin, asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' }, take: 100, include: { user: true, items: { include: { product: true } } }
  });
  res.json(orders.map(o => ({
    id: o.id, customerName: o.user.fullName, customerEmail: o.user.email,
    itemsSubtotal: o.itemsSubtotal, deliveryFee: o.deliveryFee, discountAmount: o.discountAmount, couponCode: o.couponCode,
    totalAmount: o.totalAmount, status: o.status, paymentStatus: o.paymentStatus, paymentProvider: o.paymentProvider,
    paymentReference: o.paymentReference, createdAt: o.createdAt,
    items: o.items.map(i => ({ productName: i.product?.name || 'Item', quantity: i.quantity, price: i.price })),
  })));
}));

app.get('/api/admin/coupons', requireAdmin, asyncHandler(async (req, res) => {
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(coupons);
}));

app.post('/api/admin/coupons', requireAdmin, asyncHandler(async (req, res) => {
  const { code, discountType, discountValue, maxUses, minOrderAmount, expiresInDays } = req.body;
  if (!code?.trim() || !['PERCENT', 'FIXED'].includes(discountType) || !discountValue) {
    return res.status(400).json({ success: false, message: 'Missing or invalid coupon fields' });
  }
  const coupon = await prisma.coupon.create({
    data: {
      code: code.trim().toUpperCase(), discountType, discountValue: parseInt(discountValue),
      maxUses: maxUses ? parseInt(maxUses) : null, minOrderAmount: minOrderAmount ? parseInt(minOrderAmount) : 0,
      expiresAt: expiresInDays ? new Date(Date.now() + parseInt(expiresInDays) * 24 * 60 * 60 * 1000) : null,
    }
  });
  res.json({ success: true, coupon });
}));

app.put('/api/admin/coupons/:code/toggle', requireAdmin, asyncHandler(async (req, res) => {
  const coupon = await prisma.coupon.findUnique({ where: { code: req.params.code.toUpperCase() } });
  if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
  const updated = await prisma.coupon.update({ where: { code: coupon.code }, data: { active: !coupon.active } });
  res.json({ success: true, coupon: updated });
}));

// ===== STATIC FILES =====

app.use(express.static(join(__dirname, 'public')));

app.use(/^\/api\//, (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`MyPetshoppy server running on http://localhost:${port}`);
  });
}

export default app;
