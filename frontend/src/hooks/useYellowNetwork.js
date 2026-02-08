import { useState, useEffect, useCallback } from 'react';

/**
 * Custom React Hook for Yellow Network Integration
 * Manages connection state and provides methods for Yellow Network operations
 */
export function useYellowNetwork(backendUrl = 'http://localhost:3001') {
    const [status, setStatus] = useState({
        connected: false,
        authenticated: false,
        loading: true,
        error: null
    });

    const [channels, setChannels] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [balances, setBalances] = useState(null);

    // Fetch Yellow Network status
    const fetchStatus = useCallback(async () => {
        try {
            const response = await fetch(`${backendUrl}/yellow/status`);
            const data = await response.json();

            if (data.success) {
                setStatus({
                    connected: data.connected || false,
                    authenticated: data.authenticated || false,
                    loading: false,
                    error: null,
                    wallet: data.wallet,
                    clearNodeUrl: data.clearNodeUrl,
                    demo: data.demo
                });
            }
        } catch (error) {
            setStatus(prev => ({
                ...prev,
                loading: false,
                error: error.message
            }));
        }
    }, [backendUrl]);

    // Fetch channels
    const fetchChannels = useCallback(async () => {
        try {
            const response = await fetch(`${backendUrl}/yellow/channels`);
            const data = await response.json();

            if (data.success) {
                setChannels(data.channels || []);
            }
        } catch (error) {
            console.error('Error fetching channels:', error);
        }
    }, [backendUrl]);

    // Fetch ledger balances for a participant
    const fetchBalances = useCallback(async (participant) => {
        try {
            const response = await fetch(`${backendUrl}/yellow/balances/${participant}`);
            const data = await response.json();

            if (data.success) {
                setBalances(data.balances || []);
                return data.balances;
            }
        } catch (error) {
            console.error('Error fetching balances:', error);
            return null;
        }
    }, [backendUrl]);

    // Create application session
    const createSession = useCallback(async (participantA, participantB, amount = '0') => {
        try {
            const response = await fetch(`${backendUrl}/yellow/session/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantA, participantB, amount })
            });

            const data = await response.json();

            if (data.success) {
                // Refresh sessions list
                fetchSessions();
                return data.session;
            } else {
                throw new Error(data.error || 'Failed to create session');
            }
        } catch (error) {
            console.error('Error creating session:', error);
            throw error;
        }
    }, [backendUrl]);

    // Execute off-chain payment
    const executePayment = useCallback(async (sessionId, from, to, asset, amount) => {
        try {
            const response = await fetch(`${backendUrl}/yellow/payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, from, to, asset, amount })
            });

            const data = await response.json();

            if (data.success) {
                return data.payment;
            } else {
                throw new Error(data.error || 'Failed to execute payment');
            }
        } catch (error) {
            console.error('Error executing payment:', error);
            throw error;
        }
    }, [backendUrl]);

    // Fetch sessions history
    const fetchSessions = useCallback(async () => {
        try {
            const response = await fetch(`${backendUrl}/yellow/sessions`);
            const data = await response.json();

            if (data.success) {
                setSessions(data.sessions || []);
            }
        } catch (error) {
            console.error('Error fetching sessions:', error);
        }
    }, [backendUrl]);

    // Initial fetch on mount
    useEffect(() => {
        fetchStatus();
        fetchChannels();
        fetchSessions();

        // Poll for status updates every 10 seconds
        const interval = setInterval(() => {
            fetchStatus();
        }, 10000);

        return () => clearInterval(interval);
    }, [fetchStatus, fetchChannels, fetchSessions]);

    return {
        // State
        status,
        channels,
        sessions,
        balances,

        // Methods
        fetchStatus,
        fetchChannels,
        fetchBalances,
        createSession,
        executePayment,
        fetchSessions,

        // Helpers
        isConnected: status.connected,
        isAuthenticated: status.authenticated,
        isLoading: status.loading,
        error: status.error
    };
}

export default useYellowNetwork;
