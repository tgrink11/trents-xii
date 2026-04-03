const MASSIVE_KEY = process.env.MASSIVE_API_KEY
const MASSIVE_BASE = 'https://api.massive.com'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const { action, symbols, symbol, window: smaWindow } = req.query

  try {
    if (action === 'quotes') {
      const tickers = symbols ? symbols.split(',') : []
      const results = {}

      // Fetch snapshots for all tickers
      const snapshots = await Promise.all(
        tickers.map(async (ticker) => {
          const url = `${MASSIVE_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${MASSIVE_KEY}`
          const r = await fetch(url)
          if (!r.ok) return { ticker, data: null }
          const json = await r.json()
          return { ticker, data: json }
        })
      )

      for (const { ticker, data } of snapshots) {
        if (data?.ticker) {
          results[ticker] = {
            price: data.ticker.day?.c ?? data.ticker.prevDay?.c ?? null,
            change: data.ticker.todaysChange ?? null,
            changePct: data.ticker.todaysChangePerc ?? null,
            prevClose: data.ticker.prevDay?.c ?? null,
            open: data.ticker.day?.o ?? null,
            high: data.ticker.day?.h ?? null,
            low: data.ticker.day?.l ?? null,
            volume: data.ticker.day?.v ?? null
          }
        } else {
          results[ticker] = { price: null }
        }
      }

      return res.json(results)
    }

    if (action === 'sma') {
      if (!symbol || !smaWindow) {
        return res.status(400).json({ error: 'symbol and window required' })
      }
      const url = `${MASSIVE_BASE}/v1/indicators/sma/${symbol}?timespan=day&adjusted=true&window=${smaWindow}&series_type=close&order=desc&limit=1&apiKey=${MASSIVE_KEY}`
      const r = await fetch(url)
      if (!r.ok) {
        return res.json({ value: null, error: `MASSIVE API ${r.status}` })
      }
      const json = await r.json()
      const value = json.results?.values?.[0]?.value ?? null
      return res.json({ value, symbol, window: parseInt(smaWindow) })
    }

    // YTD price - get closing price on first trading day of year
    if (action === 'ytd_price') {
      if (!symbol) {
        return res.status(400).json({ error: 'symbol required' })
      }
      const year = new Date().getFullYear()
      const url = `${MASSIVE_BASE}/v2/aggs/ticker/${symbol}/range/1/day/${year}-01-01/${year}-01-10?adjusted=true&sort=asc&limit=1&apiKey=${MASSIVE_KEY}`
      const r = await fetch(url)
      if (!r.ok) {
        return res.json({ price: null })
      }
      const json = await r.json()
      const price = json.results?.[0]?.c ?? null
      return res.json({ price, symbol })
    }

    return res.status(400).json({ error: 'Invalid action. Use: quotes, sma, ytd_price' })
  } catch (err) {
    console.error('Market data error:', err)
    return res.status(500).json({ error: err.message })
  }
}
