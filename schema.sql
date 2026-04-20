-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

-- Monthly usage snapshots (one row per user per machine per month)
CREATE TABLE IF NOT EXISTS monthly_usage (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  machine_id TEXT NOT NULL DEFAULT 'default',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (user_id, month, machine_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Copilot premium request usage (one row per GitHub user per month)
CREATE TABLE IF NOT EXISTS copilot_usage (
  github_username TEXT NOT NULL,
  month TEXT NOT NULL,
  premium_requests REAL DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (github_username, month)
);
