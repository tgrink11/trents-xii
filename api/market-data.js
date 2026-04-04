const MASSIVE_KEY = process.env.MASSIVE_API_KEY
const FMP_KEY = process.env.FMP_API_KEY
const MASSIVE_BASE = 'https://api.massive.com'
const FMP_BASE = 'https://financialmodelingprep.com/api/v3'

const delay = ms => new Promise(r => setTimeout(r, ms))

// Try MASSIVE first, fall back to FMP for quotes
async function getQuote(ticker) {
  // Try MASSIVE
  try {
    const r = await fetch(`${MASSIVE_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${MASSIVE_KEY}`)
    if (r.ok) {
      const json = await r.json()
      if (json.status === 'OK' && json.results?.[0]) {
        const bar = json.results[0]
        return { price: bar.c, open: bar.o, high: bar.h, low: bar.l }
      }
    }
  } catch { /* fall through */ }

  // Fallback: FMP
  try {
    const r = await fetch(`${FMP_BASE}/quote/${ticker}?apikey=${FMP_KEY}`)
    if (r.ok) {
      const json = await r.json()
      if (json?.[0]) {
        return { price: json[0].price, open: json[0].open, high: json[0].dayHigh, low: json[0].dayLow }
      }
    }
  } catch { /* skip */ }

  return { price: null }
}

// Try MASSIVE for SMA, compute manually from FMP as fallback
async function getSMA(ticker, window) {
  // Try MASSIVE
  try {
    const r = await fetch(`${MASSIVE_BASE}/v1/indicators/sma/${ticker}?timespan=day&adjusted=true&window=${window}&series_type=close&order=desc&limit=1&apiKey=${MASSIVE_KEY}`)
    if (r.ok) {
      const json = await r.json()
      const val = json.results?.values?.[0]?.value
      if (val != null) return val
    }
  } catch { /* fall through */ }

  // Fallback: FMP historical prices, compute SMA manually
  try {
    const r = await fetch(`${FMP_BASE}/historical-price-full/${ticker}?timeseries=${window}&apikey=${FMP_KEY}`)
    if (r.ok) {
      const json = await r.json()
      const prices = json.historical?.map(d => d.close).filter(Boolean)
      if (prices && prices.length >= window) {
        const sum = prices.slice(0, window).reduce((a, b) => a + b, 0)
        return sum / window
      }
    }
  } catch { /* skip */ }

  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const { action, symbols, symbol, window: smaWindow } = req.query

  try {
    // ALL_DATA: quotes + SMAs for all symbols
    if (action === 'all_data') {
      const tickers = symbols ? symbols.split(',') : []
      const quotes = {}
      const smas = {}

      // Fetch quotes
      for (const ticker of tickers) {
        quotes[ticker] = await getQuote(ticker)
        await delay(100)
      }

      // Fetch SMAs
      for (const ticker of tickers) {
        smas[ticker] = {
          sma15: await getSMA(ticker, 15),
          sma62: await getSMA(ticker, 62),
          sma200: await getSMA(ticker, 200)
        }
        await delay(100)
      }

      return res.json({ quotes, smas })
    }

    // QUOTES only
    if (action === 'quotes') {
      const tickers = symbols ? symbols.split(',') : []
      const results = {}
      for (const ticker of tickers) {
        results[ticker] = await getQuote(ticker)
        await delay(100)
      }
      return res.json(results)
    }

    // SMA: single symbol, single window
    if (action === 'sma') {
      if (!symbol || !smaWindow) return res.status(400).json({ error: 'symbol and window required' })
      const value = await getSMA(symbol, parseInt(smaWindow))
      return res.json({ value, symbol, window: parseInt(smaWindow) })
    }

    // YTD price
    if (action === 'ytd_price') {
      if (!symbol) return res.status(400).json({ error: 'symbol required' })
      const year = new Date().getFullYear()

      // Try MASSIVE
      try {
        const r = await fetch(`${MASSIVE_BASE}/v2/aggs/ticker/${symbol}/range/1/day/${year}-01-01/${year}-01-10?adjusted=true&sort=asc&limit=1&apiKey=${MASSIVE_KEY}`)
        if (r.ok) {
          const json = await r.json()
          if (json.results?.[0]?.c) return res.json({ price: json.results[0].c, symbol })
        }
      } catch { /* fall through */ }

      // Fallback: FMP
      try {
        const r = await fetch(`${FMP_BASE}/historical-price-full/${symbol}?from=${year}-01-01&to=${year}-01-10&apikey=${FMP_KEY}`)
        if (r.ok) {
          const json = await r.json()
          const first = json.historical?.sort((a, b) => new Date(a.date) - new Date(b.date))?.[0]
          if (first) return res.json({ price: first.close, symbol })
        }
      } catch { /* skip */ }

      return res.json({ price: null, symbol })
    }

    return res.status(400).json({ error: 'Invalid action' })
  } catch (err) {
    console.error('Market data error:', err)
    return res.status(500).json({ error: err.message })
  }
}
