import { getVixStatus } from '../lib/calculations'

export default function MarketIndicator({ vixLevel }) {
  const { status, color } = getVixStatus(vixLevel)
  const vixClass = vixLevel < 19 ? 'vix-investable' : vixLevel <= 29 ? 'vix-chop' : 'vix-defensive'

  return (
    <div className="market-indicator">
      <div className="section-title">Market Indicator</div>
      <table className="vix-table">
        <thead>
          <tr>
            <th>VIX Level</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`vix-value ${vixClass}`}>
              {vixLevel != null ? vixLevel.toFixed(2) : '—'}
            </td>
            <td>{status}</td>
          </tr>
        </tbody>
      </table>
      <div className="vix-range">
        Range: &lt;19 = Investable | 19-29 = Chop | &gt;29 = Defensive
      </div>
    </div>
  )
}
