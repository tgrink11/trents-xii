const MASSIVE_KEY = process.env.MASSIVE_API_KEY
const MASSIVE_BASE = 'https://api.massive.com'

// Helper: fetch with retry on 429
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(url)
    if (r.status === 429 && i < retries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
      continue
    }
    return r
  }
}

// Helper: sequential fetch with small delay to avoid rate limits
async function fetchSequential(urls) {
  const results = []
  for (const { key, url } of urls) {
    const r = await fetchWithRetry(url)
    if (!r.ok) {
      results.push({ key, data: null })
    } else {
      const json = await r.json()
      results.push({ key, data: json })
    }
    // Small delay between requests to stay under rate limit
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return results
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const { action, symbols, symbol, window: smaWindow } = req.query

  try {
    // QUOTES: fetch prev-day close for all tickers sequentially
    if (action === 'quotes') {
      const tickers = symbols ? symbols.split(',') : []
      const results = {}

      const urls = tickers.map(ticker => ({
        key: ticker,
        url: `${MASSIVE_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${MASSIVE_KEY}`
      }))

      const responses = await fetchSequential(urls)

      for (const { key: ticker, data } of responses) {
        const bar = data?.results?.[0]
        if (bar) {
          results[ticker] = {
            price: bar.c ?? null,
            open: bar.o ?? null,
            high: bar.h ?? null,
            low: bar.l ?? null,
            volume: bar.v ?? null,
            vwap: bar.vw ?? null
          }
        } else {
          results[ticker] = { price: null }
        }
      }

      return res.json(results)
    }

    // SMA: single symbol, single window
    if (action === 'sma') {
      if (!symbol || !smaWindow) {
        return res.status(400).json({ error: 'symbol and window required' })
      }
      const url = `${MASSIVE_BASE}/v1/indicators/sma/${symbol}?timespan=day&adjusted=true&window=${smaWindow}&series_type=close&order=desc&limit=1&apiKey=${MASSIVE_KEY}`
      const r = await fetchWithRetry(url)
      if (!r.ok) {
        return res.json({ value: null, error: `MASSIVE API ${r.status}` })
      }
      const json = await r.json()
      const value = json.results?.values?.[0]?.value ?? null
      return res.json({ value, symbol, window: parseInt(smaWindow) })
    }

    // ALL_SMAS: fetch 15, 62, 200 day SMAs for a symbol in one serverless call
    if (action === 'all_smas') {
      if (!symbol) {
        return res.status(400).json({ error: 'symbol required' })
      }
      const windows = [15, 62, 200]
      const smaResults = {}

      for (const w of windows) {
        const url = `${MASSIVE_BASE}/v1/indicators/sma/${symbol}?timespan=day&adjusted=true&window=${w}&series_type=close&order=desc&limit=1&apiKey=${MASSIVE_KEY}`
        const r = await fetchWithRetry(url)
        if (r.ok) {
          const json = await r.json()
          smaResults[`sma${w}`] = json.results?.values?.[0]?.value ?? null
        } else {
          smaResults[`sma${w}`] = null
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }

      return res.json({ symbol, ...smaResults })
    }

    // YTD_PRICE: get closing price on first trading day of year
    if (action === 'ytd_price') {
      if (!symbol) {
        return res.status(400).json({ error: 'symbol required' })
      }
      const year = new Date().getFullYear()
      const url = `${MASSIVE_BASE}/v2/aggs/ticker/${symbol}/range/1/day/${year}-01-01/${year}-01-10?adjusted=true&sort=asc&limit=1&apiKey=${MASSIVE_KEY}`
      const r = await fetchWithRetry(url)
      if (!r.ok) {
        return res.json({ price: null })
      }
      const json = await r.json()
      const price = json.results?.[0]?.c ?? null
      return res.json({ price, symbol })
    }

    return res.status(400).json({ error: 'Invalid action. Use: quotes, sma, all_smas, ytd_price' })
  } catch (err) {
    console.error('Market data error:', err)
    return res.status(500).json({ error: err.message })
  }
}
