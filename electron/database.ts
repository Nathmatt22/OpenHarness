import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
let db: Database.Database;
export function initDatabase() {
  db = new Database(path.join(app.getPath('userData'), 'openharness.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT,type TEXT,base_url TEXT,model TEXT,secret TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT,description TEXT,instructions TEXT,icon TEXT,tools TEXT,custom INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT,agent_id TEXT,connection_id TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT,agent_ids TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS missions(id TEXT PRIMARY KEY,team_id TEXT,title TEXT,status TEXT,result TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS mission_events(id TEXT PRIMARY KEY,mission_id TEXT,agent_id TEXT,content TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  const columns = (table: string) => database.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!columns('conversations').some((c) => c.name === 'connection_id')) {
    database.exec('ALTER TABLE conversations ADD COLUMN connection_id TEXT');
  }
  if (!columns('teams').some((c) => c.name === 'folders')) {
    database.exec('ALTER TABLE teams ADD COLUMN folders TEXT');
  }
  if (!columns('teams').some((c) => c.name === 'allow_run')) {
    database.exec('ALTER TABLE teams ADD COLUMN allow_run INTEGER DEFAULT 0');
  }
}
export function database() { if (!db) throw new Error('Database not initialized'); return db; }
