// x402 Client Service
// Handles payment signing and X-PAYMENT header creation for autonomous payments

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import crypto from 'crypto';

// Circle SDK instance
let circleSdk = null;

/**
 * Initialize Circle SDK for signing
 */
export function initializeCircleSdk() {
    if (!process.env.CIRCLE_API_KEY) {
        console.warn('CIRCLE_API_KEY not set - x402 signing disabled');
        return null;
    }

    circleSdk = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET
    });

    return circleSdk;
}

/**
 * Parse x402 payment requirements from 402 response
 */
export function parsePaymentRequirements(response402) {
    const accepts = response402.accepts || [];
    if (accepts.length === 0) {
        throw new Error('No payment options in 402 response');
    }

    const paymentReq = accepts[0];
    return {
        scheme: paymentReq.scheme,
        network: paymentReq.network,
        amount: paymentReq.maxAmountRequired,
        payTo: paymentReq.payTo,
        asset: paymentReq.asset,
        resource: paymentReq.resource,
        maxTimeoutSeconds: paymentReq.maxTimeoutSeconds,
        extra: paymentReq.extra
    };
}

/**
 * Build EIP-712 typed data for TransferWithAuthorization (USDC)
 */
export function buildTransferAuthorization(params) {
    const { from, to, value, chainId, nonce } = params;

    // USDC contract addresses per chain
    const usdcContracts = {
        84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
        5042002: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Arc Testnet (placeholder)
    };

    const verifyingContract = usdcContracts[chainId] || usdcContracts[84532];

    // Generate nonce if not provided
    const paymentNonce = nonce || '0x' + crypto.randomBytes(32).toString('hex');

    // Valid time window
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now.toString();
    const validBefore = (now + 600).toString(); // 10 minutes

    return {
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' }
            ],
            TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' }
            ]
        },
        domain: {
            name: 'USDC',
            version: '2',
            chainId: chainId,
            verifyingContract: verifyingContract
        },
        primaryType: 'TransferWithAuthorization',
        message: {
            from: from,
            to: to,
            value: value,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: paymentNonce
        }
    };
}

/**
 * Sign typed data using Circle SDK
 */
export async function signPayment(walletId, typedData) {
    if (!circleSdk) {
        throw new Error('Circle SDK not initialized');
    }

    try {
        const response = await circleSdk.signTypedData({
            walletId: walletId,
            data: JSON.stringify(typedData)
        });

        return response.data?.signature;
    } catch (error) {
        console.error('Failed to sign payment:', error);
        throw new Error(`Payment signing failed: ${error.message}`);
    }
}

/**
 * Build X-PAYMENT header value
 */
export function buildXPaymentHeader(signature, typedData, network = 'base-sepolia') {
    const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: network,
        payload: {
            signature: signature,
            authorization: {
                from: typedData.message.from,
                to: typedData.message.to,
                value: typedData.message.value,
                validAfter: typedData.message.validAfter,
                validBefore: typedData.message.validBefore,
                nonce: typedData.message.nonce
            }
        }
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Complete x402 payment flow
 * @param {string} apiUrl - The protected API endpoint
 * @param {object} body - Request body
 * @param {string} walletId - Circle wallet ID for signing
 * @param {string} walletAddress - Wallet address
 * @returns {object} - API response after payment
 */
export async function payAndRequest(apiUrl, body, walletId, walletAddress) {
    // Step 1: Make initial request
    console.log(`[x402] Requesting ${apiUrl}...`);

    let response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    // Step 2: If not 402, return directly
    if (response.status !== 402) {
        return {
            success: true,
            data: await response.json(),
            paid: false
        };
    }

    // Step 3: Parse payment requirements
    console.log('[x402] Received 402 Payment Required');
    const paymentInfo = await response.json();
    const requirements = parsePaymentRequirements(paymentInfo);
    console.log(`[x402] Amount: $${parseInt(requirements.amount) / 1000000} USDC to ${requirements.payTo}`);

    // Step 4: Build and sign payment (Arc Testnet is default)
    const chainId = requirements.network === 'arc-testnet' ? 5042002 :
        requirements.network === 'base-sepolia' ? 84532 : 5042002;
    const typedData = buildTransferAuthorization({
        from: walletAddress,
        to: requirements.payTo,
        value: requirements.amount,
        chainId: chainId
    });

    console.log('[x402] Signing payment with Circle SDK...');
    const signature = await signPayment(walletId, typedData);
    console.log('[x402] Payment signed');

    // Step 5: Build X-PAYMENT header
    const xPaymentHeader = buildXPaymentHeader(signature, typedData, requirements.network);

    // Step 6: Retry with payment
    console.log('[x402] Retrying request with X-PAYMENT header...');
    response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-PAYMENT': xPaymentHeader
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Payment failed: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    console.log('[x402] Payment successful, data received');

    return {
        success: true,
        data: data,
        paid: true,
        amount: requirements.amount,
        txHash: data.txHash || null
    };
}

export default {
    initializeCircleSdk,
    parsePaymentRequirements,
    buildTransferAuthorization,
    signPayment,
    buildXPaymentHeader,
    payAndRequest
};
