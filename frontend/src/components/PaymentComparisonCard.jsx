import './PaymentComparisonCard.css';

function PaymentComparisonCard({ paymentMethod, apiPrice, gasSaved, timeSavedMs }) {
    if (!paymentMethod || paymentMethod === 'arc_network') {
        return null; // Only show when Yellow was used
    }

    const arcGas = 0.001;
    const arcTime = 1500; // ms
    const yellowTime = Math.max(100, arcTime - (timeSavedMs || 0));
    
    const arcTotal = apiPrice + arcGas;
    const yellowTotal = apiPrice;
    const totalSavings = arcTotal - yellowTotal;
    const savingsPercent = ((totalSavings / arcTotal) * 100).toFixed(1);
    const speedup = (arcTime / yellowTime).toFixed(1);

    return (
        <div className="payment-comparison-card">
            <h3 className="comparison-title">💰 Cost Savings Analysis</h3>
            
            <div className="comparison-grid">
                {/* Arc Network Column */}
                <div className="comparison-column arc-column">
                    <div className="column-header">
                        <span className="column-icon">🔗</span>
                        <span className="column-title">Arc Network Only</span>
                    </div>
                    <div className="cost-breakdown">
                        <div className="cost-item">
                            <span className="cost-label">API Call</span>
                            <span className="cost-value">${apiPrice.toFixed(3)}</span>
                        </div>
                        <div className="cost-item">
                            <span className="cost-label">Gas Fee</span>
                            <span className="cost-value">${arcGas.toFixed(3)}</span>
                        </div>
                        <div className="cost-item total">
                            <span className="cost-label">Total Cost</span>
                            <span className="cost-value">${arcTotal.toFixed(3)}</span>
                        </div>
                        <div className="cost-item">
                            <span className="cost-label">Est. Time</span>
                            <span className="cost-value">~{arcTime}ms</span>
                        </div>
                    </div>
                </div>

                {/* Yellow Network Column */}
                <div className="comparison-column yellow-column active">
                    <div className="column-header">
                        <span className="column-icon">⚡</span>
                        <span className="column-title">Yellow + x402</span>
                        <span className="used-badge">Used</span>
                    </div>
                    <div className="cost-breakdown">
                        <div className="cost-item">
                            <span className="cost-label">API Call</span>
                            <span className="cost-value">${apiPrice.toFixed(3)}</span>
                        </div>
                        <div className="cost-item highlight">
                            <span className="cost-label">Gas Fee</span>
                            <span className="cost-value free">$0.000</span>
                        </div>
                        <div className="cost-item total">
                            <span className="cost-label">Total Cost</span>
                            <span className="cost-value">${yellowTotal.toFixed(3)}</span>
                        </div>
                        <div className="cost-item highlight">
                            <span className="cost-label">Actual Time</span>
                            <span className="cost-value">{yellowTime}ms</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Savings Summary */}
            <div className="savings-summary">
                <div className="savings-item">
                    <span className="savings-icon">💵</span>
                    <div className="savings-content">
                        <span className="savings-label">Gas Saved</span>
                        <span className="savings-value">${gasSaved || arcGas.toFixed(3)}</span>
                    </div>
                </div>
                <div className="savings-item">
                    <span className="savings-icon">📊</span>
                    <div className="savings-content">
                        <span className="savings-label">Savings</span>
                        <span className="savings-value">{savingsPercent}%</span>
                    </div>
                </div>
                <div className="savings-item">
                    <span className="savings-icon">⚡</span>
                    <div className="savings-content">
                        <span className="savings-label">Speedup</span>
                        <span className="savings-value">{speedup}x</span>
                    </div>
                </div>
            </div>

            <p className="comparison-note">
                Yellow Network's off-chain state channels enable instant, gasless payments.
                Agents save on every transaction while maintaining security.
            </p>
        </div>
    );
}

export default PaymentComparisonCard;
