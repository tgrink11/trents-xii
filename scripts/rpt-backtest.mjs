// RPT backtest harness.
//
// Runs the live /api/receivables handler (with a mocked req/res) through the
// scoring model so the endpoint and the math are validated together.
//
//   FMP_API_KEY=... node scripts/rpt-backtest.mjs [TICKER ...]

import handler from '../api/receivables.js'
import { computeReceivablesQuality, applyRptOverlay } from '../src/lib/receivables.js'

// A clean grower, a hypergrower that must NOT false-flag, a known AR blowup,
// a cash-burn/distress name, and a customer-concentration name.
const DEFAULT_CASES = [
  { symbol: 'MSFT', expect: 'Clean — mature enterprise software, collections in line with revenue' },
  { symbol: 'NVDA', expect: 'Control: hypergrowth should not automatically read as a receivables problem' },
  { symbol: 'SMCI', expect: 'Known AR blowup — 2024 rev-rec/filing controversy, AR far outrunning revenue' },
  { symbol: 'PLUG', expect: 'Cash-burn distress — NI/FCF gap and stretched collections' },
  { symbol: 'CIEN', expect: 'Customer-concentration telecom equipment — lumpy carrier payment behavior' }
]

async function callEndpoint(symbol, quarters = 12) {
  const req = { query: { symbol, quarters: String(quarters) } }
  let payload = null
  let statusCode = 200
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return res },
    json(body) { payload = body; return res }
  }
  await handler(req, res)
  return { statusCode, payload }
}

function bar(score) {
  const filled = Math.round((score / 100) * 24)
  return '█'.repeat(filled) + '·'.repeat(24 - filled)
}

async function run(cases) {
  console.log('\nBUS! Receivables Payment-Timing Tracker — backtest')
  console.log('='.repeat(78))

  const rows = []

  for (const testCase of cases) {
    const { symbol, expect } = testCase
    process.stdout.write(`\n${symbol}  `)

    const { statusCode, payload } = await callEndpoint(symbol)
    if (statusCode !== 200 || !payload || payload.error) {
      console.log(`FETCH FAILED — ${payload?.error || `HTTP ${statusCode}`}`)
      rows.push({ symbol, score: null, tier: 'fetch failed' })
      continue
    }

    const rpt = computeReceivablesQuality({
      quarters: payload.quarters,
      profile: payload.profile,
      symbol
    })

    console.log(`${payload.profile.companyName}`)
    console.log(`  industry:  ${payload.profile.industry || '—'}  →  band ${rpt.band.label} (${rpt.band.low}–${rpt.band.high}d)`)
    if (expect) console.log(`  expected:  ${expect}`)

    if (!rpt.ok) {
      console.log(`  RESULT:    ${rpt.status.toUpperCase()} — ${rpt.message}`)
      rows.push({ symbol, score: null, tier: rpt.status })
      continue
    }

    const overlay = applyRptOverlay(72, rpt) // 72 = illustrative base Scorecard score
    console.log(`  RPT SCORE: ${String(rpt.score).padStart(3)}/100  [${bar(rpt.score)}]  ${rpt.tier.label.toUpperCase()}`)
    console.log(`  as of:     ${rpt.asOfLabel} (${rpt.asOf}) · ${rpt.quartersAvailable} usable quarters`)
    console.log(`  overlay:   ${rpt.overlay >= 0 ? '+' : ''}${rpt.overlay} pts  (Scorecard 72.0 → ${overlay.adjusted})`)
    console.log('  components:')
    for (const c of rpt.components) {
      const pts = c.points == null ? '  n/a' : `${c.points.toFixed(1).padStart(5)}`
      const of = c.effectiveWeight ? `/${c.effectiveWeight.toFixed(0)}` : ''
      console.log(`    ${pts}${of.padEnd(4)}  ${c.label}`)
      console.log(`             ${c.valueText}`)
    }
    console.log(`  FLAG:      ${rpt.flag}`)
    for (const g of rpt.guardrails) {
      console.log(`  [${g.severity}]     ${g.text}`)
    }
    console.log(`  8Q DSO:    ${rpt.sparkline.map(s => `${s.label} ${s.dso.toFixed(0)}d`).join(' · ')}`)

    rows.push({ symbol, score: rpt.score, tier: rpt.tier.label, overlay: rpt.overlay })
  }

  console.log(`\n${'='.repeat(78)}`)
  console.log('SUMMARY')
  for (const r of rows) {
    console.log(`  ${r.symbol.padEnd(6)} ${r.score == null ? '—'.padStart(3) : String(r.score).padStart(3)}  ${r.tier}${r.overlay ? `  (overlay ${r.overlay})` : ''}`)
  }
  console.log('')
}

const args = process.argv.slice(2)
const cases = args.length ? args.map(s => ({ symbol: s.toUpperCase(), expect: null })) : DEFAULT_CASES
run(cases).catch(err => {
  console.error(err)
  process.exit(1)
})
