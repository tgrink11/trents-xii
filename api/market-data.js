const MASSIVE_KEY = process.env.MASSIVE_API_KEY
const MASSIVE_BASE = 'https://api.massive.com'

// Helper: fetch with retry on 429
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(url)
    if (r.status === 429 && i < retries) {
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)))
      continue
    }
    return r
  }
}

// Helper: delay
const delay = ms => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const { action, symbols, symbol, window: smaWindow } = req.query

  try {
    // ALL_DATA: single call that returns quotes + SMAs for all symbols
    if (action === 'all_data') {
      const tickers = symbols ? symbols.split(',') : []
      const quotes = {}
      const smas = {}

      // Fetch quotes sequentially with delays
      for (const ticker of tickers) {
        try {
          const url = `${MASSIVE_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${MASSIVE_KEY}`
          const r = await fetchWithRetry(url)
          if (r.ok) {
            const json = await r.json()
            const bar = json.results?.[0]
            quotes[ticker] = { price: bar?.c ?? null, open: bar?.o ?? null, high: bar?.h ?? null, low: bar?.l ?? null }
          } else {
            quotes[ticker] = { price: null }
          }
        } catch { quotes[ticker] = { price: null } }
        await delay(150)
      }

      // Fetch SMAs: 3 per ticker, sequentially
      for (const ticker of tickers) {
        smas[ticker] = { sma15: null, sma62: null, sma200: null }
        for (const w of [15, 62, 200]) {
          try {
            const url = `${MASSIVE_BASE}/v1/indicators/sma/${ticker}?timespan=day&adjusted=true&window=${w}&series_type=close&order=desc&limit=1&apiKey=${MASSIVE_KEY}`
            const r = await fetchWithRetry(url)
            if (r.ok) {
              const json = await r.json()
              smas[ticker][`sma${w}`] = json.results?.values?.[0]?.value ?? null
            }
          } catch { /* skip */ }
          await delay(150)
        }
      }

      return res.json({ quotes, smas })
    }

    // QUOTES only
    if (action === 'quotes') {
      const tickers = symbols ? symbols.split(',') : []
      const results = {}
      for (const ticker of tickers) {
        try {
          const url = `${MASSIVE_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${MASSIVE_KEY}`
          const r = await fetchWithRetry(url)
          if (r.ok) {
            const json = await r.json()
            const bar = json.results?.[0]
            results[ticker] = { price: bar?.c ?? null }
          } else {
            results[ticker] = { price: null }
          }
        } catch { results[ticker] = { price: null } }
        await delay(150)
      }
      return res.json(results)
    }

    // SMA: single symbol, single window
    if (action === 'sma') {
      if (!symbol || !smaWindow) return res.status(400).json({ error: 'symbol and window required' })
      const url = `${MASSIVE_BASE}/v1/indicators/sma/${symbol}?timespan=day&adjusted=true&window=${smaWindow}&series_type=close&order=desc&limit=1&apiKey=${MASSIVE_KEY}`
      const r = await fetchWithRetry(url)
      if (!r.ok) return res.json({ value: null })
      const json = await r.json()
      return res.json({ value: json.results?.values?.[0]?.value ?? null, symbol, window: parseInt(smaWindow) })
    }

    // YTD price
    if (action === 'ytd_price') {
      if (!symbol) return res.status(400).json({ error: 'symbol required' })
      const year = new Date().getFullYear()
      const url = `${MASSIVE_BASE}/v2/aggs/ticker/${symbol}/range/1/day/${year}-01-01/${year}-01-10?adjusted=true&sort=asc&limit=1&apiKey=${MASSIVE_KEY}`
      const r = await fetchWithRetry(url)
      if (!r.ok) return res.json({ price: null })
      const json = await r.json()
      return res.json({ price: json.results?.[0]?.c ?? null, symbol })
    }

    return res.status(400).json({ error: 'Invalid action' })
  } catch (err) {
    console.error('Market data error:', err)
    return res.status(500).json({ error: err.message })
  }
}
