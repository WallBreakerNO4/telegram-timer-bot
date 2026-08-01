CREATE TABLE IF NOT EXISTS ephemeral_shares (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  receiver_user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
