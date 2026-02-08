// Script to transfer USDC from demo wallet to executor wallet
import { initializeCircle, transferUSDC } from '../services/circleWallet.js';
import dotenv from 'dotenv';

dotenv.config();

const EXECUTOR_ADDRESS = '0x49bB94cE4B5F85c564780a895D3260DB6FC56b09';
const AMOUNT = '5'; // 5 USDC for gas

async function main() {
    console.log('Initializing Circle SDK...');
    await initializeCircle();

    console.log(`Transferring ${AMOUNT} USDC to executor wallet...`);
    console.log(`From: ${process.env.DEMO_WALLET_ID}`);
    console.log(`To: ${EXECUTOR_ADDRESS}`);

    try {
        const result = await transferUSDC(
            process.env.DEMO_WALLET_ID,
            EXECUTOR_ADDRESS,
            AMOUNT
        );

        console.log('Transfer initiated!');
        console.log('Transaction ID:', result.id);
        console.log('State:', result.state);
        console.log('TxHash:', result.txHash || 'Pending...');
    } catch (error) {
        console.error('Transfer failed:', error.message);
    }
}

main();
