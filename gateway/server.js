// x402 API Gateway Server
// Real integrations with Circle Wallet and Arc blockchain

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// Note: x402-express replaced with custom Arc x402 middleware
// Import services
import arcVerifier from './services/arcVerifier.js';
import circleWallet from './services/circleWallet.js';
import x402Client from './services/x402Client.js';
import arcExecutor from './services/arcExecutor.js';
import yellowNetwork from './services/yellowNetworkService.js';
// SQLite persistence
import { saveTransaction, persistProviderStats, loadProviderStats, getTransactionHistory, getDatabaseStats, getSpendingByPeriod, getSpendingStatus, saveYellowSession, saveYellowTransaction, isYellowPaymentUsed, getYellowSessionHistory } from './db.js';

dotenv.config();

const app = express();

// CORS Configuration - restrict in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// =====================
// SPENDING LIMITS & CONTROLS
// =====================
const SPENDING_LIMITS = {
    PER_TRANSACTION: parseFloat(process.env.MAX_TRANSACTION_AMOUNT) || 0.50,  // $0.50 max per transaction
    DAILY: parseFloat(process.env.DAILY_SPENDING_LIMIT) || 10.00,              // $10/day
    WEEKLY: parseFloat(process.env.WEEKLY_SPENDING_LIMIT) || 50.00,            // $50/week
    MONTHLY: parseFloat(process.env.MONTHLY_SPENDING_LIMIT) || 100.00,         // $100/month
    LOW_BALANCE_THRESHOLD: parseFloat(process.env.LOW_BALANCE_THRESHOLD) || 5.00  // Alert at $5
};

console.log('[Server] Spending Limits loaded:', SPENDING_LIMITS);

// Rate Limiting - protect against abuse
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 30; // 30 requests per minute (reduced from 100)

const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    const limit = rateLimit.get(ip);

    if (now > limit.resetTime) {
        // Reset window
        rateLimit.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    if (limit.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Try again in ${Math.ceil((limit.resetTime - now) / 1000)} seconds.`
        });
    }

    limit.count++;
    next();
};

app.use(rateLimitMiddleware);
app.use(express.json({ limit: '1mb' })); // Limit request body size

// Initialize Circle SDK, x402 Client, Arc Executor, and Yellow Network
circleWallet.initializeCircle();
x402Client.initializeCircleSdk();
arcExecutor.initializeExecutor();

// Initialize Yellow Network (optional - demo mode if not configured)
if (process.env.YELLOW_CLEARNODE_URL || process.env.YELLOW_WALLET_PRIVATE_KEY) {
    yellowNetwork.initialize({
        clearNodeUrl: process.env.YELLOW_CLEARNODE_URL,
        privateKey: process.env.YELLOW_WALLET_PRIVATE_KEY
    });
    // Auto-connect if configured
    yellowNetwork.connect().catch(err => {
        console.log('[Yellow Network] Connection failed (will run in demo mode):', err.message);
    });
} else {
    console.log('[Yellow Network] Not configured - running in demo mode');
}

// In-memory agent sessions for Yellow Network
const agentYellowSessions = new Map(); // wallet address -> session_id

/**
 * Get or create Yellow Network session for agent
 * @param {string} agentAddress - Agent wallet address
 * @returns {Promise<string|null>} Session ID or null if Yellow not available
 */
async function getYellowSessionForAgent(agentAddress) {
    // Option 1: Use global Yellow session (all agents share)
    if (process.env.YELLOW_SESSION_ID) {
        console.log('[Yellow] Using global session:', process.env.YELLOW_SESSION_ID.slice(0, 20) + '...');
        return process.env.YELLOW_SESSION_ID;
    }
    
    // Option 2: Per-agent sessions (existing logic)
    if (!yellowNetwork.isAvailable()) {
        return null;
    }

    // Check if agent already has a session
    if (agentYellowSessions.has(agentAddress)) {
        const sessionId = agentYellowSessions.get(agentAddress);
        try {
            // Verify session still exists
            await yellowNetwork.getSession(sessionId);
            return sessionId;
        } catch (e) {
            // Session expired or invalid, remove from cache
            agentYellowSessions.delete(agentAddress);
        }
    }

    // Create new session for agent
    try {
        const gatewayAddress = process.env.DEMO_WALLET_ADDRESS || '0x988530a4df2fe4590db57cfb8a6ad831c01c996a';
        const session = await yellowNetwork.getOrCreateSessionForAgent(agentAddress, gatewayAddress, '10000000'); // 10 USDC allocation
        await saveYellowSession(session);
        agentYellowSessions.set(agentAddress, session.app_session_id);
        return session.app_session_id;
    } catch (error) {
        console.error('[Server] Failed to create Yellow session for agent:', error);
        return null;
    }
}

/**
 * Build enhanced 402 response with dual payment methods
 * @param {object} api - API config
 * @param {string} resource - Request path
 * @param {string} agentAddress - Optional agent wallet address
 * @returns {Promise<object>} Enhanced 402 response
 */
async function build402Response(api, resource, agentAddress = null) {
    const priceUsdc = api.pricePerCall;
    const priceWithDecimals = String(Math.round(priceUsdc * 1e6)); // Convert to 6 decimals

    const response = {
        x402Version: 1,
        error: 'Payment Required',
        message: `This API requires payment of $${priceUsdc} USDC per call`,
        accepts: [{
            scheme: 'exact',
            network: 'arc-testnet',
            maxAmountRequired: priceWithDecimals,
            resource: resource,
            description: `API call to ${api.name}`,
            mimeType: 'application/json',
            payTo: api.ownerWallet,
            maxTimeoutSeconds: 60,
            asset: arcVerifier.ARC_CONFIG.usdc
        }],
        payment_methods: {
            arc_network: {
                recipient: api.ownerWallet,
                chain_id: 5042002,
                estimated_gas: '0.001',
                amount: priceUsdc,
                network: 'arc-testnet'
            }
        }
    };

    // Add Yellow Network option if available
    if (yellowNetwork.isAvailable()) {
        let sessionId = null;
        if (agentAddress) {
            sessionId = await getYellowSessionForAgent(agentAddress);
        }

        response.payment_methods.yellow_network = {
            participant: api.ownerWallet,
            asset: 'usdc',
            amount: priceUsdc,
            instant: true,
            gas_free: true,
            session_id: sessionId,
            session_required: !sessionId,
            create_session_endpoint: '/yellow/session/create'
        };

        // Recommend Yellow if session exists
        if (sessionId) {
            response.recommended = 'yellow_network';
        }
    }

    return response;
}

// In-memory storage (use Redis/DB in production)
const apis = new Map();
const payments = [];
const usedTxHashes = new Set(); // Prevent payment replay

// Provider Scoring System (in-memory + Turso persisted)
const defaultStats = {
    'crypto': { success: 0, failure: 0, totalLatency: 0 },
    'weather': { success: 0, failure: 0, totalLatency: 0 },
    'translation': { success: 0, failure: 0, totalLatency: 0 },
    'summarization': { success: 0, failure: 0, totalLatency: 0 },
    'sentiment': { success: 0, failure: 0, totalLatency: 0 },
    'general': { success: 0, failure: 0, totalLatency: 0 }
};
const providerStats = { ...defaultStats };

// Load persisted stats asynchronously
(async () => {
    try {
        const loadedStats = await loadProviderStats();
        for (const [provider, stats] of Object.entries(loadedStats)) {
            if (providerStats[provider]) {
                providerStats[provider] = stats;
            }
        }
        console.log('[Server] Loaded provider stats from Turso:', Object.keys(loadedStats).length, 'providers');
    } catch (e) {
        console.log('[Server] Using default provider stats');
    }
})();

function updateProviderStats(provider, success, latencyMs) {
    if (providerStats[provider]) {
        if (success) {
            providerStats[provider].success++;
        } else {
            providerStats[provider].failure++;
        }
        providerStats[provider].totalLatency += latencyMs;
        // Persist to SQLite
        persistProviderStats(provider, success, latencyMs);
    }
}

function getProviderScore(provider) {
    const stats = providerStats[provider];
    if (!stats) return 1.0;
    const total = stats.success + stats.failure;
    if (total === 0) return 1.0;
    const successRate = stats.success / total;
    const avgLatency = stats.totalLatency / total;
    // Score: 70% success rate, 30% latency (lower is better, max 5s)
    const latencyScore = Math.max(0, 1 - (avgLatency / 5000));
    return (successRate * 0.7) + (latencyScore * 0.3);
}

// Generate unique ID
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

// =====================
// Sample APIs (Demo)
// =====================

const sampleApis = [
    {
        id: 'translate-api',
        name: 'Translation API',
        targetUrl: 'internal://translate',
        pricePerCall: 0.01,
        ownerWallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f3B2E1',
        description: 'Translate text between 100+ languages using AI',
        category: 'language'
    },
    {
        id: 'summary-api',
        name: 'Summarization API',
        targetUrl: 'internal://summarize',
        pricePerCall: 0.02,
        ownerWallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f3B2E1',
        description: 'Summarize long documents into concise summaries',
        category: 'content'
    },
    {
        id: 'sentiment-api',
        name: 'Sentiment Analysis API',
        targetUrl: 'internal://sentiment',
        pricePerCall: 0.005,
        ownerWallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f3B2E1',
        description: 'Analyze sentiment and emotion in text',
        category: 'analysis'
    },
    {
        id: 'code-api',
        name: 'Code Generation API',
        targetUrl: 'internal://code',
        pricePerCall: 0.03,
        ownerWallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f3B2E1',
        description: 'Generate code from natural language descriptions',
        category: 'developer'
    }
];

// Load sample APIs on startup
function loadSampleApis() {
    sampleApis.forEach(api => {
        apis.set(api.id, {
            ...api,
            createdAt: new Date().toISOString(),
            totalCalls: Math.floor(Math.random() * 100),
            totalEarnings: Math.random() * 5
        });
    });
    console.log(`Loaded ${sampleApis.length} sample APIs`);
}

loadSampleApis();

// =====================
// API Registration
// =====================

app.post('/api/register', (req, res) => {
    const { name, targetUrl, pricePerCall, ownerWallet } = req.body;

    if (!name || !targetUrl || !pricePerCall || !ownerWallet) {
        return res.status(400).json({ error: 'Missing required fields: name, targetUrl, pricePerCall, ownerWallet' });
    }

    const id = generateId();
    const api = {
        id,
        name,
        targetUrl,
        pricePerCall: parseFloat(pricePerCall),
        ownerWallet,
        createdAt: new Date().toISOString(),
        totalCalls: 0,
        totalEarnings: 0
    };

    apis.set(id, api);

    const proxyUrl = `${req.protocol}://${req.get('host')}/proxy/${id}`;

    res.json({
        success: true,
        apiId: id,
        proxyUrl,
        pricePerCall: api.pricePerCall,
        message: `API registered! Users must pay $${api.pricePerCall} USDC per call via x402.`
    });
});

// =====================
// List Registered APIs
// =====================

app.get('/api/list', (req, res) => {
    const apiList = Array.from(apis.values()).map(api => ({
        id: api.id,
        name: api.name,
        description: api.description || '',
        category: api.category || 'general',
        pricePerCall: api.pricePerCall,
        totalCalls: api.totalCalls,
        totalEarnings: api.totalEarnings,
        targetUrl: api.targetUrl,
        ownerWallet: api.ownerWallet
    }));
    res.json({ apis: apiList });
});

// =====================
// API Stats
// =====================

app.get('/api/stats/:id', (req, res) => {
    const api = apis.get(req.params.id);
    if (!api) {
        return res.status(404).json({ error: 'API not found' });
    }

    const apiPayments = payments.filter(p => p.apiId === req.params.id).slice(-10);
    res.json({ api, recentPayments: apiPayments });
});

// =====================
// x402 Proxy Handler
// =====================

app.all('/proxy/:apiId', async (req, res) => {
    const { apiId } = req.params;

    // Get API config
    const api = apis.get(apiId);
    if (!api) {
        return res.status(404).json({ error: 'API not found' });
    }

    // Check for X-Yellow-Payment header first
    const xYellowPaymentHeader = req.headers['x-yellow-payment'];
    
    if (xYellowPaymentHeader) {
        try {
            const verification = await yellowNetwork.verifyPayment(xYellowPaymentHeader);
            
            if (!verification.valid) {
                return res.status(402).json({
                    error: 'Invalid Yellow Network payment',
                    details: verification.error
                });
            }

            // Check for replay
            if (verification.paymentId) {
                const alreadyUsed = await isYellowPaymentUsed(verification.paymentId);
                if (alreadyUsed) {
                    return res.status(402).json({
                        error: 'Payment already used'
                    });
                }
            }

            // Mark transaction as used
            await saveYellowTransaction({
                session_id: verification.sessionId,
                payment_id: verification.paymentId,
                from: verification.from,
                to: verification.to,
                asset: verification.asset,
                amount: verification.amount
            });

            // Update API stats
            api.totalCalls += 1;
            api.totalEarnings += parseFloat(verification.amount);

            // Forward request to target API
            try {
                const targetHeaders = { ...req.headers };
                delete targetHeaders['x-yellow-payment'];
                delete targetHeaders['host'];

                const targetResponse = await fetch(api.targetUrl, {
                    method: req.method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...targetHeaders
                    },
                    body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
                });

                const data = await targetResponse.json();

                // Return response with payment confirmation
                return res.json({
                    _x402: {
                        paid: true,
                        amount: verification.amount,
                        sessionId: verification.sessionId,
                        paymentId: verification.paymentId,
                        paymentMethod: 'yellow_network'
                    },
                    data
                });
            } catch (fetchError) {
                return res.json({
                    _x402: {
                        paid: true,
                        amount: verification.amount,
                        sessionId: verification.sessionId,
                        paymentMethod: 'yellow_network'
                    },
                    data: { message: 'Target API response (demo)' }
                });
            }
        } catch (error) {
            return res.status(400).json({ error: 'Invalid Yellow payment header format' });
        }
    }

    // Check for x402 payment header (Arc Network)
    const paymentHeader = req.headers['x-payment'];

    if (!paymentHeader) {
        // Return 402 Payment Required with dual payment methods
        const agentAddress = req.headers['x-agent-address'];
        const response = await build402Response(api, req.originalUrl, agentAddress);
        return res.status(402).json(response);
    }

    // Verify payment
    try {
        const payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
        const txHash = payment.txHash;

        if (!txHash) {
            return res.status(400).json({ error: 'Missing transaction hash in payment' });
        }

        // Check for replay attack
        if (usedTxHashes.has(txHash)) {
            return res.status(400).json({ error: 'Payment already used' });
        }

        // Verify payment on-chain (if real txHash, otherwise simulate for demo)
        let verificationResult;

        if (txHash.startsWith('arc:0x') && txHash.length > 20) {
            // Try real verification
            verificationResult = await arcVerifier.verifyPayment(
                txHash,
                api.ownerWallet,
                api.pricePerCall
            );
        } else {
            // Simulate for demo mode
            verificationResult = {
                valid: true,
                actualAmount: parseFloat(payment.amount) || api.pricePerCall,
                simulated: true
            };
        }

        if (!verificationResult.valid) {
            return res.status(402).json({
                error: 'Payment verification failed',
                details: verificationResult.error
            });
        }

        // Mark transaction as used
        usedTxHashes.add(txHash);

        // Record payment
        const paymentRecord = {
            id: generateId(),
            apiId,
            amount: verificationResult.actualAmount,
            payerWallet: payment.wallet || verificationResult.from || 'anonymous',
            txHash,
            verified: !verificationResult.simulated,
            timestamp: new Date().toISOString()
        };
        payments.push(paymentRecord);

        // Update API stats
        api.totalCalls += 1;
        api.totalEarnings += verificationResult.actualAmount;

        // Forward request to target API
        try {
            const targetHeaders = { ...req.headers };
            delete targetHeaders['x-payment'];
            delete targetHeaders['host'];

            const targetResponse = await fetch(api.targetUrl, {
                method: req.method,
                headers: {
                    'Content-Type': 'application/json',
                    ...targetHeaders
                },
                body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
            });

            const data = await targetResponse.json();

            // Return response with payment confirmation
            res.json({
                _x402: {
                    paid: true,
                    amount: verificationResult.actualAmount,
                    txHash,
                    verified: !verificationResult.simulated,
                    explorerUrl: `${arcVerifier.ARC_CONFIG.explorer}/tx/${txHash.replace('arc:', '')}`,
                    paymentMethod: 'arc_network'
                },
                data
            });
        } catch (fetchError) {
            res.json({
                _x402: {
                    paid: true,
                    amount: verificationResult.actualAmount,
                    txHash,
                    verified: !verificationResult.simulated,
                    explorerUrl: `${arcVerifier.ARC_CONFIG.explorer}/tx/${txHash.replace('arc:', '')}`,
                    paymentMethod: 'arc_network'
                },
                data: { message: 'Target API response (demo)' }
            });
        }

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(400).json({ error: 'Invalid payment header format' });
    }
});

// =====================
// Agent Demo Endpoints
// =====================

// Simulate agent task execution with real payment flow
app.post('/agent/run', async (req, res) => {
    const { task, walletId } = req.body;

    if (!task) {
        return res.status(400).json({ error: 'Task is required' });
    }

    const steps = [];
    const addStep = (type, text) => {
        steps.push({ type, text, time: new Date().toISOString() });
    };

    try {
        // Step 1: Analyze task
        addStep('info', 'Analyzing task requirements');

        // Determine API type needed
        const needsTranslation = task.toLowerCase().includes('translate');
        const apiType = needsTranslation ? 'Translation' : 'Processing';
        addStep('info', `Identified need: ${apiType} API`);

        // Step 2: Find API (use first available or create demo)
        addStep('info', 'Searching marketplace for suitable API');

        let selectedApi = Array.from(apis.values()).find(a =>
            a.name.toLowerCase().includes(apiType.toLowerCase())
        );

        if (!selectedApi) {
            // Use demo pricing
            selectedApi = {
                id: 'demo',
                name: `Demo ${apiType} API`,
                pricePerCall: 0.01,
                ownerWallet: '0x0000000000000000000000000000000000000000'
            };
        }

        addStep('info', `Found: ${selectedApi.name} ($${selectedApi.pricePerCall}/call)`);

        // Step 3: Check wallet balance (if Circle wallet available)
        let walletBalance = null;
        if (circleWallet.isAvailable() && walletId) {
            try {
                walletBalance = await circleWallet.getWalletBalance(walletId);
                addStep('info', `Wallet balance: $${walletBalance.usdc} USDC`);
            } catch (e) {
                addStep('info', 'Using demo mode (no real wallet)');
            }
        } else {
            addStep('info', 'Using demo mode (Circle SDK not configured)');
        }

        // Step 4: Simulate 402 response
        addStep('payment', `Received HTTP 402: Payment Required`);
        addStep('payment', `Amount: $${selectedApi.pricePerCall} USDC`);

        // Step 5: Sign payment
        let txHash;
        let networkFee = 0.0001;

        if (circleWallet.isAvailable() && walletId && walletBalance?.usdc >= selectedApi.pricePerCall) {
            // Real payment
            addStep('info', 'Signing USDC transfer with Circle Wallet');

            try {
                const tx = await circleWallet.transferUSDC(
                    walletId,
                    selectedApi.ownerWallet,
                    selectedApi.pricePerCall.toString()
                );

                addStep('info', 'Waiting for transaction confirmation');

                const confirmed = await circleWallet.waitForTransaction(tx.id);
                txHash = confirmed.txHash;

                addStep('success', 'Transaction confirmed on Arc');
            } catch (e) {
                addStep('payment', `Payment failed: ${e.message}`);
                throw e;
            }
        } else {
            // Simulated payment for demo
            addStep('info', 'Simulating payment (demo mode)');
            txHash = `arc:0x${generateId()}${generateId()}`;
            addStep('success', 'Payment simulated');
        }

        // Step 6: Retry with payment proof
        addStep('info', 'Retrying request with payment proof');

        // Generate result using Gemini AI (if available)
        let result;
        const geminiKey = process.env.GEMINI_API_KEY;

        if (geminiKey) {
            try {
                addStep('info', 'Calling AI model for task processing');

                // Create appropriate prompt based on task
                let aiPrompt;
                if (task.toLowerCase().includes('translate')) {
                    const targetLang = task.toLowerCase().includes('spanish') ? 'Spanish' :
                        task.toLowerCase().includes('french') ? 'French' :
                            task.toLowerCase().includes('german') ? 'German' : 'Spanish';
                    // Simple translation prompt
                    aiPrompt = `Translate this to ${targetLang}. Only output the translation: ${task}`;
                } else if (task.toLowerCase().includes('summar')) {
                    aiPrompt = `Summarize the following in 2-3 sentences: ${task}`;
                } else if (task.toLowerCase().includes('sentiment')) {
                    aiPrompt = `Analyze the sentiment of: "${task}". Return: sentiment (positive/negative/neutral) and confidence score.`;
                } else if (task.toLowerCase().includes('code') || task.toLowerCase().includes('function')) {
                    aiPrompt = `Write code for: ${task}. Keep it concise.`;
                } else {
                    aiPrompt = task;
                }

                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: aiPrompt }] }]
                        })
                    }
                );
                const data = await response.json();
                result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'AI response unavailable';
                addStep('success', 'AI model returned response');
            } catch (e) {
                console.error('Gemini API error:', e);
                result = 'AI processing completed (fallback)';
            }
        } else {
            // Fallback to demo responses
            if (task.toLowerCase().includes('spanish')) {
                result = '¡Hola! ¿Cómo estás?';
            } else if (task.toLowerCase().includes('french')) {
                result = 'Bonjour! Comment allez-vous?';
            } else if (task.toLowerCase().includes('summar')) {
                result = 'The document discusses key points regarding the topic, highlighting three main areas of concern and proposing actionable solutions for each.';
            } else {
                result = 'Task completed successfully.';
            }
        }

        addStep('success', 'API returned successful response');

        res.json({
            success: true,
            steps,
            result: {
                task,
                output: result,
                apiCost: selectedApi.pricePerCall,
                networkFee,
                totalCost: (selectedApi.pricePerCall + networkFee).toFixed(4),
                txHash,
                explorerUrl: `${arcVerifier.ARC_CONFIG.explorer}/tx/${txHash.replace('arc:', '')}`,
                isReal: circleWallet.isAvailable() && walletId && walletBalance?.usdc >= selectedApi.pricePerCall,
                isSimulated: !(circleWallet.isAvailable() && walletId && walletBalance?.usdc >= selectedApi.pricePerCall)
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            steps,
            error: error.message
        });
    }
});

// Get demo wallet info
app.get('/agent/wallet', async (req, res) => {
    if (!circleWallet.isAvailable()) {
        return res.json({
            available: false,
            message: 'Circle SDK not configured. Set CIRCLE_API_KEY to enable real payments.',
            demo: true
        });
    }

    try {
        const wallet = await circleWallet.getDemoWallet();
        res.json({
            available: true,
            wallet
        });
    } catch (error) {
        res.json({
            available: false,
            error: error.message
        });
    }
});

// =====================
// x402 Autonomous Agent Demo
// Real payment flow with Circle signTypedData
// AGENTIC COMMERCE: Gemini thinks, decides, and pays
// =====================

app.post('/agent/x402', async (req, res) => {
    const { task, budget = 1.0, preferYellow = true } = req.body;
    const steps = [];
    let totalSpent = 0;

    const addStep = (type, message, data = null) => {
        const step = { type, message, timestamp: new Date().toISOString() };
        if (data) step.data = data;
        steps.push(step);
        console.log(`[Agentic] ${message}`);
    };

    // Gemini decision helper
    const askGemini = async (prompt) => {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return 'DECISION: APPROVE\nREASON: Task cost is within budget limits';

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                }
            );
            const data = await response.json();
            const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            console.log('[Gemini Response]', result.slice(0, 100));
            return result || 'DECISION: APPROVE\nREASON: Cost is reasonable and within budget';
        } catch (e) {
            console.log('[Gemini Error]', e.message);
            return 'DECISION: APPROVE\nREASON: Cost is within budget and balance is sufficient';
        }
    };

    try {
        addStep('agent_start', 'Autonomous Agent activated');
        addStep('task_received', `Task: "${task}"`, { task, budget });

        // Step 1: Get wallet and check balance
        const wallet = await circleWallet.getDemoWallet();
        if (!wallet) {
            addStep('error', 'No wallet available');
            return res.status(400).json({ success: false, steps, error: 'No wallet' });
        }

        addStep('wallet_loaded', `Wallet: ${wallet.address.slice(0, 10)}...${wallet.address.slice(-4)}`, {
            address: wallet.address,
            balance: wallet.balance,
            network: 'Arc Testnet'
        });

        // Step 2: Agent thinks about what API to use
        addStep('thinking', 'Analyzing task requirements...');

        const analysisPrompt = `You are an AI agent with a budget of $${budget} USDC. 
Task: "${task}"

Available APIs:
1. Translation API - $0.01 per call
2. Summarization API - $0.02 per call  
3. Sentiment Analysis API - $0.005 per call

Which API should I use? Respond with ONLY the API name (translation/summarization/sentiment) and a brief reason in format:
API: [name]
Reason: [one sentence]`;

        const analysisResult = await askGemini(analysisPrompt);

        // Extract text and language from task for translation
        let textToProcess = task;
        let targetLang = 'Spanish';

        // Try to extract quoted text like "Translate 'hello' to French"
        const quotedMatch = task.match(/['"]([^'"]+)['"]/);
        if (quotedMatch) {
            textToProcess = quotedMatch[1];
        }

        // Extract target language
        const langMatch = task.toLowerCase().match(/to\s+(spanish|french|german|italian|portuguese|japanese|chinese|korean|arabic|russian|turkish)/i);
        if (langMatch) {
            targetLang = langMatch[1].charAt(0).toUpperCase() + langMatch[1].slice(1);
        }

        // SMART ROUTING: Multi-Provider System
        const taskLower = task.toLowerCase();
        let selectedApi = 'translation'; // default
        let apiPrice = 0.01;
        let apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/translate`;
        let requestBody = { text: textToProcess, targetLang: targetLang };
        let routingReason = '';
        let providerName = 'Intelligence Node';

        // ==== MARKET DATA NODE (CoinGecko) ====
        if (taskLower.includes('price') || taskLower.includes('bitcoin') || taskLower.includes('btc') ||
            taskLower.includes('ethereum') || taskLower.includes('eth') || taskLower.includes('crypto')) {
            selectedApi = 'crypto';
            apiPrice = 0.005;
            apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/crypto`;
            // Extract coin name
            let coin = 'bitcoin';
            if (taskLower.includes('ethereum') || taskLower.includes('eth')) coin = 'ethereum';
            if (taskLower.includes('solana') || taskLower.includes('sol')) coin = 'solana';
            requestBody = { coin, currency: 'usd' };
            routingReason = 'Routing to Market Data Node (CoinGecko)';
            providerName = 'Market Data Node';
        }
        // ==== UTILITY NODE (Weather) ====
        else if (taskLower.includes('weather') || taskLower.includes('hava') || taskLower.includes('temperature') || taskLower.includes('forecast')) {
            selectedApi = 'weather';
            apiPrice = 0.002;
            apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/weather`;
            // Extract city name
            let city = 'Istanbul';
            const cityMatch = task.match(/(?:in|at|for)\s+([A-Za-z\s]+?)(?:\?|$|,)/i);
            if (cityMatch) city = cityMatch[1].trim();
            requestBody = { city };
            routingReason = 'Routing to Utility Node (wttr.in)';
            providerName = 'Utility Node';
        }
        // ==== INTELLIGENCE NODE (Gemini) ====
        else if (taskLower.includes('summar') || taskLower.includes('explain') || taskLower.includes('benefits') || taskLower.includes('describe')) {
            selectedApi = 'summarization';
            apiPrice = 0.02;
            apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/summarize`;
            requestBody = { text: task };
            routingReason = 'Routing to Intelligence Node (Summarization)';
        } else if (taskLower.includes('sentiment') || taskLower.includes('feeling') || taskLower.includes('mood') || taskLower.includes('emotion')) {
            selectedApi = 'sentiment';
            apiPrice = 0.005;
            apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/sentiment`;
            requestBody = { text: task };
            routingReason = 'Routing to Intelligence Node (Sentiment)';
        } else if (taskLower.includes('translat') || taskLower.includes('spanish') || taskLower.includes('french') || taskLower.includes('german')) {
            selectedApi = 'translation';
            routingReason = 'Routing to Intelligence Node (Translation)';
        } else {
            // Use Gemini analysis as fallback
            if (analysisResult.toLowerCase().includes('summarization')) {
                selectedApi = 'summarization';
                apiPrice = 0.02;
                apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/summarize`;
                requestBody = { text: task };
                routingReason = 'Gemini analysis: summarization recommended';
            } else if (analysisResult.toLowerCase().includes('sentiment')) {
                selectedApi = 'sentiment';
                apiPrice = 0.005;
                apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/sentiment`;
                requestBody = { text: task };
                routingReason = 'Gemini analysis: sentiment recommended';
            } else {
                // GENERAL QUERY FALLBACK - for any other task
                selectedApi = 'general';
                apiPrice = 0.015;
                apiUrl = `http://localhost:${process.env.PORT || 3001}/x402/general`;
                requestBody = { query: task };
                routingReason = 'General query: AI will answer directly';
            }
        }

        addStep('api_selected', `Selected: ${providerName} (${selectedApi.toUpperCase()})`, {
            api: selectedApi,
            provider: providerName,
            price: `$${apiPrice}`,
            reasoning: routingReason
        });

        // Step 3: Make initial request (will get 402)
        addStep('api_call', 'Calling API...');

        let response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Agent-Address': wallet.address
            },
            body: JSON.stringify(requestBody)
        });

        if (response.status === 402) {
            const paymentInfo = await response.json();
            const requirement = paymentInfo.accepts?.[0];
            const requiredAmount = parseInt(requirement?.maxAmountRequired || 0) / 1e6;

            addStep('payment_required', 'HTTP 402 - Payment Required', {
                amount: `$${requiredAmount}`,
                recipient: requirement?.payTo,
                network: requirement?.network,
                asset: 'USDC'
            });

            // Step 4: Agent DECIDES whether to pay
            addStep('decision_making', 'Evaluating payment decision...');

            const decisionPrompt = `You are an autonomous AI agent managing a crypto wallet.

SITUATION:
- Task: "${task}"
- API Cost: $${requiredAmount} USDC
- My Budget: $${budget} USDC
- My Balance: $${wallet.balance} USDC

Should I pay for this API access? Consider:
1. Is the cost reasonable for the task?
2. Do I have enough balance?
3. Is it within my budget?

Respond with ONLY:
DECISION: [APPROVE/REJECT]
REASON: [one sentence explanation]`;

            const decisionStartTime = Date.now();
            const decisionResult = await askGemini(decisionPrompt);
            const decisionLatency = Date.now() - decisionStartTime;

            // Show AI's actual thinking/reasoning - NOT mock
            const aiDecision = decisionResult.includes('APPROVE') ? 'APPROVE' : 'REJECT';
            const aiReason = decisionResult.split('\n').find(l => l.includes('REASON'))?.replace('REASON:', '').trim() || 'No reason provided';

            addStep('ai_thinking', `AI Decision: ${aiDecision}`, {
                reasoning: aiReason,
                fullResponse: decisionResult.trim(),
                model: 'gemini-2.0-flash',
                latencyMs: decisionLatency
            });

            const shouldPay = decisionResult.toLowerCase().includes('approve') &&
                requiredAmount <= budget &&
                requiredAmount <= parseFloat(wallet.balance);

            addStep('decision_made', shouldPay ? 'APPROVED - Proceeding with payment' : 'REJECTED - Payment declined', {
                decision: shouldPay ? 'APPROVE' : 'REJECT',
                reason: aiReason,
                cost: `$${requiredAmount}`,
                budget: `$${budget}`,
                agentBalance: `$${wallet.balance}`
            });

            if (!shouldPay) {
                return res.json({
                    success: false,
                    steps,
                    result: {
                        task,
                        output: null,
                        paid: false,
                        reason: aiReason
                    }
                });
            }

            // Step 5: Check if Yellow Network payment is available and preferred
            const useYellow = preferYellow &&
                             paymentInfo.payment_methods?.yellow_network && 
                             yellowNetwork.isAvailable();

            let paymentMethod = 'arc_network';
            let paymentStartTime = Date.now();

            if (useYellow) {
                // ============================================
                // YELLOW NETWORK PATH: Instant off-chain payment
                // ============================================
                addStep('payment_method', 'Using Yellow Network (instant, zero gas)', {
                    method: 'yellow_network',
                    gasless: true,
                    instant: true
                });

                try {
                    let sessionId = paymentInfo.payment_methods.yellow_network.session_id;

                    // Create session if needed
                    if (!sessionId) {
                        addStep('session_creating', 'Creating Yellow Network session...');
                        const session = await yellowNetwork.getOrCreateSessionForAgent(
                            wallet.address,
                            paymentInfo.payment_methods.arc_network.recipient,
                            '10000000' // 10 USDC allocation
                        );
                        sessionId = session.app_session_id;
                        await saveYellowSession(session);
                        addStep('session_created', `Session created: ${sessionId.slice(0, 16)}...`);
                    }

                    // Execute off-chain payment
                    addStep('payment_executing', 'Executing off-chain payment...');
                    const payment = await yellowNetwork.executePayment({
                        sessionId: sessionId,
                        from: wallet.address,
                        to: paymentInfo.payment_methods.arc_network.recipient,
                        asset: 'usdc',
                        amount: String(requiredAmount)
                    });

                    const paymentLatency = Date.now() - paymentStartTime;
                    paymentMethod = 'yellow_network';

                    addStep('payment_success', 'Off-chain payment complete', {
                        paymentId: payment.id,
                        sessionId: sessionId,
                        amount: `$${requiredAmount}`,
                        latencyMs: paymentLatency,
                        gasless: true
                    });

                    // Build X-Yellow-Payment header
                    const yellowPaymentHeader = Buffer.from(JSON.stringify({
                        session_id: sessionId,
                        payment_id: payment.id,
                        from: wallet.address,
                        to: paymentInfo.payment_methods.arc_network.recipient,
                        amount: String(requiredAmount),
                        asset: 'usdc',
                        timestamp: Date.now()
                    })).toString('base64');

                    // Retry API with X-Yellow-Payment
                    addStep('service_executing', 'Calling API with Yellow payment proof...');
                    const serviceStart = Date.now();

                    const serviceResponse = await fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Yellow-Payment': yellowPaymentHeader
                        },
                        body: JSON.stringify(requestBody)
                    });
                    const serviceLatency = Date.now() - serviceStart;

                    if (!serviceResponse.ok) {
                        // API failed with Yellow - fall back to Arc silently
                        addStep('retry', 'Retrying..', {
                            yellowAttempted: true,
                            reason: 'API returned error with Yellow payment'
                        });
                        updateProviderStats(selectedApi, false, serviceLatency);
                        // Don't return - fall through to Arc payment below
                    } else {
                        // Yellow payment succeeded, return result
                        const apiResult = await serviceResponse.json();
                        addStep('service_success', 'API service completed', {
                            latencyMs: serviceLatency,
                            status: 200
                        });
                        updateProviderStats(selectedApi, true, serviceLatency);

                        // Save transaction
                        await saveTransaction({
                            timestamp: new Date().toISOString(),
                            provider: selectedApi,
                            serviceType: 'x402-payment-yellow',
                            amount: requiredAmount.toString(),
                            txHash: payment.id,
                            status: 'success',
                            latencyMs: paymentLatency,
                            agentId: process.env.AGENT_WALLET_ID || 'demo-agent',
                            query: task
                        });

                        const totalLatency = Date.now() - paymentStartTime;
                        const estimatedArcGas = 0.001;
                        const estimatedArcTime = 1500;

                        return res.json({
                            success: true,
                            steps,
                            result: {
                                task,
                                output: apiResult.result || apiResult,
                                paid: true,
                                amount: `$${requiredAmount}`,
                                paymentId: payment.id,
                                sessionId: sessionId,
                                paymentMethod: 'yellow_network',
                                isReal: true,
                                instant: true,
                                gasless: true
                            },
                            agent: {
                                totalSpent: `$${requiredAmount}`,
                                remainingBudget: `$${(budget - requiredAmount).toFixed(4)}`,
                                decisions: steps.filter(s => s.type === 'decision_made').length
                            },
                            savingsEstimate: {
                                gasSaved: estimatedArcGas.toString(),
                                timeSavedMs: Math.max(0, estimatedArcTime - totalLatency),
                                method: 'yellow_vs_arc'
                            }
                        });
                    }

                } catch (yellowError) {
                    addStep('error', `Yellow payment failed: ${yellowError.message}. Falling back to Arc...`);
                    // Fall through to Arc payment
                }
            }

            // ============================================
            // ARC NETWORK PATH: Traditional on-chain payment
            // ============================================
            
            // Check if we're in silent fallback mode (Yellow was attempted but API failed)
            const silentMode = steps.some(s => s.type === 'retry' && s.data?.yellowAttempted);
            
            if (!silentMode) {
                addStep('payment_method', 'Using Arc Network (on-chain)', {
                    method: 'arc_network',
                    gasEstimate: '0.001 USDC'
                });
            }

            // Step 6: Sign payment authorization (HOLD - don't execute yet)
            if (!silentMode) {
                addStep('signing', 'Preparing payment authorization...');
            }

            try {
                // Build authorization for Arc
                const typedData = x402Client.buildTransferAuthorization({
                    from: wallet.address,
                    to: requirement.payTo,
                    value: requirement.maxAmountRequired,
                    chainId: 5042002 // Arc Testnet
                });

                // Sign with Circle SDK (signature is HELD, not submitted)
                const signature = await x402Client.signPayment(
                    process.env.DEMO_WALLET_ID,
                    typedData
                );

                if (!silentMode) {
                    addStep('signed', 'Payment authorization signed and held', {
                        signedBy: 'Circle SDK',
                        wallet: wallet.address.slice(0, 10) + '...'
                    });
                }

                // ============================================
                // ATOMIC SETTLEMENT: Pre-flight check
                // ============================================
                const preflightStart = Date.now();
                const executorInfo = await arcExecutor.getExecutorBalance();
                const balanceCheck = await arcExecutor.checkBalance(
                    executorInfo.address,
                    requiredAmount.toString()
                );
                const preflightLatency = Date.now() - preflightStart;

                if (!silentMode) {
                    addStep('preflight', 'Pre-flight check (Executor Wallet)', {
                        executorAddress: executorInfo.address.slice(0, 10) + '...',
                        executorBalance: `${parseFloat(balanceCheck.balance).toFixed(4)} USDC`,
                        required: `${requiredAmount} USDC`,
                        sufficient: balanceCheck.sufficient,
                        latencyMs: preflightLatency,
                        note: 'Executor pays gas, not Agent'
                    });
                }

                if (!balanceCheck.sufficient) {
                    addStep('error', `Insufficient executor balance: ${balanceCheck.balance} < ${balanceCheck.required}`);
                    return res.status(400).json({
                        success: false,
                        steps,
                        error: 'Insufficient executor balance for atomic settlement'
                    });
                }

                // ============================================
                // ATOMIC SETTLEMENT: Execute service FIRST
                // ============================================
                const serviceStart = Date.now();
                
                if (!silentMode) {
                    addStep('service_executing', 'Calling API (payment held until success)...');
                }

                const xPaymentHeader = x402Client.buildXPaymentHeader(signature, typedData, 'arc-testnet');

                const serviceResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-PAYMENT': xPaymentHeader
                    },
                    body: JSON.stringify(requestBody)
                });
                const serviceLatency = Date.now() - serviceStart;

                if (!serviceResponse.ok) {
                    // Service failed - NO PAYMENT EXECUTED
                    const errorData = await serviceResponse.json().catch(() => ({}));
                    addStep('service_failed', 'API failed - NO payment executed', {
                        status: serviceResponse.status,
                        latencyMs: serviceLatency,
                        atomicProtection: 'User funds protected'
                    });
                    updateProviderStats(selectedApi, false, serviceLatency);

                    return res.json({
                        success: false,
                        steps,
                        result: {
                            task,
                            output: null,
                            paid: false,
                            reason: errorData.error || 'Service failed - no payment made',
                            atomicProtection: true
                        }
                    });
                }

                const apiResult = await serviceResponse.json();

                // ATOMIC SETTLEMENT: Validate result content
                // Don't settle if API returned error-like content
                const resultContent = apiResult.result || apiResult.translation || apiResult.sentiment ||
                    apiResult.temperature || apiResult.price || '';

                // Check if this is a valid response from any provider
                const hasValidContent = apiResult.temperature || apiResult.price || apiResult.translation ||
                    apiResult.sentiment || apiResult.result || apiResult.city;

                const isErrorResult =
                    (!hasValidContent && apiResult.model === 'fallback') ||
                    (typeof resultContent === 'string' && (
                        resultContent.toLowerCase().includes('could not process') ||
                        resultContent.toLowerCase().includes('failed') ||
                        resultContent.toLowerCase().includes('error')
                    ));

                if (isErrorResult) {
                    addStep('service_failed', 'API returned error - NO payment executed', {
                        latencyMs: serviceLatency,
                        result: resultContent.slice(0, 50),
                        atomicProtection: 'User funds protected'
                    });
                    updateProviderStats(selectedApi, false, serviceLatency);

                    return res.json({
                        success: false,
                        steps,
                        result: {
                            task,
                            output: resultContent,
                            paid: false,
                            reason: 'Service returned error - no payment made',
                            atomicProtection: true
                        }
                    });
                }

                if (!silentMode) {
                    addStep('service_success', 'API service completed', {
                        latencyMs: serviceLatency,
                        status: 200
                    });
                }
                updateProviderStats(selectedApi, true, serviceLatency);

                // ============================================
                // ATOMIC SETTLEMENT: NOW execute payment
                // Service succeeded, so we release the payment
                // ============================================
                const settlementStart = Date.now();
                
                if (!silentMode) {
                    addStep('settling', 'Executing USDC settlement on Arc...', {
                        amount: `${requiredAmount} USDC`,
                        recipient: requirement.payTo.slice(0, 10) + '...',
                        network: 'Arc Testnet'
                    });
                }

                const txResult = await arcExecutor.executeSimpleTransfer(
                    requirement.payTo,
                    requiredAmount.toString()
                );
                const settlementLatency = Date.now() - settlementStart;

                if (txResult.success) {
                    totalSpent = requiredAmount;

                    if (silentMode) {
                        // In silent mode, just show final settlement
                        addStep('payment_success', 'Transaction settled', {
                            txHash: txResult.txHash,
                            amount: `$${totalSpent}`,
                            network: 'Arc Testnet'
                        });
                    } else {
                        addStep('payment_success', 'Atomic settlement complete', {
                            txHash: txResult.txHash,
                            amount: `$${totalSpent}`,
                            explorerUrl: txResult.explorerUrl,
                            blockNumber: txResult.blockNumber,
                            latencyMs: settlementLatency,
                            network: 'Arc Testnet'
                        });
                    }

                    // Save transaction to SQLite
                    await saveTransaction({
                        timestamp: new Date().toISOString(),
                        provider: selectedApi,
                        serviceType: 'x402-payment',
                        amount: totalSpent.toString(),
                        txHash: txResult.txHash,
                        status: 'success',
                        latencyMs: settlementLatency,
                        agentId: process.env.AGENT_WALLET_ID || 'demo-agent',
                        query: task
                    });

                    return res.json({
                        success: true,
                        steps,
                        result: {
                            task,
                            output: apiResult.result || apiResult,
                            paid: true,
                            amount: `$${totalSpent}`,
                            txHash: txResult.txHash,
                            explorerUrl: txResult.explorerUrl,
                            network: 'Arc Testnet',
                            isReal: true,
                            atomicSettlement: true,
                            paymentMethod: silentMode ? 'arc_network_fallback' : 'arc_network',
                            yellowAttempted: silentMode
                        },
                        agent: {
                            totalSpent: `$${totalSpent}`,
                            remainingBudget: `$${(budget - totalSpent).toFixed(4)}`,
                            decisions: steps.filter(s => s.type === 'decision_made').length
                        }
                    });
                } else {
                    // This is rare - tx failed after service success
                    // In production, would need retry logic
                    throw new Error('Transaction failed on-chain after service');
                }

            } catch (signError) {
                addStep('error', `Payment failed: ${signError.message}`);
                throw signError;
            }
        } else if (response.ok) {
            // API didn't require payment (shouldn't happen with our paywall)
            const apiResult = await response.json();
            addStep('api_success', 'API response received (no payment required)');

            return res.json({
                success: true,
                steps,
                result: {
                    task,
                    output: apiResult.result || apiResult,
                    paid: false,
                    note: 'API did not require payment'
                }
            });
        } else {
            throw new Error(`API error: ${response.statusText}`);
        }

    } catch (error) {
        addStep('error', `Agent error: ${error.message}`);
        res.status(500).json({
            success: false,
            steps,
            error: error.message
        });
    }
});

// =====================
// Wallet Endpoints
// =====================

app.get('/wallet/:address/balance', async (req, res) => {
    try {
        const balance = await arcVerifier.getUSDCBalance(req.params.address);
        res.json(balance);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create EOA wallet for x402 signing
app.post('/agent/create-eoa', async (req, res) => {
    try {
        const idempotencyKey = `eoa-agent-${Date.now()}`;
        const wallet = await circleWallet.createEOAWallet(idempotencyKey);

        res.json({
            success: true,
            wallet,
            message: 'EOA wallet created. Save the wallet ID and address for x402 signing.',
            instructions: [
                '1. Fund this wallet with USDC from Circle faucet: https://faucet.circle.com',
                '2. Update .env with EOA_WALLET_ID and EOA_WALLET_ADDRESS',
                '3. Use this wallet for x402 payments'
            ]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/tx/:hash', async (req, res) => {
    try {
        const tx = await arcVerifier.getTransaction(req.params.hash);
        res.json(tx);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================
// Demo: Sample AI API
// =====================

app.post('/demo/ai', async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
    }

    const geminiKey = process.env.GEMINI_API_KEY;

    if (geminiKey) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                }
            );
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
            res.json({ response: text, model: 'gemini-2.5-flash' });
        } catch (e) {
            res.json({ response: `Demo response for: "${prompt}"`, model: 'demo' });
        }
    } else {
        res.json({
            response: `Demo response for: "${prompt}"`,
            model: 'demo',
            note: 'Set GEMINI_API_KEY for real AI responses'
        });
    }
});

// =====================
// x402 Protected AI APIs (Real Payments!)
// =====================

// Get demo wallet address for receiving payments
const getPayToAddress = async () => {
    const demoWallet = await circleWallet.getDemoWallet();
    return demoWallet?.address || '0x988530a4df2fe4590db57cfb8a6ad831c01c996a';
};

// x402-protected Translation API
const x402Router = express.Router();

// Custom Arc x402 middleware configuration - MULTI-PROVIDER SYSTEM
const x402Config = {
    // Intelligence Node (Gemini-powered)
    'POST /translate': { price: 0.01, priceDisplay: '$0.01', provider: 'Intelligence Node' },
    'POST /summarize': { price: 0.02, priceDisplay: '$0.02', provider: 'Intelligence Node' },
    'POST /sentiment': { price: 0.005, priceDisplay: '$0.005', provider: 'Intelligence Node' },
    'POST /general': { price: 0.015, priceDisplay: '$0.015', provider: 'Intelligence Node' },
    // Market Data Node (CoinGecko API)
    'POST /crypto': { price: 0.005, priceDisplay: '$0.005', provider: 'Market Data Node' },
    // Utility Node (wttr.in Weather API)
    'POST /weather': { price: 0.002, priceDisplay: '$0.002', provider: 'Utility Node' }
};

// Custom Arc x402 Paywall Middleware (replaces x402-express)
const arcX402Middleware = (recipientAddress, routeConfig) => {
    return async (req, res, next) => {
        const routeKey = `${req.method} ${req.path}`;
        const config = routeConfig[routeKey];

        // If route not configured, pass through
        if (!config) {
            return next();
        }

        // Check for X-Yellow-Payment header first
        const xYellowPaymentHeader = req.headers['x-yellow-payment'];
        
        if (xYellowPaymentHeader) {
            // Verify Yellow Network payment
            try {
                const verification = await yellowNetwork.verifyPayment(xYellowPaymentHeader);
                
                if (!verification.valid) {
                    return res.status(402).json({
                        error: 'Invalid Yellow Network payment',
                        details: verification.error
                    });
                }

                // Check if payment was already used (replay prevention)
                if (verification.paymentId) {
                    const alreadyUsed = await isYellowPaymentUsed(verification.paymentId);
                    if (alreadyUsed) {
                        return res.status(402).json({
                            error: 'Payment already used',
                            details: 'This payment has been processed before'
                        });
                    }
                }

                // Payment valid - save to DB and allow request
                console.log(`[Arc x402] Yellow payment validated: $${verification.amount} USDC`);
                await saveYellowTransaction({
                    session_id: verification.sessionId,
                    payment_id: verification.paymentId,
                    from: verification.from,
                    to: verification.to,
                    asset: verification.asset,
                    amount: verification.amount
                });

                req.x402Payment = {
                    source: 'yellow',
                    valid: true,
                    actualAmount: parseFloat(verification.amount),
                    sessionId: verification.sessionId,
                    paymentId: verification.paymentId
                };
                
                return next();
            } catch (error) {
                return res.status(402).json({
                    error: `Yellow payment verification failed: ${error.message}`
                });
            }
        }

        // Check for X-PAYMENT header (Arc Network)
        const xPaymentHeader = req.headers['x-payment'];

        if (!xPaymentHeader) {
            // Return 402 Payment Required with dual payment methods
            const agentAddress = req.headers['x-agent-address']; // Optional agent identifier
            let sessionId = null;
            
            if (agentAddress && yellowNetwork.isAvailable()) {
                sessionId = await getYellowSessionForAgent(agentAddress);
            }

            const response = {
                x402Version: 1,
                error: 'Payment required',
                message: `API Access: ${routeKey} - $${config.price} USDC`,
                accepts: [{
                    scheme: 'exact',
                    network: 'arc-testnet',
                    maxAmountRequired: String(Math.floor(config.price * 1e6)),
                    resource: req.originalUrl,
                    description: `API Access: ${routeKey}`,
                    mimeType: 'application/json',
                    payTo: recipientAddress,
                    maxTimeoutSeconds: 600,
                    asset: arcVerifier.ARC_CONFIG.usdc,
                    price: config.priceDisplay
                }],
                payment_methods: {
                    arc_network: {
                        recipient: recipientAddress,
                        chain_id: 5042002,
                        estimated_gas: '0.001',
                        amount: config.price,
                        network: 'arc-testnet'
                    }
                }
            };

            // Add Yellow Network option if available
            if (yellowNetwork.isAvailable()) {
                response.payment_methods.yellow_network = {
                    participant: recipientAddress,
                    asset: 'usdc',
                    amount: config.price,
                    instant: true,
                    gas_free: true,
                    session_id: sessionId,
                    session_required: !sessionId,
                    create_session_endpoint: '/yellow/session/create'
                };

                if (sessionId) {
                    response.recommended = 'yellow_network';
                }
            }

            return res.status(402).json(response);
        }

        // Validate payment using Arc facilitator
        try {
            const validation = arcVerifier.validateX402Payment(
                xPaymentHeader,
                recipientAddress,
                config.price
            );

            if (!validation.valid) {
                return res.status(402).json({
                    error: validation.error || 'Invalid payment',
                    details: validation
                });
            }

            // Payment valid - allow request
            console.log(`[Arc x402] Payment validated: $${validation.actualAmount} USDC from ${validation.authorization?.from}`);
            req.x402Payment = validation;
            next();

        } catch (error) {
            return res.status(402).json({
                error: `Payment validation failed: ${error.message}`
            });
        }
    };
};

// Apply Arc x402 paywall middleware
if (process.env.DEMO_WALLET_ADDRESS) {
    console.log('Setting up Arc x402 paywall with recipient:', process.env.DEMO_WALLET_ADDRESS);
    x402Router.use(arcX402Middleware(process.env.DEMO_WALLET_ADDRESS, x402Config));
}

// Translation endpoint (x402 protected)
x402Router.post('/translate', async (req, res) => {
    const { text, targetLang = 'Spanish' } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
        return res.json({ result: `Translated "${text}" to ${targetLang}`, model: 'demo' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Translate to ${targetLang}. Only output the translation: ${text}` }] }]
                })
            }
        );
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Translation failed';
        res.json({ result, model: 'gemini-2.5-flash', paid: true });
    } catch (e) {
        res.json({ result: `Translated "${text}" to ${targetLang}`, model: 'fallback' });
    }
});

// Summarization endpoint (x402 protected)
x402Router.post('/summarize', async (req, res) => {
    const { text } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
        return res.json({ result: 'This is a summary of the provided text.', model: 'demo' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Summarize in 2-3 sentences: ${text}` }] }]
                })
            }
        );
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Summary failed';
        res.json({ result, model: 'gemini-2.5-flash', paid: true });
    } catch (e) {
        res.json({ result: 'Summary of the text.', model: 'fallback' });
    }
});

// Sentiment endpoint (x402 protected)
x402Router.post('/sentiment', async (req, res) => {
    const { text } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
        return res.json({ sentiment: 'positive', confidence: 0.85, model: 'demo' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Analyze sentiment. Return JSON: {"sentiment": "positive|negative|neutral", "confidence": 0.0-1.0}. Text: ${text}` }] }]
                })
            }
        );
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '{"sentiment":"neutral","confidence":0.5}';
        try {
            res.json({ ...JSON.parse(result.replace(/```json\n?|\n?```/g, '')), model: 'gemini-2.5-flash', paid: true });
        } catch {
            res.json({ result, model: 'gemini-2.5-flash', paid: true });
        }
    } catch (e) {
        res.json({ sentiment: 'neutral', confidence: 0.5, model: 'fallback' });
    }
});

// General Query endpoint (x402 protected) - Catch-all for any question
x402Router.post('/general', async (req, res) => {
    const { query } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
        return res.json({ result: 'I can help with that query.', model: 'demo' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `You are a helpful AI assistant. Answer this query concisely and helpfully: ${query}` }] }]
                })
            }
        );
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not process that query.';
        res.json({ result, model: 'gemini-2.0-flash', paid: true, type: 'general_query' });
    } catch (e) {
        res.json({ result: 'Query processing failed.', model: 'fallback' });
    }
});

// =====================
// MARKET DATA NODE: CoinGecko Crypto Prices (x402 protected)
// =====================
x402Router.post('/crypto', async (req, res) => {
    const { coin = 'bitcoin', currency = 'usd' } = req.body;

    try {
        // Real CoinGecko API call
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true`
        );
        const data = await response.json();

        if (data[coin]) {
            const priceData = data[coin];
            res.json({
                coin: coin,
                price: priceData[currency],
                change_24h: priceData[`${currency}_24h_change`]?.toFixed(2) + '%',
                market_cap: priceData[`${currency}_market_cap`],
                currency: currency.toUpperCase(),
                source: 'CoinGecko',
                provider: 'Market Data Node',
                paid: true,
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({
                result: `Could not find price for ${coin}`,
                model: 'fallback'
            });
        }
    } catch (e) {
        console.error('CoinGecko error:', e.message);
        res.json({
            result: 'Crypto data fetch failed',
            model: 'fallback'
        });
    }
});

// =====================
// UTILITY NODE: Weather Data (x402 protected)
// =====================
x402Router.post('/weather', async (req, res) => {
    const { city = 'Istanbul' } = req.body;

    try {
        // Real wttr.in API call
        const response = await fetch(
            `https://wttr.in/${encodeURIComponent(city)}?format=j1`
        );
        const data = await response.json();

        if (data.current_condition && data.current_condition[0]) {
            const current = data.current_condition[0];
            const location = data.nearest_area?.[0];
            res.json({
                city: location?.areaName?.[0]?.value || city,
                country: location?.country?.[0]?.value || '',
                temperature: current.temp_C + '°C',
                feels_like: current.FeelsLikeC + '°C',
                condition: current.weatherDesc?.[0]?.value || 'Unknown',
                humidity: current.humidity + '%',
                wind: current.windspeedKmph + ' km/h',
                source: 'wttr.in',
                provider: 'Utility Node',
                paid: true,
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({
                result: `Could not find weather for ${city}`,
                model: 'fallback'
            });
        }
    } catch (e) {
        console.error('Weather error:', e.message);
        res.json({
            result: 'Weather data fetch failed',
            model: 'fallback'
        });
    }
});

// Mount x402 router
app.use('/x402', x402Router);

// =====================
// Provider Stats
// =====================

app.get('/providers/stats', (req, res) => {
    const stats = {};
    for (const [provider, data] of Object.entries(providerStats)) {
        const total = data.success + data.failure;
        stats[provider] = {
            ...data,
            score: getProviderScore(provider).toFixed(3),
            successRate: total > 0 ? (data.success / total * 100).toFixed(1) + '%' : 'N/A',
            avgLatency: total > 0 ? Math.round(data.totalLatency / total) + 'ms' : 'N/A'
        };
    }
    res.json({ providers: stats });
});

// =====================
// Transaction History
// =====================

app.get('/transactions/history', async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const history = await getTransactionHistory(limit);
    res.json({
        transactions: history,
        count: history.length,
        persistence: 'Turso'
    });
});

app.get('/db/stats', async (req, res) => {
    const stats = await getDatabaseStats();
    res.json({
        database: stats,
        persistence: 'Turso',
        tables: ['transactions', 'provider_stats']
    });
});

// =====================
// Spending Limits Endpoint
// =====================

app.get('/agent/limits', async (req, res) => {
    try {
        const spending = await getSpendingStatus();
        const wallet = await circleWallet.getDemoWallet();
        const balance = wallet?.balance || 0;

        res.json({
            limits: {
                perTransaction: `$${SPENDING_LIMITS.PER_TRANSACTION.toFixed(2)}`,
                daily: `$${SPENDING_LIMITS.DAILY.toFixed(2)}`,
                weekly: `$${SPENDING_LIMITS.WEEKLY.toFixed(2)}`,
                monthly: `$${SPENDING_LIMITS.MONTHLY.toFixed(2)}`,
                rateLimit: `${RATE_LIMIT_MAX} requests/minute`
            },
            currentSpending: {
                daily: `$${spending.daily.toFixed(4)}`,
                weekly: `$${spending.weekly.toFixed(4)}`,
                monthly: `$${spending.monthly.toFixed(4)}`
            },
            remaining: {
                daily: `$${Math.max(0, SPENDING_LIMITS.DAILY - spending.daily).toFixed(2)}`,
                weekly: `$${Math.max(0, SPENDING_LIMITS.WEEKLY - spending.weekly).toFixed(2)}`,
                monthly: `$${Math.max(0, SPENDING_LIMITS.MONTHLY - spending.monthly).toFixed(2)}`
            },
            percentUsed: {
                daily: `${Math.min(100, (spending.daily / SPENDING_LIMITS.DAILY * 100)).toFixed(1)}%`,
                weekly: `${Math.min(100, (spending.weekly / SPENDING_LIMITS.WEEKLY * 100)).toFixed(1)}%`,
                monthly: `${Math.min(100, (spending.monthly / SPENDING_LIMITS.MONTHLY * 100)).toFixed(1)}%`
            },
            alerts: {
                lowBalance: balance <= SPENDING_LIMITS.LOW_BALANCE_THRESHOLD,
                dailyLimitNear: spending.daily >= SPENDING_LIMITS.DAILY * 0.8,
                weeklyLimitNear: spending.weekly >= SPENDING_LIMITS.WEEKLY * 0.8
            },
            walletBalance: `$${balance.toFixed(2)}`
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get limits', details: error.message });
    }
});

// Helper function to check spending limits before payment
async function checkSpendingLimits(amount) {
    const spending = await getSpendingStatus();

    const checks = {
        perTransaction: amount <= SPENDING_LIMITS.PER_TRANSACTION,
        daily: (spending.daily + amount) <= SPENDING_LIMITS.DAILY,
        weekly: (spending.weekly + amount) <= SPENDING_LIMITS.WEEKLY,
        monthly: (spending.monthly + amount) <= SPENDING_LIMITS.MONTHLY
    };

    const passed = Object.values(checks).every(v => v);

    return {
        passed,
        checks,
        spending,
        limits: SPENDING_LIMITS,
        reason: !passed ?
            (!checks.perTransaction ? `Amount $${amount} exceeds per-transaction limit of $${SPENDING_LIMITS.PER_TRANSACTION}` :
                !checks.daily ? `Daily limit of $${SPENDING_LIMITS.DAILY} would be exceeded` :
                    !checks.weekly ? `Weekly limit of $${SPENDING_LIMITS.WEEKLY} would be exceeded` :
                        `Monthly limit of $${SPENDING_LIMITS.MONTHLY} would be exceeded`) : null
    };
}

// =====================
// Yellow Network Endpoints
// =====================

app.get('/yellow/status', (req, res) => {
    const status = yellowNetwork.getStatus();
    res.json({ success: true, ...status, demo: !yellowNetwork.isAvailable() });
});

app.get('/yellow/channels', async (req, res) => {
    try {
        const result = await yellowNetwork.getChannels();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/yellow/balances/:participant', async (req, res) => {
    try {
        const { participant } = req.params;
        const result = await yellowNetwork.getLedgerBalances(participant);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/yellow/session/create', async (req, res) => {
    try {
        const { participantA, participantB, amount } = req.body;

        if (!participantA || !participantB) {
            return res.status(400).json({ success: false, error: 'Missing required fields: participantA, participantB' });
        }

        const session = await yellowNetwork.createAppSession({ participantA, participantB, amount: amount || '0' });
        await saveYellowSession(session);

        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/yellow/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const session = await yellowNetwork.getSession(id);
        res.json({ success: true, session });
    } catch (error) {
        res.status(404).json({ success: false, error: 'Session not found' });
    }
});

app.post('/yellow/payment', async (req, res) => {
    try {
        const { sessionId, from, to, asset, amount } = req.body;

        if (!sessionId || !from || !to || !asset || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required fields: sessionId, from, to, asset, amount' });
        }

        const payment = await yellowNetwork.executePayment({ sessionId, from, to, asset, amount });
        await saveYellowTransaction(payment);

        res.json({ success: true, payment });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/yellow/sessions', async (req, res) => {
    try {
        const sessions = await getYellowSessionHistory(50);
        res.json({ success: true, count: sessions.length, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Yellow Network stats
app.get('/yellow/stats', async (req, res) => {
    try {
        // Get all Yellow transactions from DB
        const allTransactions = await getTransactionHistory(1000);
        const yellowTransactions = allTransactions.filter(tx => tx.service_type === 'x402-payment-yellow');
        
        // Calculate stats
        const totalYellowPayments = yellowTransactions.length;
        const totalGasSaved = (totalYellowPayments * 0.001).toFixed(4); // Estimated $0.001 gas per Arc tx
        const avgYellowLatency = yellowTransactions.length > 0 
            ? Math.round(yellowTransactions.reduce((sum, tx) => sum + (tx.latency_ms || 0), 0) / yellowTransactions.length)
            : 0;
        const avgArcLatency = 1500; // Estimated Arc tx latency
        const totalTimeSaved = Math.max(0, (avgArcLatency - avgYellowLatency) * totalYellowPayments);
        
        // Get active sessions
        const sessions = await getYellowSessionHistory(1000);
        const activeSessions = sessions.filter(s => s.status === 'open').length;
        
        res.json({
            success: true,
            yellowPayments: totalYellowPayments,
            totalGasSaved,
            totalTimeSaved,
            sessionsActive: activeSessions,
            avgLatencyMs: avgYellowLatency,
            estimatedArcLatency: avgArcLatency
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================
// Health Check
// =====================

app.get('/health', async (req, res) => {
    const arcHealth = await arcVerifier.healthCheck();

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        registeredApis: apis.size,
        totalPayments: payments.length,
        arc: arcHealth,
        circle: {
            available: circleWallet.isAvailable()
        }
    });
});

// =====================
// Start Server
// =====================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\nx402 API Gateway running on http://localhost:${PORT}\n`);
    console.log('Endpoints:');
    console.log('  POST /api/register   - Register a new API');
    console.log('  GET  /api/list       - List all registered APIs');
    console.log('  GET  /api/stats/:id  - Get API statistics');
    console.log('  ALL  /proxy/:id      - Proxy with x402 payment');
    console.log('  POST /agent/run      - Run agent with payment');
    console.log('  GET  /agent/wallet   - Get demo wallet info');
    console.log('  GET  /wallet/:addr/balance - Check USDC balance');
    console.log('  GET  /tx/:hash       - Get transaction details');
    console.log('  POST /demo/ai        - Demo AI endpoint');
    console.log('  GET  /health         - Health check');
    console.log('\nCircle SDK:', circleWallet.isAvailable() ? 'Connected' : 'Not configured');
    console.log('Arc RPC:', arcVerifier.ARC_CONFIG.rpcUrl);
    console.log('\nReady for micropayments!\n');
});

export default app;
