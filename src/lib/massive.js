const API_BASE = '/api/market-data'

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (text.startsWith('<!') || text.startsWith('<html')) {
      throw new Error('Got HTML instead of JSON — API not available')
    }
    return JSON.parse(text)
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

export async function fetchQuotes(symbols) {
  const params = new URLSearchParams({ symbols: symbols.join(',') })
  return fetchWithTimeout(`${API_BASE}?action=quotes&${params}`)
}

export async function fetchAllSmas(symbol) {
  return fetchWithTimeout(`${API_BASE}?action=all_smas&symbol=${symbol}`)
}

export async function fetchVIX() {
  return fetchWithTimeout('/api/vix')
}

export async function fetchAllMarketData(symbols) {
  // Step 1: Fetch quotes (one serverless call, sequential internally)
  const quotesData = await fetchQuotes(symbols).catch(() => ({}))

  // Step 2: Fetch VIX
  const vixData = await fetchVIX().catch(() => ({ level: null }))

  // Step 3: Fetch SMAs sequentially per symbol (each call gets all 3 windows)
  const smaMap = {}
  for (const sym of symbols) {
    try {
      const result = await fetchAllSmas(sym)
      smaMap[sym] = {
        sma15: result.sma15 ?? null,
        sma62: result.sma62 ?? null,
        sma200: result.sma200 ?? null
      }
    } catch {
      smaMap[sym] = { sma15: null, sma62: null, sma200: null }
    }
  }

  return { quotes: quotesData, vix: vixData, smas: smaMap }
}
