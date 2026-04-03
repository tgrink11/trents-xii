const API_BASE = '/api/market-data'

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    // Guard against getting HTML back (dev server fallback)
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

export async function fetchSMA(symbol, window) {
  const params = new URLSearchParams({ action: 'sma', symbol, window: String(window) })
  return fetchWithTimeout(`${API_BASE}?${params}`)
}

export async function fetchVIX() {
  return fetchWithTimeout('/api/vix')
}

export async function fetchAllMarketData(symbols) {
  const [quotesData, vixData, ...smaResults] = await Promise.all([
    fetchQuotes(symbols).catch(() => ({})),
    fetchVIX().catch(() => ({ level: null })),
    ...symbols.flatMap(sym => [
      fetchSMA(sym, 15).catch(() => ({ value: null })),
      fetchSMA(sym, 62).catch(() => ({ value: null })),
      fetchSMA(sym, 200).catch(() => ({ value: null }))
    ])
  ])

  const smaMap = {}
  let idx = 0
  for (const sym of symbols) {
    smaMap[sym] = {
      sma15: smaResults[idx]?.value ?? null,
      sma62: smaResults[idx + 1]?.value ?? null,
      sma200: smaResults[idx + 2]?.value ?? null
    }
    idx += 3
  }

  return { quotes: quotesData, vix: vixData, smas: smaMap }
}
