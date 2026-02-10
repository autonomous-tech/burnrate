-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  api_key TEXT UNIQUE NOT NULL,
  display_name TEXT,
  is_public INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Monthly usage snapshots (one row per user per month)
CREATE TABLE IF NOT EXISTS monthly_usage (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (user_id, month),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
