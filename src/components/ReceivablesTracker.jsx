import { useState, useCallback } from 'react'
import { fetchReceivables } from '../lib/massive'
import { computeReceivablesQuality, applyRptOverlay } from '../lib/receivables'

// Names used to validate the model — a clean grower, a hypergrower that should
// not automatically read as a problem, a known AR blowup, a distress case, and
// a customer-concentration case.
const BACKTEST_CASES = ['MSFT', 'NVDA', 'SMCI', 'PLUG', 'CIEN']

function money(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function signedPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function DsoSparkline({ points, band, tierColor }) {
  if (!points || points.length < 2) return null

  const W = 660
  const H = 150
  const padL = 44
  const padR = 12
  const padT = 12
  const padB = 26

  const values = points.map(p => p.dso)
  const lo = Math.min(...values, band.low)
  const hi = Math.max(...values, band.high)
  const span = hi - lo || 1
  const yMin = lo - span * 0.12
  const yMax = hi + span * 0.12

  const x = i => padL + (i / (points.length - 1)) * (W - padL - padR)
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB)

  const line = points.map((p, i) => `${x(i)},${y(p.dso)}`).join(' ')
  const bandTop = y(band.high)
  const bandBottom = y(band.low)

  return (
    <svg className="rpt-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
         aria-label={`Eight-quarter days-sales-outstanding trend, ${points.map(p => `${p.label} ${p.dso.toFixed(0)} days`).join(', ')}`}>
      {/* Sector reference band */}
      <rect x={padL} y={bandTop} width={W - padL - padR} height={Math.max(bandBottom - bandTop, 1)}
            fill="#2c3e6b" opacity="0.08" />
      <line x1={padL} y1={bandTop} x2={W - padR} y2={bandTop} stroke="#2c3e6b" strokeDasharray="4 3" strokeWidth="1" opacity="0.45" />
      <line x1={padL} y1={bandBottom} x2={W - padR} y2={bandBottom} stroke="#2c3e6b" strokeDasharray="4 3" strokeWidth="1" opacity="0.45" />
      <text x={padL - 6} y={bandTop + 4} textAnchor="end" className="rpt-spark-axis">{band.high}d</text>
      <text x={padL - 6} y={bandBottom + 4} textAnchor="end" className="rpt-spark-axis">{band.low}d</text>

      <polyline points={line} fill="none" stroke={tierColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p, i) => (
        <g key={p.date}>
          <circle cx={x(i)} cy={y(p.dso)} r={i === points.length - 1 ? 5 : 3.5} fill={tierColor} />
          <text x={x(i)} y={H - 12} textAnchor="middle" className="rpt-spark-label">{p.label}</text>
          <text x={x(i)} y={y(p.dso) - 10} textAnchor="middle" className="rpt-spark-value">{p.dso.toFixed(0)}</text>
        </g>
      ))}
    </svg>
  )
}

export default function ReceivablesTracker({ holdings = [] }) {
  const [input, setInput] = useState('')
  const [symbol, setSymbol] = useState(null)
  const [result, setResult] = useState(null)
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const analyze = useCallback(async (ticker) => {
    const sym = (ticker || '').trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setError(null)
    setResult(null)
    setSymbol(sym)
    try {
      const payload = await fetchReceivables(sym, 12)
      if (payload.error) throw new Error(payload.error)
      if (!payload.quarters || payload.quarters.length < 2) {
        throw new Error(`No quarterly receivables data available for ${sym}. Funds, ETFs and some ADRs don't file the statements this model needs.`)
      }
      setRaw(payload)
      setResult(computeReceivablesQuality({
        quarters: payload.quarters,
        profile: payload.profile,
        // Tier 2 from the SEC, aligned to these quarters server-side. Null for
        // filers that don't tag the allowance or whose series has gone stale.
        allowanceSeries: payload.allowanceSeries,
        allowanceUnavailableReason: payload.allowanceUnavailableReason,
        symbol: sym
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const holdingSymbols = [...new Set(holdings.map(h => h.symbol).filter(Boolean))]
  const tierColor = result?.ok ? result.tier.color : '#2c3e6b'
  const recentQuarters = result?.series ? result.series.slice(-8).reverse() : []

  return (
    <div className="rpt-section">
      <div className="section-title">Receivables Payment-Timing Tracker</div>
      <div className="rpt-purpose">
        Downside detection: is the company actually collecting the revenue it reports?
        Built on <strong>DSO</strong> &mdash; days sales outstanding, the average number of days between
        making a sale and the cash arriving. A 0&ndash;100 quality signal, not a buy signal.
      </div>

      <form className="rpt-search" onSubmit={e => { e.preventDefault(); analyze(input) }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ticker (e.g. NVDA)"
          maxLength={10}
          aria-label="Ticker symbol"
        />
        <button type="submit" className="rpt-btn" disabled={loading}>
          {loading ? 'Analyzing…' : 'Run RPT'}
        </button>
      </form>

      {holdingSymbols.length > 0 && (
        <div className="rpt-chips">
          <span className="rpt-chips-label">Holdings:</span>
          {holdingSymbols.map(s => (
            <button key={s} className={`rpt-chip ${symbol === s ? 'active' : ''}`}
                    onClick={() => { setInput(s); analyze(s) }}>{s}</button>
          ))}
        </div>
      )}
      <div className="rpt-chips">
        <span className="rpt-chips-label">Backtest cases:</span>
        {BACKTEST_CASES.map(s => (
          <button key={s} className={`rpt-chip ${symbol === s ? 'active' : ''}`}
                  onClick={() => { setInput(s); analyze(s) }}>{s}</button>
        ))}
      </div>

      {loading && <div className="rpt-status">Pulling 12 quarters of statements for {symbol}…</div>}
      {error && <div className="rpt-status rpt-error">{error}</div>}

      {result && !result.ok && (
        <div className="rpt-status rpt-error">
          {result.message}
        </div>
      )}

      {result && result.ok && (
        <div className="rpt-result">
          {/* Headline */}
          <div className="rpt-headline">
            <div className="rpt-score-block" style={{ borderColor: tierColor }}>
              <div className="rpt-score" style={{ color: tierColor }}>{result.score}</div>
              <div className="rpt-score-max">/ 100</div>
              <div className="rpt-tier" style={{ background: tierColor }}>{result.tier.label}</div>
            </div>
            <div className="rpt-meta">
              <div className="rpt-company">
                {result.companyName} <span className="rpt-symbol">{result.symbol}</span>
                {result.status === 'provisional' && <span className="rpt-provisional">provisional</span>}
              </div>
              <div className="rpt-meta-line">
                As of <strong>{result.asOfLabel}</strong> ({result.asOf}) · {result.quartersAvailable} usable quarters
              </div>
              <div className="rpt-meta-line">
                Band: <strong>{result.band.label}</strong> {result.band.low}&ndash;{result.band.high}d
                <span className="rpt-dim"> ({result.band.matchedOn})</span>
              </div>
              <div className="rpt-meta-line">
                Scorecard overlay:{' '}
                <strong style={{ color: result.overlay < 0 ? '#dc3545' : '#28a745' }}>
                  {result.overlay > 0 ? '+' : ''}{result.overlay} pts
                </strong>
                <span className="rpt-dim">
                  {' '}(e.g. a 72.0 Scorecard score becomes {applyRptOverlay(72, result).adjusted})
                </span>
              </div>
              <div className="rpt-tier-blurb">{result.tier.blurb}</div>
            </div>
          </div>

          {/* Tell Sheet flag */}
          <div className="rpt-flag" style={{ borderLeftColor: tierColor }}>
            <div className="rpt-flag-label">Tell Sheet flag</div>
            <div className="rpt-flag-text">{result.flag}</div>
          </div>

          {/* 8Q DSO trend */}
          <div className="rpt-block">
            <div className="rpt-block-title">How Long Customers Take to Pay &mdash; 8 Quarters</div>
            <DsoSparkline points={result.sparkline} band={result.band} tierColor={tierColor} />
            <div className="rpt-caption">
              Each point is days sales outstanding (DSO) &mdash; average days from sale to cash, calculated as
              (average money owed by customers ÷ revenue) × 91. Lower is better; rising means customers are
              slowing down. Shaded band = the typical range for {result.band.label} ({result.band.low}&ndash;{result.band.high} days).
            </div>
          </div>

          {/* Component breakdown */}
          <div className="rpt-block">
            <div className="rpt-block-title">Component Breakdown</div>
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Weight</th>
                  <th>Score contribution</th>
                </tr>
              </thead>
              <tbody>
                {result.components.map(c => (
                  <tr key={c.key} className={c.unavailable ? 'rpt-row-muted' : ''}>
                    <td>
                      <div className="rpt-metric-name">{c.label}</div>
                      <div className="rpt-anchors">{c.anchors}</div>
                    </td>
                    <td className="rpt-value-cell">{c.valueText}</td>
                    <td className="rpt-num">
                      {c.effectiveWeight ? `${c.effectiveWeight.toFixed(0)}%` : '—'}
                    </td>
                    <td className="rpt-num">
                      {c.points == null ? '—' : (
                        <>
                          <strong>{c.points.toFixed(1)}</strong>
                          <div className="rpt-bar">
                            <div className="rpt-bar-fill"
                                 style={{ width: `${(c.score01 * 100).toFixed(0)}%`, background: tierColor }} />
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="rpt-total-row">
                  <td colSpan={3}>Composite RPT score</td>
                  <td className="rpt-num"><strong>{result.score}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Guardrails */}
          {result.guardrails.length > 0 && (
            <div className="rpt-block">
              <div className="rpt-block-title">Guardrails &amp; Caveats</div>
              <ul className="rpt-guardrails">
                {result.guardrails.map(g => (
                  <li key={g.key} className={`rpt-guardrail rpt-${g.severity}`}>
                    <span className="rpt-guardrail-tag">{g.severity === 'warn' ? 'CHECK' : 'NOTE'}</span>
                    {g.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Quarter detail */}
          <div className="rpt-block">
            <div className="rpt-block-title">Quarterly Detail</div>
            <div className="rpt-table-scroll">
              <table className="rpt-table rpt-table-compact">
                <thead>
                  <tr>
                    <th>Quarter</th>
                    <th>Revenue</th>
                    <th>Owed by<br/>customers</th>
                    <th>Avg owed</th>
                    <th>Days to<br/>collect</th>
                    <th>Days<br/>vs yr ago</th>
                    <th>Owed<br/>vs yr ago</th>
                    <th>Revenue<br/>vs yr ago</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuarters.map(q => (
                    <tr key={q.date} className={q.maFlag ? 'rpt-row-ma' : ''}>
                      <td>{q.label}{q.maFlag && <span className="rpt-ma-tag" title="Acquisition &gt;10% of revenue">M&amp;A</span>}</td>
                      <td className="rpt-num">{money(q.revenue)}</td>
                      <td className="rpt-num">{money(q.ar)}</td>
                      <td className="rpt-num">{money(q.avgAr)}</td>
                      <td className="rpt-num"><strong>{q.dso == null ? '—' : `${q.dso.toFixed(1)}d`}</strong></td>
                      <td className={`rpt-num ${q.dsoYoY > 0 ? 'rpt-bad' : q.dsoYoY < 0 ? 'rpt-good' : ''}`}>{signedPct(q.dsoYoY)}</td>
                      <td className="rpt-num">{signedPct(q.arYoY)}</td>
                      <td className="rpt-num">{signedPct(q.revYoY)}</td>
                      <td className={`rpt-num ${q.divergence > 10 ? 'rpt-bad' : q.divergence <= 0 ? 'rpt-good' : ''}`}>
                        {q.divergence == null ? '—' : `${q.divergence >= 0 ? '+' : ''}${q.divergence.toFixed(1)} pts`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {raw?.profile?.industry && (
              <div className="rpt-caption">
                Source: FMP quarterly income statement, balance sheet and cash-flow statement · {raw.profile.industry}
                {raw.cached && ' · cached'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
