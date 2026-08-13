import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (db) return db;
    try {
        let dbPath = process.env.DATABASE_PATH;
        if (!dbPath) {
            // In serverless / Vercel environments, write to /tmp or use memory
            if (process.env.VERCEL || (process.env.NODE_ENV === 'production' && !fs.existsSync(path.join(process.cwd(), 'data')))) {
                dbPath = path.join('/tmp', 'jamroom.db');
            } else {
                dbPath = path.join(process.cwd(), 'data', 'jamroom.db');
            }
        }
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        db = new Database(dbPath);
    } catch {
        console.warn('[db] File database un-writable or serverless environment detected — falling back to in-memory SQLite');
        db = new Database(':memory:');
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}

function migrate(d: Database.Database): void {
    const version = (d.pragma('user_version', { simple: true }) as number) || 0;

    if (version < 1) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT 'Listening room',
                host_client_id TEXT NOT NULL,
                guest_controls INTEGER NOT NULL DEFAULT 0,
                current_queue_item_id INTEGER,
                position_ms INTEGER NOT NULL DEFAULT 0,
                is_playing INTEGER NOT NULL DEFAULT 0,
                playback_updated_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                nickname TEXT NOT NULL,
                avatar_color TEXT NOT NULL,
                joined_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                UNIQUE(room_id, client_id)
            );

            CREATE TABLE IF NOT EXISTS queue_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                title TEXT NOT NULL,
                artist TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                album_art_url TEXT,
                source TEXT NOT NULL,
                spotify_track_id TEXT,
                youtube_video_id TEXT,
                match_status TEXT NOT NULL DEFAULT 'matched',
                match_score REAL,
                added_by_nickname TEXT NOT NULL DEFAULT '',
                played_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_queue_room ON queue_items(room_id, sort_order);

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                client_id TEXT,
                nickname TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'chat',
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);

            CREATE TABLE IF NOT EXISTS imports (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                playlist_url TEXT NOT NULL,
                playlist_name TEXT,
                total INTEGER NOT NULL DEFAULT 0,
                matched INTEGER NOT NULL DEFAULT 0,
                needs_review INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'running',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_cache (
                playlist_id TEXT PRIMARY KEY,
                playlist_name TEXT,
                tracks_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        d.pragma('user_version = 1');
        console.log('[db] schema v1 applied');
    }

    if (version < 2) {
        const cols = d.prepare('PRAGMA table_info(queue_items)').all() as Array<{ name: string }>;
        if (!cols.some(c => c.name === 'media_url')) {
            d.exec('ALTER TABLE queue_items ADD COLUMN media_url TEXT');
        }
        d.exec(`
            CREATE TABLE IF NOT EXISTS playlist_cache (
                playlist_id TEXT PRIMARY KEY,
                playlist_name TEXT,
                tracks_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        d.pragma('user_version = 2');
        console.log('[db] schema v2 applied (media_url & playlist_cache)');
    }
}
