import { useState, useEffect, useCallback } from 'react'
import PerformanceSummary from './components/PerformanceSummary'
import MarketIndicator from './components/MarketIndicator'
import HoldingsTable from './components/HoldingsTable'
import OptionsTable from './components/OptionsTable'
import AdminPanel from './components/AdminPanel'
import { getHoldings, getTrades, getOptionsTrades } from './lib/supabase'
import { fetchAllMarketData, fetchVIX, fetchYtdPrice, fetchQuotes } from './lib/massive'
import { calcPortfolioReturn } from './lib/calculations'
import './styles/dashboard.css'

// Sample data used when Supabase is not configured
const SAMPLE_HOLDINGS = [
  { id: '1', symbol: 'RF', company_name: 'Regions Financial Corp', entry_price: 26.47, shares: 100, allocation_pct: 4, entry_date: '2026-04-02', is_active: true },
  { id: '2', symbol: 'STT', company_name: 'State Street Corp', entry_price: 128.80, shares: 50, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '3', symbol: 'ED', company_name: 'Consolidated Edison Inc', entry_price: 115.43, shares: 55, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '4', symbol: 'AEP', company_name: 'American Electric Power Company Inc', entry_price: 132.68, shares: 48, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '5', symbol: 'PLD', company_name: 'Prologis Inc', entry_price: 133.77, shares: 47, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '6', symbol: 'DBC', company_name: 'Invesco DB Commodity Index Tracking Fund', entry_price: 29.33, shares: 215, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '7', symbol: 'USO', company_name: 'United States Oil Fund LP', entry_price: 137.92, shares: 46, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '8', symbol: 'GLW', company_name: 'Corning Inc', entry_price: 147.92, shares: 43, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '9', symbol: 'STX', company_name: 'Seagate Technology Holdings PLC', entry_price: 429.36, shares: 15, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '10', symbol: 'XLE', company_name: 'State Street Energy Select Sector SPDR ETF', entry_price: 59.25, shares: 107, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '11', symbol: 'TRGP', company_name: 'Targa Resources Corp', entry_price: 244.39, shares: 26, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
  { id: '12', symbol: 'ATO', company_name: 'Atmos Energy Corp', entry_price: 188.97, shares: 34, allocation_pct: 8, entry_date: '2026-04-02', is_active: true },
]

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'admin123'

export default function App() {
  const [holdings, setHoldings] = useState([])
  const [trades, setTrades] = useState([])
  const [optionsTrades, setOptionsTrades] = useState([])
  const [quotes, setQuotes] = useState({})
  const [smas, setSmas] = useState({})
  const [ytdPrices, setYtdPrices] = useState({})
  const [vixLevel, setVixLevel] = useState(null)
  const [benchmarkYtd, setBenchmarkYtd] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdmin, setShowAdmin] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')

  const loadData = useCallback(async () => {
    try {
      // Step 1: Load holdings from Supabase (fast) — then show the page
      const dbHoldings = await getHoldings()
      const activeHoldings = dbHoldings.length > 0 ? dbHoldings : SAMPLE_HOLDINGS
      setHoldings(activeHoldings)

      const [dbTrades, dbOptions] = await Promise.all([
        getTrades(),
        getOptionsTrades()
      ])
      setTrades(dbTrades)
      setOptionsTrades(dbOptions)
      setLoading(false) // Show page immediately with holdings

      // Step 2: Load VIX immediately (separate fast endpoint)
      const symbols = activeHoldings.map(h => h.symbol)
      fetchVIX().then(v => setVixLevel(v?.level)).catch(() => {})

      // Step 3: Load all quotes + SMAs in one serverless call
      try {
        const marketData = await fetchAllMarketData(symbols)
        setQuotes(marketData.quotes)
        setSmas(marketData.smas)
      } catch (apiErr) {
        console.warn('Market data API unavailable:', apiErr.message)
      }

      // Step 4: YTD prices sequentially
      try {
        const ytdMap = {}
        for (const sym of symbols) {
          try {
            const json = await fetchYtdPrice(sym)
            if (json.price) ytdMap[sym] = json.price
          } catch { /* skip */ }
        }
        setYtdPrices(ytdMap)

        // SPY benchmark
        try {
          const spyYtd = await fetchYtdPrice('SPY')
          const spyQuote = await fetchQuotes(['SPY'])
          if (spyYtd.price && spyQuote.SPY?.price) {
            setBenchmarkYtd(((spyQuote.SPY.price - spyYtd.price) / spyYtd.price) * 100)
          }
        } catch { /* skip */ }
      } catch (ytdErr) {
        console.warn('YTD data unavailable:', ytdErr.message)
      }
    } catch (err) {
      console.error('Error loading data:', err)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  function handleAdminLogin(e) {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
      setShowAdmin(true)
    } else {
      alert('Incorrect password')
    }
    setPassword('')
  }

  function handleAdminToggle() {
    if (isAuthenticated) {
      setShowAdmin(true)
    } else {
      setShowAdmin('login')
    }
  }

  const portfolioReturn = calcPortfolioReturn(holdings, quotes)

  // Calculate YTD return for the portfolio
  let portfolioYtd = 0
  if (Object.keys(ytdPrices).length > 0 && Object.keys(quotes).length > 0) {
    let totalYtdBase = 0
    let totalCurrent = 0
    for (const h of holdings) {
      const ytdBase = ytdPrices[h.symbol] ?? h.entry_price
      const current = quotes[h.symbol]?.price ?? h.entry_price
      totalYtdBase += h.shares * ytdBase
      totalCurrent += h.shares * current
    }
    if (totalYtdBase > 0) {
      portfolioYtd = ((totalCurrent - totalYtdBase) / totalYtdBase) * 100
    }
  }

  const startDate = holdings.length > 0
    ? (() => {
        const dates = holdings.map(h => h.entry_date || '2026-04-02').sort()
        const [y, m, d] = dates[0].split('-').map(Number)
        const dt = new Date(y, m - 1, d) // local date, no UTC shift
        return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      })()
    : null

  if (loading) {
    return (
      <div className="app-container">
        <div className="loading">Loading portfolio data...</div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* Header */}
      <div className="header">
        <div className="logo-area">
          <div>
            <div className="brand-name">
              B<span className="stars">&#9733;&#9733;&#9733;&#9733;</span>est
              <span className="of"> <i>of</i> </span>Us
            </div>
            <div className="brand-sub">Investors</div>
          </div>
        </div>
        <h1>Trent's XII</h1>
      </div>

      {/* Top Row */}
      <div className="top-row">
        <PerformanceSummary
          portfolioReturn={portfolioReturn}
          ytdReturn={portfolioYtd}
          benchmarkYtd={benchmarkYtd}
          activeCount={holdings.length}
          startDate={startDate}
        />
        <MarketIndicator vixLevel={vixLevel} />
      </div>

      {/* Holdings Table */}
      <HoldingsTable
        holdings={holdings}
        quotes={quotes}
        smas={smas}
        ytdPrices={ytdPrices}
      />

      {/* Options Trades */}
      <OptionsTable optionsTrades={optionsTrades} />

      {/* Admin Button */}
      <button className="admin-toggle" onClick={handleAdminToggle}>
        Admin
      </button>

      {/* Admin Login */}
      {showAdmin === 'login' && (
        <div className="admin-overlay" onClick={(e) => e.target === e.currentTarget && setShowAdmin(false)}>
          <div className="admin-panel">
            <button className="close-btn" onClick={() => setShowAdmin(false)}>&times;</button>
            <div className="password-prompt">
              <h2>Admin Access</h2>
              <form onSubmit={handleAdminLogin}>
                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="admin-btn">Login</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Admin Panel */}
      {showAdmin === true && isAuthenticated && (
        <AdminPanel
          holdings={holdings}
          trades={trades}
          optionsTrades={optionsTrades}
          onClose={() => setShowAdmin(false)}
          onRefresh={loadData}
        />
      )}
    </div>
  )
}
