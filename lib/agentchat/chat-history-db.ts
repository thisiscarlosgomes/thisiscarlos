import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
};

let instance: Database.Database | null = null;

function getDb(): Database.Database {
  if (instance) return instance;

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "agentchat.sqlite");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      user_id TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, message_index)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
  `);

  instance = db;
  return db;
}

export function getChatHistory(userId: string): StoredChatMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT role, content
      FROM chat_messages
      WHERE user_id = ?
      ORDER BY message_index ASC
    `
    )
    .all(userId) as Array<{ role: "user" | "assistant"; content: string }>;

  return rows.map((row) => ({ role: row.role, content: row.content }));
}

export function saveChatHistory(userId: string, messages: StoredChatMessage[]): void {
  const cleaned = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM chat_messages WHERE user_id = ?");
  const insertStmt = db.prepare(
    "INSERT INTO chat_messages (user_id, message_index, role, content) VALUES (?, ?, ?, ?)"
  );

  const tx = db.transaction((uid: string, rows: StoredChatMessage[]) => {
    deleteStmt.run(uid);
    rows.forEach((row, index) => {
      insertStmt.run(uid, index, row.role, row.content);
    });
  });

  tx(userId, cleaned);
}
