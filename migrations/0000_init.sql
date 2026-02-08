CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS chat_users (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, user_id)
);
