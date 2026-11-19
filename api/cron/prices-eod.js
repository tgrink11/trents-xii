// Daily EODHD price refresh — Vercel cron, 22:30 UTC on weekdays (vercel.json).
//
// Pulls the bulk last-day feed for the US exchange and upserts the tracked
// symbols (prices_eod_symbols, filled by the backfill) into prices_eod, plus
// that day's splits into prices_eod_splits.
//
// Protected by CRON_SECRET: Vercel sends it as `Authorization: Bearer <secret>`
// on cron invocations when the env var is set. With no secret configured the
// endpoint refuses every request rather than running open.

import { timingSafeEqual } from 'node:crypto'
import {
  createUsage,
  fetchBulkDay,
  fetchBulkSplits,
  getLatestStoredDate,
  getTrackedSymbols,
  logRun,
  upsertPrices,
  upsertSplits
} from '../_lib/prices-eod.js'

// A run that failed or was skipped leaves a hole the "last day" feed will never
// refill, so missing weekdays are re-pulled by date. Capped so a long outage
// cannot burn the quota in one run. Each day costs 200 EODHD calls: 100 for
// prices and 100 for that day's splits.
const MAX_CATCH_UP_DAYS = 5

function authorized(req) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  const given = Buffer.from(String(req.headers?.authorization || ''))
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// Weekdays strictly between two YYYY-MM-DD dates, oldest first.
function weekdaysBetween(after, before) {
  const out = []
  const d = new Date(`${after}T00:00:00Z`)
  const end = new Date(`${before}T00:00:00Z`)
  for (d.setUTCDate(d.getUTCDate() + 1); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET is not set' })
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startedAt = new Date()
  const usage = createUsage()
  const days = []
  let rowsUpserted = 0

  try {
    const tracked = await getTrackedSymbols()
    if (tracked.size === 0) {
      throw new Error('prices_eod_symbols is empty — run scripts/backfill-prices-eod.mjs first')
    }
    const lastStored = await getLatestStoredDate()

    const storeDay = async (rows, date) => {
      const kept = rows.filter(r => tracked.has(r.symbol))
      const written = await upsertPrices(kept)
      rowsUpserted += written
      // Prices are stored as traded, so a missed split would leave a cliff in
      // the series; the day's splits ride along with the day's prices.
      const splits = (await fetchBulkSplits(usage, date)).filter(s => tracked.has(s.symbol))
      if (splits.length) await upsertSplits(splits)
      days.push({ date, feed_rows: rows.length, rows_upserted: written, splits: splits.map(s => `${s.symbol} ${s.ratio}`) })
    }

    const latest = await fetchBulkDay(usage)
    if (latest.length === 0) throw new Error('EODHD bulk feed returned no rows')
    // The feed is one trading day; take the newest date in case of stragglers.
    const latestDate = latest.reduce((max, r) => (r.date > max ? r.date : max), latest[0].date)

    let skippedDays = []
    if (lastStored && lastStored < latestDate) {
      const missing = weekdaysBetween(lastStored, latestDate)
      skippedDays = missing.slice(0, Math.max(0, missing.length - MAX_CATCH_UP_DAYS))
      for (const date of missing.slice(-MAX_CATCH_UP_DAYS)) {
        // A market holiday simply comes back empty.
        await storeDay(await fetchBulkDay(usage, date), date)
      }
    }

    await storeDay(latest.filter(r => r.date === latestDate), latestDate)

    // At 22:30 UTC the feed should already carry today's session. If it does
    // not, EODHD had not published yet (or today is a holiday) and the store is
    // a day behind until the next run.
    const today = startedAt.toISOString().slice(0, 10)
    const stale = latestDate !== today
    if (stale) console.warn(`[prices-eod] bulk feed is dated ${latestDate}, not ${today}`)
    if (skippedDays.length) console.warn(`[prices-eod] gap too long to catch up: ${skippedDays.join(', ')}`)

    const status = skippedDays.length ? 'partial' : 'ok'
    const detail = { latest_date: latestDate, stale, tracked_symbols: tracked.size, days, skipped_days: skippedDays }
    await logRun({ job: 'daily', startedAt, status, rowsUpserted, usage, detail })

    return res.status(200).json({
      status,
      rows_upserted: rowsUpserted,
      eodhd_requests: usage.requests,
      eodhd_calls: usage.calls,
      ...detail
    })
  } catch (err) {
    console.error(`[prices-eod] daily run failed: ${err.message}`)
    await logRun({
      job: 'daily', startedAt, status: 'error', rowsUpserted, usage,
      detail: { error: err.message, days }
    })
    return res.status(500).json({
      error: err.message,
      rows_upserted: rowsUpserted,
      eodhd_requests: usage.requests,
      eodhd_calls: usage.calls
    })
  }
}
