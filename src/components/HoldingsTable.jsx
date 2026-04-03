import { getTrendSignal, calcReturn, formatPercent, formatCurrency } from '../lib/calculations'

export default function HoldingsTable({ holdings, quotes, smas, ytdPrices }) {
  // Use the earliest entry date among holdings for the header
  const entryDates = holdings.map(h => h.entry_date).filter(Boolean)
  const earliestEntry = entryDates.length > 0
    ? (() => {
        // Parse date as local (not UTC) by splitting the YYYY-MM-DD string
        const sorted = [...entryDates].sort()
        const [y, m, d] = sorted[0].split('-').map(Number)
        return `${m}/${String(d).padStart(2, '0')}`
      })()
    : ''
  const today = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })

  return (
    <div className="holdings-section">
      <div className="section-title">Current Holdings</div>
      <table className="holdings-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Symbol</th>
            <th>Current Price</th>
            <th>Trade Trend</th>
            <th>Inter. Trend</th>
            <th>200d Trend</th>
            <th>Entry Price<br/><span style={{fontWeight:400,fontSize:'10px'}}>({earliestEntry})</span></th>
            <th>Return (%) as of<br/>{today}</th>
            <th>YTD Return (%)</th>
            <th>Allocation %</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const quote = quotes[h.symbol] || {}
            const sma = smas[h.symbol] || {}
            const currentPrice = quote.price
            const tradeTrend = getTrendSignal(currentPrice, sma.sma15)
            const interTrend = getTrendSignal(currentPrice, sma.sma62)
            const longTrend = getTrendSignal(currentPrice, sma.sma200)
            const returnPct = calcReturn(currentPrice, h.entry_price)
            const ytdBasePrice = ytdPrices?.[h.symbol] ?? h.entry_price
            const ytdReturn = calcReturn(currentPrice, ytdBasePrice)

            return (
              <tr key={h.id || h.symbol}>
                <td>{h.company_name}</td>
                <td>{h.symbol}</td>
                <td>{currentPrice ? formatCurrency(currentPrice) : '—'}</td>
                <td className={tradeTrend === 'UP' ? 'trend-up' : tradeTrend === 'DOWN' ? 'trend-down-yellow' : ''}>
                  {tradeTrend}
                </td>
                <td className={interTrend === 'UP' ? 'trend-up' : interTrend === 'DOWN' ? 'trend-down' : ''}>
                  {interTrend}
                </td>
                <td className={longTrend === 'UP' ? 'trend-up' : longTrend === 'DOWN' ? 'trend-down' : ''}>
                  {longTrend}
                </td>
                <td>{h.entry_price ? formatCurrency(h.entry_price) : '—'}</td>
                <td>{formatPercent(returnPct)}</td>
                <td>{formatPercent(ytdReturn)}</td>
                <td>{h.allocation_pct}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
