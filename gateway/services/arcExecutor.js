/**
 * Arc Executor Service
 * Executes real on-chain transactions using transferWithAuthorization
 * This service acts as the "facilitator" that pays gas and submits Agent's signed authorization
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Arc Testnet Configuration
const ARC_CONFIG = {
    rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
    chainId: parseInt(process.env.ARC_CHAIN_ID || '5042002'),
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://testnet.arcscan.app'
};

// USDC ABI with transferWithAuthorization
const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
    'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Initialize provider and executor wallet
let provider = null;
let executorWallet = null;
let usdcContract = null;

/**
 * Initialize the Arc Executor
 */
export function initializeExecutor() {
    if (!process.env.EXECUTOR_PRIVATE_KEY) {
        console.warn('[Arc Executor] EXECUTOR_PRIVATE_KEY not set - on-chain execution disabled');
        return false;
    }

    provider = new ethers.JsonRpcProvider(ARC_CONFIG.rpcUrl);
    executorWallet = new ethers.Wallet(process.env.EXECUTOR_PRIVATE_KEY, provider);
    usdcContract = new ethers.Contract(ARC_CONFIG.usdc, USDC_ABI, executorWallet);

    console.log(`[Arc Executor] Initialized with address: ${executorWallet.address}`);
    return true;
}

/**
 * Get executor wallet balance
 */
export async function getExecutorBalance() {
    if (!provider || !executorWallet) {
        initializeExecutor();
    }

    const balance = await provider.getBalance(executorWallet.address);
    return {
        address: executorWallet.address,
        nativeBalance: ethers.formatUnits(balance, 18), // Arc native uses 18 decimals
        network: 'Arc Testnet'
    };
}

/**
 * PRE-FLIGHT: Check if an address has sufficient USDC balance
 * Zero gas cost - just an RPC query
 * @param {string} address - The wallet address to check
 * @param {string} requiredAmount - Required amount in USDC (e.g., "0.01")
 * @returns {Promise<{sufficient: boolean, balance: string, required: string}>}
 */
export async function checkBalance(address, requiredAmount) {
    if (!provider) {
        initializeExecutor();
    }

    try {
        // Arc native USDC uses 18 decimals
        const balance = await provider.getBalance(address);
        const balanceUsdc = parseFloat(ethers.formatUnits(balance, 18));
        const required = parseFloat(requiredAmount);

        console.log(`[Pre-Flight] Balance check: ${address.slice(0, 10)}... has ${balanceUsdc} USDC, needs ${required}`);

        return {
            sufficient: balanceUsdc >= required,
            balance: balanceUsdc.toFixed(4),
            required: required.toFixed(4),
            address
        };
    } catch (error) {
        console.error('[Pre-Flight] Balance check failed:', error.message);
        return {
            sufficient: false,
            balance: '0',
            required: requiredAmount,
            error: error.message
        };
    }
}

/**
 * PRE-FLIGHT: Verify EIP-712 signature off-chain
 * Zero gas cost - cryptographic verification only
 * @param {object} typedData - The EIP-712 typed data that was signed
 * @param {string} signature - The signature to verify
 * @param {string} expectedSigner - The expected signer address
 * @returns {Promise<{valid: boolean, recoveredAddress: string}>}
 */
export function verifySignature(typedData, signature, expectedSigner) {
    try {
        // Extract domain and types from typedData
        const { domain, types, message } = typedData;

        // Remove EIP712Domain from types (ethers handles this automatically)
        const typesWithoutDomain = { ...types };
        delete typesWithoutDomain.EIP712Domain;

        // Recover the signer address from signature
        const recoveredAddress = ethers.verifyTypedData(
            domain,
            typesWithoutDomain,
            message,
            signature
        );

        const valid = recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();

        console.log(`[Pre-Flight] Signature verification: expected=${expectedSigner.slice(0, 10)}..., recovered=${recoveredAddress.slice(0, 10)}..., valid=${valid}`);

        return {
            valid,
            recoveredAddress,
            expectedSigner
        };
    } catch (error) {
        console.error('[Pre-Flight] Signature verification failed:', error.message);
        return {
            valid: false,
            recoveredAddress: null,
            error: error.message
        };
    }
}

/**
 * PRE-FLIGHT: Complete pre-flight check for atomic settlement
 * Verifies signature AND checks balance before any execution
 * @param {object} typedData - The EIP-712 typed data
 * @param {string} signature - The signature
 * @param {string} signerAddress - Expected signer address
 * @param {string} requiredAmount - Required USDC amount
 * @returns {Promise<{passed: boolean, checks: object}>}
 */
export async function preFlightCheck(typedData, signature, signerAddress, requiredAmount) {
    console.log('[Pre-Flight] Starting atomic settlement pre-flight checks...');

    // Check 1: Verify signature
    const signatureCheck = verifySignature(typedData, signature, signerAddress);

    // Check 2: Check balance (for executor wallet in our case, since it pays)
    const balanceCheck = await checkBalance(executorWallet?.address || signerAddress, requiredAmount);

    const passed = signatureCheck.valid && balanceCheck.sufficient;

    console.log(`[Pre-Flight] Result: signature=${signatureCheck.valid}, balance=${balanceCheck.sufficient}, passed=${passed}`);

    return {
        passed,
        checks: {
            signature: signatureCheck,
            balance: balanceCheck
        }
    };
}

/**
 * Execute a transferWithAuthorization on-chain
 * This is called after Agent signs the authorization with Circle SDK
 * 
 * @param {object} authorization - The authorization details from Agent's signature
 * @param {string} signature - The signature from Circle SDK signTypedData
 * @returns {Promise<object>} Transaction result with txHash
 */
export async function executeTransferWithAuthorization(authorization, signature) {
    if (!executorWallet) {
        initializeExecutor();
    }

    if (!executorWallet) {
        throw new Error('Executor wallet not configured');
    }

    console.log('[Arc Executor] Executing transferWithAuthorization...');
    console.log(`[Arc Executor] From: ${authorization.from}`);
    console.log(`[Arc Executor] To: ${authorization.to}`);
    console.log(`[Arc Executor] Amount: ${authorization.value}`);

    // Parse signature into v, r, s components
    const sig = ethers.Signature.from(signature);

    try {
        // Call transferWithAuthorization on USDC contract
        const tx = await usdcContract.transferWithAuthorization(
            authorization.from,
            authorization.to,
            authorization.value,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            sig.v,
            sig.r,
            sig.s
        );

        console.log(`[Arc Executor] Transaction submitted: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`[Arc Executor] Transaction confirmed in block ${receipt.blockNumber}`);
            return {
                success: true,
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                explorerUrl: `${ARC_CONFIG.explorer}/tx/${tx.hash}`
            };
        } else {
            throw new Error('Transaction reverted on-chain');
        }

    } catch (error) {
        console.error('[Arc Executor] Transaction failed:', error.message);
        throw error;
    }
}

/**
 * Execute a simple USDC transfer (for testing)
 * @param {string} to - Recipient address
 * @param {string} amount - Amount in USDC (with decimals)
 */
export async function executeSimpleTransfer(to, amount) {
    if (!executorWallet) {
        initializeExecutor();
    }

    console.log(`[Arc Executor] Simple transfer: ${amount} USDC to ${to}`);

    // Arc native USDC uses 18 decimals (like ETH native token)
    const amountWei = ethers.parseUnits(amount, 18);

    const tx = await executorWallet.sendTransaction({
        to: to,
        value: amountWei
    });

    console.log(`[Arc Executor] Transaction submitted: ${tx.hash}`);

    const receipt = await tx.wait();

    return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        explorerUrl: `${ARC_CONFIG.explorer}/tx/${tx.hash}`
    };
}

export default {
    initializeExecutor,
    getExecutorBalance,
    checkBalance,
    verifySignature,
    preFlightCheck,
    executeTransferWithAuthorization,
    executeSimpleTransfer,
    ARC_CONFIG
};
