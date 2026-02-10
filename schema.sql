-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  api_key TEXT UNIQUE NOT NULL,
  display_name TEXT,
  is_public INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Usage logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  project TEXT,
  submitted_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Aggregated stats for leaderboard (updated on insert)
CREATE TABLE IF NOT EXISTS daily_stats (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_logs_submitted ON usage_logs(submitted_at);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
