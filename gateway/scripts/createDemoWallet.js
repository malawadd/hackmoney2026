// Create Demo Wallet for Arcent Agent Demo
// Run with: node scripts/createDemoWallet.js

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

async function createDemoWallet() {
    console.log('\n=== Arcent Demo Wallet Creator ===\n');

    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET || !process.env.CIRCLE_WALLET_SET_ID) {
        console.error('Error: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID must be set');
        process.exit(1);
    }

    try {
        const client = initiateDeveloperControlledWalletsClient({
            apiKey: process.env.CIRCLE_API_KEY,
            entitySecret: process.env.CIRCLE_ENTITY_SECRET
        });

        console.log('Creating wallet on Arc Testnet...');

        const idempotencyKey = crypto.randomUUID();
        const response = await client.createWallets({
            idempotencyKey,
            blockchains: ['ARC-TESTNET'], // Arc Testnet
            count: 1,
            walletSetId: process.env.CIRCLE_WALLET_SET_ID
        });

        const wallet = response.data?.wallets?.[0];

        if (wallet) {
            console.log('\n--- Demo Wallet Created! ---');
            console.log('Wallet ID:', wallet.id);
            console.log('Address:', wallet.address);
            console.log('Blockchain:', wallet.blockchain);
            console.log('State:', wallet.state);
            console.log('----------------------------\n');

            console.log('Add to your .env file:');
            console.log(`DEMO_WALLET_ID=${wallet.id}`);
            console.log(`DEMO_WALLET_ADDRESS=${wallet.address}`);
            console.log('');
            console.log('To fund this wallet with testnet USDC:');
            console.log('1. Go to https://faucet.circle.com');
            console.log('2. Select Arc Sepolia network');
            console.log('3. Enter address:', wallet.address);
            console.log('4. Request testnet USDC');

            // Save to file
            const fs = await import('fs');
            fs.appendFileSync('scripts/entity_secret_output.txt', `
Demo Wallet ID: ${wallet.id}
Demo Wallet Address: ${wallet.address}
`);
        } else {
            console.log('Response:', JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response?.data) {
            console.error('API Error:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

createDemoWallet();
