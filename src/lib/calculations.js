export function getTrendSignal(price, smaValue) {
  if (price == null || smaValue == null) return 'N/A'
  return price >= smaValue ? 'UP' : 'DOWN'
}

export function calcReturn(currentPrice, entryPrice) {
  if (!currentPrice || !entryPrice || entryPrice === 0) return 0
  return ((currentPrice - entryPrice) / entryPrice) * 100
}

export function calcPortfolioValue(holdings, quotes) {
  return holdings.reduce((sum, h) => {
    const price = quotes[h.symbol]?.price ?? 0
    return sum + (h.shares * price)
  }, 0)
}

export function calcPortfolioReturn(holdings, quotes) {
  let totalCost = 0
  let totalValue = 0
  for (const h of holdings) {
    const price = quotes[h.symbol]?.price ?? h.entry_price
    totalCost += h.shares * h.entry_price
    totalValue += h.shares * price
  }
  if (totalCost === 0) return 0
  return ((totalValue - totalCost) / totalCost) * 100
}

export function getVixStatus(vixLevel) {
  if (vixLevel == null) return { status: 'N/A', color: '#999' }
  if (vixLevel < 19) return { status: 'Investable', color: '#28a745' }
  if (vixLevel <= 29) return { status: 'Chop', color: '#ffc107' }
  return { status: 'Defensive', color: '#dc3545' }
}

export function formatPercent(value) {
  if (value == null) return '0.00%'
  return value.toFixed(2) + '%'
}

export function formatCurrency(value) {
  if (value == null) return '$0.00'
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
