import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActionItem, ExtractedItem, Note } from "./contracts";

let database: DatabaseSync | undefined;

function getDatabase() {
  if (database) return database;
  const path = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || "data/action-items.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA busy_timeout = 75;
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS action_items (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id),
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        owner TEXT,
        due TEXT,
        done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        UNIQUE (note_id, position)
      ) STRICT;
    `);
  } catch (error) {
    db.close();
    throw error;
  }
  database = db;
  return db;
}

type ItemRow = Omit<ActionItem, "done"> & { done: 0 | 1 };
type JoinedRow = {
  note_id: string;
  note_text: string;
  created_at: string;
} & ({ id: null } | ItemRow);

function toItem(row: ItemRow): ActionItem {
  return { id: row.id, title: row.title, owner: row.owner, due: row.due, done: row.done === 1 };
}

export function listNotes(): Note[] {
  const rows = getDatabase().prepare(`
    SELECT n.id AS note_id, n.text AS note_text, n.created_at,
           a.id, a.title, a.owner, a.due, a.done
    FROM notes AS n
    LEFT JOIN action_items AS a ON a.note_id = n.id
    ORDER BY n.created_at DESC, n.id DESC, a.position ASC
  `).all() as JoinedRow[];

  const notes = new Map<string, Note>();
  for (const row of rows) {
    let note = notes.get(row.note_id);
    if (!note) {
      note = { id: row.note_id, text: row.note_text, createdAt: row.created_at, items: [] };
      notes.set(note.id, note);
    }
    if (row.id !== null) note.items.push(toItem(row));
  }
  return [...notes.values()];
}

export function saveExtraction(text: string, extracted: ExtractedItem[]): Note {
  const db = getDatabase();
  const note: Note = {
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
    items: extracted.map((item) => ({ ...item, id: randomUUID(), done: false })),
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO notes (id, text, created_at) VALUES (?, ?, ?)")
      .run(note.id, note.text, note.createdAt);
    const insert = db.prepare(`
      INSERT INTO action_items (id, note_id, position, title, owner, due)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    note.items.forEach((item, position) => {
      insert.run(item.id, note.id, position, item.title, item.owner, item.due);
    });
    db.exec("COMMIT");
    return note;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function setItemDone(id: string, done: boolean): ActionItem | undefined {
  const row = getDatabase().prepare(`
    UPDATE action_items SET done = ? WHERE id = ?
    RETURNING id, title, owner, due, done
  `).get(done ? 1 : 0, id) as ItemRow | undefined;
  return row ? toItem(row) : undefined;
}
