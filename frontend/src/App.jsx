import { useState, useEffect } from 'react'
import './App.css'
import { useWallet } from './hooks/useWallet'
import YellowNetworkDemo from './components/YellowNetworkDemo'
import YellowNetworkView from './components/YellowNetworkView';
import PaymentComparisonCard from './components/PaymentComparisonCard';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  const [currentView, setCurrentView] = useState('landing');
  const [apis, setApis] = useState([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [totalCalls, setTotalCalls] = useState(0);

  const [regForm, setRegForm] = useState({
    name: '',
    targetUrl: '',
    pricePerCall: '0.01',
    ownerWallet: ''
  });

  const [selectedApi, setSelectedApi] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);

  // Agent Demo State
  const [agentTask, setAgentTask] = useState('');
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentResult, setAgentResult] = useState(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [useHybridMode, setUseHybridMode] = useState(true); // Yellow Network preference

  // Wallet Connection
  const wallet = useWallet();

  // Demo Wallet (server-side Circle wallet)
  const [demoWallet, setDemoWallet] = useState(null);

  // Transaction History (SQLite persistence)
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [dbStats, setDbStats] = useState(null);

  // Provider Scoring Stats
  const [providerStats, setProviderStats] = useState({});

  // Spending Limits
  const [spendingLimits, setSpendingLimits] = useState(null);

  // Yellow Network Stats
  const [yellowStats, setYellowStats] = useState(null);

  useEffect(() => {
    fetchApis();
    fetchDemoWallet();
    fetchTransactionHistory();
    fetchProviderStats();
    fetchSpendingLimits();
    fetchYellowStats();
  }, []);

  const fetchProviderStats = async () => {
    try {
      const res = await fetch(`${API_URL}/providers/stats`);
      const data = await res.json();
      if (data.providers) {
        setProviderStats(data.providers);
      }
    } catch (e) {
      console.log('Provider stats not available');
    }
  };

  const fetchYellowStats = async () => {
    try {
      const res = await fetch(`${API_URL}/yellow/stats`);
      const data = await res.json();
      if (data.success) {
        setYellowStats(data);
      }
    } catch (e) {
      console.log('Yellow stats not available');
    }
  };

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

  const fetchTransactionHistory = async () => {
    try {
      const [historyRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/transactions/history?limit=50`),
        fetch(`${API_URL}/db/stats`)
      ]);
      const historyData = await historyRes.json();
      const statsData = await statsRes.json();
      setTransactionHistory(historyData.transactions || []);
      setDbStats(statsData.database || null);
    } catch (e) {
      console.log('Transaction history not available');
    }
  };

  const fetchApis = async () => {
    try {
      const res = await fetch(`${API_URL}/api/list`);
      const data = await res.json();
      const apiList = data.apis || [];
      setApis(apiList);
      setTotalEarnings(apiList.reduce((sum, a) => sum + a.totalEarnings, 0));
      setTotalCalls(apiList.reduce((sum, a) => sum + a.totalCalls, 0));
    } catch (e) {
      console.error('Failed to fetch APIs:', e);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regForm)
    });
    const data = await res.json();
    if (data.success) {
      setRegForm({ name: '', targetUrl: '', pricePerCall: '0.01', ownerWallet: '' });
      fetchApis();
      setCurrentView('apis');
    }
  };

  const handleDemo = async (e) => {
    e.preventDefault();
    if (!selectedApi) return;
    setLoading(true);
    setResponse(null);

    const initialRes = await fetch(`${API_URL}/proxy/${selectedApi.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (initialRes.status === 402) {
      setTimeout(async () => {
        const payment = {
          amount: selectedApi.pricePerCall,
          wallet: '0x' + Math.random().toString(16).slice(2, 42),
          txHash: 'arc:0x' + Math.random().toString(16).slice(2, 66)
        };

        const paidRes = await fetch(`${API_URL}/proxy/${selectedApi.id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payment': btoa(JSON.stringify(payment))
          },
          body: JSON.stringify({ prompt })
        });

        const result = await paidRes.json();
        setResponse({ payment, data: result });
        fetchApis();
        setLoading(false);
      }, 1500);
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
          await sleep(400); // Slightly slower for dramatic effect
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
          agent: data.agent
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
              <span className="logo-icon">A</span>
              <span className="logo-text">Arcent</span>
            </div>
            <p className="footer-tagline">
              API marketplace for autonomous agents. Built on Arc Network with USDC.
            </p>
            <div className="footer-tech">
              <span>Arc</span>
              <span>USDC</span>
              <span>Circle</span>
              <span>x402</span>
            </div>
          </div>
          <div className="footer-nav">
            <div className="footer-col">
              <h4>Product</h4>
              <a onClick={() => setCurrentView('landing')}>Home</a>
              <a onClick={() => setCurrentView('register')}>Register API</a>
              <a onClick={() => setCurrentView('agent')}>Agent Demo</a>
              <a onClick={() => setCurrentView('docs')}>Documentation</a>
            </div>
            <div className="footer-col">
              <h4>Resources</h4>
              <a href="https://www.x402.org/" target="_blank" rel="noopener noreferrer">x402 Protocol</a>
              <a href="https://www.arc.network/" target="_blank" rel="noopener noreferrer">Arc Network</a>
              <a href="https://www.circle.com/" target="_blank" rel="noopener noreferrer">Circle</a>
              <a href="https://developers.circle.com/" target="_blank" rel="noopener noreferrer">Circle Developers</a>
              <a href="https://github.com/ArcAgents/arcent" target="_blank" rel="noopener noreferrer">GitHub</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>Open source project for Agentic Commerce on Arc Hackathon</p>
        </div>
      </div>
    </footer>
  );

  const Header = () => (
    <header className="header">
      <div className="header-inner">
        <div className="logo" onClick={() => setCurrentView('landing')} style={{ cursor: 'pointer' }}>
          <span className="logo-icon">A</span>
          <span className="logo-text">Arcent</span>
        </div>
        <nav className="nav">
          <button className={`nav-btn ${currentView === 'landing' ? 'active' : ''}`} onClick={() => setCurrentView('landing')}>Home</button>
          <button className={`nav-btn ${currentView === 'agent' ? 'active' : ''}`} onClick={() => setCurrentView('agent')}>Agent Demo</button>
          <button className={`nav-btn ${currentView === 'yellow' ? 'active' : ''}`} onClick={() => setCurrentView('yellow')}>Yellow Network</button>
          <button className={`nav-btn ${currentView === 'providers' ? 'active' : ''}`} onClick={() => setCurrentView('providers')}>Providers</button>
          <button className={`nav-btn ${currentView === 'docs' ? 'active' : ''}`} onClick={() => setCurrentView('docs')}>How It Works</button>
          <button className={`nav-btn ${currentView === 'history' ? 'active' : ''}`} onClick={() => { setCurrentView('history'); fetchTransactionHistory(); }}>History</button>
        </nav>
        <div className="wallet-section">
          {wallet.isConnected ? (
            <div className="wallet-connected">
              {!wallet.isArcNetwork && (
                <button className="btn-network" onClick={() => {
                  console.log('Add button clicked!');
                  wallet.addArcNetwork();
                }}>
                  Add Arc Testnet
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
          )}
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
              <span className="hero-label">First x402 Implementation on Arc</span>
              <h1>Agentic Commerce</h1>
              <p className="hero-text">
                AI agents that autonomously pay for API access. No human intervention.
                Agent analyzes tasks, makes payment decisions, and executes real
                USDC transactions on Arc Network. Gasless, sub-second finality.
              </p>
              <div className="hero-tech-stack">
                <span className="tech-item">x402 Protocol</span>
                <span className="tech-divider">·</span>
                <span className="tech-item">Arc Network</span>
                <span className="tech-divider">·</span>
                <span className="tech-item">Circle Wallets</span>
                <span className="tech-divider">·</span>
                <span className="tech-item">Gemini AI</span>
              </div>
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={() => setCurrentView('agent')}>
                  Try Agent Demo
                </button>
                <button className="btn btn-secondary" onClick={() => setCurrentView('docs')}>
                  How It Works
                </button>
              </div>
            </div>
          </section>
          {/* Problem / Solution Callout */}
          <section className="ps-callout">
            <div className="container">
              <blockquote className="ps-quote">
                <p className="ps-problem">
                  AI agents can't have bank accounts. They can't pass KYC. The internet economy was built for humans.
                </p>
                <p className="ps-answer">
                  Arcent changes that. No credit cards. No subscriptions. Just code and money.
                </p>
              </blockquote>
            </div>
          </section>

          {/* Value Props */}
          <section className="section">
            <div className="container">
              <div className="value-props">
                <div className="value-prop">
                  <h3>Multi-Provider Network</h3>
                  <p className="value-lead">One protocol, multiple service providers.</p>
                  <p>
                    Arcent operates a network of x402-compliant nodes. Each node provides
                    specialized services: AI reasoning, market data, environmental data, and more.
                    Agents route tasks to the optimal provider automatically.
                  </p>
                  <p>
                    All payments settle on Arc Network in USDC. Sub-second finality,
                    gasless transactions, and atomic settlement ensure secure commerce.
                  </p>
                  <button className="btn btn-primary" onClick={() => setCurrentView('providers')}>
                    View Active Nodes
                  </button>
                </div>
                <div className="value-prop">
                  <h3>Atomic Settlement</h3>
                  <p className="value-lead">No Service? No Pay.</p>
                  <p>
                    Traditional APIs charge upfront. With Arcent, payment is held until
                    the service confirms success. If the API fails or returns an error,
                    no payment is released. Your funds are protected.
                  </p>
                  <p>
                    This service-first architecture aligns incentives: providers only earn
                    when they deliver value. Agents only pay for results they can use.
                  </p>
                  <button className="btn btn-primary" onClick={() => setCurrentView('agent')}>
                    Try Agent Demo
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* How It Works */}
          <section className="section section-alt">
            <div className="container">
              <div className="section-header">
                <h2>How Arcent Works</h2>
                <p>x402 protocol enables native HTTP payments with Atomic Settlement on Arc Network.</p>
              </div>

              <div className="how-it-works">
                <div className="how-step">
                  <div className="how-num">1</div>
                  <div>
                    <h4>Agent Analyzes Task</h4>
                    <p>
                      Agent receives a task and uses AI reasoning to determine the optimal service provider.
                      Multi-provider routing selects between AI, financial data, or utility nodes based on task requirements.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">2</div>
                  <div>
                    <h4>Gateway Returns 402</h4>
                    <p>
                      The x402 protocol uses HTTP status code 402 "Payment Required" to signal payment terms.
                      Response includes exact USDC amount and recipient wallet address on Arc Network.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">3</div>
                  <div>
                    <h4>Agent Signs Payment</h4>
                    <p>
                      Circle Wallet programmatically signs a USDC transfer. Transaction confirms on Arc
                      in under 1 second with fees under $0.001. No human intervention required.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">4</div>
                  <div>
                    <h4>Service Execution</h4>
                    <p>
                      Agent retries with X-Payment header containing the transaction hash. Gateway verifies
                      on-chain payment and forwards request to the service provider.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-num">5</div>
                  <div>
                    <h4>Atomic Settlement</h4>
                    <p>
                      Service executes and returns results. Payment only settles if service succeeds.
                      Failed or errored calls release no funds. Agents pay only for working results.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Use Cases */}
          <section className="section">
            <div className="container">
              <div className="section-header">
                <h2>Active Provider Network</h2>
                <p>Three specialized nodes powering autonomous commerce.</p>
              </div>

              <div className="use-cases-list">
                <div className="use-case-item">
                  <h4>AI Reasoning</h4>
                  <p>
                    LLM powered translation, summarization, and sentiment analysis.
                    Agents pay per task, from $0.005 for simple queries to $0.02
                    for complex reasoning.
                  </p>
                </div>
                <div className="use-case-item">
                  <h4>Market Data</h4>
                  <p>
                    Real time cryptocurrency prices from CoinGecko.
                    Bitcoin, Ethereum, and more at $0.005 per query.
                    No API keys, no rate limits.
                  </p>
                </div>
                <div className="use-case-item">
                  <h4>Environmental Data</h4>
                  <p>
                    Global weather information for any city.
                    Temperature, humidity, forecasts at $0.002 per query.
                    Agents access utility services on demand.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Why Arc */}
          <section className="section section-alt">
            <div className="container">
              <div className="explain-block">
                <h2>Built on Arc Network</h2>
                <p>
                  Arc is Circle's Layer-1 blockchain, purpose-built for stablecoin finance.
                  USDC is the native gas token, which means no separate token to manage.
                  You hold USDC, you can transact. Transaction finality is under one second.
                  Network fees are typically under $0.001, making true micropayments viable.
                </p>
                <p style={{ marginTop: '1rem' }}>
                  Circle Wallets provide developer-controlled wallets that agents can use
                  programmatically. Combined with x402, this creates a complete stack for
                  machine-to-machine payments. Developers earn with zero payment infrastructure.
                  Agents pay without human intervention.
                </p>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="cta-section">
            <div className="container">
              <h2>Experience Agentic Commerce</h2>
              <p>
                Watch an autonomous agent pay for real API services using x402 micropayments.
              </p>
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={() => setCurrentView('agent')}>
                  Try Agent Demo
                </button>
                <button className="btn btn-secondary" onClick={() => setCurrentView('providers')}>
                  View Providers
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
              <h1 className="page-title">x402 Payment Demo</h1>
              <p className="page-subtitle">
                First x402 implementation on Arc Network with Atomic Settlement
              </p>
            </div>

            {/* Architecture Note */}
            <div className="info-callout">
              <strong>Atomic Settlement</strong> — The executor holds payment signatures until service delivery is confirmed.
              If the API fails, no payment is executed. Users are fully protected. All transactions are gasless for the agent.
            </div>

            {/* x402 Flow - 2x2 Grid */}
            <div className="flow-2x2">
              <div className="flow-row">
                <div className="flow-box">
                  <div className="box-number">1</div>
                  <h4>Task Analysis</h4>
                  <p>Agent receives a task and determines which external API is needed to complete it.</p>
                </div>
                <div className="flow-box">
                  <div className="box-number">2</div>
                  <h4>HTTP 402 Response</h4>
                  <p>API returns "Payment Required" with the USDC amount and recipient wallet.</p>
                </div>
              </div>

              <div className="flow-row">
                <div className="flow-box">
                  <div className="box-number">3</div>
                  <h4>Service Execution</h4>
                  <p>Agent signs authorization. Executor holds payment while API delivers result first.</p>
                </div>
                <div className="flow-box success">
                  <div className="box-number">4</div>
                  <h4>Settlement</h4>
                  <p>Service success confirmed. USDC payment released to Arc Network. Gasless.</p>
                </div>
              </div>
            </div>

            {/* Agent Demo Card */}
            <div className="card demo-card">
              <div className="card-header demo-header">
                <div className="demo-agent-info">
                  <span className="demo-agent-icon">⬡</span>
                  <div>
                    <span className="demo-agent-name">Arcent Demo Agent</span>
                    <span className="demo-agent-status">
                      {agentRunning ? 'Processing task...' : 'Ready to execute'}
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
                    <span className="demo-wallet-note">Pre-funded for demo. Connect your wallet coming soon.</span>
                    <button className="btn-add-funds" disabled>+ Add Funds <span className="soon-tag">Soon</span></button>
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
                        Use Yellow Network when available
                        <span className="toggle-badge">Instant & Gasless</span>
                      </span>
                    </label>
                    <p className="hybrid-toggle-note">
                      {useHybridMode 
                        ? 'Agent will use Yellow Network for instant, zero-gas payments when possible' 
                        : 'Agent will use Arc Network on-chain payments only'}
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
                    placeholder="Example: Translate 'Hello, how are you?' to Spanish&#10;&#10;The agent will find an appropriate API, handle the x402 payment automatically, and return the result."
                    disabled={agentRunning}
                    rows={4}
                  />
                  <div className="demo-actions">
                    <button
                      className="btn btn-primary btn-large"
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
            {spendingLimits && (
              <div className="card spending-limits-card">
                <div className="card-header">
                  <span className="card-title">Spending Controls</span>
                  <span className="limits-configurable">Configurable</span>
                </div>
                <div className="card-body spending-limits-body">
                  <div className="limits-grid">
                    {/* Daily */}
                    <div className="limit-item">
                      <div className="limit-header">
                        <span className="limit-label">Daily</span>
                        <span className="limit-values">
                          {spendingLimits.currentSpending?.daily} / {spendingLimits.limits?.daily}
                        </span>
                      </div>
                      <div className="limit-bar-container">
                        <div
                          className={`limit-bar ${parseFloat(spendingLimits.percentUsed?.daily) > 80 ? 'limit-high' : ''}`}
                          style={{ width: spendingLimits.percentUsed?.daily || '0%' }}
                        />
                      </div>
                      <span className="limit-remaining">
                        {spendingLimits.remaining?.daily} remaining
                      </span>
                    </div>

                    {/* Weekly */}
                    <div className="limit-item">
                      <div className="limit-header">
                        <span className="limit-label">Weekly</span>
                        <span className="limit-values">
                          {spendingLimits.currentSpending?.weekly} / {spendingLimits.limits?.weekly}
                        </span>
                      </div>
                      <div className="limit-bar-container">
                        <div
                          className={`limit-bar ${parseFloat(spendingLimits.percentUsed?.weekly) > 80 ? 'limit-high' : ''}`}
                          style={{ width: spendingLimits.percentUsed?.weekly || '0%' }}
                        />
                      </div>
                      <span className="limit-remaining">
                        {spendingLimits.remaining?.weekly} remaining
                      </span>
                    </div>

                    {/* Monthly */}
                    <div className="limit-item">
                      <div className="limit-header">
                        <span className="limit-label">Monthly</span>
                        <span className="limit-values">
                          {spendingLimits.currentSpending?.monthly} / {spendingLimits.limits?.monthly}
                        </span>
                      </div>
                      <div className="limit-bar-container">
                        <div
                          className={`limit-bar ${parseFloat(spendingLimits.percentUsed?.monthly) > 80 ? 'limit-high' : ''}`}
                          style={{ width: spendingLimits.percentUsed?.monthly || '0%' }}
                        />
                      </div>
                      <span className="limit-remaining">
                        {spendingLimits.remaining?.monthly} remaining
                      </span>
                    </div>
                  </div>

                  <div className="limits-footer">
                    <span className="limits-rate">
                      Rate: {spendingLimits.limits?.rateLimit}
                    </span>
                    <span className="limits-note">
                      Limits configurable via environment variables
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Process Log */}
            {agentSteps.length > 0 && (
              <div className="card process-card">
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
                  <div className="card-body terminal-body">
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
                                  {step.type === 'payment_success' && ' [1 Block Confirmation]'}
                                </span>
                              )}
                              {step.data.model && (
                                <span className="terminal-metric">[{step.data.model}]</span>
                              )}
                              {step.data.blockNumber && (
                                <span className="terminal-metric">Block #{step.data.blockNumber}</span>
                              )}
                              {step.data.executorBalance && (
                                <span className="terminal-metric">Executor: {step.data.executorBalance}</span>
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
              <div className={`card result-card ${agentResult.rejected ? 'rejected' : ''}`}>
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
                                <span className="badge badge-arc">
                                  🔗 Arc Network
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="payment-row">
                            <span className="payment-label">Network</span>
                            <span className="payment-value">{agentResult.network || 'Arc Testnet'}</span>
                          </div>
                          {agentResult.gasless && (
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
                              className="btn btn-secondary"
                            >
                              View on Arc Explorer →
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

  // Transaction History Page
  if (currentView === 'history') {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="page-container page-container-wide">
            <div className="page-header">
              <h1 className="page-title">Transaction History</h1>
              <p className="page-subtitle">Embedded SQL Persistence — All transactions auditable across restarts</p>
            </div>

            {/* Database Stats Banner */}
            {dbStats && (
              <div className="db-stats-banner">
                <div className="db-stat">
                  <span className="db-stat-label">Persistence</span>
                  <span className="db-stat-value">Embedded SQL</span>
                </div>
                <div className="db-stat">
                  <span className="db-stat-label">Total Transactions</span>
                  <span className="db-stat-value">{dbStats.transactions}</span>
                </div>
                <div className="db-stat">
                  <span className="db-stat-label">Tracked Providers</span>
                  <span className="db-stat-value">{dbStats.providers}</span>
                </div>
              </div>
            )}

            {/* Transaction Table */}
            <section className="history-section">
              <h2>Payment Audit Trail</h2>
              <p className="demo-agent-note">Showing transactions for the demo agent wallet. In production, each agent views only their own transaction history.</p>
              {transactionHistory.length === 0 ? (
                <div className="empty-history">
                  <p>No transactions yet. Run an agent task to create payment history.</p>
                  <button className="btn btn-primary" onClick={() => setCurrentView('agent')}>
                    Try Agent Demo
                  </button>
                </div>
              ) : (
                <div className="transaction-table-wrapper">
                  <table className="transaction-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Provider</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Latency</th>
                        <th>Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactionHistory.map((tx, idx) => (
                        <tr key={idx}>
                          <td>{new Date(tx.timestamp).toLocaleString()}</td>
                          <td><span className="provider-badge">{tx.provider}</span></td>
                          <td className="amount">${tx.amount}</td>
                          <td>
                            <span className={`status-badge status-${tx.status}`}>
                              {tx.status}
                            </span>
                          </td>
                          <td>{tx.latency_ms ? `${tx.latency_ms}ms` : '-'}</td>
                          <td>
                            {tx.tx_hash ? (
                              <a
                                href={`https://testnet.arcscan.app/tx/${tx.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="tx-link"
                              >
                                {tx.tx_hash.slice(0, 10)}...
                              </a>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Persistence Info */}
            <section className="doc-section">
              <h2>Why Embedded SQL?</h2>
              <p>
                Arcent uses embedded SQL persistence to store transaction history and provider reliability metrics.
                This ensures agent decisions remain auditable across restarts.
              </p>
              <ul>
                <li><strong>Deterministic transaction history</strong> — Every payment is recorded</li>
                <li><strong>Restart-safe agent memory</strong> — Provider scores persist</li>
                <li><strong>Zero infrastructure overhead</strong> — No external database required</li>
              </ul>
            </section>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Docs Page
  if (currentView === 'docs') {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="page-container page-container-wide">
            <div className="page-header">
              <h1 className="page-title">Documentation</h1>
              <p className="page-subtitle">Complete guide to integrating with Arcent</p>
            </div>

            {/* Overview */}
            <section className="doc-section">
              <h2>Overview</h2>
              <p>
                Arcent is the first x402 implementation on Arc Network. It enables autonomous agents
                to pay for API access programmatically using USDC micropayments. Developer registration
                to monetize APIs is coming soon. The system uses Circle Wallets for secure agent identity.
              </p>
              <p>
                The x402 protocol leverages HTTP status code 402 "Payment Required", which was reserved
                for digital payments since the HTTP specification was written in the 1990s but never
                widely implemented. With blockchain-based stablecoins and fast finality chains like Arc,
                the infrastructure finally exists to make this standard practical.
              </p>
            </section>

            {/* Atomic Settlement */}
            <section className="doc-section">
              <h2>Atomic Settlement</h2>
              <p>
                Arcent implements Atomic Settlement - a service-first payment architecture that protects
                agents from paying for failed services. Unlike traditional APIs that charge upfront,
                Arcent holds payment until service delivery is confirmed.
              </p>

              <h3>How It Works</h3>
              <ol>
                <li><strong>Service Call</strong>: Agent requests a service from a network node</li>
                <li><strong>Execution</strong>: Node processes the request and returns results</li>
                <li><strong>Validation</strong>: System checks if the response indicates success</li>
                <li><strong>Settlement</strong>: Payment released only if service succeeded</li>
              </ol>

              <h3>Error Protection</h3>
              <p>
                If a service returns an error, fails to process, or returns a fallback response,
                no payment is executed. The agent's funds remain protected. This aligns incentives:
                providers only earn when they deliver working results.
              </p>
            </section>

            {/* Multi-Provider Network */}
            <section className="doc-section">
              <h2>Network Providers</h2>
              <p>
                Arcent operates a network of x402-compliant service nodes, each specializing in
                different capabilities. Currently active providers:
              </p>
              <ul>
                <li><strong>LLM-Reasoning-01</strong>: AI-powered text processing (translation, summarization, sentiment analysis)</li>
                <li><strong>Oracle-Price-Feed</strong>: Real-time cryptocurrency prices from CoinGecko</li>
                <li><strong>Meteorology-Relay</strong>: Global weather data from wttr.in</li>
              </ul>
              <p>
                The agent automatically routes tasks to the optimal provider based on the request content.
                Each provider has different pricing based on computational complexity.
              </p>

              <h3>Becoming a Provider (Coming Soon)</h3>
              <p>
                Soon developers will be able to register their own x402-compliant endpoints and receive
                USDC payments directly from agents. Registration is currently in Private Beta.
              </p>
            </section>

            {/* For Agent Builders */}
            <section className="doc-section">
              <h2>For Agent Builders</h2>

              <h3>Enabling Your Agent to Pay</h3>
              <p>
                To enable your autonomous agent to pay for API access, you need to integrate a Circle Wallet
                and implement x402 payment handling. This gives your agent economic autonomy.
              </p>

              <h4>Step 1: Create a Circle Wallet</h4>
              <p>
                Use Circle's Developer Console to create a developer-controlled wallet. This wallet type
                allows your application to sign transactions programmatically without user interaction.
                Fund the wallet with USDC on Arc (testnet for development, mainnet for production).
              </p>
              <p>
                Circle Wallets: <a href="https://developers.circle.com/w3s/programmable-wallets" target="_blank" rel="noopener noreferrer">developers.circle.com/w3s/programmable-wallets</a>
              </p>

              <h4>Step 2: Handle 402 Responses</h4>
              <p>
                When your agent calls an x402-enabled API without payment, it receives an HTTP 402 response
                with a JSON body containing payment requirements:
              </p>

              <div className="code-block">
                <pre>{`HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402": {
    "version": "1.0",
    "amount": "0.01",
    "currency": "USDC",
    "network": "arc",
    "payTo": "0x742d35Cc6634C0532925a3b844Bc9e7595f...",
    "validFor": 300
  },
  "message": "Payment required to access this resource"
}`}</pre>
              </div>

              <h4>Step 3: Sign Payment</h4>
              <p>
                Parse the payment requirements and use the Circle Wallet SDK to sign a USDC transfer to the
                specified address. Wait for transaction confirmation (under 1 second on Arc).
              </p>

              <h4>Step 4: Retry with Payment Proof</h4>
              <p>
                Send the original request again with an X-Payment header containing the transaction hash:
              </p>

              <div className="code-block">
                <pre>{`X-Payment: {"txHash": "arc:0x...", "network": "arc"}`}</pre>
              </div>

              <h3>Example Implementation</h3>
              <div className="code-block">
                <pre>{`async function callWithPayment(url, payload) {
  // First attempt without payment
  let response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  // Handle 402 Payment Required
  if (response.status === 402) {
    const requirements = await response.json();
    
    // Sign payment with Circle Wallet
    const tx = await circleWallet.transfer({
      to: requirements.x402.payTo,
      amount: requirements.x402.amount,
      currency: 'USDC',
      network: 'arc'
    });
    
    // Wait for confirmation
    await tx.waitForConfirmation();
    
    // Retry with payment proof
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': JSON.stringify({ 
          txHash: tx.hash,
          network: 'arc'
        })
      },
      body: JSON.stringify(payload)
    });
  }
  
  return response.json();
}`}</pre>
              </div>

              <h3>Budget Management</h3>
              <p>
                Consider implementing spending limits in your agent logic. Track cumulative spending,
                set per-transaction limits, and alert when the wallet balance is low. The Circle API
                provides balance queries and transaction history.
              </p>
            </section>

            {/* Technical Reference */}
            <section className="doc-section">
              <h2>Technical Reference</h2>

              <h3>x402 Protocol</h3>
              <p>
                x402 is an open standard for HTTP-based micropayments. It extends the HTTP protocol
                to support native payments without external payment processors. The protocol is
                designed to be simple, stateless, and compatible with existing HTTP infrastructure.
              </p>
              <p>
                Full specification: <a href="https://www.x402.org/" target="_blank" rel="noopener noreferrer">x402.org</a>
              </p>

              <h3>Arc Network</h3>
              <p>
                Arc is Circle's Layer-1 blockchain, purpose-built for stablecoin finance. Key characteristics:
              </p>
              <ul>
                <li><strong>Native USDC</strong>: USDC is the gas token, no separate native token needed</li>
                <li><strong>Sub-second finality</strong>: Transactions confirm in under 1 second</li>
                <li><strong>Low fees</strong>: Typical transaction costs under $0.001</li>
                <li><strong>EVM compatible</strong>: Works with existing Ethereum tooling</li>
              </ul>
              <p>
                Arc documentation: <a href="https://www.arc.network/" target="_blank" rel="noopener noreferrer">arc.network</a>
              </p>

              <h3>Circle Wallets</h3>
              <p>
                Circle provides two wallet types relevant to Arcent:
              </p>
              <ul>
                <li><strong>User-Controlled Wallets</strong>: End users own the keys. Good for human users.</li>
                <li><strong>Developer-Controlled Wallets</strong>: Your application owns the keys. Required for agents.</li>
              </ul>
              <p>
                For autonomous agents, use Developer-Controlled Wallets. These allow your code to sign
                transactions without user interaction, which is essential for autonomous operation.
              </p>
              <p>
                Circle Developer Portal: <a href="https://developers.circle.com/" target="_blank" rel="noopener noreferrer">developers.circle.com</a>
              </p>

              <h3>USDC on Arc</h3>
              <p>
                USDC (USD Coin) is a regulated, dollar-backed stablecoin. 1 USDC equals 1 USD. On Arc,
                USDC is the native gas token, simplifying transactions since you only need to hold one asset.
                For development, use Arc testnet USDC. For production, use mainnet USDC.
              </p>

              <h3>Security Considerations</h3>
              <ul>
                <li><strong>Payment replay</strong>: Track used transaction hashes to prevent replay attacks</li>
                <li><strong>Amount verification</strong>: Always verify payment amount matches requirements</li>
                <li><strong>Rate limiting</strong>: Implement rate limits to prevent abuse</li>
                <li><strong>Wallet security</strong>: Secure your Circle API credentials appropriately</li>
              </ul>
            </section>

            {/* Resources */}
            <section className="doc-section">
              <h2>Resources</h2>
              <ul className="resource-list">
                <li><a href="https://www.x402.org/" target="_blank" rel="noopener noreferrer">x402 Protocol Specification</a></li>
                <li><a href="https://www.arc.network/" target="_blank" rel="noopener noreferrer">Arc Network Overview</a></li>
                <li><a href="https://developers.circle.com/" target="_blank" rel="noopener noreferrer">Circle Developer Documentation</a></li>
                <li><a href="https://developers.circle.com/w3s/programmable-wallets" target="_blank" rel="noopener noreferrer">Circle Programmable Wallets</a></li>
                <li><a href="https://www.circle.com/usdc" target="_blank" rel="noopener noreferrer">USDC Documentation</a></li>
              </ul>
            </section>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Dashboard
  if (currentView === 'dashboard') {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="page-container">
            <div className="page-header">
              <h1 className="page-title">Dashboard</h1>
              <p className="page-subtitle">Monitor your API performance and earnings</p>
            </div>

            <div className="content-block">
              <p>
                This dashboard shows real-time statistics for all your registered APIs. Every payment
                that comes through Arcent is recorded here. When an agent pays to access your API,
                the call count increments and the corresponding USDC amount is added to your earnings.
              </p>
              <p>
                Payments are sent directly to your wallet on each successful call. The earnings shown
                here are already in your possession. Use the My APIs page to see individual
                API performance and manage your endpoints.
              </p>
            </div>

            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-label">Registered APIs</div>
                <div className="stat-value">{apis.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total API Calls</div>
                <div className="stat-value">{totalCalls}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Earnings</div>
                <div className="stat-value">${totalEarnings.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Average per Call</div>
                <div className="stat-value">${totalCalls ? (totalEarnings / totalCalls).toFixed(3) : '0.00'}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Your APIs</span>
                <button className="btn-small" onClick={() => setCurrentView('register')}>Add API</button>
              </div>
              {apis.length === 0 ? (
                <div className="card-body">
                  <div className="empty-state">
                    <div className="empty-title">No APIs registered</div>
                    <div className="empty-text">
                      Register your first API to start receiving payments from agents.
                    </div>
                    <button className="btn btn-primary" onClick={() => setCurrentView('register')}>
                      Register API
                    </button>
                  </div>
                </div>
              ) : (
                <div className="api-grid">
                  {apis.map(api => (
                    <div key={api.id} className="api-card">
                      <div className="api-card-header">
                        <span className="api-name">{api.name}</span>
                        <span className="api-category">{api.category || 'general'}</span>
                      </div>
                      {api.description && (
                        <p className="api-description">{api.description}</p>
                      )}
                      <div className="api-card-stats">
                        <div className="api-stat">
                          <span className="api-stat-value">${api.pricePerCall}</span>
                          <span className="api-stat-label">per call</span>
                        </div>
                        <div className="api-stat">
                          <span className="api-stat-value">{api.totalCalls}</span>
                          <span className="api-stat-label">calls</span>
                        </div>
                        <div className="api-stat">
                          <span className="api-stat-value">${api.totalEarnings?.toFixed(2) || '0.00'}</span>
                          <span className="api-stat-label">earned</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // APIs List
  // Active Network Nodes Page
  if (currentView === 'providers') {
    const nodes = [
      {
        name: 'LLM-Reasoning-01',
        type: 'Generative AI',
        backing: 'Google Gemini Flash',
        status: 'ONLINE',
        capabilities: ['Translation', 'Summarization', 'Sentiment Analysis', 'General Reasoning'],
        cost: '$0.005 - $0.02',
        costNote: 'Dynamic pricing based on task complexity',
        description: 'Large language model for complex reasoning, content generation, and natural language processing tasks.',
        testPrompt: "Summarize the benefits of blockchain technology",
        color: '#1f6feb',
        statsKey: 'general'
      },
      {
        name: 'Oracle-Price-Feed',
        type: 'Financial Data',
        backing: 'CoinGecko API',
        status: 'ONLINE',
        capabilities: ['Crypto Prices', 'Market Cap', '24h Price Changes'],
        cost: '$0.005',
        costNote: 'Per query',
        description: 'Real-time cryptocurrency price oracle with market data from leading exchanges.',
        testPrompt: "What is the current Bitcoin price?",
        color: '#f7931a',
        statsKey: 'crypto'
      },
      {
        name: 'Meteorology-Relay',
        type: 'Environmental Data',
        backing: 'wttr.in',
        status: 'ONLINE',
        capabilities: ['Current Weather', 'Temperature', 'Humidity', 'Wind Speed'],
        cost: '$0.002',
        costNote: 'Per query',
        description: 'Global weather data relay providing real-time meteorological information for any location.',
        testPrompt: "What's the weather in New York?",
        color: '#00b4d8',
        statsKey: 'weather'
      }
    ];

    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="page-container">
            <div className="page-header">
              <h1 className="page-title">Active Network Nodes</h1>
              <p className="page-subtitle">
                Live x402-compliant endpoints operated by Arcent Foundation. All payments settle on Arc Network.
              </p>
            </div>

            <div className="providers-grid">
              {nodes.map((node, i) => (
                <div key={i} className="provider-card">
                  <div className="provider-header" style={{ borderLeftColor: node.color }}>
                    <div className="provider-info">
                      <div className="provider-name-row">
                        <h3 className="provider-name">{node.name}</h3>
                        <span className="status-badge status-online">{node.status}</span>
                      </div>
                      <span className="provider-type">{node.type}</span>
                    </div>
                  </div>
                  <div className="provider-body">
                    <p className="provider-description">{node.description}</p>
                    <div className="provider-details">
                      <div className="provider-detail-row">
                        <span className="detail-label">Backing:</span>
                        <span className="detail-value">{node.backing}</span>
                      </div>
                      <div className="provider-detail-row">
                        <span className="detail-label">Cost:</span>
                        <span className="detail-value cost-value">{node.cost}</span>
                        <span className="cost-note">{node.costNote}</span>
                      </div>
                    </div>
                    <div className="provider-services">
                      {node.capabilities.map((cap, j) => (
                        <span key={j} className="service-tag">{cap}</span>
                      ))}
                    </div>
                    {providerStats[node.statsKey] && (
                      <div className="provider-reliability">
                        <div className="reliability-header">Reliability Metrics</div>
                        <div className="reliability-stats">
                          <div className="reliability-stat">
                            <span className="stat-label">Success Rate</span>
                            <span className="stat-value">{providerStats[node.statsKey].successRate}</span>
                          </div>
                          <div className="reliability-stat">
                            <span className="stat-label">Avg Latency</span>
                            <span className="stat-value">{providerStats[node.statsKey].avgLatency}</span>
                          </div>
                          <div className="reliability-stat">
                            <span className="stat-label">Total Calls</span>
                            <span className="stat-value">{providerStats[node.statsKey].success + providerStats[node.statsKey].failure}</span>
                          </div>
                          <div className="reliability-stat">
                            <span className="stat-label">Score</span>
                            <span className="stat-value score-value">{providerStats[node.statsKey].score}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="provider-footer">
                    <button
                      className="btn btn-test-node"
                      onClick={() => {
                        setAgentTask(node.testPrompt);
                        setCurrentView('agent');
                      }}
                    >
                      Test Node
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Become a Provider Section */}
            <div className="coming-soon-section">
              <div className="coming-soon-card">
                <h3>Become a Network Provider</h3>
                <p>
                  Register your own x402-compliant endpoints and receive USDC payments directly from autonomous agents.
                  Connect your wallet, deploy your API, and start earning.
                </p>
                <p className="fomo-text">
                  Join the waitlist to monetize your APIs on the first autonomous agent marketplace.
                </p>
                <button className="btn btn-disabled" disabled>
                  Register Provider
                </button>
                <span className="coming-soon-badge">Private Beta</span>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Register - Coming Soon
  if (currentView === 'register') {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="page-container">
            <div className="page-header">
              <h1 className="page-title">Register Provider</h1>
              <p className="page-subtitle">Monetize your API with x402 micropayments</p>
            </div>

            <div className="coming-soon-section" style={{ marginTop: '2rem' }}>
              <div className="coming-soon-card">
                <h3>Provider Registration</h3>
                <p>
                  Soon you'll be able to register your own x402-compliant endpoints and receive
                  USDC payments directly from autonomous agents. Connect your wallet, deploy your API,
                  and start earning.
                </p>
                <button className="btn btn-disabled" disabled>
                  Register Provider
                </button>
                <span className="coming-soon-badge">Private Beta</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <button className="btn btn-secondary" onClick={() => setCurrentView('providers')}>
                View Active Nodes
              </button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (currentView === 'yellow') {
    return <YellowNetworkView Header={Header} Footer={Footer} />;
  }

  // Default fallback
  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="page-container">
          <div className="page-header">
            <h1 className="page-title">Welcome to Arcent</h1>
          </div>
          <p>Select a page from the navigation above.</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default App
