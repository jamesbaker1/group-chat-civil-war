-- GROUP CHAT CIVIL WAR — initial schema
-- The muster roll, the battle logs, and the records of who aided the enemy.

CREATE TABLE players (
  id TEXT PRIMARY KEY,            -- crypto.randomUUID()
  name TEXT NOT NULL,            -- 1..20 chars, trimmed; uniqueness NOT enforced (it's a small chat)
  army TEXT NOT NULL CHECK (army IN ('PHI','NY')),
  created_at INTEGER NOT NULL
);

CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  battle_name TEXT NOT NULL,
  question_ids TEXT NOT NULL,          -- JSON array of 10 ids
  answers TEXT NOT NULL DEFAULT '{}',  -- JSON object qid -> {choice, points, correct}
  score INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  own_city_misses INTEGER NOT NULL DEFAULT 0,   -- for Traitor Watch
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_battles_player ON battles(player_id, created_at);
