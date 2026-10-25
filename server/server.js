
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, "studytrack.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Keep the existing database schema compatible.
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    task_title TEXT NOT NULL DEFAULT 'Study Session',
    date TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    duration INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Add missing columns only if necessary.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("tasks", "created_at", "TEXT");
ensureColumn("sessions", "task_id", "INTEGER");
ensureColumn("sessions", "task_title", "TEXT NOT NULL DEFAULT 'Study Session'");

function localDate(timestamp) {
  const d = new Date(Number(timestamp));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeTask(row) {
  if (!row) return null;
  return { ...row, completed: Boolean(row.completed) };
}

function safeSession(row) {
  if (!row) return null;
  return {
    ...row,
    task_title: row.task_title || "Study Session",
    duration: Number(row.duration),
    started_at: Number(row.started_at),
    ended_at: Number(row.ended_at),
  };
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", database: "connected" });
});

// TASKS
app.get("/api/tasks", (req, res) => {
  const date = req.query.date || localDate(Date.now());

  const rows = db.prepare(`
    SELECT id, title, date, completed, created_at
    FROM tasks
    WHERE date = ?
    ORDER BY id DESC
  `).all(date);

  res.json(rows.map(safeTask));
});

app.post("/api/tasks", (req, res) => {
  const title = String(req.body.title || "").trim();
  const date = String(req.body.date || localDate(Date.now()));

  if (!title) {
    return res.status(400).json({ error: "Task title is required." });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid task date." });
  }

  const result = db.prepare(`
    INSERT INTO tasks (title, date, completed, created_at)
    VALUES (?, ?, 0, CURRENT_TIMESTAMP)
  `).run(title, date);

  const task = db.prepare(`
    SELECT id, title, date, completed, created_at
    FROM tasks WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(safeTask(task));
});

app.patch("/api/tasks/:id/completed", (req, res) => {
  const id = Number(req.params.id);
  const completed = req.body.completed;

  if (!Number.isInteger(id) || typeof completed !== "boolean") {
    return res.status(400).json({ error: "Invalid task update." });
  }

  const result = db.prepare(
    "UPDATE tasks SET completed = ? WHERE id = ?"
  ).run(completed ? 1 : 0, id);

  if (!result.changes) {
    return res.status(404).json({ error: "Task not found." });
  }

  const task = db.prepare(`
    SELECT id, title, date, completed, created_at
    FROM tasks WHERE id = ?
  `).get(id);

  res.json(safeTask(task));
});

app.delete("/api/tasks/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);

  if (!result.changes) {
    return res.status(404).json({ error: "Task not found." });
  }

  res.json({ success: true });
});

// STUDY SESSIONS
app.get("/api/sessions", (req, res) => {
  const { date, from, to } = req.query;
  let rows;

  if (from && to) {
    rows = db.prepare(`
      SELECT id, task_id, task_title, date, started_at, ended_at, duration
      FROM sessions
      WHERE date >= ? AND date <= ?
      ORDER BY started_at DESC
    `).all(from, to);
  } else {
    const targetDate = date || localDate(Date.now());

    rows = db.prepare(`
      SELECT id, task_id, task_title, date, started_at, ended_at, duration
      FROM sessions
      WHERE date = ?
      ORDER BY started_at DESC
    `).all(targetDate);
  }

  res.json(rows.map(safeSession));
});

app.post("/api/sessions", (req, res) => {
  const startedAt = Number(req.body.startedAt);
  const endedAt = Number(req.body.endedAt);

  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    startedAt <= 0 ||
    endedAt <= startedAt
  ) {
    return res.status(400).json({
      error: "Invalid session start or end time.",
    });
  }

  const seconds = Math.floor((endedAt - startedAt) / 1000);

  if (seconds < 1) {
    return res.status(400).json({
      error: "Study for at least one second before saving.",
    });
  }

  const date = localDate(startedAt);

  const result = db.prepare(`
    INSERT INTO sessions (
      task_id, task_title, started_at, ended_at, duration, date
    )
    VALUES (NULL, 'Study Session', ?, ?, ?, ?)
  `).run(startedAt, endedAt, seconds, date);

  const session = db.prepare(`
    SELECT id, task_id, task_title, date, started_at, ended_at, duration
    FROM sessions WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(safeSession(session));
});

// SETTINGS: use the existing key/value schema.
app.get("/api/settings", (req, res) => {
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = ?"
  ).get("goalHours");

  const goalHours = row ? Number(row.value) : null;

  res.json({
    goalHours: Number.isFinite(goalHours) ? goalHours : null,
  });
});

app.put("/api/settings", (req, res) => {
  const value = req.body.goalHours;

  if (value === null || value === "") {
    db.prepare("DELETE FROM settings WHERE key = ?").run("goalHours");
    return res.json({ goalHours: null });
  }

  const hours = Number(value);

  if (!Number.isFinite(hours) || hours < 0.25 || hours > 24) {
    return res.status(400).json({
      error: "Goal must be between 0.25 and 24 hours.",
    });
  }

  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run("goalHours", String(hours));

  res.json({ goalHours: hours });
});

app.listen(PORT, () => {
  console.log(`StudyTrack API running at http://localhost:${PORT}`);
  console.log(`Database file: ${path.join(__dirname, "studytrack.db")}`);
});

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
