PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nickname TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  played_at TEXT NOT NULL DEFAULT (datetime('now')),
  discipline TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'finished',
  scoring_type TEXT NOT NULL DEFAULT 'sets',
  target_score INTEGER,
  target_sets INTEGER,
  max_innings INTEGER,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  player1_score INTEGER NOT NULL DEFAULT 0,
  player2_score INTEGER NOT NULL DEFAULT 0,
  player1_sets INTEGER NOT NULL DEFAULT 0,
  player2_sets INTEGER NOT NULL DEFAULT 0,
  player1_innings INTEGER NOT NULL DEFAULT 0,
  player2_innings INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player1_id) REFERENCES players(id),
  FOREIGN KEY (player2_id) REFERENCES players(id),
  FOREIGN KEY (winner_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS match_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT,
  event_type TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  player1_score INTEGER NOT NULL DEFAULT 0,
  player2_score INTEGER NOT NULL DEFAULT 0,
  player1_sets INTEGER NOT NULL DEFAULT 0,
  player2_sets INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS streaming_state (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_players_ranking
  ON players(points DESC, wins DESC, played ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_matches_played_at
  ON matches(played_at DESC);

CREATE INDEX IF NOT EXISTS idx_matches_players
  ON matches(player1_id, player2_id);

CREATE INDEX IF NOT EXISTS idx_match_events_match
  ON match_events(match_id, created_at ASC);

CREATE TRIGGER IF NOT EXISTS players_touch_updated_at
AFTER UPDATE ON players
FOR EACH ROW
BEGIN
  UPDATE players SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS matches_touch_updated_at
AFTER UPDATE ON matches
FOR EACH ROW
BEGIN
  UPDATE matches SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS streaming_state_touch_updated_at
AFTER UPDATE ON streaming_state
FOR EACH ROW
BEGIN
  UPDATE streaming_state SET updated_at = datetime('now') WHERE id = OLD.id;
END;
