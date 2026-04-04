const API_BASE = '/api/market-data'

async function fetchJson(url, timeoutMs = 60000) {
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

// Single call that gets quotes + SMAs for all symbols
export async function fetchAllMarketData(symbols) {
  const params = new URLSearchParams({ symbols: symbols.join(',') })
  const data = await fetchJson(`${API_BASE}?action=all_data&${params}`)
  return {
    quotes: data.quotes || {},
    smas: data.smas || {},
    vix: { level: null } // VIX comes from separate endpoint
  }
}

export async function fetchVIX() {
  return fetchJson('/api/vix')
}

export async function fetchYtdPrice(symbol) {
  return fetchJson(`${API_BASE}?action=ytd_price&symbol=${symbol}`)
}

export async function fetchQuotes(symbols) {
  const params = new URLSearchParams({ symbols: symbols.join(',') })
  return fetchJson(`${API_BASE}?action=quotes&${params}`)
}
