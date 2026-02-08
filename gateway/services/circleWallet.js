// Circle Wallet Service
// Developer-controlled wallets for agent payments

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

// Initialize Circle SDK
let circleClient = null;

/**
 * Initialize Circle Wallet client
 */
export async function initializeCircle() {
    if (!process.env.CIRCLE_API_KEY) {
        console.warn('CIRCLE_API_KEY not set - Circle Wallet features disabled');
        return null;
    }

    try {
        circleClient = initiateDeveloperControlledWalletsClient({
            apiKey: process.env.CIRCLE_API_KEY,
            entitySecret: process.env.CIRCLE_ENTITY_SECRET
        });

        console.log('Circle Wallet SDK initialized');
        return circleClient;
    } catch (error) {
        console.error('Failed to initialize Circle SDK:', error);
        return null;
    }
}

/**
 * Create a new developer-controlled wallet
 * @param {string} idempotencyKey - Unique key to prevent duplicates
 * @returns {Promise<object>} Wallet details
 */
export async function createWallet(idempotencyKey) {
    if (!circleClient) {
        throw new Error('Circle SDK not initialized');
    }

    try {
        const response = await circleClient.createWallets({
            idempotencyKey,
            blockchains: ['ARC-TESTNET'],
            count: 1,
            walletSetId: process.env.CIRCLE_WALLET_SET_ID
        });

        const wallet = response.data?.wallets?.[0];

        return {
            id: wallet.id,
            address: wallet.address,
            blockchain: wallet.blockchain,
            state: wallet.state
        };
    } catch (error) {
        console.error('Failed to create wallet:', error);
        throw new Error(`Wallet creation failed: ${error.message}`);
    }
}

/**
 * Create an EOA wallet for signTypedData (required for x402 payments)
 * EOA wallets can sign on ANY EVM chain
 * @param {string} idempotencyKey - Unique key to prevent duplicates
 * @returns {Promise<object>} EOA Wallet details
 */
export async function createEOAWallet(idempotencyKey) {
    if (!circleClient) {
        throw new Error('Circle SDK not initialized');
    }

    try {
        // EOA wallets need a specific blockchain - using BASE-SEPOLIA as per Circle's x402 blog
        // EOA wallets can sign on ANY EVM chain once created
        const response = await circleClient.createWallets({
            idempotencyKey,
            accountType: 'EOA',
            blockchains: ['BASE-SEPOLIA'],
            count: 1,
            walletSetId: process.env.CIRCLE_WALLET_SET_ID
        });

        const wallet = response.data?.wallets?.[0];

        return {
            id: wallet.id,
            address: wallet.address,
            blockchain: wallet.blockchain,
            accountType: 'EOA',
            state: wallet.state
        };
    } catch (error) {
        console.error('Failed to create EOA wallet:', error);
        throw new Error(`EOA Wallet creation failed: ${error.message}`);
    }
}

/**
 * Get wallet balance
 * @param {string} walletId - Circle wallet ID
 * @returns {Promise<object>} Balance details
 */
export async function getWalletBalance(walletId) {
    if (!circleClient) {
        throw new Error('Circle SDK not initialized');
    }

    try {
        const response = await circleClient.getWalletTokenBalance({
            id: walletId
        });

        const tokenBalances = response.data?.tokenBalances || [];
        const usdcBalance = tokenBalances.find(t =>
            t.token.symbol === 'USDC' && t.token.blockchain === 'ARC-TESTNET'
        );

        return {
            walletId,
            usdc: usdcBalance ? parseFloat(usdcBalance.amount) : 0,
            tokenId: usdcBalance?.token.id
        };
    } catch (error) {
        console.error('Failed to get wallet balance:', error);
        throw new Error(`Balance check failed: ${error.message}`);
    }
}

/**
 * Transfer USDC to another address
 * @param {string} walletId - Source wallet ID
 * @param {string} destinationAddress - Recipient address
 * @param {string} amount - Amount in USDC
 * @returns {Promise<object>} Transaction details
 */
export async function transferUSDC(walletId, destinationAddress, amount) {
    if (!circleClient) {
        throw new Error('Circle SDK not initialized');
    }

    try {
        // First get the USDC token ID
        const balanceResponse = await circleClient.getWalletTokenBalance({
            id: walletId
        });

        const usdcToken = balanceResponse.data?.tokenBalances?.find(t =>
            t.token.symbol === 'USDC' && t.token.blockchain === 'ARC-TESTNET'
        );

        if (!usdcToken) {
            throw new Error('No USDC found in wallet');
        }

        // Create transfer
        const idempotencyKey = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const response = await circleClient.createTransaction({
            idempotencyKey,
            walletId,
            tokenId: usdcToken.token.id,
            destinationAddress,
            amounts: [amount],
            fee: {
                type: 'level',
                config: {
                    feeLevel: 'MEDIUM'
                }
            }
        });

        const tx = response.data;

        return {
            id: tx.id,
            state: tx.state,
            txHash: tx.txHash,
            amount,
            destinationAddress,
            blockchain: 'ARC-TESTNET'
        };
    } catch (error) {
        console.error('Failed to transfer USDC:', error);
        throw new Error(`Transfer failed: ${error.message}`);
    }
}

/**
 * Wait for transaction to complete
 * @param {string} transactionId - Circle transaction ID
 * @param {number} maxWaitMs - Maximum wait time
 * @returns {Promise<object>} Final transaction state
 */
export async function waitForTransaction(transactionId, maxWaitMs = 30000) {
    if (!circleClient) {
        throw new Error('Circle SDK not initialized');
    }

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const response = await circleClient.getTransaction({
            id: transactionId
        });

        const tx = response.data;

        if (tx.state === 'CONFIRMED') {
            return {
                id: tx.id,
                state: tx.state,
                txHash: tx.txHash,
                blockNumber: tx.blockNumber,
                explorerUrl: `https://testnet.arcscan.app/tx/${tx.txHash}`
            };
        }

        if (tx.state === 'FAILED' || tx.state === 'CANCELLED') {
            throw new Error(`Transaction ${tx.state.toLowerCase()}`);
        }

        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Transaction confirmation timeout');
}

/**
 * Get Demo Wallet (creates or returns existing)
 * @returns {Promise<object>} Demo wallet details
 */
export async function getDemoWallet() {
    // Check for pre-configured demo wallet
    if (process.env.DEMO_WALLET_ID && process.env.DEMO_WALLET_ADDRESS) {
        // Get balance from Arc RPC directly (USDC is native token)
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');

        try {
            const balance = await provider.getBalance(process.env.DEMO_WALLET_ADDRESS);
            const balanceFormatted = parseFloat(ethers.formatUnits(balance, 18));

            return {
                id: process.env.DEMO_WALLET_ID,
                address: process.env.DEMO_WALLET_ADDRESS,
                balance: balanceFormatted
            };
        } catch (error) {
            console.warn('Failed to get demo wallet balance:', error.message);
            return {
                id: process.env.DEMO_WALLET_ID,
                address: process.env.DEMO_WALLET_ADDRESS,
                balance: 0
            };
        }
    }

    // Create a new demo wallet if none exists
    const idempotencyKey = `demo-wallet-${process.env.NODE_ENV || 'dev'}`;

    try {
        const wallet = await createWallet(idempotencyKey);
        return {
            id: wallet.id,
            address: wallet.address,
            balance: 0,
            isNew: true,
            fundingNeeded: true
        };
    } catch (error) {
        // Wallet may already exist from previous runs
        console.log('Using cached demo wallet approach');
        return null;
    }
}

/**
 * Check if Circle SDK is available
 */
export function isAvailable() {
    return circleClient !== null;
}

export default {
    initializeCircle,
    createWallet,
    createEOAWallet,
    getWalletBalance,
    transferUSDC,
    waitForTransaction,
    getDemoWallet,
    isAvailable
};
