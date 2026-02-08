import { useState, useEffect } from 'react'
import './App.css'
import { useWallet } from './hooks/useWallet'
import PaymentComparisonCard from './components/PaymentComparisonCard';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  const [currentView, setCurrentView] = useState('landing');

  // Agent Demo State
  const [agentTask, setAgentTask] = useState('');
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentResult, setAgentResult] = useState(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [useHybridMode, setUseHybridMode] = useState(true); // Yellow Network preference

  // Wallet Connection
  const wallet = useWallet();

  // Demo Wallet (server-side wallet)
  const [demoWallet, setDemoWallet] = useState(null);

  // Spending Limits
  const [spendingLimits, setSpendingLimits] = useState(null);

  useEffect(() => {
    fetchDemoWallet();
    fetchSpendingLimits();
  }, []);

  const fetchDemoWallet = async () => {
    try {
      const res = await fetch(`${API_URL}/agent/wallet`);
      const data = await res.json();
      if (data.available && data.wallet) {
        setDemoWallet(data.wallet);
      }
    } catch (e) {
      console.log('Demo wallet not available');
    }
  };

  const fetchSpendingLimits = async () => {
    try {
      const res = await fetch(`${API_URL}/agent/limits`);
      const data = await res.json();
      if (data.limits) {
        setSpendingLimits(data);
      }
    } catch (e) {
      console.log('Spending limits not available');
    }
  };

  // Agent Demo Handler - uses x402 agentic payments
  const runAgent = async (customTask) => {
    const taskToRun = customTask || agentTask;
    if (!taskToRun.trim()) return;

    if (customTask) setAgentTask(customTask);

    setAgentRunning(true);
    setAgentSteps([]);
    setAgentResult(null);

    try {
      // Call the agentic x402 endpoint
      const response = await fetch(`${API_URL}/agent/x402`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskToRun,
          budget: 1.0, // $1 USDC budget for agent
          preferYellow: useHybridMode
        })
      });

      const data = await response.json();

      if (data.success) {
        // Animate each step
        for (const step of data.steps) {
          setAgentSteps(prev => [...prev, {
            type: step.type,
            text: step.message,
            data: step.data,
            time: new Date(step.timestamp).toLocaleTimeString()
          }]);
          await sleep(400);
        }

        // Show final result
        setAgentResult({
          task: data.result.task,
          result: data.result.output,
          paid: data.result.paid,
          amount: data.result.amount,
          txHash: data.result.txHash,
          explorerUrl: data.result.explorerUrl,
          network: data.result.network,
          isReal: data.result.isReal,
          paymentMethod: data.result.paymentMethod,
          savingsEstimate: data.result.savingsEstimate,
          agent: data.result.agent
        });
      } else {
        // Handle rejection or error
        for (const step of (data.steps || [])) {
          setAgentSteps(prev => [...prev, {
            type: step.type,
            text: step.message,
            data: step.data,
            time: new Date(step.timestamp).toLocaleTimeString()
          }]);
          await sleep(300);
        }

        if (data.result?.reason) {
          setAgentResult({
            task: data.result.task,
            rejected: true,
            reason: data.result.reason
          });
        }
      }
    } catch (error) {
      setAgentSteps(prev => [...prev, {
        type: 'error',
        text: `Error: ${error.message}`,
        time: new Date().toLocaleTimeString()
      }]);
    }

    setAgentRunning(false);
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Footer Component
  const Footer = () => (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="footer-logo">
              <span className="logo-icon">X</span>
              <span className="logo-text">yellowX</span>
            </div>
            <p className="footer-tagline">
              x402 payments for autonomous agents, powered by Yellow Network
            </p>
    
          </div>
          <div className="footer-nav">
            <div className="footer-col">
              <h4>Product</h4>
              <a onClick={() => setCurrentView('landing')}>Home</a>
              <a onClick={() => setCurrentView('agent')}>Agent Demo</a>
            </div>
            <div className="footer-col">
              <h4>Resources</h4>
              <a href="https://www.x402.org/" target="_blank" rel="noopener noreferrer">x402 Protocol</a>
              <a href="https://yellow.org/" target="_blank" rel="noopener noreferrer">Yellow Network</a>
            </div>
          </div>
        </div>
        
      </div>
    </footer>
  );

  const Header = () => (
    <header className="header">
      <div className="header-inner">
        <div className="logo" onClick={() => setCurrentView('landing')}>
          <span className="logo-icon">X</span>
          <span className="logo-text">yellowX</span>
        </div>
        <nav className="nav">
          <button className={`nav-btn ${currentView === 'landing' ? 'active' : ''}`} onClick={() => setCurrentView('landing')}>Home</button>
          <button className={`nav-btn ${currentView === 'agent' ? 'active' : ''}`} onClick={() => setCurrentView('agent')}>Agent Demo</button>
        </nav>
        <div className="wallet-section">
          {/* {wallet.isConnected ? (
            <div className="wallet-connected">
              {!wallet.isArcNetwork && (
                <button className="btn-network" onClick={() => {
                  wallet.addArcNetwork();
                }}>
                  Add Testnet
                </button>
              )}
              <div className="wallet-balance">
                <span className="balance-amount">${wallet.balance?.toFixed(2) || '0.00'}</span>
                <span className="balance-label">USDC</span>
              </div>
              <button className="wallet-address" onClick={wallet.disconnect}>
                {wallet.shortAddress}
              </button>
            </div>
          ) : (
            <div className="wallet-coming-soon">
              <span className="wallet-btn-disabled">Connect Wallet</span>
              <span className="wallet-coming-badge">Soon</span>
            </div>
          )} */}
        </div>
      </div>
    </header>
  );

  // Landing Page
  if (currentView === 'landing') {
    return (
      <div className="app">
        <Header />
        <main className="main">
          {/* Hero */}
          <section className="hero">
            <div className="container">
              <span className="hero-label">Powered by Yellow Network</span>
              <h1>Instant x402 Payments for AI Agents</h1>
              <p className="hero-text">
                Autonomous agents that pay for APIs instantly. Zero gas fees. Sub-second finality.
                Built on Yellow Network's state channels for true agent autonomy.
              </p>
              <div className="hero-tech-stack">
                <span className="tech-item">x402 Protocol</span>
                <span className="tech-divider">·</span>
                <span className="tech-item">Yellow Network</span>
                <span className="tech-divider">·</span>
                <span className="tech-item">USDC</span>
                <span className="tech-divider">·</span>
                <span className="tech-item">Gemini AI</span>
              </div>
              <div className="hero-actions">
                <button className="neobrutalism-btn" onClick={() => setCurrentView('agent')}>
                  Try Agent Demo
                </button>
              </div>
            </div>
          </section>

          {/* Problem / Solution Callout */}
          <section className="ps-callout">
            <div className="container">
              <blockquote className="ps-quote">
                <p className="ps-problem">
                  Traditional payment rails are too slow and expensive for autonomous agents.
                  Agents need instant, gasless payments to operate at scale.
                </p>
                <p className="ps-answer">
                  Yellow Network changes that. State channels enable instant settlement.
                  Zero gas fees. Built for machines.
                </p>
              </blockquote>
            </div>
          </section>

          {/* Why Yellow Network */}
          <section className="section">
            <div className="container">
              <div className="section-header">
                <h2>Why Yellow Network?</h2>
                <p>Purpose-built for autonomous agent commerce</p>
              </div>
              <div className="value-props">
                <div className="neobrutalism-card p-8">
                  <h3>Instant Settlement</h3>
                  <p className="value-lead">Sub-second payments via state channels</p>
                  <p>
                    Yellow Network's off-chain state channels enable instant payment settlement.
                    No waiting for block confirmations. Agents execute tasks and pay instantly.
                    Perfect for micropayments and high-frequency API calls.
                  </p>
                </div>
                <div className="neobrutalism-card p-8">
                  <h3>Zero Gas Fees</h3>
                  <p className="value-lead">100% of payment reaches service providers</p>
                  <p>
                    Traditional blockchain payments incur gas fees. Yellow Network state channels
                    eliminate gas entirely. Agents pay exactly what the API costs—nothing more.
                    Makes micropayments economically viable.
                  </p>
                </div>
              </div>
              <div className="value-props mt-8">
                <div className="neobrutalism-card p-8">
                  <h3>Atomic Settlement</h3>
                  <p className="value-lead">No service? No payment.</p>
                  <p>
                    Payment is held until service confirms success. If the API fails or returns
                    an error, no payment is released. Your funds are protected. Service-first
                    architecture aligns incentives between agents and providers.
                  </p>
                </div>
                <div className="neobrutalism-card p-8">
                  <h3>x402 Native</h3>
                  <p className="value-lead">HTTP payments that just work</p>
                  <p>
                    x402 extends HTTP with native payment support. Agents detect 402 responses,
                    authorize payments via Yellow Network, and retry with proof—all automatically.
                    No complex integrations. Just HTTP.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* How It Works */}
          <section className="section section-alt">
            <div className="container">
              <div className="section-header">
                <h2>How yellowX Works</h2>
                <p>x402 protocol + Yellow Network state channels</p>
              </div>

              <div className="how-it-works">
                <div className="how-step">
                  <div className="how-num">1</div>
                  <div>
                    <h4>Agent Analyzes Task</h4>
                    <p>
                      Agent receives a task and uses AI reasoning to determine which service is needed.
                      Routes to optimal provider automatically.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">2</div>
                  <div>
                    <h4>Service Returns 402</h4>
                    <p>
                      x402 protocol returns HTTP 402 "Payment Required" with exact USDC amount
                      and Yellow Network payment channel details.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">3</div>
                  <div>
                    <h4>Instant Payment via Yellow</h4>
                    <p>
                      Agent authorizes payment through Yellow Network state channel. Settlement
                      happens instantly—no gas fees, no block wait. Sub-second confirmation.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">4</div>
                  <div>
                    <h4>Service Execution</h4>
                    <p>
                      Service executes and returns results. Payment only settles if service succeeds.
                      Failed calls release no funds. Agents pay only for working results.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="cta-section">
            <div className="container">
              <h2>Experience Instant Agent Payments</h2>
              <p>
                Watch an autonomous agent pay for API services using Yellow Network.
              </p>
              <div className="hero-actions">
                <button className="neobrutalism-btn" onClick={() => setCurrentView('agent')}>
                  Try Agent Demo
                </button>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  // Agent Demo Page
  if (currentView === 'agent') {
    const exampleTasks = [
      "What is the current Bitcoin price?",
      "What's the weather in New York?",
      "Translate 'Hello world' to Spanish",
      "Summarize the benefits of blockchain"
    ];

    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="page-container">

            {/* Page Header */}
            <div className="page-header">
              <h1 className="page-title">x402 on Yellow Network</h1>
              <p className="page-subtitle">
                Instant, gasless agent payments with atomic settlement
              </p>
            </div>

            {/* Architecture Note */}
            <div className="info-callout">
              <strong>Yellow Network State Channels</strong> — Payments settle instantly off-chain with zero gas fees.
              On-chain settlement only happens when channels close. Perfect for autonomous agents.
            </div>

            {/* x402 Flow - 2x2 Grid */}
            <div className="flow-2x2">
              <div className="flow-row">
                <div className="flow-box">
                  <div className="box-number">1</div>
                  <h4>Task Analysis</h4>
                  <p>Agent receives task and determines which API is needed to complete it.</p>
                </div>
                <div className="flow-box">
                  <div className="box-number">2</div>
                  <h4>HTTP 402 Response</h4>
                  <p>API returns "Payment Required" with USDC amount and Yellow Network channel.</p>
                </div>
              </div>

              <div className="flow-row">
                <div className="flow-box">
                  <div className="box-number">3</div>
                  <h4>Yellow Network Payment</h4>
                  <p>Agent authorizes payment via state channel. Instant, gasless settlement.</p>
                </div>
                <div className="flow-box success">
                  <div className="box-number">4</div>
                  <h4>Service Execution</h4>
                  <p>Service confirms success. Payment released. Agent receives result.</p>
                </div>
              </div>
            </div>

            {/* Agent Demo Card */}
            <div className="neobrutalism-card demo-card">
              <div className="card-header demo-header">
                <div className="demo-agent-info">
                  <span className="demo-agent-icon">⬡</span>
                  <div>
                    <span className="demo-agent-name">yellowX Demo Agent</span>
                    <span className="demo-agent-status">
                      {agentRunning ? 'Processing on Yellow Network...' : 'Ready to execute'}
                    </span>
                  </div>
                </div>
                {demoWallet && (
                  <div className="demo-wallet-info">
                    <div className="demo-wallet-row">
                      <span className="demo-wallet-label">Demo Agent</span>
                      <span className="demo-wallet-amount">
                        ${parseFloat(demoWallet.balance).toFixed(2)} <small>USDC</small>
                      </span>
                    </div>
                    <span className="demo-wallet-note">Pre-funded for demo</span>
                    {/* <button className="btn-add-funds" disabled>+ Add Funds <span className="soon-tag">Soon</span></button> */}
                  </div>
                )}
              </div>

              <div className="card-body demo-body">
                {/* Hybrid Mode Toggle */}
                <div className="hybrid-mode-section">
                  <div className="hybrid-toggle-container">
                    <label className="hybrid-toggle-label">
                      <input
                        type="checkbox"
                        checked={useHybridMode}
                        onChange={(e) => setUseHybridMode(e.target.checked)}
                        disabled={agentRunning}
                      />
                      <span className="hybrid-toggle-text">
                        <span className="toggle-icon">⚡</span>
                        Use Yellow Network for instant payments
                        <span className="toggle-badge">Recommended</span>
                      </span>
                    </label>
                    <p className="hybrid-toggle-note">
                      {useHybridMode 
                        ? 'Agent will use Yellow Network for instant, zero-gas payments' 
                        : 'Agent will use on-chain payments (slower, gas fees apply)'}
                    </p>
                  </div>
                </div>

                <div className="demo-input-section">
                  <label className="demo-label">
                    Give the agent a task that requires an API call
                  </label>
                  <textarea
                    className="demo-textarea"
                    value={agentTask}
                    onChange={(e) => setAgentTask(e.target.value)}
                    placeholder="Example: What's the current price of Bitcoin?&#10;&#10;The agent will find the right API, handle Yellow Network payments automatically, and return the result."
                    disabled={agentRunning}
                    rows={4}
                  />
                  <div className="demo-actions">
                    <button
                      className="neobrutalism-btn btn-large"
                      onClick={() => runAgent()}
                      disabled={agentRunning || !agentTask.trim()}
                    >
                      {agentRunning ? 'Agent Working...' : 'Execute Task'}
                    </button>
                  </div>
                </div>

                <div className="demo-examples">
                  <span className="demo-examples-label">Try an example:</span>
                  <div className="demo-examples-grid">
                    {exampleTasks.map((task, i) => (
                      <button
                        key={i}
                        className="demo-example-btn"
                        onClick={() => setAgentTask(task)}
                        disabled={agentRunning}
                      >
                        {task}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Spending Limits Card */}
           

            {/* Agent Process Log */}
            {agentSteps.length > 0 && (
              <div className="neobrutalism-card process-card">
                <div
                  className="card-header process-header"
                  onClick={() => setThinkingExpanded(!thinkingExpanded)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="card-title terminal-title">System Terminal</span>
                  <div className="process-header-right">
                    <span className="step-count">{agentSteps.length} logs</span>
                    <span className="expand-toggle">{thinkingExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {thinkingExpanded && (
                  <div className="terminal-body">
                    {agentSteps.map((step, i) => {
                      const timestamp = step.time || '--:--:--';
                      const level = step.type === 'payment_success' ? 'SUCCESS' :
                        step.type === 'error' ? 'ERROR' :
                          step.type === 'ai_thinking' ? 'AGENT' :
                            step.type === 'preflight' ? 'CHECK' :
                              step.type === 'settling' ? 'TX' : 'INFO';
                      return (
                        <div key={i} className={`terminal-line ${step.type}`}>
                          <span className="terminal-time">[{timestamp}]</span>
                          <span className={`terminal-level level-${level.toLowerCase()}`}>{level}</span>
                          <span className="terminal-msg">{step.message || step.text}</span>
                          {step.data && (
                            <div className="terminal-details">
                              {step.data.reasoning && (
                                <div className="terminal-reasoning">&gt;&gt; REASONING: {step.data.reasoning}</div>
                              )}
                              {step.data.latencyMs && (
                                <span className="terminal-metric">
                                  {step.data.latencyMs}ms
                                </span>
                              )}
                              {step.data.model && (
                                <span className="terminal-metric">[{step.data.model}]</span>
                              )}
                              {step.data.txHash && (
                                <a
                                  href={step.data.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="terminal-tx-link"
                                >
                                  TX: {step.data.txHash.slice(0, 10)}...
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Result Card */}
            {agentResult && (
              <div className={`neobrutalism-card result-card ${agentResult.rejected ? 'rejected' : ''}`}>
                <div className="card-header">
                  <span className="card-title">
                    {agentResult.rejected ? 'Payment Declined' : 'Task Completed'}
                  </span>
                  {agentResult.isReal && <span className="badge badge-success">Real Transaction</span>}
                </div>
                <div className="card-body">
                  <div className="result-section">
                    <label>Task</label>
                    <p>{agentResult.task}</p>
                  </div>

                  {agentResult.rejected ? (
                    <div className="result-section">
                      <label>Reason</label>
                      <p className="rejection-reason">{agentResult.reason}</p>
                    </div>
                  ) : (
                    <>
                      <div className="result-section">
                        <label>Result</label>
                        <div className="result-output">
                          {typeof agentResult.result === 'string'
                            ? agentResult.result
                            : JSON.stringify(agentResult.result, null, 2)}
                        </div>
                      </div>

                      {agentResult.paid && (
                        <div className="result-payment">
                          <div className="payment-row">
                            <span className="payment-label">Amount Paid</span>
                            <span className="payment-value">{agentResult.amount} USDC</span>
                          </div>
                          <div className="payment-row">
                            <span className="payment-label">Payment Method</span>
                            <span className="payment-value">
                              {agentResult.paymentMethod === 'yellow_network' ? (
                                <span className="badge badge-yellow">
                                  ⚡ Yellow Network
                                </span>
                              ) : (
                                <span className="badge badge-onchain">
                                  🔗 On-chain
                                </span>
                              )}
                            </span>
                          </div>
                          {/* <div className="payment-row">
                            <span className="payment-label">Network</span>
                            <span className="payment-value">{agentResult.network || 'Testnet'}</span>
                          </div> */}
                          {agentResult.paymentMethod === 'yellow_network' && (
                            <div className="payment-row highlight">
                              <span className="payment-label">Gas Fee</span>
                              <span className="payment-value">$0.000 (Gasless)</span>
                            </div>
                          )}
                        </div>
                      )}

                      {agentResult.txHash && (
                        <div className="result-tx">
                          <label>Transaction</label>
                          <code className="tx-hash">{agentResult.txHash}</code>
                          {agentResult.explorerUrl && (
                            <a
                              href={agentResult.explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="neobrutalism-btn neobrutalism-btn-secondary"
                            >
                              View on Explorer →
                            </a>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Payment Comparison Card - Show when Yellow was used */}
            {agentResult && agentResult.paymentMethod === 'yellow_network' && agentResult.savingsEstimate && (
              <PaymentComparisonCard
                paymentMethod={agentResult.paymentMethod}
                apiPrice={parseFloat(agentResult.amount?.replace('$', '') || '0')}
                gasSaved={agentResult.savingsEstimate.gasSaved}
                timeSavedMs={agentResult.savingsEstimate.timeSavedMs}
              />
            )}

          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Default fallback
  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="page-container">
          <div className="page-header">
            <h1 className="page-title">Welcome to yellowX</h1>
          </div>
          <p>Select a page from the navigation above.</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default App
