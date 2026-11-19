// One-time backfill for the shared EODHD price store.
//
// For every symbol in the universe, pulls EODHD /api/eod/{SYMBOL}.US from
// 2018-01-01 and upserts it into prices_eod, stores its splits over the same
// span in prices_eod_splits (two EODHD calls a symbol), then registers the symbol in
// prices_eod_symbols so the daily cron keeps it current. Safe to re-run: it
// only ever upserts, and a re-run also refreshes adj_close after a split.
//
//   node --use-system-ca --env-file=.env scripts/backfill-prices-eod.mjs [options] [SYMBOL ...]
//
// --use-system-ca makes Node trust the certificates Windows trusts. Without it,
// antivirus that inspects HTTPS (Norton here) makes every request fail with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE.
//
//   --file <path>    extra symbols, one per line or comma-separated (# comments ok);
//                    repeatable, e.g. one file per app universe
//   --no-db          do not add this app's holdings/trades/options symbols
//                    (read from this app's own Supabase with the public anon key)
//   --from <date>    first date to pull (default 2018-01-01)
//   --dry-run        print the universe and exit; no EODHD calls, no writes
//
// The universe is the union of: symbols on the command line, every --file,
// and (unless --no-db) every symbol in this app's holdings, trades and
// options_trades tables.
//
// Needs EODHD_KEY, PRICES_SUPABASE_URL and PRICES_SUPABASE_KEY (the kerry_top10
// project and its service-role key) in the environment, plus this app's usual
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY unless --no-db is given.

import { readFileSync } from 'node:fs'
import {
  createUsage,
  fetchSymbolHistory,
  fetchSymbolSplits,
  logRun,
  normalizeSymbol,
  registerSymbols,
  upsertPrices,
  upsertSplits
} from '../api/_lib/prices-eod.js'

const delay = ms => new Promise(r => setTimeout(r, ms))
// EODHD allows 1,000 requests a minute; this stays far under it.
const PAUSE_MS = 150

function parseArgs(argv) {
  const opts = { files: [], symbols: [], useDb: true, from: '2018-01-01', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--file') opts.files.push(argv[++i])
    else if (a === '--no-db') opts.useDb = false
    else if (a === '--from') opts.from = argv[++i]
    else if (a === '--dry-run') opts.dryRun = true
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else opts.symbols.push(...a.split(','))
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.from || '')) throw new Error('--from must be YYYY-MM-DD')
  if (opts.files.some(f => !f)) throw new Error('--file needs a path')
  return opts
}

// This app's own tables live in its own Supabase project, not the store's.
// They are publicly readable, so the anon key is enough.
async function readAppSymbols(table) {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (or pass --no-db)')
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=symbol&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    })
    if (!r.ok) throw new Error(`Reading ${table}: HTTP ${r.status}`)
    const page = await r.json()
    out.push(...page.map(row => row.symbol))
    if (page.length < 1000) return out
  }
}

function readSymbolFile(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.replace(/#.*/, ''))
    .flatMap(line => line.split(/[,\s]+/))
}

async function buildUniverse(opts) {
  const raw = [...opts.symbols]
  for (const file of opts.files) raw.push(...readSymbolFile(file))
  if (opts.useDb) {
    for (const table of ['holdings', 'trades', 'options_trades']) {
      raw.push(...await readAppSymbols(table))
    }
  }
  return [...new Set(raw.map(normalizeSymbol).filter(Boolean))].sort()
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const universe = await buildUniverse(opts)
  if (universe.length === 0) throw new Error('The universe is empty — nothing to backfill')

  console.log(`Universe: ${universe.length} symbols, from ${opts.from}`)
  if (opts.dryRun) {
    console.log(universe.join(' '))
    return
  }

  const startedAt = new Date()
  const usage = createUsage()
  const failed = []
  const empty = []
  let rowsUpserted = 0
  let networkFailures = 0
  let splitsUpserted = 0
  let done = 0

  for (const symbol of universe) {
    try {
      const rows = await fetchSymbolHistory(symbol, opts.from, usage)
      if (rows.length === 0) {
        empty.push(symbol)
        console.log(`${symbol.padEnd(8)} no data`)
      } else {
        // Prices are stored as traded; the splits make them comparable on read.
        const splits = await fetchSymbolSplits(symbol, opts.from, usage)
        if (splits.length) splitsUpserted += await upsertSplits(splits)
        rowsUpserted += await upsertPrices(rows)
        await registerSymbols([{
          symbol,
          backfilled_at: new Date().toISOString(),
          first_date: rows[0].date,
          last_date: rows[rows.length - 1].date
        }])
        done += 1
        networkFailures = 0
        console.log(`${symbol.padEnd(8)} ${String(rows.length).padStart(5)} rows  ${rows[0].date} → ${rows[rows.length - 1].date}`)
      }
    } catch (err) {
      failed.push({ symbol, error: err.message })
      console.log(`${symbol.padEnd(8)} FAILED — ${err.message}`)
      // A bad key or an exhausted quota will fail every symbol; stop early.
      if (err.status === 401 || err.status === 402 || err.status === 403 || err.status === 429) {
        console.log('Stopping: EODHD refused the request (key or quota).')
        break
      }
      // Nothing is getting through at all: stop instead of failing every symbol.
      if (/network error|fetch failed/.test(err.message) && ++networkFailures >= 5 && done === 0) {
        console.log('Stopping: no request is reaching the network.')
        if (/UNABLE_TO_VERIFY|SELF_SIGNED|CERT_/.test(err.message)) {
          console.log('Node does not trust the certificate it was shown (antivirus HTTPS inspection).')
          console.log('Run with:  node --use-system-ca --env-file=.env scripts/backfill-prices-eod.mjs ...')
        }
        break
      }
    }
    await delay(PAUSE_MS)
  }

  const status = failed.length ? (done ? 'partial' : 'error') : 'ok'
  await logRun({
    job: 'backfill', startedAt, status, rowsUpserted, usage,
    detail: { from: opts.from, universe: universe.length, symbols_loaded: done, splits_upserted: splitsUpserted, empty, failed }
  })

  console.log(`\nSymbols loaded: ${done} of ${universe.length}`)
  console.log(`Rows upserted:  ${rowsUpserted}`)
  console.log(`Splits stored:  ${splitsUpserted}`)
  console.log(`EODHD calls:    ${usage.calls} (${usage.requests} requests)`)
  if (empty.length) console.log(`No data:        ${empty.join(' ')}`)
  if (failed.length) console.log(`Failed:         ${failed.map(f => f.symbol).join(' ')}`)
  if (failed.length) process.exitCode = 1
}

main().catch(err => {
  console.error(err.message)
  process.exitCode = 1
})
