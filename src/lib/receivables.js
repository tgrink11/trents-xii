// BUS! Receivables Payment-Timing Tracker (RPT)
//
// Downside-detection model: does a company's receivables behavior confirm or
// contradict its reported revenue growth? Pure functions — no fetching here, so
// the math can be exercised offline by scripts/rpt-backtest.mjs.

export const DAYS_IN_PERIOD = 91

// ---------------------------------------------------------------- industry bands

// Median DSO reference bands (days), adapted to BUS! coverage sectors from
// cross-industry DSO benchmark data. Directional, not exact.
export const INDUSTRY_BANDS = [
  {
    key: 'semiconductors',
    label: 'Semiconductors',
    low: 50, high: 65,
    match: [/semiconductor/i]
  },
  {
    key: 'saas',
    label: 'Software: SaaS / subscription',
    low: 30, high: 45,
    match: [/software\s*[-—]\s*application/i, /^software$/i, /internet content/i, /software application/i]
  },
  {
    key: 'enterprise-software',
    label: 'Software: enterprise / legacy license',
    low: 60, high: 65,
    match: [/software\s*[-—]\s*infrastructure/i, /enterprise software/i]
  },
  {
    key: 'it-services',
    label: 'Computer / IT services',
    low: 70, high: 80,
    match: [/information technology services/i, /\bit services\b/i, /technology consulting/i, /staffing/i]
  },
  {
    key: 'telecom-equipment',
    label: 'Telecom equipment',
    low: 65, high: 75,
    match: [/communication equipment/i, /telecom.*equipment/i, /networking/i]
  },
  {
    key: 'fintech',
    label: 'Fintech / transaction-based financial services',
    low: 15, high: 30,
    match: [/credit services/i, /financial\s*[-—]\s*data/i, /stock exchanges/i, /payment/i, /financial conglomerates/i]
  },
  {
    key: 'tech-hardware',
    label: 'General technology hardware',
    low: 45, high: 60,
    match: [/hardware/i, /consumer electronics/i, /electronic components/i, /computer/i, /technology distributors/i, /solar/i]
  },
  {
    key: 'industrial',
    label: 'Diversified industrial (fallback)',
    low: 45, high: 60,
    match: [/industrial/i, /machinery/i, /aerospace/i, /electrical equipment/i, /manufactur/i, /engineering/i, /construction/i, /auto\b/i, /chemicals/i, /packaging/i, /metals/i, /oil/i, /gas/i, /energy/i]
  }
]

export const DEFAULT_BAND_KEY = 'tech-hardware'

// Manual overrides where FMP's industry tag doesn't map cleanly to billing model.
export const BAND_OVERRIDES = {
  CRM: 'saas', NOW: 'saas', WDAY: 'saas', ADBE: 'saas', SNOW: 'saas',
  DDOG: 'saas', ZM: 'saas', TEAM: 'saas', HUBS: 'saas', VEEV: 'saas',
  ORCL: 'enterprise-software', MSFT: 'enterprise-software', SAP: 'enterprise-software',
  IBM: 'it-services', ACN: 'it-services', INFY: 'it-services', CTSH: 'it-services', DXC: 'it-services',
  CSCO: 'telecom-equipment', ERIC: 'telecom-equipment', NOK: 'telecom-equipment',
  JNPR: 'telecom-equipment', CIEN: 'telecom-equipment', LITE: 'telecom-equipment',
  V: 'fintech', MA: 'fintech', PYPL: 'fintech', SQ: 'fintech', FI: 'fintech', GPN: 'fintech'
}

// Sectors where DSO is structurally meaningless or dominated by the business
// model rather than collection behavior — score is still shown, but caveated.
const LOW_SIGNAL_INDUSTRY = [
  /^bank/i, /banks\b/i, /insurance/i, /asset management/i, /capital markets/i,
  /reit/i, /real estate/i, /^utilities/i, /regulated (electric|gas|water)/i,
  /mortgage/i, /^shell companies/i
]

export function resolveBand(profile = {}, symbol = '', overrideKey = null) {
  const key = overrideKey || BAND_OVERRIDES[(symbol || '').toUpperCase()]
  if (key) {
    const forced = INDUSTRY_BANDS.find(b => b.key === key)
    if (forced) return { ...forced, matchedOn: 'manual override' }
  }

  const industry = profile.industry || ''
  const sector = profile.sector || ''
  for (const band of INDUSTRY_BANDS) {
    if (band.match.some(rx => rx.test(industry))) return { ...band, matchedOn: `industry: ${industry}` }
  }
  for (const band of INDUSTRY_BANDS) {
    if (band.match.some(rx => rx.test(sector))) return { ...band, matchedOn: `sector: ${sector}` }
  }
  const fallback = INDUSTRY_BANDS.find(b => b.key === DEFAULT_BAND_KEY)
  return { ...fallback, matchedOn: 'default (no clean industry match)' }
}

export function sectorCaveat(profile = {}) {
  const text = `${profile.industry || ''} ${profile.sector || ''}`
  if (profile.isEtf) return 'This is a fund/ETF — it has no receivables. RPT does not apply.'
  if (LOW_SIGNAL_INDUSTRY.some(rx => rx.test(text))) {
    return `${profile.industry || profile.sector} — receivables here reflect the balance-sheet business model, not customer payment behavior. Treat the RPT score as low-signal.`
  }
  return null
}

// ---------------------------------------------------------------- small helpers

const isNum = v => v != null && Number.isFinite(v)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Growth % — undefined when the base is zero or negative (a swing out of a loss
// is not a growth rate, and pretending otherwise creates phantom flags).
function growthPct(current, base) {
  if (!isNum(current) || !isNum(base) || base <= 0) return null
  return ((current - base) / base) * 100
}

// Level-to-level % change, safe for any non-zero denominator.
function pctChange(current, prior) {
  if (!isNum(current) || !isNum(prior) || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}

// Ordinary least squares slope of y over index, returned as % of the mean per period.
function trendSlopePct(values) {
  const pts = values.map((y, x) => ({ x, y })).filter(p => isNum(p.y))
  if (pts.length < 4) return null
  const n = pts.length
  const meanX = pts.reduce((s, p) => s + p.x, 0) / n
  const meanY = pts.reduce((s, p) => s + p.y, 0) / n
  if (meanY === 0) return null
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.x - meanX) * (p.y - meanY)
    den += (p.x - meanX) ** 2
  }
  if (den === 0) return null
  return ((num / den) / meanY) * 100 // % of mean DSO per quarter
}

// 1.0 at the green anchor or better, 0.0 at the red anchor or worse, linear between.
function scoreLinear(value, greenAt, redAt) {
  if (!isNum(value)) return null
  if (redAt === greenAt) return value <= greenAt ? 1 : 0
  const t = (value - greenAt) / (redAt - greenAt)
  return clamp(1 - t, 0, 1)
}

// Label on the company's own fiscal calendar when the filing gives us one —
// pairing a fiscal quarter with the calendar year produces duplicate, wrong
// labels for anyone whose fiscal year is offset (MSFT, NVDA, CIEN).
function quarterLabel(q) {
  const calYear = String(q.date || '').slice(2, 4)
  const fiscalYear = q.fiscalYear ? String(q.fiscalYear).slice(-2) : null
  if (q.period && /^Q[1-4]$/.test(q.period) && fiscalYear) return `${q.period} FY${fiscalYear}`
  const month = Number(String(q.date || '').slice(5, 7))
  const qn = month ? Math.ceil(month / 3) : null
  return qn ? `Q${qn} '${calYear}` : (q.date || '—')
}

function sumRange(arr, endIdx, len, field) {
  if (endIdx - len + 1 < 0) return null
  let total = 0
  for (let i = endIdx - len + 1; i <= endIdx; i++) {
    const v = arr[i]?.[field]
    if (!isNum(v)) return null
    total += v
  }
  return total
}

// ---------------------------------------------------------------- weights & tiers

export const BASE_WEIGHTS = { dsoTrend: 30, divergence: 25, bandPosition: 20, cashConversion: 15, allowance: 10 }
// Tier 2 allowance data lives in 10-Q/10-K footnotes, not FMP's standardized
// statements. When it's missing its 10% is redistributed pro-rata.
export const WEIGHTS_NO_TIER2 = { dsoTrend: 33, divergence: 28, bandPosition: 22, cashConversion: 17 }

export const TIERS = [
  { key: 'clean', label: 'Clean', min: 80, max: 100, color: '#28a745', blurb: 'Receivables behavior confirms reported revenue quality. No overlay adjustment.' },
  { key: 'watch', label: 'Watch', min: 60, max: 79, color: '#c9a227', blurb: 'One metric diverging. Note in Scorecard commentary; re-check next quarter. No score adjustment yet.' },
  { key: 'caution', label: 'Caution', min: 40, max: 59, color: '#e07b39', blurb: 'Multiple metrics diverging. Overlay applied and flagged explicitly on the Tell Sheet.' },
  { key: 'red-flag', label: 'Red Flag', min: 0, max: 39, color: '#dc3545', blurb: 'High-probability revenue quality issue — channel stuffing, customer distress, or aggressive rev rec. Hold new position sizing until Kerry reviews the fundamentals.' }
]

export function tierFor(score) {
  return TIERS.find(t => score >= t.min && score <= t.max) || TIERS[TIERS.length - 1]
}

// Option A integration: capped +/-15 point adjustment to the final Scorecard score.
export function overlayFromScore(score) {
  if (!isNum(score)) return 0
  if (score >= 60) return 0
  let adj
  if (score >= 40) adj = -(5 + ((59 - score) / 19) * 5)      // 59 -> -5,  40 -> -10
  else adj = -(10 + ((39 - score) / 39) * 5)                 // 39 -> -10,  0 -> -15
  return Math.round(clamp(adj, -15, 15) * 10) / 10
}

export function applyRptOverlay(scorecardScore, rpt) {
  const adjustment = rpt && rpt.ok ? overlayFromScore(rpt.score) : 0
  const base = isNum(scorecardScore) ? scorecardScore : null
  return {
    base,
    adjustment,
    adjusted: base == null ? null : clamp(Math.round((base + adjustment) * 10) / 10, 0, 100)
  }
}

// ---------------------------------------------------------------- main model

/**
 * @param {object} input
 * @param {Array}  input.quarters  oldest-first quarterly rows from /api/receivables
 * @param {object} input.profile   { companyName, sector, industry, isEtf }
 * @param {string} input.symbol
 * @param {Array}  [input.allowanceSeries] optional Tier 2: [{date, allowance, grossAr}]
 * @param {string} [input.allowanceUnavailableReason] why Tier 2 is off, when it's a config gap rather than a filer gap
 * @param {string} [input.bandOverride]
 */
export function computeReceivablesQuality({ quarters = [], profile = {}, symbol = '', allowanceSeries = null, allowanceUnavailableReason = null, bandOverride = null }) {
  const band = resolveBand(profile, symbol, bandOverride)
  const caveat = sectorCaveat(profile)
  const companyName = profile.companyName || symbol

  const raw = [...quarters].sort((a, b) => new Date(a.date) - new Date(b.date))

  // Average net receivables needs a beginning balance, so the oldest raw quarter
  // is consumed as an opening reading only.
  const series = []
  for (let i = 1; i < raw.length; i++) {
    const q = raw[i]
    const prev = raw[i - 1]
    const avgAr = (isNum(q.netReceivables) && isNum(prev.netReceivables))
      ? (prev.netReceivables + q.netReceivables) / 2
      : null
    const dso = (isNum(avgAr) && isNum(q.revenue) && q.revenue > 0)
      ? (avgAr / q.revenue) * DAYS_IN_PERIOD
      : null
    series.push({
      date: q.date,
      label: quarterLabel(q),
      revenue: q.revenue,
      ar: q.netReceivables,
      avgAr,
      dso,
      netIncome: q.netIncome ?? null,
      freeCashFlow: q.freeCashFlow ?? null,
      arChange: q.arChange ?? null,
      acquisitionsNet: q.acquisitionsNet ?? null,
      // Purchase accounting moves AR without saying anything about collections.
      maFlag: isNum(q.acquisitionsNet) && isNum(q.revenue) && q.revenue > 0
        ? Math.abs(q.acquisitionsNet) > 0.10 * q.revenue
        : false
    })
  }

  // Per-quarter YoY figures, used for streak counting as well as the headline.
  for (let i = 0; i < series.length; i++) {
    const yoy = series[i - 4]
    series[i].dsoYoY = yoy ? pctChange(series[i].dso, yoy.dso) : null
    series[i].arYoY = yoy ? growthPct(series[i].ar, yoy.ar) : null
    series[i].revYoY = yoy ? growthPct(series[i].revenue, yoy.revenue) : null
    series[i].divergence = (isNum(series[i].arYoY) && isNum(series[i].revYoY))
      ? series[i].arYoY - series[i].revYoY
      : null
  }

  const usable = series.filter(s => isNum(s.dso))
  const latestIdx = series.length - 1
  const latest = series[latestIdx]

  const insufficient = {
    ok: false,
    status: 'insufficient',
    symbol,
    companyName,
    band,
    caveat,
    quartersAvailable: usable.length,
    series,
    sparkline: usable.slice(-8).map(s => ({ label: s.label, dso: s.dso, date: s.date })),
    message: `Only ${usable.length} usable quarter${usable.length === 1 ? '' : 's'} of receivables data. RPT requires 4+ consecutive quarters before generating a first score.`,
    guardrails: []
  }
  if (!latest || !isNum(latest.dso)) return insufficient

  // --- Component 1: DSO trend (QoQ + YoY + 8Q slope) --------------------------
  const dsoQoQ = pctChange(latest.dso, series[latestIdx - 1]?.dso)
  const dsoYoY = latest.dsoYoY
  const slopePerQuarter = trendSlopePct(usable.slice(-8).map(s => s.dso))
  const slopeAnnualized = isNum(slopePerQuarter) ? slopePerQuarter * 4 : null

  // Weighted blend anchored on YoY so seasonal billing patterns don't drive the flag.
  const trendParts = [
    { v: dsoYoY, w: 0.55 },
    { v: slopeAnnualized, w: 0.25 },
    { v: dsoQoQ, w: 0.20 }
  ].filter(p => isNum(p.v))
  const trendWeight = trendParts.reduce((s, p) => s + p.w, 0)
  const blendedTrend = trendWeight > 0
    ? trendParts.reduce((s, p) => s + p.v * p.w, 0) / trendWeight
    : null

  // --- Component 2: AR / Revenue growth divergence ----------------------------
  const divergence = latest.divergence
  let divergenceStreak = 0
  for (let i = latestIdx; i >= 0; i--) {
    if (isNum(series[i].divergence) && series[i].divergence > 10) divergenceStreak++
    else break
  }

  // --- Component 3: industry-adjusted DSO position ----------------------------
  const bandRatio = latest.dso / band.high
  // Rough percentile within the sector band: 0% at the floor, 100% at the ceiling.
  const bandPercentile = band.high > band.low
    ? clamp(((latest.dso - band.low) / (band.high - band.low)) * 100, 0, 200)
    : null

  // --- Component 4: cash conversion (NI vs FCF, AR-attributed) ----------------
  const useTTM = series.length >= 8
  let niGrowth = null
  let fcfGrowth = null
  let cashBasis = 'n/a'
  let dollarGap = null
  let arDrag = null
  if (useTTM) {
    const niTTM = sumRange(series, latestIdx, 4, 'netIncome')
    const niPrior = sumRange(series, latestIdx - 4, 4, 'netIncome')
    const fcfTTM = sumRange(series, latestIdx, 4, 'freeCashFlow')
    const fcfPrior = sumRange(series, latestIdx - 4, 4, 'freeCashFlow')
    niGrowth = growthPct(niTTM, niPrior)
    fcfGrowth = growthPct(fcfTTM, fcfPrior)
    cashBasis = 'TTM vs prior-year TTM'
    if (isNum(niTTM) && isNum(fcfTTM)) dollarGap = niTTM - fcfTTM
    // Cash-flow AR line: negative = receivables grew and consumed cash.
    const arFlow = sumRange(series, latestIdx, 4, 'arChange')
    if (isNum(arFlow)) arDrag = -arFlow
  } else {
    const prior = series[latestIdx - 4]
    niGrowth = prior ? growthPct(latest.netIncome, prior.netIncome) : null
    fcfGrowth = prior ? growthPct(latest.freeCashFlow, prior.freeCashFlow) : null
    cashBasis = 'single quarter YoY'
    if (isNum(latest.netIncome) && isNum(latest.freeCashFlow)) dollarGap = latest.netIncome - latest.freeCashFlow
    if (isNum(latest.arChange)) arDrag = -latest.arChange
  }

  const cashGap = (isNum(niGrowth) && isNum(fcfGrowth)) ? niGrowth - fcfGrowth : null
  // Only penalize a cash shortfall that receivables actually explain.
  let arAttribution = null
  if (isNum(dollarGap) && dollarGap > 0 && isNum(arDrag)) {
    arAttribution = clamp(arDrag / dollarGap, 0, 1)
  } else if (isNum(dollarGap) && dollarGap <= 0) {
    arAttribution = 0
  }
  const attributionForScore = isNum(arAttribution) ? arAttribution : 0.5
  const effectiveCashGap = isNum(cashGap) && cashGap > 0 ? cashGap * attributionForScore : cashGap

  // --- Component 5 (Tier 2, optional): allowance ratio trend ------------------
  let allowanceRatio = null
  let allowanceRising = 0
  let allowanceAvailable = false
  if (Array.isArray(allowanceSeries) && allowanceSeries.length >= 3) {
    const ratios = allowanceSeries
      .filter(a => isNum(a.allowance) && isNum(a.grossAr) && a.grossAr > 0)
      .map(a => ({ date: a.date, ratio: a.allowance / a.grossAr }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
    if (ratios.length >= 3) {
      allowanceAvailable = true
      allowanceRatio = ratios[ratios.length - 1].ratio
      for (let i = ratios.length - 1; i > 0; i--) {
        if (ratios[i].ratio > ratios[i - 1].ratio) allowanceRising++
        else break
      }
    }
  }

  const weights = allowanceAvailable ? BASE_WEIGHTS : WEIGHTS_NO_TIER2

  // --- Scoring ----------------------------------------------------------------
  const scores = {
    dsoTrend: scoreLinear(blendedTrend, 0, 15),
    divergence: scoreLinear(divergence, 0, 10),
    bandPosition: scoreLinear(bandRatio, 1.0, 1.5),
    cashConversion: scoreLinear(effectiveCashGap, 0, 20),
    allowance: allowanceAvailable ? scoreLinear(allowanceRising, 0, 2) : null
  }

  const pts = v => isNum(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts` : '—'
  const pct = v => isNum(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'

  const components = [
    {
      key: 'dsoTrend',
      label: 'DSO trend (QoQ + YoY + 8Q slope)',
      value: blendedTrend,
      valueText: `${latest.dso.toFixed(1)}d · YoY ${pct(dsoYoY)} · QoQ ${pct(dsoQoQ)} · slope ${pct(slopeAnnualized)}/yr`,
      anchors: 'Green: flat or declining · Red: YoY DSO up >15%',
      weight: weights.dsoTrend,
      score01: scores.dsoTrend
    },
    {
      key: 'divergence',
      label: 'AR / Revenue growth divergence',
      value: divergence,
      valueText: isNum(divergence)
        ? `${pts(divergence)} (AR ${pct(latest.arYoY)} vs revenue ${pct(latest.revYoY)})`
        : '—',
      anchors: 'Green: ≤0 pts · Red: >10 pts',
      weight: weights.divergence,
      score01: scores.divergence
    },
    {
      key: 'bandPosition',
      label: 'Industry-adjusted DSO percentile',
      value: bandRatio,
      valueText: `${latest.dso.toFixed(1)}d vs ${band.low}–${band.high}d band (${(bandRatio * 100).toFixed(0)}% of ceiling)`,
      anchors: `Green: within ${band.label} band · Red: >1.5x ceiling (${(band.high * 1.5).toFixed(0)}d)`,
      weight: weights.bandPosition,
      score01: scores.bandPosition
    },
    {
      key: 'cashConversion',
      label: 'Cash conversion signal',
      value: cashGap,
      valueText: isNum(cashGap)
        ? `NI ${pct(niGrowth)} vs FCF ${pct(fcfGrowth)} = ${pts(cashGap)} gap · ${isNum(arAttribution) ? `${(arAttribution * 100).toFixed(0)}% AR-explained` : 'AR attribution unknown'}`
        : `Not computable — ${cashBasis} base is zero or negative`,
      anchors: 'Green: FCF/NI growth in line · Red: NI exceeds FCF by >20 pts, AR-driven',
      weight: weights.cashConversion,
      score01: scores.cashConversion
    }
  ]

  if (allowanceAvailable) {
    components.push({
      key: 'allowance',
      label: 'Allowance ratio trend (Tier 2)',
      value: allowanceRising,
      valueText: `${(allowanceRatio * 100).toFixed(2)}% of gross AR · rising ${allowanceRising} consecutive quarter${allowanceRising === 1 ? '' : 's'}`,
      anchors: 'Green: flat/declining · Red: rising 2+ consecutive quarters',
      weight: weights.allowance,
      score01: scores.allowance
    })
  } else {
    components.push({
      key: 'allowance',
      label: 'Allowance ratio trend (Tier 2)',
      value: null,
      valueText: 'Not available — allowance for doubtful accounts is a 10-Q/10-K footnote (XBRL AllowanceForDoubtfulAccountsReceivable), not an FMP standardized line.',
      anchors: 'Weight redistributed pro-rata across the other four components.',
      weight: 0,
      score01: null,
      unavailable: true
    })
  }

  // Any component we couldn't compute gets its weight redistributed too, so a
  // missing input never silently reads as a passing grade.
  const scored = components.filter(c => isNum(c.score01) && c.weight > 0)
  const scoredWeight = scored.reduce((s, c) => s + c.weight, 0)
  for (const c of components) {
    c.effectiveWeight = (scoredWeight > 0 && isNum(c.score01) && c.weight > 0)
      ? (c.weight / scoredWeight) * 100
      : 0
    c.points = isNum(c.score01) ? Math.round(c.score01 * c.effectiveWeight * 10) / 10 : null
  }

  if (scoredWeight === 0) {
    return { ...insufficient, message: 'No RPT component could be computed from the available statements.' }
  }

  const score = Math.round(scored.reduce((s, c) => s + c.score01 * (c.weight / scoredWeight), 0) * 100)

  // --- Guardrails -------------------------------------------------------------
  const guardrails = []
  const usableCount = usable.length

  if (usableCount < 4) {
    const extreme = isNum(dsoYoY) && Math.abs(dsoYoY) > 25
    guardrails.push({
      key: 'sample',
      severity: 'warn',
      text: extreme
        ? `Only ${usableCount} usable quarters — below the 4-quarter minimum, but the ${dsoYoY.toFixed(1)}% YoY DSO move is extreme enough to surface anyway. Treat as provisional.`
        : `Only ${usableCount} usable quarters — below the 4-quarter minimum. Score is provisional; don't act on one quarter.`
    })
  }

  const maQuarters = series.slice(-8).filter(s => s.maFlag)
  if (maQuarters.length) {
    guardrails.push({
      key: 'ma',
      severity: 'warn',
      text: `Acquisition >10% of revenue in ${maQuarters.map(q => q.label).join(', ')}. AR in those quarters moved on purchase accounting, not collection behavior — discount the trend across them.`
    })
  }

  if (latest.dso < band.low * 0.6) {
    guardrails.push({
      key: 'factoring',
      severity: 'warn',
      text: `DSO of ${latest.dso.toFixed(1)}d sits far below the ${band.low}–${band.high}d ${band.label} band. Check the 10-K for "sale of receivables" / securitization language before treating this as clean — factored receivables leave the balance sheet and flatter DSO artificially.`
    })
  }

  // A company compounding revenue sequentially will show period-end AR outrunning
  // trailing revenue growth even when nobody is paying slower — the divergence
  // component fires, but DSO (the direct measure of collection speed) doesn't.
  if (isNum(divergence) && divergence > 10 && isNum(dsoYoY) && dsoYoY <= 5 && bandRatio <= 1.0) {
    guardrails.push({
      key: 'hypergrowth',
      severity: 'info',
      text: `AR/revenue divergence is ${divergence >= 0 ? '+' : ''}${divergence.toFixed(0)} pts, but DSO is ${dsoYoY >= 0 ? '+' : ''}${dsoYoY.toFixed(1)}% YoY and still inside the ${band.low}–${band.high}d band. In a fast-compounding quarter, period-end receivables mechanically outrun trailing revenue growth — collection speed itself has not deteriorated. Weight the DSO trend row over the divergence row here.`
    })
  }

  if (isNum(dsoQoQ) && isNum(dsoYoY) && dsoQoQ > 15 && dsoYoY <= 0) {
    guardrails.push({
      key: 'seasonality',
      severity: 'info',
      text: `QoQ DSO is up ${dsoQoQ.toFixed(1)}% while YoY is ${dsoYoY.toFixed(1)}% — that reads as seasonal. The score is anchored on YoY for exactly this reason.`
    })
  }

  if (score < 60) {
    guardrails.push({
      key: 'mix',
      severity: 'info',
      text: 'Before acting on this flag, sanity-check it against the 10-Q MD&A or the earnings call — a shift toward usage-based or prepaid billing moves DSO structurally with no quality signal behind it.'
    })
  }

  if (!allowanceAvailable) {
    guardrails.push({
      key: 'tier2',
      severity: allowanceUnavailableReason ? 'warn' : 'info',
      text: allowanceUnavailableReason
        || 'No usable allowance-for-doubtful-accounts history from the SEC for this filer — either it never tags the concept, or its tagged series is stale. Tier 2’s 10% weight is redistributed 33/28/22/17 across the remaining components.'
    })
  } else if (isNum(allowanceRatio) && allowanceRatio < 0.0025) {
    // The Tier 2 component scores the *trend*, so a company carrying almost no
    // reserve gets full marks simply for not raising it. On a large receivables
    // book that thin reserve is the finding, not a clean bill.
    guardrails.push({
      key: 'allowance-level',
      severity: 'warn',
      text: `The allowance is only ${(allowanceRatio * 100).toFixed(2)}% of gross AR. Tier 2 scores whether the reserve is rising, so a book this thinly reserved earns full marks for holding flat — read that as "management is not provisioning", not as "collections are safe", and check the reserve against peers.`
    })
  }

  if (caveat) guardrails.push({ key: 'sector', severity: 'warn', text: caveat })

  const tier = tierFor(score)
  const overlay = overlayFromScore(score)

  return {
    ok: true,
    status: usableCount < 4 ? 'provisional' : 'ok',
    symbol,
    companyName,
    band,
    caveat,
    asOf: latest.date,
    asOfLabel: latest.label,
    quartersAvailable: usableCount,
    score,
    tier,
    overlay,
    components,
    series,
    sparkline: usable.slice(-8).map(s => ({ label: s.label, dso: s.dso, date: s.date })),
    metrics: {
      dso: { latest: latest.dso, qoq: dsoQoQ, yoy: dsoYoY, slopePerQuarter, slopeAnnualized, blendedTrend },
      divergence: { value: divergence, arYoY: latest.arYoY, revYoY: latest.revYoY, streak: divergenceStreak },
      band: { ratio: bandRatio, percentile: bandPercentile, low: band.low, high: band.high },
      cashConversion: { gap: cashGap, niGrowth, fcfGrowth, basis: cashBasis, dollarGap, arDrag, arAttribution },
      allowance: { available: allowanceAvailable, ratio: allowanceRatio, risingQuarters: allowanceRising }
    },
    flag: buildFlag({
      score,
      tier,
      components,
      latest,
      divergenceStreak,
      dsoYoY,
      band,
      m: { divergence, bandRatio, cashGap, arAttribution, blendedTrend }
    }),
    guardrails
  }
}

// ---------------------------------------------------------------- flag copy

// One plain-English line for the Tell Sheet / Scorecard commentary, written off
// whichever component is doing the most damage.
function buildFlag({ score, tier, components, latest, divergenceStreak, dsoYoY, band, m }) {
  if (score >= 80) {
    const yoyText = isNum(dsoYoY) ? ` (${dsoYoY >= 0 ? '+' : ''}${dsoYoY.toFixed(0)}% YoY)` : ''
    return `Receivables track revenue — DSO ${latest.dso.toFixed(0)} days${yoyText}, inside the ${band.low}–${band.high}d ${band.label} band. Reported growth is cash-backed.`
  }

  const worst = components
    .filter(c => isNum(c.score01) && c.weight > 0)
    .sort((a, b) => a.score01 - b.score01)[0]
  if (!worst) return `RPT ${score}/100 — ${tier.label}. ${tier.blurb}`

  const streakText = divergenceStreak >= 2 ? ` for ${divergenceStreak} straight quarters` : ''

  switch (worst.key) {
    case 'divergence':
      return `AR growing ${Math.abs(m.divergence).toFixed(0)} points faster than revenue${streakText} — treat reported growth with skepticism until collections catch up.`
    case 'dsoTrend': {
      const move = isNum(dsoYoY) ? dsoYoY : m.blendedTrend
      return `DSO up ${move.toFixed(0)}% YoY to ${latest.dso.toFixed(0)} days — customers are paying slower than they used to, which usually shows up in demand before it shows up in guidance.`
    }
    case 'bandPosition':
      return `DSO of ${latest.dso.toFixed(0)} days runs ${(m.bandRatio * 100 - 100).toFixed(0)}% past the ${band.high}d ceiling for ${band.label} — collections are structurally slower than the peer set.`
    case 'cashConversion': {
      const attrText = isNum(m.arAttribution) ? ` and ${(m.arAttribution * 100).toFixed(0)}% of that gap is rising receivables` : ''
      return `Net income is outgrowing free cash flow by ${m.cashGap.toFixed(0)} points${attrText} — earnings are being reported ahead of the cash.`
    }
    case 'allowance':
      return `Allowance for doubtful accounts has risen ${worst.value} consecutive quarters — management is pricing in write-offs before they show up in the numbers.`
    default:
      return `RPT ${score}/100 — ${tier.label}. ${tier.blurb}`
  }
}
