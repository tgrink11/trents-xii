import { formatCurrency } from '../lib/calculations'

export default function OptionsTable({ optionsTrades }) {
  if (!optionsTrades || optionsTrades.length === 0) return null

  return (
    <div className="options-section">
      <div className="section-title">Options Trades</div>
      <table className="holdings-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            <th>Strike</th>
            <th>Expiration</th>
            <th>Action</th>
            <th>Premium</th>
            <th>Contracts</th>
            <th>Trade Date</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {optionsTrades.map((t) => (
            <tr key={t.id}>
              <td style={{ fontWeight: 600 }}>{t.symbol}</td>
              <td className={t.option_type === 'CALL' ? 'trend-up' : 'trend-down'}>
                {t.option_type}
              </td>
              <td>{formatCurrency(t.strike_price)}</td>
              <td>{t.expiration_date}</td>
              <td>{t.action?.replace(/_/g, ' ')}</td>
              <td>{formatCurrency(t.premium)}</td>
              <td>{t.contracts}</td>
              <td>{t.trade_date}</td>
              <td style={{ textAlign: 'left', fontSize: '12px' }}>{t.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
