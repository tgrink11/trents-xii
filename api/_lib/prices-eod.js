// Shared EODHD price store — the pieces used by both the one-time backfill
// (scripts/backfill-prices-eod.mjs) and the daily cron (api/cron/prices-eod.js).
//
// The store lives in the kerry_top10 Supabase project (the BMA site's
// database), not in this app's own project, so it has its own settings:
// PRICES_SUPABASE_URL and PRICES_SUPABASE_KEY (that project's service-role
// key). There is deliberately no fallback to this app's VITE_SUPABASE_URL,
// which would send the writes to the wrong database.
//
// Server-side only. EODHD_KEY and PRICES_SUPABASE_KEY may never carry a VITE_
// prefix, which would bundle them into the browser build.

const EODHD_BASE = 'https://eodhd.com/api'
const UPSERT_CHUNK = 1000
const PAGE = 1000

// EODHD bills a bulk request as 100 API calls; everything else used here is 1.
export const BULK_CALL_COST = 100

function requireEnv(name) {
  const value = (process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

// ---------------------------------------------------------------------------
// EODHD
// ---------------------------------------------------------------------------

// Counts usage for one run. `requests` is HTTP requests sent, `calls` is what
// they cost against the EODHD quota.
export function createUsage() {
  return { requests: 0, calls: 0 }
}

async function eodhdGet(path, params, usage, cost) {
  const key = requireEnv('EODHD_KEY')
  const query = new URLSearchParams({ ...params, fmt: 'json', api_token: key })
  usage.requests += 1
  usage.calls += cost

  let r
  try {
    r = await fetch(`${EODHD_BASE}${path}?${query}`)
  } catch (err) {
    // Never let the URL (it carries the key) reach a log line.
    throw new Error(`EODHD ${path}: network error (${err.cause?.code || err.name})`)
  }
  if (!r.ok) {
    const err = new Error(`EODHD ${path}: HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  const json = await r.json()
  if (!Array.isArray(json)) throw new Error(`EODHD ${path}: unexpected response shape`)
  return json
}

const numOrNull = v => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const intOrNull = v => (numOrNull(v) == null ? null : Math.round(Number(v)))

// Store symbols in EODHD's own form: upper case, class shares with a dash
// (BRK-B, not BRK.B or BRK/B), no exchange suffix.
export function normalizeSymbol(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\.US$/, '').replace(/[./]/g, '-')
}

function toRow(symbol, bar) {
  return {
    symbol,
    date: bar.date,
    open: numOrNull(bar.open),
    high: numOrNull(bar.high),
    low: numOrNull(bar.low),
    close: numOrNull(bar.close),
    adj_close: numOrNull(bar.adjusted_close),
    volume: intOrNull(bar.volume)
  }
}

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Full daily history for one symbol. 1 API call.
export async function fetchSymbolHistory(symbol, from, usage) {
  const bars = await eodhdGet(`/eod/${encodeURIComponent(symbol)}.US`, { from }, usage, 1)
  return bars.filter(b => isDate(b.date)).map(b => toRow(symbol, b))
}

// Every US symbol for one day (the last trading day when `date` is omitted).
// 100 API calls.
export async function fetchBulkDay(usage, date) {
  const bars = await eodhdGet('/eod-bulk-last-day/US', date ? { date } : {}, usage, BULK_CALL_COST)
  return bars
    .filter(b => b.code && isDate(b.date))
    .map(b => toRow(normalizeSymbol(b.code), b))
}

// "4.000000/1.000000" → 4 (new shares per old share). Null if unreadable.
function splitRatio(text) {
  const [to, from] = String(text || '').split('/').map(Number)
  return Number.isFinite(to) && Number.isFinite(from) && to > 0 && from > 0 ? to / from : null
}

function toSplit(symbol, row) {
  const ratio = splitRatio(row.split)
  return ratio && isDate(row.date) ? { symbol, date: row.date, ratio } : null
}

// Every split for one symbol since `from`. 1 API call.
export async function fetchSymbolSplits(symbol, from, usage) {
  const rows = await eodhdGet(`/splits/${encodeURIComponent(symbol)}.US`, { from }, usage, 1)
  return rows.map(r => toSplit(symbol, r)).filter(Boolean)
}

// Every US split taking effect on one day. 100 API calls.
export async function fetchBulkSplits(usage, date) {
  const rows = await eodhdGet('/eod-bulk-last-day/US', { type: 'splits', date }, usage, BULK_CALL_COST)
  return rows.filter(r => r.code).map(r => toSplit(normalizeSymbol(r.code), r)).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST over fetch, service-role key)
// ---------------------------------------------------------------------------

function supabaseConfig() {
  const url = requireEnv('PRICES_SUPABASE_URL').replace(/\/+$/, '')
  const key = requireEnv('PRICES_SUPABASE_KEY')
  return { url, key }
}

async function rest(method, pathAndQuery, { body, prefer } = {}) {
  const { url, key } = supabaseConfig()
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer

  const r = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]}: HTTP ${r.status} ${text.slice(0, 300)}`)
  }
  return r.status === 204 || method === 'POST' ? null : r.json()
}

// Read every row of a (small) table or filtered view, past PostgREST's
// per-request row cap.
export async function selectAll(table, query) {
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest('GET', `${table}?${query}&limit=${PAGE}&offset=${offset}`)
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

async function upsert(table, conflict, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await rest('POST', `${table}?on_conflict=${conflict}`, {
      body: rows.slice(i, i + UPSERT_CHUNK),
      prefer: 'resolution=merge-duplicates,return=minimal'
    })
  }
  return rows.length
}

// Returns the number of rows written (inserted or updated).
export function upsertPrices(rows) {
  return upsert('prices_eod', 'symbol,date', rows)
}

export function upsertSplits(rows) {
  return upsert('prices_eod_splits', 'symbol,date', rows)
}

export function registerSymbols(rows) {
  return upsert('prices_eod_symbols', 'symbol', rows)
}

export async function getTrackedSymbols() {
  const rows = await selectAll('prices_eod_symbols', 'select=symbol&order=symbol')
  return new Set(rows.map(r => r.symbol))
}

export async function getLatestStoredDate() {
  const rows = await rest('GET', 'prices_eod?select=date&order=date.desc&limit=1')
  return rows[0]?.date ?? null
}

// ---------------------------------------------------------------------------
// Run log
// ---------------------------------------------------------------------------

// Logs one run to stdout (Vercel function logs / the terminal) and to
// prices_eod_runs. A failure to write the log row never fails the run.
export async function logRun({ job, startedAt, status, rowsUpserted, usage, detail }) {
  console.log(
    `[prices-eod] job=${job} status=${status} rows_upserted=${rowsUpserted} ` +
    `eodhd_requests=${usage.requests} eodhd_calls=${usage.calls} ` +
    `duration_ms=${Date.now() - startedAt.getTime()}`
  )
  try {
    await rest('POST', 'prices_eod_runs', {
      body: [{
        job,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        status,
        rows_upserted: rowsUpserted,
        eodhd_requests: usage.requests,
        eodhd_calls: usage.calls,
        detail: detail ?? null
      }],
      prefer: 'return=minimal'
    })
  } catch (err) {
    console.error(`[prices-eod] could not write run log: ${err.message}`)
  }
}
