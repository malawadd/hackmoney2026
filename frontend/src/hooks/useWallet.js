// useWallet Hook - MetaMask connection for Arc blockchain
import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

// Arc Testnet Configuration
const ARC_TESTNET = {
    chainId: '0x4cef52', // 5042002 in hex (correct!)
    chainName: 'Arc Testnet',
    nativeCurrency: {
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 18  // MetaMask requires 18
    },
    rpcUrls: ['https://rpc.testnet.arc.network'],
    blockExplorerUrls: ['https://testnet.arcscan.app']
};

// USDC Contract on Arc Testnet (system contract - USDC is native token)
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const USDC_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)'
];

export function useWallet() {
    const [address, setAddress] = useState(null);
    const [balance, setBalance] = useState(null);
    const [chainId, setChainId] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState(null);
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [needsArcAdded, setNeedsArcAdded] = useState(false);

    // Check if MetaMask is installed
    const hasMetaMask = typeof window !== 'undefined' && window.ethereum;

    // Check if connected to Arc
    const isArcNetwork = chainId === parseInt(ARC_TESTNET.chainId, 16);

    // Format address for display
    const shortAddress = address
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : null;

    // Get USDC balance (on Arc, USDC is native token so use getBalance)
    const fetchBalance = useCallback(async (addr, prov) => {
        if (!addr || !prov) return;

        try {
            // On Arc, USDC is the native token, so use getBalance
            const bal = await prov.getBalance(addr);
            // Native USDC on Arc has 18 decimals
            setBalance(parseFloat(ethers.formatUnits(bal, 18)));
        } catch (e) {
            console.error('Failed to fetch balance:', e);
            setBalance(0);
        }
    }, []);

    // Connect wallet
    const connect = useCallback(async () => {
        if (!hasMetaMask) {
            setError('MetaMask is not installed. Please install MetaMask to continue.');
            return false;
        }

        setIsConnecting(true);
        setError(null);

        try {
            // Request account access
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            if (accounts.length === 0) {
                throw new Error('No accounts found');
            }

            const addr = accounts[0];
            setAddress(addr);

            // Get chain ID
            const chain = await window.ethereum.request({ method: 'eth_chainId' });
            const currentChainId = parseInt(chain, 16);
            setChainId(currentChainId);

            // Debug: log chain comparison
            const arcChainId = parseInt(ARC_TESTNET.chainId, 16);
            console.log('Current chain:', currentChainId, '(hex:', chain, ')');
            console.log('Arc Testnet chain:', arcChainId, '(hex:', ARC_TESTNET.chainId, ')');
            console.log('Is Arc Network:', currentChainId === arcChainId);

            // Create provider and signer
            const prov = new ethers.BrowserProvider(window.ethereum);
            const sign = await prov.getSigner();
            setProvider(prov);
            setSigner(sign);

            // Don't auto-switch - user can use "Switch to Arc" button if needed

            // Fetch balance (will work on Arc, might fail on other networks)
            try {
                await fetchBalance(addr, prov);
            } catch (e) {
                console.log('Balance fetch skipped - not on Arc');
            }

            setIsConnecting(false);
            return true;
        } catch (e) {
            console.error('Connection error:', e);
            setError(e.message);
            setIsConnecting(false);
            return false;
        }
    }, [hasMetaMask, fetchBalance]);

    // Disconnect wallet
    const disconnect = useCallback(() => {
        setAddress(null);
        setBalance(null);
        setChainId(null);
        setProvider(null);
        setSigner(null);
        setError(null);
    }, []);

    // Add Arc Testnet to wallet (only add, don't switch)
    const addArcNetwork = useCallback(async () => {
        if (!hasMetaMask) {
            setError('MetaMask is not installed');
            return false;
        }

        console.log('Adding Arc Testnet...');

        try {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [ARC_TESTNET]
            });
            console.log('Arc Testnet added successfully!');
            setNeedsArcAdded(false);
            // Reload to update state
            window.location.reload();
            return true;
        } catch (error) {
            console.error('Failed to add Arc network:', error);
            if (error.code === 4001) {
                console.log('User rejected adding network');
            } else {
                setError('Failed to add Arc network');
            }
            return false;
        }
    }, [hasMetaMask]);

    // Transfer USDC
    const transferUSDC = useCallback(async (to, amount) => {
        if (!signer || !isArcNetwork) {
            throw new Error('Wallet not connected or not on Arc network');
        }

        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
        const decimals = await usdc.decimals();
        const amountWei = ethers.parseUnits(amount.toString(), decimals);

        const tx = await usdc.transfer(to, amountWei);
        const receipt = await tx.wait();

        // Refresh balance
        await fetchBalance(address, provider);

        return {
            hash: receipt.hash,
            explorerUrl: `${ARC_TESTNET.blockExplorerUrls[0]}/tx/${receipt.hash}`
        };
    }, [signer, isArcNetwork, address, provider, fetchBalance]);

    // Sign x402 payment header
    const signPaymentHeader = useCallback(async (paymentDetails) => {
        if (!signer) {
            throw new Error('Wallet not connected');
        }

        const payload = {
            ...paymentDetails,
            wallet: address,
            timestamp: Date.now()
        };

        // Sign the payload
        const message = JSON.stringify(payload);
        const signature = await signer.signMessage(message);

        return {
            payload,
            signature,
            // Base64 encoded for x-payment header
            header: btoa(JSON.stringify({ ...payload, signature }))
        };
    }, [signer, address]);

    // Listen for account/network changes
    useEffect(() => {
        if (!hasMetaMask) return;

        const handleAccountsChanged = (accounts) => {
            if (accounts.length === 0) {
                disconnect();
            } else if (accounts[0] !== address) {
                setAddress(accounts[0]);
                if (provider) {
                    fetchBalance(accounts[0], provider);
                }
            }
        };

        const handleChainChanged = (chainIdHex) => {
            const newChainId = parseInt(chainIdHex, 16);
            setChainId(newChainId);

            // Refresh balance on chain change
            if (address && provider) {
                fetchBalance(address, provider);
            }
        };

        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);

        // Don't auto-connect - user must click Connect Wallet button

        return () => {
            window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
            window.ethereum.removeListener('chainChanged', handleChainChanged);
        };
    }, [hasMetaMask, address, provider, disconnect, fetchBalance]);

    return {
        // State
        address,
        shortAddress,
        balance,
        chainId,
        isConnecting,
        error,
        isConnected: !!address,
        isArcNetwork,
        needsArcAdded,
        hasMetaMask,

        // Actions
        connect,
        disconnect,
        addArcNetwork,
        transferUSDC,
        signPaymentHeader,
        refreshBalance: () => fetchBalance(address, provider)
    };
}

export default useWallet;
