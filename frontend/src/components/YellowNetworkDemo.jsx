import { useState } from 'react';
import useYellowNetwork from '../hooks/useYellowNetwork';
import './YellowNetworkDemo.css';

function YellowNetworkDemo() {
    const {
        status,
        channels,
        sessions,
        balances,
        isConnected,
        isAuthenticated,
        isLoading,
        fetchBalances,
        createSession,
        executePayment
    } = useYellowNetwork();

    const [participantA, setParticipantA] = useState('');
    const [participantB, setParticipantB] = useState('');
    const [sessionAmount, setSessionAmount] = useState('0');
    const [selectedSession, setSelectedSession] = useState(null);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentRecipient, setPaymentRecipient] = useState('');
    const [creating, setCreating] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [message, setMessage] = useState(null);

    const handleCreateSession = async (e) => {
        e.preventDefault();
        setCreating(true);
        setMessage(null);

        try {
            const session = await createSession(participantA, participantB, sessionAmount);
            setMessage({ type: 'success', text: `Session created: ${session.app_session_id}` });
            setParticipantA('');
            setParticipantB('');
            setSessionAmount('0');
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setCreating(false);
        }
    };

    const handleExecutePayment = async (e) => {
        e.preventDefault();
        if (!selectedSession) {
            setMessage({ type: 'error', text: 'Please select a session first' });
            return;
        }

        setExecuting(true);
        setMessage(null);

        try {
            const payment = await executePayment(
                selectedSession,
                status.wallet || '0x0000000000000000000000000000000000000000',
                paymentRecipient,
                'usdc',
                paymentAmount
            );
            setMessage({ type: 'success', text: `Payment executed: ${payment.id}` });
            setPaymentAmount('');
            setPaymentRecipient('');
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setExecuting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="yellow-network-demo">
                <div className="loading">Loading Yellow Network...</div>
            </div>
        );
    }

    return (
        <div className="yellow-network-demo">
            <header className="demo-header">
                <div className="yellow-branding">
                    <div className="yellow-logo">⚡ Yellow Network</div>
                    <span className="demo-badge">DEMO</span>
                </div>
                <p className="tagline">Off-Chain State Channels & Instant Settlements</p>
            </header>

            {/* Connection Status */}
            <section className="status-section">
                <h3>Connection Status</h3>
                <div className="status-grid">
                    <div className="status-item">
                        <span className="label">ClearNode</span>
                        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                            {isConnected ? '● Connected' : '○ Disconnected'}
                        </span>
                    </div>
                    <div className="status-item">
                        <span className="label">Authentication</span>
                        <span className={`status-indicator ${isAuthenticated ? 'connected' : 'disconnected'}`}>
                            {isAuthenticated ? '● Authenticated' : '○ Not Authenticated'}
                        </span>
                    </div>
                    {status.wallet && (
                        <div className="status-item">
                            <span className="label">Wallet</span>
                            <span className="value">{status.wallet.slice(0, 6)}...{status.wallet.slice(-4)}</span>
                        </div>
                    )}
                    {status.demo && (
                        <div className="status-item demo-mode">
                            <span className="label">Mode</span>
                            <span className="value">✨ Demo (Simulated)</span>
                        </div>
                    )}
                </div>
            </section>

            {/* Channel Information */}
            <section className="channels-section">
                <h3>State Channels ({channels.length})</h3>
                {channels.length === 0 ? (
                    <p className="empty-state">No active channels. Create a session to start.</p>
                ) : (
                    <div className="channels-list">
                        {channels.map((channel, idx) => (
                            <div key={idx} className="channel-card">
                                <div className="channel-info">
                                    <strong>Channel {idx + 1}</strong>
                                    <span className="channel-status">Active</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Create Session Form */}
            <section className="create-session-section">
                <h3>Create Application Session</h3>
                <form onSubmit={handleCreateSession} className="session-form">
                    <div className="form-group">
                        <label>Participant A (Your Address)</label>
                        <input
                            type="text"
                            value={participantA}
                            onChange={(e) => setParticipantA(e.target.value)}
                            placeholder="0x..."
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Participant B (Counterparty Address)</label>
                        <input
                            type="text"
                            value={participantB}
                            onChange={(e) => setParticipantB(e.target.value)}
                            placeholder="0x..."
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Initial Amount (USDC, with 6 decimals)</label>
                        <input
                            type="text"
                            value={sessionAmount}
                            onChange={(e) => setSessionAmount(e.target.value)}
                            placeholder="1000000"
                        />
                        <small>Example: 1000000 = 1 USDC</small>
                    </div>
                    <button type="submit" className="btn-primary" disabled={creating}>
                        {creating ? 'Creating...' : 'Create Session'}
                    </button>
                </form>
            </section>

            {/* Sessions List */}
            {sessions.length > 0 && (
                <section className="sessions-section">
                    <h3>Recent Sessions ({sessions.length})</h3>
                    <div className="sessions-list">
                        {sessions.slice(0, 5).map((session) => (
                            <div
                                key={session.session_id}
                                className={`session-card ${selectedSession === session.session_id ? 'selected' : ''}`}
                                onClick={() => setSelectedSession(session.session_id)}
                            >
                                <div className="session-header">
                                    <strong>{session.session_id}</strong>
                                    <span className={`session-status status-${session.status}`}>
                                        {session.status}
                                    </span>
                                </div>
                                <div className="session-participants">
                                    <div>A: {session.participant_a?.slice(0, 10)}...</div>
                                    <div>B: {session.participant_b?.slice(0, 10)}...</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Payment Form */}
            {selectedSession && (
                <section className="payment-section">
                    <h3>Execute Off-Chain Payment</h3>
                    <form onSubmit={handleExecutePayment} className="payment-form">
                        <div className="form-group">
                            <label>Session ID</label>
                            <input type="text" value={selectedSession} disabled />
                        </div>
                        <div className="form-group">
                            <label>Recipient Address</label>
                            <input
                                type="text"
                                value={paymentRecipient}
                                onChange={(e) => setPaymentRecipient(e.target.value)}
                                placeholder="0x..."
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Amount (USDC with 6 decimals)</label>
                            <input
                                type="text"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                                placeholder="100000"
                                required
                            />
                        </div>
                        <button type="submit" className="btn-primary" disabled={executing}>
                            {executing ? 'Executing...' : 'Execute Payment'}
                        </button>
                    </form>
                </section>
            )}

            {/* Message Display */}
            {message && (
                <div className={`message message-${message.type}`}>
                    {message.text}
                </div>
            )}

            {/* Features Highlight */}
            <section className="features-section">
                <h3>Why Yellow Network?</h3>
                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-icon">⚡</div>
                        <h4>Instant Settlements</h4>
                        <p>Off-chain state channels enable near-instant transaction finality</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">💰</div>
                        <h4>Low Costs</h4>
                        <p>Reduce gas fees with off-chain payment processing</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">🔒</div>
                        <h4>Secure</h4>
                        <p>EIP-712 signatures and cryptographic proofs ensure security</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">🌐</div>
                        <h4>Decentralized</h4>
                        <p>Connect to ClearNodes across the Yellow Network mesh</p>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default YellowNetworkDemo;
