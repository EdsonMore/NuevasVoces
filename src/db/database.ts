import Database from 'better-sqlite3';
import path from 'path';

export const db = new Database(path.join(process.cwd(), 'itaca.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS obras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS escenas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obra_id INTEGER NOT NULL REFERENCES obras(id),
    nombre TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS canales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escena_id INTEGER NOT NULL REFERENCES escenas(id),
    canal_hw INTEGER NOT NULL,
    nombre_persona TEXT,
    gain_db REAL NOT NULL,
    mute INTEGER NOT NULL DEFAULT 0,
    UNIQUE(escena_id, canal_hw)
  );
`);
