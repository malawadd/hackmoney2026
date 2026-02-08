// Create Wallet Set for Circle Developer-Controlled Wallets
// Run with: node scripts/createWalletSet.js

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import dotenv from 'dotenv';
import crypto from 'crypto';
import forge from 'node-forge';

dotenv.config();

async function createWalletSet() {
    console.log('\n=== Circle Wallet Set Creator ===\n');

    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
        console.error('Error: CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set in .env');
        process.exit(1);
    }

    try {
        // Get public key first
        const tempClient = initiateDeveloperControlledWalletsClient({
            apiKey: process.env.CIRCLE_API_KEY
        });

        console.log('Fetching Circle public key...');
        const configResponse = await tempClient.getPublicKey();
        const publicKeyPem = configResponse.data?.publicKey;

        if (!publicKeyPem) {
            console.error('Could not fetch public key');
            process.exit(1);
        }

        // Create entity secret ciphertext
        const entitySecretHex = process.env.CIRCLE_ENTITY_SECRET;
        const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
        const entitySecretBytes = forge.util.hexToBytes(entitySecretHex);
        const encryptedBytes = publicKey.encrypt(entitySecretBytes, 'RSA-OAEP', {
            md: forge.md.sha256.create(),
            mgf1: { md: forge.md.sha256.create() }
        });
        const entitySecretCiphertext = forge.util.encode64(encryptedBytes);

        // Initialize with entity secret as hex
        const client = initiateDeveloperControlledWalletsClient({
            apiKey: process.env.CIRCLE_API_KEY,
            entitySecret: process.env.CIRCLE_ENTITY_SECRET // Pass hex directly
        });

        console.log('Creating Wallet Set...');

        const idempotencyKey = crypto.randomUUID();
        const response = await client.createWalletSet({
            idempotencyKey,
            name: 'Arcent Demo Wallets'
        });

        const walletSet = response.data?.walletSet;

        if (walletSet) {
            console.log('\n--- Wallet Set Created! ---');
            console.log('Wallet Set ID:', walletSet.id);
            console.log('Name:', walletSet.name);
            console.log('---------------------------\n');

            console.log('Add to your .env file:');
            console.log(`CIRCLE_WALLET_SET_ID=${walletSet.id}`);

            // Save to file
            const fs = await import('fs');
            fs.appendFileSync('scripts/entity_secret_output.txt', `\nWallet Set ID: ${walletSet.id}\n`);
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

createWalletSet();
