import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// Holdings CRUD
export async function getHoldings() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('is_active', true)
    .order('allocation_pct', { ascending: false })
  if (error) { console.error('Error fetching holdings:', error); return [] }
  return data
}

export async function addHolding(holding) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('holdings')
    .insert([{ ...holding, is_active: true }])
    .select()
    .single()
  if (error) { console.error('Error adding holding:', error); return null }
  return data
}

export async function updateHolding(id, updates) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('holdings')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) { console.error('Error updating holding:', error); return null }
  return data
}

export async function removeHolding(id) {
  if (!supabase) return false
  const { error } = await supabase
    .from('holdings')
    .update({ is_active: false })
    .eq('id', id)
  if (error) { console.error('Error removing holding:', error); return false }
  return true
}

// Trades CRUD
export async function getTrades() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('trade_date', { ascending: false })
  if (error) { console.error('Error fetching trades:', error); return [] }
  return data
}

export async function addTrade(trade) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('trades')
    .insert([trade])
    .select()
    .single()
  if (error) { console.error('Error adding trade:', error); return null }
  return data
}

// Options Trades CRUD
export async function getOptionsTrades() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('options_trades')
    .select('*')
    .order('trade_date', { ascending: false })
  if (error) { console.error('Error fetching options trades:', error); return [] }
  return data
}

export async function addOptionsTrade(trade) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('options_trades')
    .insert([trade])
    .select()
    .single()
  if (error) { console.error('Error adding options trade:', error); return null }
  return data
}
