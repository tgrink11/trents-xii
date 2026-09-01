// BUS! Receivables Payment-Timing Tracker (RPT) — data endpoint
//
// Pulls the quarterly statements the RPT model needs from FMP and returns them
// as one normalized, oldest-first series. All scoring math lives client-side in
// src/lib/receivables.js so it stays testable without a network round trip.

const FMP_KEY = process.env.FMP_API_KEY
const STABLE = 'https://financialmodelingprep.com/stable'
const V3 = 'https://financialmodelingprep.com/api/v3'

// Fundamentals only move once a quarter — cache aggressively to stay well
// inside FMP rate limits when several tickers get checked in a session.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map()

async function getJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const json = await r.json()
  if (json && json['Error Message']) throw new Error(json['Error Message'])
  return json
}

// Try the stable API first, fall back to legacy v3 (field names differ slightly).
async function fetchStatement(kind, symbol, limit) {
  try {
    const json = await getJson(`${STABLE}/${kind}?symbol=${symbol}&period=quarter&limit=${limit}&apikey=${FMP_KEY}`)
    if (Array.isArray(json) && json.length) return json
  } catch { /* fall through */ }

  const v3Kind = kind === 'cash-flow-statement' ? 'cash-flow-statement' : kind
  try {
    const json = await getJson(`${V3}/${v3Kind}/${symbol}?period=quarter&limit=${limit}&apikey=${FMP_KEY}`)
    if (Array.isArray(json) && json.length) return json
  } catch { /* skip */ }

  return []
}

async function fetchProfile(symbol) {
  try {
    const json = await getJson(`${STABLE}/profile?symbol=${symbol}&apikey=${FMP_KEY}`)
    if (Array.isArray(json) && json[0]) return json[0]
  } catch { /* fall through */ }

  try {
    const json = await getJson(`${V3}/profile/${symbol}?apikey=${FMP_KEY}`)
    if (Array.isArray(json) && json[0]) return json[0]
  } catch { /* skip */ }

  return null
}

const num = (...vals) => {
  for (const v of vals) {
    if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const symbol = (req.query.symbol || '').toString().trim().toUpperCase()
  if (!symbol) return res.status(400).json({ error: 'symbol required' })
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) return res.status(400).json({ error: 'invalid symbol' })
  if (!FMP_KEY) {
    return res.status(500).json({
      error: 'FMP_API_KEY is not set for this deployment environment. Add it under Vercel → Project Settings → Environment Variables (check Preview as well as Production), then redeploy.'
    })
  }

  // Ask for one extra quarter: the oldest AR reading is only used as the
  // "beginning balance" for the next quarter's average-receivables figure.
  const requested = Math.min(Math.max(parseInt(req.query.quarters) || 12, 4), 20)
  const limit = requested + 1

  const cacheKey = `${symbol}:${limit}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return res.json({ ...hit.payload, cached: true })
  }

  try {
    const [income, balance, cashflow, profile] = await Promise.all([
      fetchStatement('income-statement', symbol, limit),
      fetchStatement('balance-sheet-statement', symbol, limit),
      fetchStatement('cash-flow-statement', symbol, limit),
      fetchProfile(symbol)
    ])

    if (!income.length || !balance.length) {
      return res.status(404).json({
        error: `No quarterly statements returned for ${symbol}`,
        symbol
      })
    }

    const byDate = new Map()
    const touch = (date) => {
      if (!byDate.has(date)) byDate.set(date, { date })
      return byDate.get(date)
    }

    for (const row of income) {
      const q = touch(row.date)
      q.revenue = num(row.revenue)
      q.fiscalYear = row.fiscalYear || row.calendarYear || String(row.date || '').slice(0, 4)
      q.period = row.period
    }
    for (const row of balance) {
      const q = touch(row.date)
      q.netReceivables = num(row.netReceivables, row.accountsReceivables)
      q.fiscalYear = q.fiscalYear || row.fiscalYear || row.calendarYear
      q.period = q.period || row.period
    }
    for (const row of cashflow) {
      const q = touch(row.date)
      q.netIncome = num(row.netIncome)
      q.operatingCashFlow = num(row.operatingCashFlow, row.netCashProvidedByOperatingActivities)
      q.capitalExpenditure = num(row.capitalExpenditure, row.investmentsInPropertyPlantAndEquipment)
      const fcf = num(row.freeCashFlow)
      q.freeCashFlow = fcf != null
        ? fcf
        : (q.operatingCashFlow != null && q.capitalExpenditure != null
            ? q.operatingCashFlow + q.capitalExpenditure // capex is already negative
            : null)
      // Cash-flow-statement AR line: negative = receivables grew (a use of cash)
      q.arChange = num(row.accountsReceivables, row.changeInAccountsReceivables)
      q.acquisitionsNet = num(row.acquisitionsNet)
    }

    const quarters = [...byDate.values()]
      .filter(q => q.revenue != null && q.netReceivables != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    const payload = {
      symbol,
      profile: profile ? {
        companyName: profile.companyName || symbol,
        sector: profile.sector || null,
        industry: profile.industry || null,
        isEtf: profile.isEtf === true || profile.isFund === true,
        image: profile.image || null
      } : { companyName: symbol, sector: null, industry: null, isEtf: false, image: null },
      quarters,
      fetchedAt: new Date().toISOString()
    }

    cache.set(cacheKey, { at: Date.now(), payload })
    return res.json(payload)
  } catch (err) {
    console.error('Receivables fetch error:', err)
    return res.status(500).json({ error: err.message, symbol })
  }
}
