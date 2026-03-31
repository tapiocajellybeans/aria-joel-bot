# ARIA — Telegram Bot Setup Guide (v2)
Powered by **Google Gemini 1.5 Flash** (free) + **SQLite** persistent storage.

---

## Step 1 — Create your Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Pick a name (e.g. `ARIA Assistant`) and a username ending in `bot`
4. Copy the **Bot Token** BotFather gives you

**Optional — set bot commands for a nice menu in Telegram:**
Send `/setcommands` to BotFather, select your bot, then paste:
```
start - Start ARIA
help - Show available commands
clear - Wipe conversation memory
tasks - List pending tasks
brief - Get a daily briefing
```

---

## Step 2 — Get your Gemini API Key (free, no credit card)

1. Go to [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in with a Google account
3. Click **Create API Key**
4. Copy the key

Free tier limits: **15 requests/min, 1,500 requests/day** — plenty for personal use.

---

## Step 3 — Configure

```bash
cp .env.example .env
```

Fill in `.env`:
```
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ
GEMINI_API_KEY=AIzaSy...
```

---

## Step 4 — Install & Run

Requires **Node.js 18+**.

```bash
npm install
npm start
```

You should see:
```
✅  SQLite database ready at /path/to/aria.db
✅  ARIA Telegram Bot is running (Gemini + SQLite)...
```

Open Telegram, find your bot, send `/start`.

---

## Commands

| Command  | What it does                          |
|----------|---------------------------------------|
| `/start` | Welcome message                       |
| `/help`  | Show all commands                     |
| `/clear` | Wipe conversation history from DB     |
| `/tasks` | List pending tasks stored in DB       |
| `/brief` | Daily briefing with task summary      |

---

## Task Management (natural language)

ARIA can manage your tasks automatically through chat:

- *"Add a task: review the Q4 report by Friday"*
- *"Remind me to call Lisa tomorrow"*
- *"Mark task 2 as done"*
- *"What are my pending tasks?"*

Tasks are saved to SQLite and survive restarts.

---

## Persistent Memory

Conversation history and tasks are stored in `aria.db` (SQLite file in the project folder).

- History is loaded from DB on every message — ARIA remembers past sessions
- `/clear` wipes conversation history but keeps tasks
- Tasks persist until explicitly marked done

---

## Running 24/7 (Railway — recommended)

1. Push the project to a GitHub repo (make sure `.env` is in `.gitignore`)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway's dashboard (Settings → Variables)
4. Railway auto-detects Node.js and runs `npm start`

For the SQLite file to persist across Railway deploys, add a **Volume** in Railway:
- Mount path: `/app` (or wherever your project runs)
- This ensures `aria.db` isn't wiped on redeploy

---

## Project Structure

```
aria-telegram-bot/
├── bot.js          # Telegram bot + Gemini integration
├── db.js           # All SQLite logic (messages + tasks)
├── aria.db         # Auto-created on first run
├── package.json
├── .env.example
├── .env            # Your secrets — never commit this
├── .gitignore
└── README.md
```
