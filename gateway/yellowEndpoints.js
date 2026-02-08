// Yellow Network Integration
// This file contains Yellow Network endpoint implementations
// Import and use in server.js

/**
 * Yellow Network endpoints to add to server.js
 */

// Get Yellow Network connection status
export const yellowStatus = (req, res) => {
    const status = yellowNetwork.getStatus();
    res.json({
        success: true,
        ...status,
        demo: !yellowNetwork.isAvailable()
    });
};

// List channels
export const yellowChannels = async (req, res) => {
    try {
        const result = await yellowNetwork.getChannels();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get ledger balances for a participant
export const yellowBalances = async (req, res) => {
    try {
        const { participant } = req.params;
        const result = await yellowNetwork.getLedgerBalances(participant);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Create application session
export const createYellowSession = async (req, res) => {
    try {
        const { participantA, participantB, amount } = req.body;

        if (!participantA || !participantB) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: participantA, participantB'
            });
        }

        const session = await yellowNetwork.createAppSession({
            participantA,
            participantB,
            amount: amount || '0'
        });

        // Save to database
        await saveYellowSession(session);

        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get session details
export const yellowSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await yellowNetwork.getSession(id);
        res.json({ success: true, session });
    } catch (error) {
        res.status(404).json({ success: false, error: 'Session not found' });
    }
};

// Execute off-chain payment
export const yellowPayment = async (req, res) => {
    try {
        const { sessionId, from, to, asset, amount } = req.body;

        if (!sessionId || !from || !to || !asset || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: sessionId, from, to, asset, amount'
            });
        }

        const payment = await yellowNetwork.executePayment({
            sessionId,
            from,
            to,
            asset,
            amount
        });

        // Save to database
        await saveYellowTransaction(payment);

        res.json({ success: true, payment });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get Yellow Network session history
export const yellowHistory = async (req, res) => {
    try {
        const sessions = await getYellowSessionHistory(50);
        res.json({ success: true, count: sessions.length, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


/**
 * Register these routes in server.js:
 * 
 * app.get('/yellow/status', yellowStatus);
 * app.get('/yellow/channels', yellowChannels);
 * app.get('/yellow/balances/:participant', yellowBalances);
 * app.post('/yellow/session/create', createYellowSession);
 * app.get('/yellow/session/:id', yellowSession);  
 * app.post('/yellow/payment', yellowPayment);
 * app.get('/yellow/sessions', yellowHistory);
 */
