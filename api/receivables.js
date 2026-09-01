// BUS! Receivables Payment-Timing Tracker (RPT) — data endpoint
//
// Pulls the quarterly statements the RPT model needs from FMP and returns them
// as one normalized, oldest-first series. All scoring math lives client-side in
// src/lib/receivables.js so it stays testable without a network round trip.
//
// Tier 2 (allowance for doubtful accounts) comes from the SEC's XBRL API and is
// aligned to those quarters here — the browser can't make that call itself
// (cross-origin, and User-Agent is a forbidden header), so it rides along in
// the payload for the client-side scorer to consume.

const FMP_KEY = process.env.FMP_API_KEY
const STABLE = 'https://financialmodelingprep.com/stable'
const V3 = 'https://financialmodelingprep.com/api/v3'

// SEC requires a User-Agent carrying real contact info, and caps callers at
// 10 req/sec. One request per ticker, cached for a day, sits far under that.
const SEC_CONCEPT = 'https://data.sec.gov/api/xbrl/companyconcept'
const SEC_CONTACT = (process.env.SEC_CONTACT || 'tgrink11@gmail.com').trim()
const SEC_USER_AGENT = `BUS! Receivables Payment-Timing Tracker (${SEC_CONTACT})`
// Post-CECL the SEC relabeled this "Accounts Receivable, Allowance for Credit
// Loss, Current", but the original tag is the one that resolves —
// AccountsReceivableAllowanceForCreditLossCurrent 404s.
const ALLOWANCE_TAG = 'AllowanceForDoubtfulAccountsReceivableCurrent'
const PERIODIC_FORM = /^10-[QK]/
const DATE_TOLERANCE_DAYS = 5
const MIN_ALLOWANCE_QUARTERS = 3

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

// ---------------------------------------------------------------- SEC Tier 2

const secCache = new Map()
const SEC_CACHE_TTL_MS = 24 * 60 * 60 * 1000

// The API only accepts a 10-digit zero-padded CIK.
function normalizeCik(cik) {
  if (cik == null) return null
  const digits = String(cik).replace(/\D/g, '')
  if (!digits || Number(digits) === 0) return null
  return digits.padStart(10, '0')
}

/**
 * Allowance balances by period-end date, deduped.
 *
 * The same balance is re-reported across the original 10-Q and every later
 * amendment, so end dates repeat heavily (MSFT: 136 facts, 73 duplicate ends).
 * Keep the most recently filed value per date — that's the latest restatement.
 * 8-K restatements carry the tag too and would double-count, so only periodic
 * reports are read.
 *
 * Returns null when the filer doesn't tag the concept. Network and parse
 * failures also return null: Tier 2 is optional, and the scorer redistributes
 * its weight rather than failing.
 */
async function fetchAllowanceFacts(cik) {
  const padded = normalizeCik(cik)
  if (!padded) return null

  const hit = secCache.get(padded)
  if (hit && Date.now() - hit.at < SEC_CACHE_TTL_MS) return hit.facts

  let facts = null
  try {
    const r = await fetch(`${SEC_CONCEPT}/CIK${padded}/us-gaap/${ALLOWANCE_TAG}.json`, {
      headers: { 'User-Agent': SEC_USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    // 404 = this filer has never tagged the concept. Not an error.
    if (r.ok) {
      const json = await r.json()
      const rows = json?.units?.USD
      if (Array.isArray(rows) && rows.length) {
        const latestFiled = new Map()
        for (const f of rows) {
          if (!f?.end || !Number.isFinite(f.val)) continue
          if (!PERIODIC_FORM.test(f.form || '')) continue
          const filed = f.filed || ''
          const prev = latestFiled.get(f.end)
          if (!prev || filed >= prev.filed) latestFiled.set(f.end, { val: f.val, filed })
        }
        if (latestFiled.size) {
          facts = Object.fromEntries([...latestFiled].map(([end, v]) => [end, v.val]))
        }
      }
    }
  } catch {
    facts = null // offline, timeout, malformed — degrade to "no Tier 2"
  }

  secCache.set(padded, { at: Date.now(), facts })
  return facts
}

const dayDiff = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000

/**
 * Line the allowance facts up with the quarters actually being scored, deriving
 * gross AR from  Gross = Net + Allowance  (AccountsReceivableGrossCurrent is
 * barely tagged, and this needs no extra request).
 *
 * Returns null unless the series is both deep enough AND current. That second
 * condition matters: NVDA still returns 18 facts but stopped tagging in 2018,
 * so a presence check alone would score a 2026 ratio off an 8-year-old balance.
 */
function alignAllowanceToQuarters(facts, quarters) {
  if (!facts || !quarters.length) return null
  const ends = Object.keys(facts)
  if (!ends.length) return null

  const findNear = (date) => {
    let best = null
    for (const end of ends) {
      const d = dayDiff(end, date)
      if (d <= DATE_TOLERANCE_DAYS && (!best || d < best.d)) best = { end, d }
    }
    return best ? facts[best.end] : null
  }

  const points = []
  for (const q of quarters) {
    if (!Number.isFinite(q.netReceivables)) continue
    const allowance = findNear(q.date)
    if (allowance == null) continue
    points.push({ date: q.date, allowance, grossAr: q.netReceivables + allowance })
  }

  if (points.length < MIN_ALLOWANCE_QUARTERS) return null

  // Stale-series gate: the newest quarter being scored must itself be covered.
  const newest = quarters[quarters.length - 1]?.date
  if (!points.some((p) => p.date === newest)) return null

  return points
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

    // Tier 2: the allowance for doubtful accounts. Optional by design — when a
    // filer doesn't tag it (or stopped years ago) this stays null and the
    // scorer redistributes the 10% weight across the other components.
    const allowanceSeries = alignAllowanceToQuarters(
      await fetchAllowanceFacts(profile?.cik),
      quarters
    )

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
      allowanceSeries,
      fetchedAt: new Date().toISOString()
    }

    cache.set(cacheKey, { at: Date.now(), payload })
    return res.json(payload)
  } catch (err) {
    console.error('Receivables fetch error:', err)
    return res.status(500).json({ error: err.message, symbol })
  }
}
