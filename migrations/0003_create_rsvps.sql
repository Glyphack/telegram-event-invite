CREATE TABLE rsvps (
  inline_message_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (inline_message_id, user_id)
);
