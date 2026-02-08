// Arc Blockchain Verifier Service
// Verifies USDC payments on Arc testnet

import { ethers } from 'ethers';

// Arc Testnet Configuration
export const ARC_CONFIG = {
    rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
    chainId: 5042002,
    chainName: 'Arc Testnet',
    explorer: 'https://testnet.arcscan.app',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
};

// USDC ERC-20 ABI (with TransferWithAuthorization for x402)
const USDC_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
    'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'
];

// Create provider
const provider = new ethers.JsonRpcProvider(ARC_CONFIG.rpcUrl, {
    chainId: ARC_CONFIG.chainId,
    name: ARC_CONFIG.chainName
});

// USDC contract instance
const usdcContract = new ethers.Contract(ARC_CONFIG.usdc, USDC_ABI, provider);

/**
 * Get USDC balance for an address (on Arc, USDC is native token)
 * @param {string} address - Wallet address
 * @returns {Promise<{balance: string, balanceUSD: number}>}
 */
export async function getUSDCBalance(address) {
    try {
        // On Arc, USDC is native token so use getBalance
        const balance = await provider.getBalance(address);
        // Native USDC on Arc has 18 decimals
        const balanceFormatted = ethers.formatUnits(balance, 18);

        return {
            balance: balanceFormatted,
            balanceUSD: parseFloat(balanceFormatted),
            raw: balance.toString()
        };
    } catch (error) {
        console.error('Error getting USDC balance:', error);
        throw new Error(`Failed to get balance: ${error.message}`);
    }
}

/**
 * Verify a USDC transfer transaction
 * @param {string} txHash - Transaction hash (with or without arc: prefix)
 * @param {string} expectedRecipient - Expected recipient address
 * @param {number} expectedAmount - Expected amount in USDC (decimal)
 * @returns {Promise<{valid: boolean, actualAmount?: number, recipient?: string, error?: string}>}
 */
export async function verifyPayment(txHash, expectedRecipient, expectedAmount) {
    try {
        // Remove arc: prefix if present
        const cleanHash = txHash.replace(/^arc:/, '');

        // Get transaction receipt
        const receipt = await provider.getTransactionReceipt(cleanHash);

        if (!receipt) {
            return { valid: false, error: 'Transaction not found' };
        }

        if (receipt.status !== 1) {
            return { valid: false, error: 'Transaction failed' };
        }

        // Parse transfer events from logs
        const transferEvents = receipt.logs
            .filter(log => log.address.toLowerCase() === ARC_CONFIG.usdc.toLowerCase())
            .map(log => {
                try {
                    return usdcContract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                } catch {
                    return null;
                }
            })
            .filter(parsed => parsed && parsed.name === 'Transfer');

        // Find transfer to expected recipient
        const matchingTransfer = transferEvents.find(event =>
            event.args.to.toLowerCase() === expectedRecipient.toLowerCase()
        );

        if (!matchingTransfer) {
            return {
                valid: false,
                error: `No transfer to ${expectedRecipient} found in transaction`
            };
        }

        // Calculate actual amount (USDC has 6 decimals)
        const actualAmount = parseFloat(ethers.formatUnits(matchingTransfer.args.value, 6));

        // Verify amount (allow small tolerance for rounding)
        const tolerance = 0.0001;
        if (actualAmount < expectedAmount - tolerance) {
            return {
                valid: false,
                actualAmount,
                expectedAmount,
                error: `Insufficient payment: received $${actualAmount}, expected $${expectedAmount}`
            };
        }

        return {
            valid: true,
            actualAmount,
            recipient: matchingTransfer.args.to,
            from: matchingTransfer.args.from,
            txHash: cleanHash,
            blockNumber: receipt.blockNumber,
            explorerUrl: `${ARC_CONFIG.explorer}/tx/${cleanHash}`
        };

    } catch (error) {
        console.error('Payment verification error:', error);
        return {
            valid: false,
            error: `Verification failed: ${error.message}`
        };
    }
}

/**
 * Get transaction details
 * @param {string} txHash - Transaction hash
 * @returns {Promise<object>}
 */
export async function getTransaction(txHash) {
    try {
        const cleanHash = txHash.replace(/^arc:/, '');
        const tx = await provider.getTransaction(cleanHash);
        const receipt = await provider.getTransactionReceipt(cleanHash);

        return {
            hash: cleanHash,
            from: tx?.from,
            to: tx?.to,
            status: receipt?.status === 1 ? 'success' : 'failed',
            blockNumber: receipt?.blockNumber,
            gasUsed: receipt?.gasUsed?.toString(),
            explorerUrl: `${ARC_CONFIG.explorer}/tx/${cleanHash}`
        };
    } catch (error) {
        throw new Error(`Failed to get transaction: ${error.message}`);
    }
}

/**
 * Check if Arc RPC is healthy
 * @returns {Promise<boolean>}
 */
export async function healthCheck() {
    try {
        const blockNumber = await provider.getBlockNumber();
        return { healthy: true, blockNumber };
    } catch (error) {
        return { healthy: false, error: error.message };
    }
}

// =====================
// x402 FACILITATOR FOR ARC
// Custom facilitator to process x402 payments on Arc Testnet
// =====================

/**
 * Decode X-PAYMENT header from base64
 * @param {string} xPaymentHeader - Base64 encoded payment header
 * @returns {object} Decoded payment payload
 */
export function decodeXPaymentHeader(xPaymentHeader) {
    try {
        const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
        const payload = JSON.parse(decoded);

        return {
            version: payload.x402Version,
            scheme: payload.scheme,
            network: payload.network,
            signature: payload.payload?.signature,
            authorization: payload.payload?.authorization
        };
    } catch (error) {
        throw new Error(`Invalid X-PAYMENT header: ${error.message}`);
    }
}

/**
 * Verify that the signature is valid for the authorization
 * @param {object} authorization - Authorization details
 * @param {string} signature - Signature string
 * @returns {object} Verification result
 */
export function verifySignature(authorization, signature) {
    try {
        // Split signature into r, s, v
        const sig = ethers.Signature.from(signature);

        // Build EIP-712 typed data hash
        const domain = {
            name: 'USDC',
            version: '2',
            chainId: ARC_CONFIG.chainId,
            verifyingContract: ARC_CONFIG.usdc
        };

        const types = {
            TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' }
            ]
        };

        const message = {
            from: authorization.from,
            to: authorization.to,
            value: authorization.value,
            validAfter: authorization.validAfter,
            validBefore: authorization.validBefore,
            nonce: authorization.nonce
        };

        // Recover signer from typed data
        const recoveredAddress = ethers.verifyTypedData(domain, types, message, sig);

        // Verify signer matches 'from' address
        const isValid = recoveredAddress.toLowerCase() === authorization.from.toLowerCase();

        return {
            valid: isValid,
            recoveredAddress,
            expectedAddress: authorization.from,
            v: sig.v,
            r: sig.r,
            s: sig.s
        };
    } catch (error) {
        return {
            valid: false,
            error: `Signature verification failed: ${error.message}`
        };
    }
}

/**
 * Check if authorization nonce has been used
 * @param {string} authorizer - Authorizer address
 * @param {string} nonce - Authorization nonce
 * @returns {Promise<boolean>} True if nonce already used
 */
export async function isNonceUsed(authorizer, nonce) {
    try {
        return await usdcContract.authorizationState(authorizer, nonce);
    } catch (error) {
        console.error('Error checking nonce:', error);
        return false;
    }
}

/**
 * Process x402 payment on Arc testnet
 * This is the core facilitator function
 * @param {string} xPaymentHeader - X-PAYMENT header value
 * @param {string} expectedRecipient - Expected payment recipient
 * @param {number} expectedAmount - Expected amount in USDC
 * @param {ethers.Wallet} executorWallet - Wallet to execute the transaction
 * @returns {Promise<object>} Payment result
 */
export async function processX402Payment(xPaymentHeader, expectedRecipient, expectedAmount, executorWallet) {
    console.log('[Arc Facilitator] Processing x402 payment...');

    // Step 1: Decode header
    const payment = decodeXPaymentHeader(xPaymentHeader);
    console.log(`[Arc Facilitator] Authorization from: ${payment.authorization?.from}`);

    // Step 2: Validate network
    if (payment.network !== 'arc-testnet' && payment.network !== 'base-sepolia') {
        // Accept both for compatibility during transition
        console.log(`[Arc Facilitator] Warning: Network is ${payment.network}, proceeding anyway`);
    }

    // Step 3: Verify signature
    const sigResult = verifySignature(payment.authorization, payment.signature);
    if (!sigResult.valid) {
        return { success: false, error: sigResult.error || 'Invalid signature' };
    }
    console.log('[Arc Facilitator] Signature verified');

    // Step 4: Check recipient matches
    if (payment.authorization.to.toLowerCase() !== expectedRecipient.toLowerCase()) {
        return {
            success: false,
            error: `Recipient mismatch: expected ${expectedRecipient}, got ${payment.authorization.to}`
        };
    }

    // Step 5: Check amount
    const paymentAmount = BigInt(payment.authorization.value);
    const expectedAmountWei = BigInt(Math.floor(expectedAmount * 1e6)); // USDC has 6 decimals
    if (paymentAmount < expectedAmountWei) {
        return {
            success: false,
            error: `Insufficient amount: expected ${expectedAmount} USDC, got ${Number(paymentAmount) / 1e6}`
        };
    }

    // Step 6: Check time validity
    const now = Math.floor(Date.now() / 1000);
    if (now < parseInt(payment.authorization.validAfter)) {
        return { success: false, error: 'Payment not yet valid' };
    }
    if (now > parseInt(payment.authorization.validBefore)) {
        return { success: false, error: 'Payment expired' };
    }

    // Step 7: Check nonce not used
    const nonceUsed = await isNonceUsed(payment.authorization.from, payment.authorization.nonce);
    if (nonceUsed) {
        return { success: false, error: 'Nonce already used (replay attack prevented)' };
    }

    // Step 8: Execute TransferWithAuthorization on Arc
    console.log('[Arc Facilitator] Executing on-chain transfer...');
    try {
        const usdcWithSigner = usdcContract.connect(executorWallet);

        const tx = await usdcWithSigner.transferWithAuthorization(
            payment.authorization.from,
            payment.authorization.to,
            payment.authorization.value,
            payment.authorization.validAfter,
            payment.authorization.validBefore,
            payment.authorization.nonce,
            sigResult.v,
            sigResult.r,
            sigResult.s
        );

        console.log(`[Arc Facilitator] TX submitted: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log('[Arc Facilitator] Payment confirmed!');
            return {
                success: true,
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                amount: Number(paymentAmount) / 1e6,
                from: payment.authorization.from,
                to: payment.authorization.to,
                explorerUrl: `${ARC_CONFIG.explorer}/tx/${tx.hash}`
            };
        } else {
            return { success: false, error: 'Transaction failed on-chain' };
        }

    } catch (error) {
        console.error('[Arc Facilitator] Execution error:', error);
        return { success: false, error: `Execution failed: ${error.message}` };
    }
}

/**
 * Verify x402 payment without executing (read-only check)
 * @param {string} xPaymentHeader - X-PAYMENT header value
 * @param {string} expectedRecipient - Expected payment recipient
 * @param {number} expectedAmount - Expected amount in USDC
 * @returns {object} Validation result
 */
export function validateX402Payment(xPaymentHeader, expectedRecipient, expectedAmount) {
    try {
        const payment = decodeXPaymentHeader(xPaymentHeader);
        const sigResult = verifySignature(payment.authorization, payment.signature);

        return {
            valid: sigResult.valid,
            authorization: payment.authorization,
            expectedRecipient,
            actualRecipient: payment.authorization?.to,
            expectedAmount,
            actualAmount: Number(BigInt(payment.authorization?.value || 0)) / 1e6,
            signatureValid: sigResult.valid
        };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

export default {
    getUSDCBalance,
    verifyPayment,
    getTransaction,
    healthCheck,
    ARC_CONFIG,
    // x402 Facilitator functions
    decodeXPaymentHeader,
    verifySignature,
    isNonceUsed,
    processX402Payment,
    validateX402Payment
};
