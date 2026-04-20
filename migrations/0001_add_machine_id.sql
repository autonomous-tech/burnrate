-- Migration: Add machine_id column to monthly_usage for multi-machine support
-- Previously: one row per (user_id, month) — last machine to submit overwrites all others
-- After: one row per (user_id, month, machine_id) — each machine's tokens tracked separately

-- SQLite doesn't support ALTER TABLE to change primary keys, so recreate the table
CREATE TABLE IF NOT EXISTS monthly_usage_new (
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

-- Copy existing data (all existing rows get machine_id = 'default')
INSERT INTO monthly_usage_new (user_id, month, machine_id, input_tokens, output_tokens, total_tokens, updated_at)
SELECT user_id, month, 'default', input_tokens, output_tokens, total_tokens, updated_at
FROM monthly_usage;

-- Swap tables
DROP TABLE monthly_usage;
ALTER TABLE monthly_usage_new RENAME TO monthly_usage;
