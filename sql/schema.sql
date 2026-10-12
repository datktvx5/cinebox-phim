CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT 'Khác',
  year INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'movie' CHECK(type IN ('movie', 'series')),
  synopsis TEXT NOT NULL DEFAULT '',
  poster_url TEXT NOT NULL DEFAULT '',
  backdrop_url TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  drive_file_id TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  public_ok INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(movie_id,episode_number)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  session_uri TEXT NOT NULL,
  sent_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_connection (
  id INTEGER PRIMARY KEY CHECK(id=1),
  refresh_cipher TEXT NOT NULL,
  access_cipher TEXT NOT NULL,
  access_expires INTEGER NOT NULL,
  folder_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, blocked_until INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_movies_public ON movies(published,featured,created_at);
CREATE INDEX IF NOT EXISTS idx_eps_movie ON episodes(movie_id,episode_number);
