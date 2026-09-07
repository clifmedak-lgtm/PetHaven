/**
 * ==============================================================================
 * PETHAVEN - MASTER BACKEND ENGINE (PRODUCTION BUILD)
 * ==============================================================================
 * Version: 2.0.1
 * Purpose: Full Multi-Vendor Pet Marketplace Infrastructure
 * Tech Stack: Node.js, Express, Prisma ORM, PostgreSQL, Cloudinary, NotchPay, Brevo
 * 
 * Logic Mapping:
 * 1.  CORE CONFIGURATION & ENV VALIDATION
 * 2.  MIDDLEWARE STACK (Auth, Logging, Role Verification)
 * 3.  UTILITY LAYER (Currency, Slugs, Token Gen)
 * 4.  IMAGE ENGINE (Cloudinary Integration)
 * 5.  EMAIL ENGINE (Brevo SMTP Logic)
 * 6.  VENDOR ENGINE (Commission Math & Balance System)
 * 7.  ORDER ENGINE (NotchPay, Polling, Status Verification)
 * 8.  PRODUCT ENGINE (Bulky Filters & Search)
 * 9.  ADMIN CONSOLE (Master Stats & Manual Payout Recording)
 * 10. ERROR HANDLING & SHUTDOWN LOGIC
 * ==============================================================================
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

// ------------------------------------------------------------------------------
// 1. CORE CONFIGURATION
// ------------------------------------------------------------------------------
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Global Constants from Environment
 * Ensuring type-safety and fallback defaults
 */
const NOTCHPAY_PUBLIC_KEY = process.env.NOTCHPAY_PUBLIC_KEY;
const NOTCHPAY_PRIVATE_KEY = process.env.NOTCHPAY_PRIVATE_KEY;
const NOTCHPAY_BASE_URL = 'https://api.notchpay.co';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'PetHaven Marketplace';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Business Parameters
const DELIVERY_FEE_XAF = parseInt(process.env.DELIVERY_FEE_XAF) || 1500;
const COMMISSION_RATE_PERCENT = parseFloat(process.env.COMMISSION_RATE_PERCENT) || 10;

// Cloudinary Configuration
if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('[SYSTEM] Cloudinary Engine Initialized.');
}

// ------------------------------------------------------------------------------
// 2. MIDDLEWARE STACK
// ------------------------------------------------------------------------------

// Security & Parsing
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

/**
 * Performance Request Logger
 */
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[HTTP] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

/**
 * Authentication Middleware (Bulky)
 * Extracts Bearer token and validates active session in Prisma
 */
const addUserToRequest = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    req.user = null;
    if (!token) return next();

    try {
        const session = await prisma.session.findUnique({
            where: { token },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        role: true,
                        businessName: true,
                        momoProvider: true,
                        momoPhone: true,
                        notchpayRecipientId: true
                    }
                }
            }
        });

        if (session && new Date(session.expiresAt) >= new Date()) {
            req.user = session.user;
        } else if (session) {
            // Cleanup expired session
            await prisma.session.delete({ where: { token } }).catch(() => { });
        }
    } catch (error) {
        console.error('[AUTH ERROR] Token validation failed:', error.message);
    }
    next();
};

app.use(addUserToRequest);

/**
 * Role-Based Access Control (RBAC)
 */
const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Identity validation required' });
    next();
};

const requireVendor = (req, res, next) => {
    if (!req.user || req.user.role !== 'vendor') {
        return res.status(403).json({ success: false, message: 'Access denied: Breeder/Vendor credentials required' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Access denied: Master Admin secret required' });
    }
    next();
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ------------------------------------------------------------------------------
// 3. UTILITY ENGINE
// ------------------------------------------------------------------------------

/**
 * Generates secure hex tokens for sessions and password resets
 */
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Creates valid URL-friendly slugs for pet breeds and products
 */
function createProductSlug(name, category) {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `${category.toLowerCase()}-${base}-${crypto.randomBytes(3).toString('hex')}`;
}

// ------------------------------------------------------------------------------
// 4. IMAGE PROCESSING (CLOUDINARY)
// ------------------------------------------------------------------------------

/**
 * Process and upload animal photos with AI saliency cropping
 * Ensures all pet photos are high-quality 1:1 squares
 */
app.post('/api/upload/image', requireVendor, asyncHandler(async (req, res) => {
    const { image } = req.body;
    if (!image || !image.startsWith('data:image')) {
        return res.status(400).json({ success: false, message: 'Valid Base64 image string required' });
    }

    try {
        const result = await cloudinary.uploader.upload(image, {
            folder: 'pethaven/products',
            transformation: [
                { width: 1200, height: 1200, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }
            ]
        });

        console.log(`[IMAGE] New pet photo uploaded: ${result.secure_url}`);
        res.json({ success: true, url: result.secure_url });
    } catch (error) {
        console.error('[CLOUDINARY ERROR]', error);
        res.status(500).json({ success: false, message: 'Image processing failed' });
    }
}));

// ------------------------------------------------------------------------------
// 5. EMAIL SYSTEM (BREVO SMTP)
// ------------------------------------------------------------------------------

/**
 * Sends transactional emails via Brevo API
 */
async function sendPetHavenEmail({ to, subject, htmlContent }) {
    if (!BREVO_API_KEY || !EMAIL_FROM) {
        console.warn('[MAIL WARNING] Email not configured. Content:', subject);
        return;
    }

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM },
                to: [{ email: to }],
                subject,
                htmlContent
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('[BREVO ERROR]', error);
        }
    } catch (e) {
        console.error('[MAIL FAULT]', e.message);
    }
}

// ------------------------------------------------------------------------------
// 6. VENDOR MANAGEMENT ENGINE
// ------------------------------------------------------------------------------

/**
 * Calculate net balances for Breeders
 * PAID orders only, minus platform commission
 */
async function getVendorEarningStats(vendorUser) {
    const vendorWhere = { OR: [{ vendorId: vendorUser.id }, { vendor: vendorUser.fullName }] };

    // Find all paid order items belonging to this vendor
    const paidItems = await prisma.orderItem.findMany({
        where: {
            order: { paymentStatus: 'PAID' },
            product: vendorWhere
        }
    });

    const totalEarned = paidItems.reduce((sum, item) => sum + item.vendorEarning, 0);

    const payouts = await prisma.payout.findMany({
        where: { vendorId: vendorUser.id },
        orderBy: { createdAt: 'desc' }
    });

    const totalPaidOut = payouts.reduce((sum, p) => sum + p.amount, 0);

    return {
        totalEarned,
        totalPaidOut,
        balance: totalEarned - totalPaidOut,
        payoutHistory: payouts
    };
}

// ------------------------------------------------------------------------------
// 7. ORDER & PAYMENT ENGINE (NOTCHPAY)
// ------------------------------------------------------------------------------

/**
 * Initiates order acquisition in PENDING_PAYMENT state
 */
app.post('/api/checkout', requireAuth, asyncHandler(async (req, res) => {
    const { items, shippingAddress, shippingCity, shippingPhone } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Basket is empty' });
    }

    // Input Validation
    if (!shippingAddress?.trim() || !shippingCity?.trim() || !shippingPhone?.trim()) {
        return res.status(400).json({ success: false, message: 'Complete logistics data required' });
    }

    const productIds = items.map(i => String(i.id));
    const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = Object.fromEntries(dbProducts.map(p => [p.id, p]));

    // Check Stock
    const outOfStock = items.filter(i => (productMap[i.id]?.stock || 0) < i.quantity);
    if (outOfStock.length > 0) {
        return res.status(409).json({ success: false, message: 'Stock depleted for selected items', outOfStock });
    }

    const commissionRate = COMMISSION_RATE_PERCENT / 100;
    const orderItemsFinal = items.map(item => {
        const dbProduct = productMap[item.id];
        const lineTotal = dbProduct.price * item.quantity;
        const platformFee = Math.round(lineTotal * commissionRate);

        return {
            productId: dbProduct.id,
            quantity: item.quantity,
            price: dbProduct.price,
            commissionRate: commissionRate,
            platformFee: platformFee,
            vendorEarning: lineTotal - platformFee
        };
    });

    const itemsSubtotal = orderItemsFinal.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    const totalAmount = itemsSubtotal + DELIVERY_FEE_XAF;

    const order = await prisma.order.create({
        data: {
            userId: req.user.id,
            itemsSubtotal,
            deliveryFee: DELIVERY_FEE_XAF,
            totalAmount,
            status: 'PENDING_PAYMENT',
            paymentStatus: 'UNPAID',
            shippingAddress: shippingAddress.trim(),
            shippingCity: shippingCity.trim(),
            shippingPhone: shippingPhone.trim(),
            items: { create: orderItemsFinal }
        },
        include: { items: { include: { product: true } } }
    });

    console.log(`[ORDER] New order generated: ${order.id} | Total: ${totalAmount} CFA`);
    res.json({ success: true, order });
}));

/**
 * Initiates NotchPay Redirect
 */
app.post('/api/payment/initiate', requireAuth, asyncHandler(async (req, res) => {
    const { orderId, paymentMethod } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== req.user.id) {
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const payload = {
        amount: order.totalAmount,
        currency: 'XAF',
        email: req.user.email,
        phone: order.shippingPhone,
        reference: order.id,
        description: `PetHaven Order #${order.id}`,
        callback: `${APP_URL}/checkout.html?order=${order.id}`,
        channels: paymentMethod === 'CARD' ? ['card'] : ['mobile_money']
    };

    const response = await fetch(`${NOTCHPAY_BASE_URL}/payments/initialize`, {
        method: 'POST',
        headers: {
            'Authorization': NOTCHPAY_PUBLIC_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Payment initiation failed');

    await prisma.order.update({
        where: { id: order.id },
        data: {
            paymentMethod: paymentMethod || 'MOMO',
            paymentProvider: 'notchpay',
            paymentReference: data.transaction?.reference || order.id
        }
    });

    res.json({ success: true, paymentUrl: data.authorization_url });
}));

/**
 * NotchPay Order Status Polling (Secure Fallback)
 */
app.get('/api/payment/status/:orderId', requireAuth, asyncHandler(async (req, res) => {
    let order = await prisma.order.findUnique({ where: { id: req.params.orderId } });

    if (!order || order.userId !== req.user.id) {
        return res.status(404).json({ message: 'Order not found' });
    }

    // If still unpaid, verify with NotchPay directly
    if (order.paymentStatus === 'UNPAID') {
        try {
            const verifyRes = await fetch(`${NOTCHPAY_BASE_URL}/payments/${order.paymentReference}`, {
                headers: { 'Authorization': NOTCHPAY_PUBLIC_KEY, 'Accept': 'application/json' }
            });
            const verifyData = await verifyRes.json();

            if (verifyData.transaction?.status === 'complete') {
                order = await prisma.order.update({
                    where: { id: order.id },
                    data: { paymentStatus: 'PAID', status: 'PROCESSING' }
                });

                // Decrement Stock Logic
                const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
                for (const item of items) {
                    await prisma.product.update({
                        where: { id: item.productId },
                        data: { stock: { decrement: item.quantity } }
                    }).catch(() => { });
                }

                // Send Confirmation Email
                await sendPetHavenEmail({
                    to: req.user.email,
                    subject: 'Welcome to the PetHaven Family!',
                    htmlContent: `<h1>Order Confirmed!</h1><p>Your order #${order.id} is now being prepared for delivery.</p>`
                });
            }
        } catch (e) { console.error('[VERIFICATION ERROR]', e.message); }
    }

    res.json({ success: true, status: order.status, paymentStatus: order.paymentStatus });
}));

// ------------------------------------------------------------------------------
// 8. PRODUCT ENGINE (MASSIVE SEARCH & FILTERS)
// ------------------------------------------------------------------------------

/**
 * Bulky Retrieval with Category, Search, and Price Matrix
 */
app.get('/api/products', asyncHandler(async (req, res) => {
    const { category, search, id, priceMin, priceMax, sort } = req.query;

    if (id) {
        const product = await prisma.product.findUnique({
            where: { id: String(id) },
            include: { reviews: { include: { user: true }, take: 10 } }
        });
        if (!product) return res.status(404).json({ success: false, message: 'Pet or supply not found' });
        return res.json(product);
    }

    const where = {};
    if (category && category !== 'all') {
        where.category = String(category);
    }

    if (search) {
        const term = String(search).trim();
        where.OR = [
            { name: { contains: term, mode: 'insensitive' } },
            { breed: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { vendor: { contains: term, mode: 'insensitive' } }
        ];
    }

    if (priceMin || priceMax) {
        where.price = {};
        if (priceMin) where.price.gte = parseInt(priceMin) || 0;
        if (priceMax) where.price.lte = parseInt(priceMax) || 999999999;
    }

    let orderBy = { createdAt: 'desc' };
    if (sort === 'price_asc') orderBy = { price: 'asc' };
    if (sort === 'price_desc') orderBy = { price: 'desc' };
    if (sort === 'rating') orderBy = { rating: 'desc' };

    const products = await prisma.product.findMany({
        where,
        orderBy,
        take: 100
    });

    res.json(products);
}));

app.get('/api/recommendations', asyncHandler(async (req, res) => {
    const { category } = req.query;
    const where = category && category !== 'all' ? { category } : {};
    const products = await prisma.product.findMany({
        where,
        orderBy: { rating: 'desc' },
        take: 8
    });
    res.json(products);
}));

// ------------------------------------------------------------------------------
// 9. ADMIN MASTER ENGINE
// ------------------------------------------------------------------------------

app.post('/api/admin/login', asyncHandler(async (req, res) => {
    const { secret } = req.body;
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, message: 'Invalid Master Secret' });
    }
    res.json({ success: true, token: ADMIN_SECRET });
}));

/**
 * Bulky Stats Calculator for Admin Dashboard
 */
app.get('/api/admin/stats', requireAdmin, asyncHandler(async (req, res) => {
    const [userCount, vendorCount, productCount, orderCount] = await Promise.all([
        prisma.user.count({ where: { role: 'customer' } }),
        prisma.user.count({ where: { role: 'vendor' } }),
        prisma.product.count(),
        prisma.order.count()
    ]);

    const paidOrders = await prisma.order.findMany({
        where: { paymentStatus: 'PAID' },
        include: { items: true }
    });

    const totalGMV = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const platformRevenue = paidOrders.reduce((sum, o) => {
        return sum + o.items.reduce((s, i) => s + i.platformFee, 0);
    }, 0);

    res.json({
        userCount,
        vendorCount,
        productCount,
        orderCount,
        totalGMV,
        platformRevenue,
        paidOrderCount: paidOrders.length
    });
}));

// ------------------------------------------------------------------------------
// 10. AUTHENTICATION (REVIEWS, WISHLIST, SESSIONS)
// ------------------------------------------------------------------------------

app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { fullName, email, password, role, businessName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(400).json({ success: false, message: 'Identity already exists' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
        data: {
            fullName,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: role || 'customer',
            businessName: businessName || null
        }
    });

    const token = generateSecureToken();
    await prisma.session.create({
        data: {
            token,
            userId: user.id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 Days
        }
    });

    res.json({ token, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role } });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateSecureToken();
    await prisma.session.create({
        data: {
            token,
            userId: user.id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
    });

    res.json({ token, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role } });
}));

// ------------------------------------------------------------------------------
// FINALIZE & EXPORT
// ------------------------------------------------------------------------------

app.use(express.static(join(__dirname, 'public')));

// Global Error Catcher
app.use((err, req, res, next) => {
    console.error('[FATAL SERVER ERROR]', err);
    res.status(500).json({
        success: false,
        message: 'Internal Application Error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.post('/api/admin/vendors/:id/payouts/send', asyncHandler(async (req, res) => {
    const { amount } = req.body;
    const vendor = await prisma.user.findUnique({ where: { id: req.params.id } });

    const payload = {
        amount: parseInt(amount),
        currency: 'XAF',
        receiver: vendor.momoPhone,
        channel: vendor.momoProvider === 'MTN' ? 'cm.mtn' : 'cm.orange',
        reference: `PAYOUT-${vendor.id}-${Date.now()}`
    };

    const notchRes = await fetch(`${NOTCHPAY_BASE_URL}/transfers`, {
        method: 'POST',
        headers: {
            'Authorization': NOTCHPAY_PUBLIC_KEY,
            'X-Grant': NOTCHPAY_PRIVATE_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await notchRes.json();
    if (notchRes.ok) {
        await prisma.payout.create({ data: { vendorId: vendor.id, amount: parseInt(amount), reference: data.reference } });
        res.json({ success: true });
    } else {
        res.status(502).json({ message: data.message });
    }
}));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    [PETHAVEN] Engine Initialized
    Port: ${PORT}
    Node URL: ${APP_URL}
    Logic: Bulky Production v2.1
    `);
});

export default app;