const FMP_KEY = process.env.FMP_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${FMP_KEY}`
    const r = await fetch(url)
    if (!r.ok) {
      return res.json({ level: null, error: `FMP API ${r.status}` })
    }
    const json = await r.json()
    const vix = json?.[0]
    return res.json({
      level: vix?.price ?? null,
      change: vix?.change ?? null,
      changePct: vix?.changesPercentage ?? null
    })
  } catch (err) {
    console.error('VIX fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
