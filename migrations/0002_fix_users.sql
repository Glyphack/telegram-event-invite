CREATE TABLE users_new (
  user_id INTEGER PRIMARY KEY,
  email TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new (user_id, email, updated_at)
  SELECT user_id, value, updated_at FROM users WHERE key = 'email';
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
