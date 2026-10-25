
import { useEffect, useState } from "react";
import "./App.css";

const API = "http://localhost:5000/api";

function localDate(timestamp = Date.now()) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function duration(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

function clock(timestamp) {
  return new Date(Number(timestamp)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

async function api(endpoint, options = {}) {
  const response = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function App() {
  const [tasks, setTasks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [weekSessions, setWeekSessions] = useState([]);
  const [goalHours, setGoalHours] = useState(null);
  const [taskInput, setTaskInput] = useState("");
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [tab, setTab] = useState("focus");
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("studytrack-active")) || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [goalEditor, setGoalEditor] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  const today = localDate();
  const isToday = selectedDate === today;
  const goalSeconds = (Number(goalHours) || 0) * 3600;

  const weekStart = new Date(`${selectedDate}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return localDate(d.getTime());
  });

  async function loadData(date = selectedDate) {
    setError("");
    try {
      const [taskData, sessionData, settings, weeklyData] = await Promise.all([
        api(`/tasks?date=${date}`),
        api(`/sessions?date=${date}`),
        api("/settings"),
        api(`/sessions?from=${weekDates[0]}&to=${weekDates[6]}`),
      ]);
      setTasks(taskData);
      setSessions(sessionData);
      setGoalHours(settings.goalHours == null ? null : Number(settings.goalHours));
      setGoalInput(settings.goalHours == null ? "" : String(settings.goalHours));
      setWeekSessions(weeklyData);
    } catch (err) {
      setError(`${err.message}. Make sure the backend is running.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (active) localStorage.setItem("studytrack-active", JSON.stringify(active));
    else localStorage.removeItem("studytrack-active");
  }, [active]);

  const savedSeconds = sessions.reduce((sum, s) => sum + Number(s.duration || 0), 0);
  const runningSeconds = active
    ? Math.max(0, Math.floor((now - active.startedAt) / 1000))
    : 0;
  const totalSeconds = savedSeconds + (isToday && active?.date === today ? runningSeconds : 0);
  const progress = goalSeconds > 0 ? Math.min(100, totalSeconds / goalSeconds * 100) : 0;
  const completed = tasks.filter((task) => task.completed).length;
  const taskProgress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;

  function secondsForDate(date) {
    return weekSessions
      .filter((session) => session.date === date)
      .reduce((sum, session) => sum + Number(session.duration || 0), 0);
  }

  async function addTask(event) {
    event.preventDefault();
    if (!taskInput.trim() || busy) return;
    setBusy(true);
    try {
      const task = await api("/tasks", {
        method: "POST",
        body: JSON.stringify({ title: taskInput.trim(), date: selectedDate }),
      });
      setTasks((old) => [task, ...old]);
      setTaskInput("");
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task) {
    try {
      const updated = await api(`/tasks/${task.id}/completed`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed }),
      });
      setTasks((old) => old.map((item) => item.id === task.id ? updated : item));
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTask(id) {
    try {
      await api(`/tasks/${id}`, { method: "DELETE" });
      setTasks((old) => old.filter((task) => task.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  function startTimer() {
    if (active || !isToday) return;
    const startedAt = Date.now();
    setActive({ startedAt, date: localDate(startedAt) });
    setNow(startedAt);
    setError("");
  }

  async function stopTimer() {
    if (!active || busy) return;
    const endedAt = Date.now();
    const seconds = Math.floor((endedAt - active.startedAt) / 1000);
    if (seconds < 1) {
      setError("Study for at least one second before stopping.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api("/sessions", {
        method: "POST",
        body: JSON.stringify({
          startedAt: active.startedAt,
          endedAt,
        }),
      });
      setActive(null);
      setNow(endedAt);
      await loadData(selectedDate);
    } catch (err) {
      setError(`Session not saved: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveGoal(event) {
    event.preventDefault();
    const value = goalInput.trim() === "" ? null : Number(goalInput);
    if (value !== null && (!Number.isFinite(value) || value < 0.25 || value > 24)) {
      setError("Enter a goal from 0.25 to 24 hours, or leave it blank.");
      return;
    }
    try {
      const result = await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ goalHours: value }),
      });
      setGoalHours(result.goalHours == null ? null : Number(result.goalHours));
      setGoalEditor(false);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  function changeDate(amount) {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + amount);
    const next = localDate(date.getTime());
    if (next <= today) setSelectedDate(next);
  }

  const dayName = new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const radius = 103;
  const circumference = 2 * Math.PI * radius;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S<span>✿</span></div>
        <div className="brand-copy">
          <h1>StudyTrack</h1>
          <p>{dayName} · {displayDate(selectedDate)}</p>
        </div>
        <button className="goal-button" onClick={() => setGoalEditor(!goalEditor)}>
          ✧ {goalHours ? `${goalHours}h goal` : "Set goal"}
        </button>
      </header>

      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")}>×</button></div>}

      {goalEditor && (
        <form className="goal-editor" onSubmit={saveGoal}>
          <label htmlFor="goal">Daily goal (hours)</label>
          <input id="goal" type="number" min="0.25" max="24" step="0.25" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} placeholder="Leave blank for no goal" />
          <button type="submit">Save goal</button>
          <button type="button" onClick={() => setGoalEditor(false)}>Cancel</button>
        </form>
      )}

      {loading ? (
        <section className="panel loading-card"><div className="loading-flower">✿</div><h2>Preparing your day...</h2><p>Loading saved study data.</p></section>
      ) : (
        <>
          {tab === "focus" && (
            <>
              <section className="reference-focus">
                <div className="selected-date">
                  <button className="date-back" onClick={() => changeDate(-1)} aria-label="Previous day">‹</button>
                  <div><strong>{displayDate(selectedDate)}</strong><span>{dayName}</span></div>
                  <button className="date-flower" onClick={() => setSelectedDate(today)} aria-label="Go to today">✿</button>
                </div>

                <div className="week-progress">
                  {weekDates.map((date, index) => {
                    const dayProgress = goalSeconds > 0 ? Math.min(1, secondsForDate(date) / goalSeconds) : 0;
                    const names = ["M", "T", "W", "T", "F", "S", "S"];
                    return (
                      <button className={`week-day ${date === selectedDate ? "current" : ""}`} key={date} onClick={() => setSelectedDate(date)} aria-label={`View ${date}`}>
                        <span className="week-label">{names[index]}</span>
                        <svg viewBox="0 0 46 46" className="week-ring">
                          <circle cx="23" cy="23" r="18" className="week-ring-track" />
                          <circle cx="23" cy="23" r="18" className="week-ring-fill" strokeDasharray={2 * Math.PI * 18} strokeDashoffset={2 * Math.PI * 18 * (1 - dayProgress)} />
                        </svg>
                        <span className="week-date-number">{new Date(`${date}T12:00:00`).getDate()}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="reference-ring-wrap">
                  <svg className="reference-ring" viewBox="0 0 250 250">
                    <circle cx="125" cy="125" r={radius} className="reference-ring-track" />
                    <circle cx="125" cy="125" r={radius} className="reference-ring-progress" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress / 100)} />
                  </svg>
                  <button className={`ring-control ${active ? "ring-control-stop" : ""}`} onClick={active ? stopTimer : startTimer} disabled={busy || (!isToday && !active)} aria-label={active ? "Stop timer" : "Start timer"}>
                    {busy ? "…" : active ? "■" : "→"}
                  </button>
                  <div className="reference-ring-center">
                    <strong>{duration(totalSeconds)}</strong>
                    <span>{goalHours ? `Focus goal ${goalHours}h` : "No daily goal set"}</span>
                    {active && <small>✿ Focusing now</small>}
                    {!isToday && !active && <small>Viewing past day</small>}
                  </div>
                </div>
                <div className="focus-goal-caption">
                  <span>{goalHours ? `${Math.round(progress)}% completed` : "Set a goal to track progress"}</span>
                  <span>{goalHours ? `${duration(Math.max(0, goalSeconds - totalSeconds))} left` : "Goal optional"}</span>
                </div>
              </section>

              <section className="panel summary-card">
                <div className="panel-heading"><div><span className="eyebrow">YOUR DAY AT A GLANCE</span><h2>Summary</h2></div><span className="mini-icon">☼</span></div>
                <div className="day-timeline"><div className="timeline-fill" style={{ width: `${progress}%` }} /></div>
                <div className="timeline-labels"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
                <div className="summary-stats">
                  <div><strong>{duration(totalSeconds)}</strong><span>Focus time</span></div>
                  <div><strong>{sessions.length}</strong><span>Sessions</span></div>
                  <div><strong>{goalHours ? `${Math.round(progress)}%` : "—"}</strong><span>Goal reached</span></div>
                </div>
              </section>

              <section className="panel tags-card">
                <div className="panel-heading"><div><span className="eyebrow">YOUR FOCUS</span><h2>Tags</h2></div><span className="mini-icon">♡</span></div>
                <p className="muted-message">{sessions.length ? "Independent study" : "No tags yet. Your saved study sessions will appear here."}</p>
              </section>

              <section className="panel recent-card">
                <div className="panel-heading"><div><span className="eyebrow">LITTLE WINS</span><h2>Sessions</h2></div><span className="mini-icon">◷</span></div>
                {sessions.length ? (
                  <div className="session-list">
                    {sessions.map((session) => (
                      <div className="session-row" key={session.id}>
                        <div className="session-symbol">✿</div>
                        <div className="session-details"><strong>Study session</strong><span>{clock(session.started_at)} – {clock(session.ended_at)}</span></div>
                        <strong className="session-duration">{duration(session.duration)}</strong>
                      </div>
                    ))}
                  </div>
                ) : <p className="muted-message">No sessions yet.</p>}
                {active && <p className="running-note"><i /> Current session · {duration(runningSeconds)}</p>}
              </section>
            </>
          )}

          {tab === "planner" && (
            <section className="page-content">
              <div className="page-intro"><span className="eyebrow">A FRESH LITTLE START</span><h2>Your daily planner <span>♡</span></h2><p>Plan your priorities for the day.</p></div>
              <section className="panel planner-panel">
                <div className="panel-heading"><div><span className="eyebrow">DAILY PLAN</span><h2>Study tasks</h2></div><span className="task-pill">{completed}/{tasks.length} done</span></div>
                <div className="date-picker-row"><label htmlFor="task-date">Plan for</label><input id="task-date" type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} />{!isToday && <button className="text-button" onClick={() => setSelectedDate(today)}>Today</button>}</div>
                <form className="add-task-form" onSubmit={addTask}><input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="Add a task for today..." aria-label="New task" /><button type="submit" disabled={!taskInput.trim() || busy}>+ Add task</button></form>
                <div className="planner-progress"><div><span>Daily completion</span><strong>{taskProgress}%</strong></div><div className="task-progress-track"><div style={{ width: `${taskProgress}%` }} /></div></div>
                {tasks.length ? <div className="planner-list">{tasks.map((task) => (
                  <div className={`planner-task ${task.completed ? "completed-task" : ""}`} key={task.id}>
                    <button className={`task-checkbox ${task.completed ? "checked" : ""}`} onClick={() => toggleTask(task)} aria-label="Toggle task">{task.completed ? "✓" : ""}</button>
                    <div className="planner-task-title"><strong>{task.title}</strong><span>{task.completed ? "Completed" : "Pending"}</span></div>
                    <button className="delete-button" onClick={() => deleteTask(task.id)} aria-label="Delete task">×</button>
                  </div>
                ))}</div> : <div className="empty-state"><div className="empty-icon">♡</div><p>No tasks for this day</p><span>Add your first task above.</span></div>}
              </section>
            </section>
          )}

          {tab === "history" && (
            <section className="page-content">
              <div className="page-intro"><span className="eyebrow">YOUR REAL PROGRESS</span><h2>Study history <span>♡</span></h2><p>Review sessions saved to your database.</p></div>
              <section className="panel history-panel">
                <label htmlFor="history-date">Select date</label>
                <input id="history-date" type="date" max={today} value={selectedDate} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} />
                <div className="history-total"><span className="eyebrow">TOTAL FOCUS TIME</span><strong>{duration(totalSeconds)}</strong><span>{sessions.length} saved session{sessions.length === 1 ? "" : "s"}</span></div>
                {sessions.length ? <div className="session-list">{sessions.map((session) => (
                  <div className="session-row" key={session.id}><div className="session-symbol">✿</div><div className="session-details"><strong>Study session</strong><span>{clock(session.started_at)} – {clock(session.ended_at)}</span></div><strong className="session-duration">{duration(session.duration)}</strong></div>
                ))}</div> : <div className="empty-state"><div className="empty-icon">✿</div><p>No saved sessions on this date</p><span>Complete a focus session to build your history.</span></div>}
              </section>
            </section>
          )}
        </>
      )}

      <nav className="bottom-nav">
        <button className={tab === "focus" ? "nav-item active" : "nav-item"} onClick={() => setTab("focus")}><span className="nav-icon">◷</span><span>Focus</span></button>
        <button className={tab === "planner" ? "nav-item active" : "nav-item"} onClick={() => setTab("planner")}><span className="nav-icon">▦</span><span>Planner</span></button>
        <button className={tab === "history" ? "nav-item active" : "nav-item"} onClick={() => setTab("history")}><span className="nav-icon">♡</span><span>History</span></button>
      </nav>
    </main>
  );
}

export default App;
