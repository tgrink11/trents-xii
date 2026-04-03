-- Trent's XII - Supabase Database Setup
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

-- Holdings table
CREATE TABLE holdings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  company_name TEXT NOT NULL,
  entry_price NUMERIC(12,2) NOT NULL,
  entry_date DATE,
  shares NUMERIC(12,4) NOT NULL DEFAULT 0,
  allocation_pct NUMERIC(5,1) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trades table
CREATE TABLE trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  holding_id UUID REFERENCES holdings(id),
  symbol TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  price NUMERIC(12,2) NOT NULL,
  shares NUMERIC(12,4) NOT NULL,
  trade_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Options trades table
CREATE TABLE options_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  option_type TEXT NOT NULL CHECK (option_type IN ('CALL', 'PUT')),
  strike_price NUMERIC(12,2) NOT NULL,
  expiration_date DATE NOT NULL,
  premium NUMERIC(12,2) NOT NULL,
  contracts INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL CHECK (action IN ('BUY_TO_OPEN', 'SELL_TO_OPEN', 'BUY_TO_CLOSE', 'SELL_TO_CLOSE')),
  trade_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE options_trades ENABLE ROW LEVEL SECURITY;

-- Public read access (for the dashboard iframe)
CREATE POLICY "Public read access" ON holdings FOR SELECT USING (true);
CREATE POLICY "Public read access" ON trades FOR SELECT USING (true);
CREATE POLICY "Public read access" ON options_trades FOR SELECT USING (true);

-- Authenticated write access (for admin panel)
CREATE POLICY "Authenticated insert" ON holdings FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated update" ON holdings FOR UPDATE USING (true);
CREATE POLICY "Authenticated insert" ON trades FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated insert" ON options_trades FOR INSERT WITH CHECK (true);

-- Seed with your current 12 holdings
INSERT INTO holdings (symbol, company_name, entry_price, entry_date, shares, allocation_pct) VALUES
  ('RF',   'Regions Financial Corp',                    26.47,  '2026-04-02', 100, 4),
  ('STT',  'State Street Corp',                        128.80,  '2026-04-02', 50,  8),
  ('ED',   'Consolidated Edison Inc',                  115.43,  '2026-04-02', 55,  8),
  ('AEP',  'American Electric Power Company Inc',      132.68,  '2026-04-02', 48,  8),
  ('PLD',  'Prologis Inc',                             133.77,  '2026-04-02', 47,  8),
  ('DBC',  'Invesco DB Commodity Index Tracking Fund',  29.33,  '2026-04-02', 215, 8),
  ('USO',  'United States Oil Fund LP',                137.92,  '2026-04-02', 46,  8),
  ('GLW',  'Corning Inc',                              147.92,  '2026-04-02', 43,  8),
  ('STX',  'Seagate Technology Holdings PLC',          429.36,  '2026-04-02', 15,  8),
  ('XLE',  'State Street Energy Select Sector SPDR ETF', 59.25, '2026-04-02', 107, 8),
  ('TRGP', 'Targa Resources Corp',                    244.39,  '2026-04-02', 26,  8),
  ('ATO',  'Atmos Energy Corp',                        188.97,  '2026-04-02', 34,  8);
