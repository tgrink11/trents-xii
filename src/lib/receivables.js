// BUS! Receivables Payment-Timing Tracker (RPT)
//
// Downside-detection model: does a company's receivables behavior confirm or
// contradict its reported revenue growth? Pure functions — no fetching here, so
// the math can be exercised offline by scripts/rpt-backtest.mjs.

export const DAYS_IN_PERIOD = 91

// ---------------------------------------------------------------- industry bands

// Sector reference profiles.
//
// Two calibrations per sector, both directional rather than exact:
//   dsoLow/dsoHigh   — median DSO band (days). A 65-day DSO means one thing for
//                      a semiconductor company and another for a restaurant.
//   reserveFloor     — allowance for doubtful accounts as a share of gross AR,
//   reserveTypical     below which a book looks under-reserved for the sector.
//
// The DSO bands for the technology rows come from cross-industry DSO benchmark
// data adapted to coverage sectors. The non-tech rows and every reserve figure
// are directional priors, set deliberately wide so only egregious outliers
// score badly — a wrong norm should cost a company nothing, not accuse it.
// Tune them as real peer data accumulates.
//
// Order matters: the first regex to match wins, so specific rows precede broad
// ones. Matching runs against FMP's `industry` first, then `sector`.
export const INDUSTRY_BANDS = [
  // ---- technology ----
  {
    key: 'semiconductors',
    label: 'Semiconductors',
    low: 50, high: 65, reserveFloor: 0.003, reserveTypical: 0.007,
    match: [/semiconductor/i]
  },
  {
    key: 'saas',
    label: 'Software: SaaS / subscription',
    low: 30, high: 45, reserveFloor: 0.010, reserveTypical: 0.020,
    match: [/software\s*[-—]\s*application/i, /^software$/i, /software application/i]
  },
  {
    key: 'enterprise-software',
    label: 'Software: enterprise / legacy license',
    low: 60, high: 65, reserveFloor: 0.008, reserveTypical: 0.015,
    match: [/software\s*[-—]\s*infrastructure/i, /enterprise software/i]
  },
  {
    key: 'it-services',
    label: 'Computer / IT services',
    low: 70, high: 80, reserveFloor: 0.008, reserveTypical: 0.018,
    match: [/information technology services/i, /\bit services\b/i, /technology consulting/i, /staffing/i]
  },
  {
    key: 'telecom-equipment',
    label: 'Telecom equipment',
    low: 65, high: 75, reserveFloor: 0.008, reserveTypical: 0.020,
    match: [/communication equipment/i, /telecom.*equipment/i, /networking/i]
  },
  {
    key: 'fintech',
    label: 'Fintech / transaction-based financial services',
    low: 15, high: 30, reserveFloor: 0.010, reserveTypical: 0.025,
    match: [/credit services/i, /financial\s*[-—]\s*data/i, /stock exchanges/i, /payment/i, /financial conglomerates/i]
  },
  {
    key: 'tech-hardware',
    label: 'General technology hardware',
    low: 45, high: 60, reserveFloor: 0.004, reserveTypical: 0.010,
    match: [/hardware/i, /consumer electronics/i, /electronic components/i, /computer/i, /technology distributors/i, /solar/i]
  },

  // ---- consumer ----
  {
    // Sells to the end consumer, who pays at the point of sale. Receivables are
    // card settlements and vendor allowances, so DSO is single-digit by nature.
    key: 'consumer-retail',
    label: 'Retail / restaurants (consumer-paid)',
    low: 3, high: 12, reserveFloor: 0.004, reserveTypical: 0.012,
    match: [/discount stores/i, /restaurants/i, /home improvement/i, /specialty retail/i, /grocery/i, /department stores/i, /apparel\s*[-—]\s*retail/i, /internet retail/i, /auto\s*[-—]\s*dealerships/i, /luxury goods/i, /personal services/i]
  },
  {
    key: 'homebuilders',
    label: 'Homebuilding',
    low: 5, high: 15, reserveFloor: 0.003, reserveTypical: 0.010,
    match: [/residential construction/i, /homebuild/i]
  },
  {
    // Branded manufacturers selling into retail — terms are set by the retailer.
    key: 'consumer-brands',
    label: 'Consumer brands (sells to retail)',
    low: 30, high: 45, reserveFloor: 0.004, reserveTypical: 0.010,
    match: [/household & personal/i, /beverages/i, /packaged foods/i, /confectioner/i, /tobacco/i, /apparel\s*[-—]\s*(manufactur|footwear)/i, /farm products/i, /food distribution/i]
  },

  // ---- healthcare ----
  {
    key: 'healthcare-plans',
    label: 'Managed care / health plans',
    low: 15, high: 30, reserveFloor: 0.010, reserveTypical: 0.030,
    match: [/healthcare plans/i, /managed care/i]
  },
  {
    // Patient and payer mix makes uncollectible balances structural here — the
    // reserve norm sits an order of magnitude above most sectors.
    key: 'healthcare-providers',
    label: 'Healthcare providers / facilities',
    low: 45, high: 65, reserveFloor: 0.030, reserveTypical: 0.080,
    match: [/medical care facilities/i, /health information services/i, /diagnostics & research/i]
  },
  {
    key: 'pharma',
    label: 'Pharmaceuticals / biotech',
    low: 55, high: 75, reserveFloor: 0.004, reserveTypical: 0.012,
    match: [/drug manufacturers/i, /biotechnolog/i, /pharmaceutical retailers/i]
  },
  {
    key: 'medical-devices',
    label: 'Medical devices & supplies',
    low: 55, high: 70, reserveFloor: 0.008, reserveTypical: 0.020,
    match: [/medical devices/i, /medical instruments/i, /medical distribution/i, /medical\s*[-—]\s*(devices|instruments|supplies)/i]
  },

  // ---- industrial & transport ----
  {
    // Government and prime-contractor payers settle slowly, and milestone
    // billing stretches the cycle further.
    key: 'aerospace-defense',
    label: 'Aerospace & defense',
    low: 50, high: 70, reserveFloor: 0.003, reserveTypical: 0.010,
    match: [/aerospace/i, /defense/i]
  },
  {
    // Retainage is withheld until project completion, structurally inflating DSO.
    key: 'engineering-construction',
    label: 'Engineering & construction',
    low: 60, high: 85, reserveFloor: 0.010, reserveTypical: 0.030,
    match: [/engineering & construction/i, /infrastructure operations/i, /building products/i]
  },
  {
    key: 'freight-logistics',
    label: 'Freight & logistics',
    low: 40, high: 55, reserveFloor: 0.008, reserveTypical: 0.020,
    match: [/freight/i, /logistics/i, /trucking/i, /railroad/i, /marine shipping/i]
  },
  {
    key: 'airlines',
    label: 'Airlines & travel',
    low: 10, high: 25, reserveFloor: 0.004, reserveTypical: 0.012,
    match: [/airlines/i, /airports/i, /travel (services|lodging)/i, /resorts & casinos/i, /lodging/i]
  },
  {
    key: 'autos',
    label: 'Auto manufacturing & parts',
    low: 25, high: 40, reserveFloor: 0.004, reserveTypical: 0.012,
    match: [/auto\s*[-—]\s*(manufactur|parts|recreational)/i, /automobile/i]
  },
  {
    key: 'chemicals-materials',
    label: 'Chemicals & materials',
    low: 45, high: 60, reserveFloor: 0.004, reserveTypical: 0.012,
    match: [/chemicals/i, /agricultural inputs/i, /paper/i, /packaging/i, /steel/i, /aluminum/i, /copper/i, /gold/i, /silver/i, /other industrial metals/i, /building materials/i, /lumber/i]
  },

  // ---- communication & regulated ----
  {
    // Advertising receivables clear through agencies, which is slow by design.
    key: 'media-advertising',
    label: 'Media, entertainment & advertising',
    low: 60, high: 90, reserveFloor: 0.010, reserveTypical: 0.030,
    match: [/entertainment/i, /advertising agencies/i, /broadcasting/i, /publishing/i, /electronic gaming/i, /internet content/i]
  },
  {
    // Consumer non-payment and churn keep provisioning structurally high.
    key: 'telecom-services',
    label: 'Telecom services',
    low: 30, high: 45, reserveFloor: 0.020, reserveTypical: 0.050,
    match: [/telecom services/i, /telecommunications services/i]
  },
  {
    key: 'utilities',
    label: 'Utilities (regulated)',
    low: 25, high: 40, reserveFloor: 0.010, reserveTypical: 0.030,
    match: [/utilities/i, /regulated (electric|gas|water)/i, /independent power/i, /renewable utilities/i]
  },
  {
    key: 'energy',
    label: 'Energy / oil & gas',
    low: 30, high: 45, reserveFloor: 0.003, reserveTypical: 0.010,
    match: [/oil & gas/i, /\benergy\b/i, /coal/i, /uranium/i, /pipeline/i]
  },

  // ---- catch-alls ----
  {
    // Financials, REITs and funds are already caveated as low-signal; a wide
    // band keeps the component from manufacturing a verdict on them.
    key: 'balance-sheet-lenders',
    label: 'Financials / real estate (low-signal)',
    low: 15, high: 45, reserveFloor: 0.005, reserveTypical: 0.020,
    match: [/bank/i, /insurance/i, /asset management/i, /capital markets/i, /reit/i, /real estate/i, /mortgage/i, /financial/i]
  },
  {
    key: 'industrial',
    label: 'Diversified industrial',
    low: 45, high: 60, reserveFloor: 0.006, reserveTypical: 0.015,
    match: [/industrial/i, /machinery/i, /electrical equipment/i, /manufactur/i, /engineering/i, /construction/i, /conglomerate/i, /waste management/i, /security & protection/i, /business equipment/i, /rental & leasing/i, /metal fabrication/i, /tools & accessories/i, /pollution/i]
  },
  {
    // Reached only when nothing above matches. Deliberately wide, and the
    // scorer raises a guardrail saying the sector was not identified.
    key: 'unclassified',
    label: 'Unclassified',
    low: 30, high: 65, reserveFloor: 0.004, reserveTypical: 0.012,
    match: []
  }
]

export const DEFAULT_BAND_KEY = 'unclassified'

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
  let allowanceLevelScore = null
  let allowanceTrendScore = null
  let allowanceReleasePct = null
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

      // LEVEL — is the book reserved at all, by the standards of its sector?
      // Scoring only the trend hands full marks to a company that reserves
      // nothing and simply keeps reserving nothing. Anchors are deliberately
      // generous: at or above the sector floor is clean, and it takes a book
      // reserved at a fifth of the floor to zero the row, because the floors
      // themselves are priors rather than measurements.
      allowanceLevelScore = scoreLinear(
        -allowanceRatio,
        -band.reserveFloor,
        -band.reserveFloor * 0.2
      )

      // TREND — two-sided. A rising reserve is management pricing in write-offs
      // (the spec's original case). But a reserve *rate* falling hard while the
      // book grows is release into earnings, which is the same soft-earnings
      // tell pointing the other way. Only one of those was being scored.
      const risingScore = scoreLinear(allowanceRising, 0, 2)
      const oldest = ratios[0].ratio
      allowanceReleasePct = oldest > 0
        ? ((allowanceRatio - oldest) / oldest) * 100
        : null
      const releaseScore = isNum(allowanceReleasePct)
        ? scoreLinear(-allowanceReleasePct, 25, 60) // -25% erosion still fine, -60% is a release
        : null
      allowanceTrendScore = isNum(releaseScore)
        ? Math.min(risingScore, releaseScore)
        : risingScore
    }
  }

  // Level carries more of the component than direction: where a book sits
  // relative to its sector says more about adequacy than which way it drifted.
  const allowanceScore = allowanceAvailable
    ? (isNum(allowanceLevelScore) && isNum(allowanceTrendScore)
        ? allowanceLevelScore * 0.6 + allowanceTrendScore * 0.4
        : (allowanceLevelScore ?? allowanceTrendScore))
    : null

  const weights = allowanceAvailable ? BASE_WEIGHTS : WEIGHTS_NO_TIER2

  // --- Scoring ----------------------------------------------------------------
  const scores = {
    dsoTrend: scoreLinear(blendedTrend, 0, 15),
    divergence: scoreLinear(divergence, 0, 10),
    bandPosition: scoreLinear(bandRatio, 1.0, 1.5),
    cashConversion: scoreLinear(effectiveCashGap, 0, 20),
    allowance: allowanceScore
  }

  const pts = v => isNum(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts` : '—'
  const pct = v => isNum(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'

  const components = [
    {
      key: 'dsoTrend',
      label: 'How long customers take to pay (DSO trend)',
      value: blendedTrend,
      valueText: `${latest.dso.toFixed(1)} days to collect · ${pct(dsoYoY)} vs a year ago · ${pct(dsoQoQ)} vs last quarter · trend ${pct(slopeAnnualized)}/yr`,
      anchors: 'Days sales outstanding — the average days between a sale and the cash arriving. Green: flat or falling · Red: up >15% year over year',
      weight: weights.dsoTrend,
      score01: scores.dsoTrend
    },
    {
      key: 'divergence',
      label: 'Unpaid bills growing faster than sales',
      value: divergence,
      valueText: isNum(divergence)
        ? `${pts(divergence)} — money owed ${pct(latest.arYoY)} vs revenue ${pct(latest.revYoY)}`
        : '—',
      anchors: 'Receivables (money owed by customers) growing faster than revenue. Green: ≤0 points faster · Red: >10 points faster',
      weight: weights.divergence,
      score01: scores.divergence
    },
    {
      key: 'bandPosition',
      label: 'Payment speed vs the sector norm',
      value: bandRatio,
      valueText: `${latest.dso.toFixed(1)} days vs the ${band.low}–${band.high} day norm for this sector (${(bandRatio * 100).toFixed(0)}% of the ceiling)`,
      anchors: `Green: within ${band.label} band · Red: >1.5x ceiling (${(band.high * 1.5).toFixed(0)}d)`,
      weight: weights.bandPosition,
      score01: scores.bandPosition
    },
    {
      key: 'cashConversion',
      label: 'Profit reported vs cash collected',
      value: cashGap,
      valueText: isNum(cashGap)
        ? `profit ${pct(niGrowth)} vs free cash flow ${pct(fcfGrowth)} = ${pts(cashGap)} gap · ${isNum(arAttribution) ? `${(arAttribution * 100).toFixed(0)}% of it explained by unpaid bills` : 'cause of the gap unknown'}`
        : `Not computable — ${cashBasis} base is zero or negative`,
      anchors: 'Net income vs free cash flow growth. Green: in line · Red: profit outgrowing cash by >20 points, and receivables explain the gap',
      weight: weights.cashConversion,
      score01: scores.cashConversion
    }
  ]

  if (allowanceAvailable) {
    components.push({
      key: 'allowance',
      label: 'Reserve set aside for unpaid bills (Tier 2)',
      value: allowanceRising,
      valueText: `${(allowanceRatio * 100).toFixed(2)}% of what customers owe, vs a ${(band.reserveFloor * 100).toFixed(2)}% sector floor · rising ${allowanceRising} quarter${allowanceRising === 1 ? '' : 's'}${isNum(allowanceReleasePct) ? ` · reserve rate ${allowanceReleasePct >= 0 ? '+' : ''}${allowanceReleasePct.toFixed(0)}% across the window` : ''}`,
      anchors: 'Level (60%): at or above the sector reserve floor · Trend (40%): neither building 2+ quarters nor released >60%',
      weight: weights.allowance,
      score01: scores.allowance
    })
  } else {
    components.push({
      key: 'allowance',
      label: 'Reserve set aside for unpaid bills (Tier 2)',
      value: null,
      valueText: 'Not available. The reserve a company sets aside for bills it expects never to collect is disclosed in a 10-Q/10-K footnote, not on the face of the statements.',
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
      text: `Acquisition >10% of revenue in ${maQuarters.map(q => q.label).join(', ')}. The balance owed jumped in those quarters because an acquisition brought its invoices along, not because customers changed how they pay — discount the trend across them.`
    })
  }

  if (latest.dso < band.low * 0.6) {
    guardrails.push({
      key: 'factoring',
      severity: 'warn',
      text: `Customers appear to pay in just ${latest.dso.toFixed(1)} days, far below the ${band.low}–${band.high} day norm for ${band.label}. Check the 10-K for "sale of receivables" or securitization language before treating that as clean — a company that sells its unpaid invoices to a third party removes them from the balance sheet, which makes collection look faster than it is.`
    })
  }

  // A company compounding revenue sequentially will show period-end AR outrunning
  // trailing revenue growth even when nobody is paying slower — the divergence
  // component fires, but DSO (the direct measure of collection speed) doesn't.
  if (isNum(divergence) && divergence > 10 && isNum(dsoYoY) && dsoYoY <= 5 && bandRatio <= 1.0) {
    guardrails.push({
      key: 'hypergrowth',
      severity: 'info',
      text: `Money owed is growing ${divergence >= 0 ? '+' : ''}${divergence.toFixed(0)} points faster than revenue, but days-to-collect is ${dsoYoY >= 0 ? '+' : ''}${dsoYoY.toFixed(1)}% year over year and still inside the ${band.low}–${band.high} day norm. When sales compound fast, the quarter-end balance owed mechanically outruns trailing revenue growth even though nobody is paying slower. Weight the days-to-collect row over the growth-gap row here.`
    })
  }

  if (isNum(dsoQoQ) && isNum(dsoYoY) && dsoQoQ > 15 && dsoYoY <= 0) {
    guardrails.push({
      key: 'seasonality',
      severity: 'info',
      text: `Days-to-collect rose ${dsoQoQ.toFixed(1)}% against last quarter but is ${dsoYoY.toFixed(1)}% against the same quarter last year — that pattern reads as seasonal. The score leans on the year-over-year comparison for exactly this reason.`
    })
  }

  if (score < 60) {
    guardrails.push({
      key: 'mix',
      severity: 'info',
      text: 'Before acting on this flag, sanity-check it against the 10-Q MD&A or the earnings call — a shift toward usage-based or prepaid billing changes how fast customers pay for structural reasons, with no quality problem behind it.'
    })
  }

  if (!allowanceAvailable) {
    guardrails.push({
      key: 'tier2',
      severity: allowanceUnavailableReason ? 'warn' : 'info',
      text: allowanceUnavailableReason
        || 'The SEC filings for this company do not give a usable history of the reserve it sets aside for bills it expects never to collect — either it never tags that figure, or the last one it tagged is years old. That component’s 10% weight is spread across the other four (33/28/22/17).'
    })
  } else {
    if (isNum(allowanceRatio) && allowanceRatio < band.reserveFloor * 0.6) {
      const under = band.reserveFloor / Math.max(allowanceRatio, 1e-9)
      guardrails.push({
        key: 'allowance-level',
        severity: 'warn',
        text: `The reserve for uncollectable bills is ${(allowanceRatio * 100).toFixed(2)}% of everything customers owe, against a ${(band.reserveFloor * 100).toFixed(2)}% floor for ${band.label}${under >= 2 ? ` — roughly ${under.toFixed(0)}x under-reserved for the sector` : ''}. Read that as management not provisioning, not as collections being safe. Customer concentration in high-credit-quality names can justify a thin reserve, so check who they sell to before treating it as a finding.`
      })
    }
    if (isNum(allowanceReleasePct) && allowanceReleasePct < -25) {
      guardrails.push({
        key: 'allowance-release',
        severity: 'warn',
        text: `The reserve rate has fallen ${Math.abs(allowanceReleasePct).toFixed(0)}% across the window, from ${(allowanceSeries[0].allowance / allowanceSeries[0].grossAr * 100).toFixed(2)}% to ${(allowanceRatio * 100).toFixed(2)}% of everything customers owe. A reserve released while the book holds up flatters earnings — the same soft-earnings tell as a reserve build, pointing the other way.`
      })
    }
  }

  if (band.key === 'unclassified') {
    guardrails.push({
      key: 'band-unmatched',
      severity: 'info',
      text: `No sector profile matched this filer${profile.industry ? ` (${profile.industry})` : ''}, so the days-to-collect norm and reserve floor fall back to a deliberately wide default. The sector-comparison row is close to uninformative here — lean on the days-to-collect trend and the growth-gap rows instead.`
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
    const yoyText = isNum(dsoYoY) ? `, ${dsoYoY >= 0 ? 'up' : 'down'} ${Math.abs(dsoYoY).toFixed(0)}% from a year ago` : ''
    return `Collections are keeping pace with sales — customers pay in about ${latest.dso.toFixed(0)} days${yoyText}, inside the ${band.low}–${band.high} day norm for ${band.label}. The reported growth is backed by cash.`
  }

  const worst = components
    .filter(c => isNum(c.score01) && c.weight > 0)
    .sort((a, b) => a.score01 - b.score01)[0]
  if (!worst) return `RPT ${score}/100 — ${tier.label}. ${tier.blurb}`

  const streakText = divergenceStreak >= 2 ? ` for ${divergenceStreak} straight quarters` : ''

  switch (worst.key) {
    case 'divergence':
      return `The money customers owe is growing ${Math.abs(m.divergence).toFixed(0)} points faster than sales${streakText} — treat the reported growth with skepticism until collections catch up.`
    case 'dsoTrend': {
      const move = isNum(dsoYoY) ? dsoYoY : m.blendedTrend
      return `Customers now take ${latest.dso.toFixed(0)} days to pay, up ${move.toFixed(0)}% from a year ago — they are paying slower than they used to, which usually shows up in demand before it shows up in guidance.`
    }
    case 'bandPosition':
      return `Customers take ${latest.dso.toFixed(0)} days to pay, ${(m.bandRatio * 100 - 100).toFixed(0)}% beyond the ${band.high}-day ceiling for ${band.label} — collections are structurally slower than the peer set.`
    case 'cashConversion': {
      const attrText = isNum(m.arAttribution) ? ` and ${(m.arAttribution * 100).toFixed(0)}% of that gap is rising receivables` : ''
      return `Net income is outgrowing free cash flow by ${m.cashGap.toFixed(0)} points${attrText} — earnings are being reported ahead of the cash.`
    }
    case 'allowance':
      return `The reserve for bills they expect never to collect has risen ${worst.value} quarters running — management is pricing in write-offs before they show up in the numbers.`
    default:
      return `RPT ${score}/100 — ${tier.label}. ${tier.blurb}`
  }
}
