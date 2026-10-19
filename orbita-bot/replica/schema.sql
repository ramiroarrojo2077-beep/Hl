PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS bots (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
 instructions TEXT NOT NULL DEFAULT '', memory TEXT NOT NULL DEFAULT '',
 color TEXT NOT NULL DEFAULT 'sage' CHECK(color IN ('sage','clay','lavender','blue')),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
 created_at TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1))
);
CREATE INDEX IF NOT EXISTS messages_bot ON messages(bot_id, created_at);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 prompt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','done','error','cancelled')),
 error TEXT, created_at TEXT NOT NULL, finished_at TEXT, demo INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_per_bot ON jobs(bot_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
 name TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_bot ON files(bot_id);
CREATE TABLE IF NOT EXISTS routines (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 name TEXT NOT NULL, prompt TEXT NOT NULL,
 interval_hours INTEGER NOT NULL CHECK(interval_hours IN (1,24,168)),
 next_run INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS routines_due ON routines(enabled,next_run);
CREATE TABLE IF NOT EXISTS skills (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, instructions TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_calls (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 name TEXT NOT NULL, arguments TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','running','done','error','cancelled','expired')),
 result TEXT, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_calls_job ON tool_calls(job_id,created_at);
