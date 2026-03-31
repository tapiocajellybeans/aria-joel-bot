/**
 * db.js — Persistent storage for ARIA using sql.js (pure JS SQLite)
 * No native compilation required — works on any platform/Node version.
 */

const path = require("path");
const fs   = require("fs");
const initSqlJs = require("sql.js");

const DB_PATH = path.join(__dirname, "aria.db");

// db is initialised asynchronously — all exports return Promises
let _db = null;

async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  // Load existing DB file if it exists, otherwise start fresh
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  // Create tables if they don't exist
  _db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT    NOT NULL,
      role       TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT    NOT NULL,
      text       TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'pending',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_chat_id    ON tasks(chat_id);
  `);

  // ── Add after tasks table creation
  _db.run(`
    CREATE TABLE IF NOT EXISTS facts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_chat_key ON facts(chat_id, key);
  `);

  persist(); // save initial schema to disk
  console.log(`✅  SQLite database ready at ${DB_PATH}`);
  return _db;
}

// Write the in-memory DB back to disk after every write operation
function persist() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function saveMessage(chatId, role, content) {
  const db = await getDb();
  db.run(
    "INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)",
    [String(chatId), role, content]
  );
  persist();
}

async function loadHistory(chatId, limit = 40) {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT role, content FROM (
      SELECT role, content, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT ?
    ) ORDER BY created_at ASC
  `);
  stmt.bind([String(chatId), limit]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function clearHistory(chatId) {
  const db = await getDb();
  db.run("DELETE FROM messages WHERE chat_id = ?", [String(chatId)]);
  persist();
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

async function addTask(chatId, text) {
  const db = await getDb();
  db.run(
    "INSERT INTO tasks (chat_id, text) VALUES (?, ?)",
    [String(chatId), text]
  );
  persist();
}

async function getPendingTasks(chatId) {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT id, text, created_at FROM tasks WHERE chat_id = ? AND status = 'pending' ORDER BY id ASC"
  );
  stmt.bind([String(chatId)]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function completeTask(taskId, chatId) {
  const db = await getDb();
  db.run(
    "UPDATE tasks SET status = 'done' WHERE id = ? AND chat_id = ?",
    [taskId, String(chatId)]
  );
  persist();
}

async function uncompleteTask(taskId, chatId) {
  const db = await getDb();
  db.run(
    "UPDATE tasks SET status = 'pending' WHERE id = ? AND chat_id = ?",
    [taskId, String(chatId)]
  );
  persist();
}

async function deleteTask(taskId, chatId) {
  const db = await getDb();
  db.run(
    "DELETE FROM tasks WHERE id = ? AND chat_id = ?",
    [taskId, String(chatId)]
  );
  persist();
  return true;
}

// Optional: get a task by exact text for AI remove command
async function getTaskByText(chatId, text) {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT id, text FROM tasks WHERE chat_id = ? AND text = ? AND status = 'pending' LIMIT 1"
  );
  stmt.bind([String(chatId), text]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;  // null if not found
}

async function clearTasks(chatId) {
  const db = await getDb();
  db.run("DELETE FROM tasks WHERE chat_id = ?", [String(chatId)]);
  persist();
}

// ── Facts functions ─────────────────────────────

async function setFact(chatId, key, value) {
  const db = await getDb();
  db.run(
    `INSERT INTO facts (chat_id, key, value) 
     VALUES (?, ?, ?)
     ON CONFLICT(chat_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [String(chatId), key, value]
  );
  persist();
}

async function getFact(chatId, key) {
  const db = await getDb();
  const stmt = db.prepare("SELECT value FROM facts WHERE chat_id = ? AND key = ?");
  stmt.bind([String(chatId), key]);
  let value = null;
  if (stmt.step()) value = stmt.getAsObject().value;
  stmt.free();
  return value;
}

async function deleteFact(chatId, key) {
  const db = await getDb();
  db.run("DELETE FROM facts WHERE chat_id = ? AND key = ?", [String(chatId), key]);
  persist();
}

async function getAllFacts(chatId) {
  const db = await getDb();
  const stmt = db.prepare("SELECT key, value FROM facts WHERE chat_id = ?");
  stmt.bind([String(chatId)]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = {
  saveMessage,
  loadHistory,
  clearHistory,
  addTask,
  getPendingTasks,
  completeTask,
  uncompleteTask,
  deleteTask,
  getTaskByText,
  clearTasks,

  setFact,
  getFact,
  deleteFact,
  getAllFacts
};