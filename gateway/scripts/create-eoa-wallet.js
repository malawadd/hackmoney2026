// Create EOA wallet script
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const sdk = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET
});

// Create EOA wallet on BASE-SEPOLIA (for x402 signing)
sdk.createWallets({
    idempotencyKey: randomUUID(),
    accountType: 'EOA',
    blockchains: ['BASE-SEPOLIA'],
    count: 1,
    walletSetId: process.env.CIRCLE_WALLET_SET_ID
})
    .then(r => console.log(JSON.stringify(r.data, null, 2)))
    .catch(e => console.error('Error:', e.response?.data || e.message));
