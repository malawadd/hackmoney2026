// Entity Secret Generator for Circle Developer-Controlled Wallets
// Run with: node scripts/generateEntitySecret.js

import crypto from 'crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import dotenv from 'dotenv';
import forge from 'node-forge';

dotenv.config();

async function generateEntitySecret() {
    console.log('\n=== Circle Entity Secret Generator ===\n');

    // Check API key
    if (!process.env.CIRCLE_API_KEY) {
        console.error('Error: CIRCLE_API_KEY not set in .env file');
        process.exit(1);
    }

    try {
        // Initialize Circle client
        const client = initiateDeveloperControlledWalletsClient({
            apiKey: process.env.CIRCLE_API_KEY
        });

        // Get configuration (including public key)
        console.log('Fetching Circle public key...');
        const configResponse = await client.getPublicKey();
        const publicKeyPem = configResponse.data?.publicKey;

        if (!publicKeyPem) {
            console.error('Could not fetch public key from Circle');
            process.exit(1);
        }

        console.log('Public key received.');

        // Generate a random 32-byte entity secret
        const entitySecretHex = crypto.randomBytes(32).toString('hex');
        console.log('\n--- Your Entity Secret (SAVE THIS!) ---');
        console.log(entitySecretHex);
        console.log('----------------------------------------\n');

        // Encrypt the entity secret with Circle's public key
        const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
        const entitySecretBytes = forge.util.hexToBytes(entitySecretHex);
        const encryptedBytes = publicKey.encrypt(entitySecretBytes, 'RSA-OAEP', {
            md: forge.md.sha256.create(),
            mgf1: {
                md: forge.md.sha256.create()
            }
        });
        const entitySecretCiphertext = forge.util.encode64(encryptedBytes);

        console.log('--- Entity Secret Ciphertext (for Circle Console) ---');
        console.log(entitySecretCiphertext);
        console.log('------------------------------------------------------\n');

        console.log('Next steps:');
        console.log('1. Copy the "Entity Secret Ciphertext" above');
        console.log('2. Go to Circle Console > Dev Controlled > Configurator > Entity Secret');
        console.log('3. Paste and Register');
        console.log('4. Add CIRCLE_ENTITY_SECRET=' + entitySecretHex + ' to your .env file');
        console.log('');

        // Also save to file for convenience
        console.log('Saved to scripts/entity_secret_output.txt');
        const fs = await import('fs');
        fs.writeFileSync('scripts/entity_secret_output.txt', `
Entity Secret (hex, for .env):
${entitySecretHex}

Entity Secret Ciphertext (for Circle Console):
${entitySecretCiphertext}
`);

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response?.data) {
            console.error('API Error:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

generateEntitySecret();
