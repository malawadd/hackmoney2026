// Yellow Network Service - ClearNode Integration
// Demonstrates Yellow Network off-chain payment capabilities
// Based on Nitrolite RPC protocol from yellowdocs.txt

import EventEmitter from 'events';
import { ethers } from 'ethers';

/**
 * Yellow Network Service
 * Manages connection to ClearNode for off-chain state channels
 */
class YellowNetworkService extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000;
        this.requestMap = new Map();
        this.stateWallet = null;
        this.clearNodeUrl = null;
        this.channels = [];
        this.sessions = [];
    }

    /**
     * Initialize the service with configuration
     */
    initialize(config) {
        this.clearNodeUrl = config.clearNodeUrl || process.env.YELLOW_CLEARNODE_URL;
        
        // Initialize state wallet for signing
        const privateKey = config.privateKey || process.env.YELLOW_WALLET_PRIVATE_KEY;
        if (privateKey) {
            this.stateWallet = new ethers.Wallet(privateKey);
            console.log('[Yellow Network] Initialized with wallet:', this.stateWallet.address);
        } else {
            console.log('[Yellow Network] No wallet configured - running in demo mode');
        }
    }

    /**
     * Check if the service is available
     */
    isAvailable() {
        return this.clearNodeUrl && this.stateWallet;
    }

    /**
     * Message signer function for Nitrolite RPC
     */
    async messageSigner(payload) {
        if (!this.stateWallet) {
            throw new Error('State wallet not initialized');
        }

        try {
            const message = JSON.stringify(payload);
            const digestHex = ethers.id(message);
            const messageBytes = ethers.getBytes(digestHex);
            const { serialized: signature } = this.stateWallet.signingKey.sign(messageBytes);
            return signature;
        } catch (error) {
            console.error('[Yellow Network] Error signing message:', error);
            throw error;
        }
    }

    /**
     * Create a signed request following Nitrolite RPC format
     */
    async createSignedRequest(method, params = []) {
        if (!this.stateWallet) {
            throw new Error('State wallet not initialized');
        }

        const requestId = this.generateRequestId();
        const timestamp = Date.now();
        const requestData = [requestId, method, params, timestamp];
        const request = { req: requestData };

        // Sign the request
        const signature = await this.messageSigner(request);
        request.sig = [signature];

        return { request, requestId };
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return Math.floor(Math.random() * 1000000000);
    }

    /**
     * Connect to ClearNode
     */
    async connect() {
        if (!this.isAvailable()) {
            throw new Error('Yellow Network service not configured. Set YELLOW_CLEARNODE_URL and YELLOW_WALLET_PRIVATE_KEY');
        }

        // For demo purposes, simulate connection
        console.log('[Yellow Network] Connecting to ClearNode:', this.clearNodeUrl);
        this.isConnected = true;
        this.isAuthenticated = true;
        this.emit('connected');
        this.emit('authenticated');
        
        // In real implementation, this would:
        // 1. Create WebSocket connection
        // 2. Send auth_request message
        // 3. Handle auth_challenge
        // 4. Send auth_verify with EIP-712 signature
        // 5. Receive auth_success
        
        return {
            connected: true,
            authenticated: true,
            wallet: this.stateWallet.address
        };
    }

    /**
     * Disconnect from ClearNode
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.isAuthenticated = false;
        this.emit('disconnected');
        console.log('[Yellow Network] Disconnected from ClearNode');
    }

    /**
     * Get list of channels
     */
    async getChannels() {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated with ClearNode');
        }

        // Demo response - in real implementation this would:
        // 1. Create get_channels signed request
        // 2. Send via WebSocket
        // 3. Parse response
        return {
            channels: this.channels,
            count: this.channels.length
        };
    }

    /**
     * Get ledger balances for a participant
     */
    async getLedgerBalances(participant) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated with ClearNode');
        }

        // Demo response - shows sample balance structure
        return {
            participant,
            balances: [
                { asset: 'usdc', amount: '100.0' },
                { asset: 'eth', amount: '0.5' }
            ]
        };
    }

    /**
     * Create an application session
     */
    async createAppSession(params) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated with ClearNode');
        }

        const { participantA, participantB, amount } = params;

        // Generate app session ID
        const appSessionId = `app_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const session = {
            app_session_id: appSessionId,
            status: 'open',
            participants: [participantA, participantB],
            allocations: [
                { participant: participantA, asset: 'usdc', amount },
                { participant: participantB, asset: 'usdc', amount: '0' }
            ],
            created_at: new Date().toISOString()
        };

        this.sessions.push(session);

        console.log('[Yellow Network] Created app session:', appSessionId);

        return session;
    }

    /**
     * Get session details
     */
    async getSession(sessionId) {
        const session = this.sessions.find(s => s.app_session_id === sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        return session;
    }

    /**
     * Execute off-chain payment
     */
    async executePayment(params) {
        const { sessionId, from, to, asset, amount } = params;

        const payment = {
            id: `payment_${Date.now()}`,
            session_id: sessionId,
            from,
            to,
            asset,
            amount,
            status: 'completed',
            timestamp: new Date().toISOString()
        };

        console.log('[Yellow Network] Payment executed:', payment.id);

        return payment;
    }

    /**
     * Verify X-Yellow-Payment header
     * @param {string} xYellowPaymentHeader - Base64 encoded payment proof
     * @returns {Promise<{valid: boolean, amount?: string, sessionId?: string, paymentId?: string, error?: string}>}
     */
    async verifyPayment(xYellowPaymentHeader) {
        try {
            // Parse base64 header
            const paymentData = JSON.parse(Buffer.from(xYellowPaymentHeader, 'base64').toString());
            
            const { session_id, payment_id, from, to, amount, asset, timestamp } = paymentData;
            
            if (!session_id || !payment_id || !amount) {
                return { valid: false, error: 'Missing required payment fields' };
            }
            
            // Check if session exists
            const session = this.sessions.find(s => s.app_session_id === session_id);
            if (!session) {
                return { valid: false, error: 'Session not found' };
            }
            
            // Check if session is open
            if (session.status !== 'open') {
                return { valid: false, error: 'Session is not open' };
            }
            
            // In demo mode, validate basic structure
            // In production, would verify signature and check ClearNode state
            
            return {
                valid: true,
                amount,
                sessionId: session_id,
                paymentId: payment_id,
                from,
                to,
                asset: asset || 'usdc'
            };
        } catch (error) {
            console.error('[Yellow Network] Payment verification error:', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get or create session for agent
     * @param {string} agentAddress - Agent wallet address
     * @param {string} gatewayAddress - Gateway wallet address
     * @param {string} initialAmount - Initial allocation amount
     * @returns {Promise<Object>} Session object
     */
    async getOrCreateSessionForAgent(agentAddress, gatewayAddress, initialAmount = '1000000') {
        // Check if session already exists for this agent
        const existingSession = this.sessions.find(s => 
            s.participants.includes(agentAddress) && 
            s.participants.includes(gatewayAddress) &&
            s.status === 'open'
        );
        
        if (existingSession) {
            console.log('[Yellow Network] Reusing existing session:', existingSession.app_session_id);
            return existingSession;
        }
        
        // Create new session
        return await this.createAppSession({
            participantA: agentAddress,
            participantB: gatewayAddress,
            amount: initialAmount
        });
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            authenticated: this.isAuthenticated,
            clearNodeUrl: this.clearNodeUrl,
            wallet: this.stateWallet ? this.stateWallet.address : null,
            channels: this.channels.length,
            sessions: this.sessions.length
        };
    }
}

// Export singleton instance
const yellowNetworkService = new YellowNetworkService();

export default {
    initialize: (config) => yellowNetworkService.initialize(config),
    isAvailable: () => yellowNetworkService.isAvailable(),
    connect: () => yellowNetworkService.connect(),
    disconnect: () => yellowNetworkService.disconnect(),
    getChannels: () => yellowNetworkService.getChannels(),
    getLedgerBalances: (participant) => yellowNetworkService.getLedgerBalances(participant),
    createAppSession: (params) => yellowNetworkService.createAppSession(params),
    getSession: (sessionId) => yellowNetworkService.getSession(sessionId),
    executePayment: (params) => yellowNetworkService.executePayment(params),
    verifyPayment: (header) => yellowNetworkService.verifyPayment(header),
    getOrCreateSessionForAgent: (agentAddress, gatewayAddress, initialAmount) => yellowNetworkService.getOrCreateSessionForAgent(agentAddress, gatewayAddress, initialAmount),
    getStatus: () => yellowNetworkService.getStatus(),
    on: (event, callback) => yellowNetworkService.on(event, callback)
};
