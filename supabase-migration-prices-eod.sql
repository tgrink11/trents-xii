-- Shared EODHD end-of-day price store
-- Lives in the kerry_top10 Supabase project (the BMA site's database); applied
-- there 2026-11-19 as migration prices_eod_store. Safe to re-run.
--
-- Written by scripts/backfill-prices-eod.mjs (one-time history) and
-- api/cron/prices-eod.js (daily, 22:30 UTC weekdays). Both write with the
-- service-role key, which bypasses RLS.

-- One row per symbol per trading day. open/high/low/close are as-traded;
-- adj_close is EODHD's split- and dividend-adjusted close as of the day the
-- row was written.
CREATE TABLE IF NOT EXISTS prices_eod (
  symbol    TEXT    NOT NULL,
  date      DATE    NOT NULL,
  open      NUMERIC,
  high      NUMERIC,
  low       NUMERIC,
  close     NUMERIC,
  adj_close NUMERIC,
  volume    BIGINT,
  PRIMARY KEY (symbol, date)
);

-- "Latest stored date" and whole-day reads; the primary key only helps when
-- the symbol is known.
CREATE INDEX IF NOT EXISTS prices_eod_date_idx ON prices_eod (date);

-- The symbols the store tracks. The backfill registers a symbol here once its
-- history is loaded; the daily cron keeps only these symbols from the bulk
-- feed, so every stored symbol has full history rather than a stub that
-- starts on the day the cron first ran.
CREATE TABLE IF NOT EXISTS prices_eod_symbols (
  symbol        TEXT PRIMARY KEY,
  backfilled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_date    DATE,
  last_date     DATE
);

-- One row per backfill or cron run: rows upserted and EODHD usage.
CREATE TABLE IF NOT EXISTS prices_eod_runs (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job            TEXT NOT NULL CHECK (job IN ('backfill', 'daily')),
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'error')),
  rows_upserted  INTEGER NOT NULL DEFAULT 0,
  eodhd_requests INTEGER NOT NULL DEFAULT 0,  -- HTTP requests sent
  eodhd_calls    INTEGER NOT NULL DEFAULT 0,  -- quota used (a bulk request counts as 100)
  detail         JSONB
);

CREATE INDEX IF NOT EXISTS prices_eod_runs_started_idx ON prices_eod_runs (started_at DESC);

-- RLS on, no policies: only the service-role key can read or write. To let the
-- browser (anon key) read prices, add:
--   CREATE POLICY "Public read access" ON prices_eod FOR SELECT USING (true);
ALTER TABLE prices_eod         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices_eod_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices_eod_runs    ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Splits and read functions
-- ---------------------------------------------------------------------------

-- EODHD's open/high/low/close are as-traded, so a split leaves a cliff in the
-- raw series. Splits are stored here and applied when prices are read, which
-- keeps every bar on today's share basis without rewriting history.
-- ratio = new shares per old share: 4 for a 4-for-1, 0.1 for a 1-for-10 reverse.
CREATE TABLE IF NOT EXISTS prices_eod_splits (
  symbol TEXT    NOT NULL,
  date   DATE    NOT NULL,   -- first day the stock trades on the new basis
  ratio  NUMERIC NOT NULL CHECK (ratio > 0),
  PRIMARY KEY (symbol, date)
);
ALTER TABLE prices_eod_splits ENABLE ROW LEVEL SECURITY;

-- What to divide a bar's prices by (and multiply its volume by) to put it on
-- today's share basis: the product of every split after that bar. EODHD lists
-- splits ahead of time, so one dated in the future (New York time) is ignored
-- until its day arrives.
CREATE OR REPLACE FUNCTION prices_eod_split_factor(p_symbol TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(round(exp(sum(ln(s.ratio))), 8), 1)
  FROM prices_eod_splits s
  WHERE s.symbol = p_symbol AND s.date > p_date
    AND s.date <= (now() AT TIME ZONE 'America/New_York')::date
$$;

-- One row per requested symbol that the store holds: the latest bar, the
-- close before it, the last close of the prior calendar year (the YTD base)
-- and the 52-week range. All prices are split-adjusted, none are
-- dividend-adjusted, so changes are price returns.
CREATE OR REPLACE FUNCTION prices_eod_quotes(p_symbols TEXT[])
RETURNS TABLE (
  symbol TEXT, date DATE, open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume BIGINT,
  prev_date DATE, prev_close NUMERIC, year_end_date DATE, year_end_close NUMERIC,
  year_high NUMERIC, year_low NUMERIC
) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.symbol, l.date, l.open, l.high, l.low, l.close, l.volume,
         p.date, p.close, y.date, y.close, r.hi, r.lo
  FROM (SELECT DISTINCT u.symbol FROM unnest(p_symbols) AS u(symbol)) s
  JOIN LATERAL (
    SELECT t.date, t.open, t.high, t.low, t.close, t.volume
    FROM prices_eod t WHERE t.symbol = s.symbol AND t.close IS NOT NULL
    ORDER BY t.date DESC LIMIT 1
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT t.date, round(t.close / prices_eod_split_factor(t.symbol, t.date), 6) AS close
    FROM prices_eod t WHERE t.symbol = s.symbol AND t.date < l.date AND t.close IS NOT NULL
    ORDER BY t.date DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT t.date, round(t.close / prices_eod_split_factor(t.symbol, t.date), 6) AS close
    FROM prices_eod t
    WHERE t.symbol = s.symbol AND t.date < date_trunc('year', l.date)::date AND t.close IS NOT NULL
    ORDER BY t.date DESC LIMIT 1
  ) y ON true
  LEFT JOIN LATERAL (
    SELECT round(max(t.high / prices_eod_split_factor(t.symbol, t.date)), 6) AS hi,
           round(min(t.low  / prices_eod_split_factor(t.symbol, t.date)), 6) AS lo
    FROM prices_eod t WHERE t.symbol = s.symbol AND t.date > l.date - 365
  ) r ON true
$$;

-- Split-adjusted daily bars for one symbol, newest first.
CREATE OR REPLACE FUNCTION prices_eod_history(
  p_symbol TEXT, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_limit INTEGER DEFAULT NULL
)
RETURNS TABLE (symbol TEXT, date DATE, open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume BIGINT)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.symbol, t.date,
         round(t.open / f.k, 6), round(t.high / f.k, 6), round(t.low / f.k, 6), round(t.close / f.k, 6),
         round(t.volume * f.k)::bigint
  FROM prices_eod t
  CROSS JOIN LATERAL (SELECT prices_eod_split_factor(t.symbol, t.date) AS k) f
  WHERE t.symbol = p_symbol
    AND (p_from IS NULL OR t.date >= p_from)
    AND (p_to   IS NULL OR t.date <= p_to)
  ORDER BY t.date DESC
  LIMIT p_limit
$$;

-- These run with the caller's rights, so row-level security still applies:
-- the anon key gets no rows back unless a read policy is added above.
