import { formatPercent } from '../lib/calculations'

export default function PerformanceSummary({ portfolioReturn, ytdReturn, benchmarkYtd, activeCount, startDate }) {
  const diff = (portfolioReturn ?? 0) - (benchmarkYtd ?? 0)
  const ytdDiff = (ytdReturn ?? 0) - (benchmarkYtd ?? 0)

  return (
    <div className="performance-summary">
      <div className="section-title">Performance Summary</div>
      <table className="performance-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
            <th>Benchmark (SPY)</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Since {startDate || 'Inception'}</td>
            <td>{formatPercent(portfolioReturn)}</td>
            <td>{formatPercent(benchmarkYtd)}</td>
            <td className={diff >= 0 ? 'diff-positive' : 'diff-negative'}>
              {formatPercent(diff)}
            </td>
          </tr>
          <tr>
            <td>YTD Return</td>
            <td>{formatPercent(ytdReturn)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td>Active Positions</td>
            <td>{activeCount}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
