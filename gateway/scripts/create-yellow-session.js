import yellowNetwork from '../services/yellowNetworkService.js';
import { saveYellowSession } from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

async function createGlobalSession() {
    const gatewayAddress = process.env.DEMO_WALLET_ADDRESS;
    const agentAddress = '0x0000000000000000000000000000000000000001'; // Placeholder for "all agents"
    
    if (!gatewayAddress) {
        console.error('❌ DEMO_WALLET_ADDRESS not set in .env file');
        process.exit(1);
    }
    
    yellowNetwork.initialize({
        clearNodeUrl: process.env.YELLOW_CLEARNODE_URL,
        privateKey: process.env.YELLOW_WALLET_PRIVATE_KEY
    });
    
    if (!yellowNetwork.isAvailable()) {
        console.error('❌ Yellow Network not configured. Set YELLOW_CLEARNODE_URL and YELLOW_WALLET_PRIVATE_KEY in .env');
        process.exit(1);
    }
    
    console.log('🔄 Connecting to Yellow Network...');
    await yellowNetwork.connect();
    
    console.log('🔄 Creating global Yellow Network session...');
    const session = await yellowNetwork.createAppSession({
        participantA: agentAddress,
        participantB: gatewayAddress,
        amount: '100000000' // 100 USDC allocation
    });
    
    console.log('🔄 Saving session to database...');
    await saveYellowSession(session);
    
    console.log('\n✅ Yellow Network Session Created!\n');
    console.log('Session ID:', session.app_session_id);
    console.log('Status:', session.status);
    console.log('Participants:', session.participants.join(', '));
    console.log('\n📝 Add this to your .env file:\n');
    console.log(`YELLOW_SESSION_ID=${session.app_session_id}`);
    console.log('\nThis session can be reused for all agent payments.');
}

createGlobalSession()
    .then(() => {
        console.log('\n✨ Done!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Error creating session:', error);
        process.exit(1);
    });
