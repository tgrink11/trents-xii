import { useState } from 'react'
import { addHolding, updateHolding, removeHolding, addTrade, addOptionsTrade } from '../lib/supabase'

export default function AdminPanel({ holdings, trades, optionsTrades, onClose, onRefresh }) {
  const [activeTab, setActiveTab] = useState('holdings')
  const [holdingForm, setHoldingForm] = useState({
    symbol: '', company_name: '', entry_price: '', entry_date: '', shares: '', allocation_pct: ''
  })
  const [tradeForm, setTradeForm] = useState({
    symbol: '', trade_type: 'BUY', price: '', shares: '', trade_date: '', notes: ''
  })
  const [optionForm, setOptionForm] = useState({
    symbol: '', option_type: 'CALL', strike_price: '', expiration_date: '',
    premium: '', contracts: '1', action: 'BUY_TO_OPEN', trade_date: '', notes: ''
  })
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})

  async function handleAddHolding(e) {
    e.preventDefault()
    await addHolding({
      ...holdingForm,
      entry_price: parseFloat(holdingForm.entry_price),
      shares: parseFloat(holdingForm.shares),
      allocation_pct: parseFloat(holdingForm.allocation_pct)
    })
    setHoldingForm({ symbol: '', company_name: '', entry_price: '', entry_date: '', shares: '', allocation_pct: '' })
    onRefresh()
  }

  async function handleUpdateHolding(id) {
    await updateHolding(id, {
      ...editForm,
      entry_price: parseFloat(editForm.entry_price),
      shares: parseFloat(editForm.shares),
      allocation_pct: parseFloat(editForm.allocation_pct)
    })
    setEditingId(null)
    onRefresh()
  }

  async function handleRemoveHolding(id, symbol) {
    if (confirm(`Remove ${symbol} from holdings?`)) {
      await removeHolding(id)
      onRefresh()
    }
  }

  async function handleAddTrade(e) {
    e.preventDefault()
    const holding = holdings.find(h => h.symbol === tradeForm.symbol.toUpperCase())
    await addTrade({
      ...tradeForm,
      symbol: tradeForm.symbol.toUpperCase(),
      holding_id: holding?.id || null,
      price: parseFloat(tradeForm.price),
      shares: parseFloat(tradeForm.shares)
    })
    setTradeForm({ symbol: '', trade_type: 'BUY', price: '', shares: '', trade_date: '', notes: '' })
    onRefresh()
  }

  async function handleAddOption(e) {
    e.preventDefault()
    await addOptionsTrade({
      ...optionForm,
      symbol: optionForm.symbol.toUpperCase(),
      strike_price: parseFloat(optionForm.strike_price),
      premium: parseFloat(optionForm.premium),
      contracts: parseInt(optionForm.contracts)
    })
    setOptionForm({
      symbol: '', option_type: 'CALL', strike_price: '', expiration_date: '',
      premium: '', contracts: '1', action: 'BUY_TO_OPEN', trade_date: '', notes: ''
    })
    onRefresh()
  }

  function startEdit(holding) {
    setEditingId(holding.id)
    setEditForm({
      symbol: holding.symbol,
      company_name: holding.company_name,
      entry_price: holding.entry_price,
      entry_date: holding.entry_date || '',
      shares: holding.shares,
      allocation_pct: holding.allocation_pct
    })
  }

  return (
    <div className="admin-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-panel">
        <button className="close-btn" onClick={onClose}>&times;</button>
        <h2>Admin Panel</h2>

        <div className="admin-tabs">
          <button className={`admin-tab ${activeTab === 'holdings' ? 'active' : ''}`}
                  onClick={() => setActiveTab('holdings')}>Holdings</button>
          <button className={`admin-tab ${activeTab === 'trades' ? 'active' : ''}`}
                  onClick={() => setActiveTab('trades')}>Trades</button>
          <button className={`admin-tab ${activeTab === 'options' ? 'active' : ''}`}
                  onClick={() => setActiveTab('options')}>Options</button>
        </div>

        {activeTab === 'holdings' && (
          <>
            <h3>Add New Holding</h3>
            <form onSubmit={handleAddHolding} className="admin-form">
              <label>Symbol
                <input required value={holdingForm.symbol}
                       onChange={e => setHoldingForm({...holdingForm, symbol: e.target.value.toUpperCase()})} />
              </label>
              <label>Company Name
                <input required value={holdingForm.company_name}
                       onChange={e => setHoldingForm({...holdingForm, company_name: e.target.value})} />
              </label>
              <label>Entry Price
                <input type="number" step="0.01" required value={holdingForm.entry_price}
                       onChange={e => setHoldingForm({...holdingForm, entry_price: e.target.value})} />
              </label>
              <label>Entry Date
                <input type="date" value={holdingForm.entry_date}
                       onChange={e => setHoldingForm({...holdingForm, entry_date: e.target.value})} />
              </label>
              <label>Shares
                <input type="number" step="0.01" required value={holdingForm.shares}
                       onChange={e => setHoldingForm({...holdingForm, shares: e.target.value})} />
              </label>
              <label>Allocation %
                <input type="number" step="0.1" required value={holdingForm.allocation_pct}
                       onChange={e => setHoldingForm({...holdingForm, allocation_pct: e.target.value})} />
              </label>
              <div className="full-width">
                <button type="submit" className="admin-btn">Add Holding</button>
              </div>
            </form>

            <h3>Current Holdings</h3>
            <table className="trade-history">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Company</th>
                  <th>Entry Price</th>
                  <th>Shares</th>
                  <th>Alloc %</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
                  <tr key={h.id}>
                    {editingId === h.id ? (
                      <>
                        <td><input size="6" value={editForm.symbol} onChange={e => setEditForm({...editForm, symbol: e.target.value.toUpperCase()})} /></td>
                        <td><input size="20" value={editForm.company_name} onChange={e => setEditForm({...editForm, company_name: e.target.value})} /></td>
                        <td><input size="8" type="number" step="0.01" value={editForm.entry_price} onChange={e => setEditForm({...editForm, entry_price: e.target.value})} /></td>
                        <td><input size="6" type="number" step="0.01" value={editForm.shares} onChange={e => setEditForm({...editForm, shares: e.target.value})} /></td>
                        <td><input size="4" type="number" step="0.1" value={editForm.allocation_pct} onChange={e => setEditForm({...editForm, allocation_pct: e.target.value})} /></td>
                        <td>
                          <button className="admin-btn" style={{padding:'4px 10px',fontSize:'11px',marginRight:'4px'}} onClick={() => handleUpdateHolding(h.id)}>Save</button>
                          <button className="admin-btn danger" style={{padding:'4px 10px',fontSize:'11px'}} onClick={() => setEditingId(null)}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{fontWeight:600}}>{h.symbol}</td>
                        <td>{h.company_name}</td>
                        <td>${h.entry_price}</td>
                        <td>{h.shares}</td>
                        <td>{h.allocation_pct}</td>
                        <td>
                          <button className="admin-btn" style={{padding:'4px 10px',fontSize:'11px',marginRight:'4px'}} onClick={() => startEdit(h)}>Edit</button>
                          <button className="admin-btn danger" style={{padding:'4px 10px',fontSize:'11px'}} onClick={() => handleRemoveHolding(h.id, h.symbol)}>Remove</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {activeTab === 'trades' && (
          <>
            <h3>Record Trade</h3>
            <form onSubmit={handleAddTrade} className="admin-form">
              <label>Symbol
                <input required value={tradeForm.symbol}
                       onChange={e => setTradeForm({...tradeForm, symbol: e.target.value.toUpperCase()})} />
              </label>
              <label>Type
                <select value={tradeForm.trade_type}
                        onChange={e => setTradeForm({...tradeForm, trade_type: e.target.value})}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label>Price
                <input type="number" step="0.01" required value={tradeForm.price}
                       onChange={e => setTradeForm({...tradeForm, price: e.target.value})} />
              </label>
              <label>Shares
                <input type="number" step="0.01" required value={tradeForm.shares}
                       onChange={e => setTradeForm({...tradeForm, shares: e.target.value})} />
              </label>
              <label>Trade Date
                <input type="date" required value={tradeForm.trade_date}
                       onChange={e => setTradeForm({...tradeForm, trade_date: e.target.value})} />
              </label>
              <label>Notes
                <input value={tradeForm.notes}
                       onChange={e => setTradeForm({...tradeForm, notes: e.target.value})} />
              </label>
              <div className="full-width">
                <button type="submit" className="admin-btn">Record Trade</button>
              </div>
            </form>

            <h3>Trade History</h3>
            <table className="trade-history">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Shares</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {(trades || []).map(t => (
                  <tr key={t.id}>
                    <td>{t.trade_date}</td>
                    <td style={{fontWeight:600}}>{t.symbol}</td>
                    <td style={{color: t.trade_type === 'BUY' ? '#28a745' : '#dc3545', fontWeight:600}}>
                      {t.trade_type}
                    </td>
                    <td>${t.price}</td>
                    <td>{t.shares}</td>
                    <td style={{textAlign:'left'}}>{t.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {activeTab === 'options' && (
          <>
            <h3>Record Options Trade</h3>
            <form onSubmit={handleAddOption} className="admin-form">
              <label>Underlying Symbol
                <input required value={optionForm.symbol}
                       onChange={e => setOptionForm({...optionForm, symbol: e.target.value.toUpperCase()})} />
              </label>
              <label>Option Type
                <select value={optionForm.option_type}
                        onChange={e => setOptionForm({...optionForm, option_type: e.target.value})}>
                  <option value="CALL">CALL</option>
                  <option value="PUT">PUT</option>
                </select>
              </label>
              <label>Strike Price
                <input type="number" step="0.01" required value={optionForm.strike_price}
                       onChange={e => setOptionForm({...optionForm, strike_price: e.target.value})} />
              </label>
              <label>Expiration Date
                <input type="date" required value={optionForm.expiration_date}
                       onChange={e => setOptionForm({...optionForm, expiration_date: e.target.value})} />
              </label>
              <label>Action
                <select value={optionForm.action}
                        onChange={e => setOptionForm({...optionForm, action: e.target.value})}>
                  <option value="BUY_TO_OPEN">Buy to Open</option>
                  <option value="SELL_TO_OPEN">Sell to Open</option>
                  <option value="BUY_TO_CLOSE">Buy to Close</option>
                  <option value="SELL_TO_CLOSE">Sell to Close</option>
                </select>
              </label>
              <label>Premium
                <input type="number" step="0.01" required value={optionForm.premium}
                       onChange={e => setOptionForm({...optionForm, premium: e.target.value})} />
              </label>
              <label>Contracts
                <input type="number" min="1" required value={optionForm.contracts}
                       onChange={e => setOptionForm({...optionForm, contracts: e.target.value})} />
              </label>
              <label>Trade Date
                <input type="date" required value={optionForm.trade_date}
                       onChange={e => setOptionForm({...optionForm, trade_date: e.target.value})} />
              </label>
              <label className="full-width">Notes
                <input value={optionForm.notes}
                       onChange={e => setOptionForm({...optionForm, notes: e.target.value})} />
              </label>
              <div className="full-width">
                <button type="submit" className="admin-btn">Record Options Trade</button>
              </div>
            </form>

            <h3>Options Trade History</h3>
            <table className="trade-history">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Strike</th>
                  <th>Expiry</th>
                  <th>Action</th>
                  <th>Premium</th>
                  <th>Contracts</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {(optionsTrades || []).map(t => (
                  <tr key={t.id}>
                    <td>{t.trade_date}</td>
                    <td style={{fontWeight:600}}>{t.symbol}</td>
                    <td style={{color: t.option_type === 'CALL' ? '#28a745' : '#dc3545', fontWeight:600}}>
                      {t.option_type}
                    </td>
                    <td>${t.strike_price}</td>
                    <td>{t.expiration_date}</td>
                    <td>{t.action?.replace(/_/g, ' ')}</td>
                    <td>${t.premium}</td>
                    <td>{t.contracts}</td>
                    <td style={{textAlign:'left'}}>{t.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
