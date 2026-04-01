/**
 * ARIA — AI Personal Assistant Telegram Bot (OpenRouter) - SECURED VERSION
 * Powered by OpenRouter Step 3.5 Flash (free) + SQLite persistent storage
 * 
 * SECURITY ENHANCEMENTS:
 * - User whitelist authentication
 * - Rate limiting per user
 * - File upload restrictions
 * - Input sanitization
 *
 * Usage:   node bot_secured.js
 * Env vars: TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY, ALLOWED_USER_IDS
 * Requires: SQLite DB file (db.js) for conversation & tasks
 */

require("dotenv").config();
const activeChats = new Set();
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const { getAllFacts } = require("./db");

// ── Config ───────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_NAME = "stepfun/step-3.5-flash:free";

// ── SECURITY: Whitelist Configuration ────────────────────────────────────
// Get your Telegram user ID by messaging @userinfobot on Telegram
// Add to .env as: ALLOWED_USER_IDS=123456789,987654321
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS 
  ? process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()))
  : [];

// Rate limiting: max requests per user per hour
const RATE_LIMIT = {
  maxRequests: 100,
  windowMs: 60 * 60 * 1000, // 1 hour
  requests: new Map() // userId -> [{timestamp}]
};

// File upload limits
const FILE_LIMITS = {
  maxSizeMB: 10,
  maxPerHour: 20
};

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or OPENROUTER_API_KEY.");
  process.exit(1);
}

if (ALLOWED_USER_IDS.length === 0) {
  console.error("⚠️  SECURITY WARNING: No ALLOWED_USER_IDS set!");
  console.error("   Bot will reject all requests for safety.");
  console.error("   Add your Telegram user ID to .env: ALLOWED_USER_IDS=YOUR_ID");
  console.error("   Get your ID from @userinfobot on Telegram");
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ── Security Middleware ──────────────────────────────────────────────────
function isAuthorized(userId) {
  if (ALLOWED_USER_IDS.length === 0) {
    return false; // Reject all if whitelist not configured
  }
  return ALLOWED_USER_IDS.includes(userId);
}

function checkRateLimit(userId) {
  const now = Date.now();
  const userRequests = RATE_LIMIT.requests.get(userId) || [];
  
  // Clean old requests outside window
  const recentRequests = userRequests.filter(
    timestamp => now - timestamp < RATE_LIMIT.windowMs
  );
  
  if (recentRequests.length >= RATE_LIMIT.maxRequests) {
    return false; // Rate limit exceeded
  }
  
  recentRequests.push(now);
  RATE_LIMIT.requests.set(userId, recentRequests);
  return true;
}

function sendUnauthorized(chatId, username) {
  console.warn(`⛔ Unauthorized access attempt from user ID ${chatId} (${username})`);
  bot.sendMessage(chatId, "⛔ *Unauthorized Access*\n\nThis bot is private and only accepts commands from authorized users.\n\nIf you believe this is an error, please contact the bot owner.", 
    { parse_mode: "Markdown" });
}

function sendRateLimited(chatId) {
  bot.sendMessage(chatId, "⚠️ Rate limit exceeded. Please try again later.");
}

// ── System Prompt ─────────────────────────────────────────────────────────
const fs = require('fs');
const SYSTEM_PROMPT = fs.readFileSync('./system_prompt.txt', 'utf8');

// ── Telegram-safe message sender ─────────────────────────────────────────
async function sendSafeMessage(chatId, text, options = {}) {
  const MAX_LENGTH = 4096;

  let safeText = text?.trim() || "⚠️ Empty response from AI.";

  // Split into chunks
  const chunks = [];
  for (let i = 0; i < safeText.length; i += MAX_LENGTH) {
    chunks.push(safeText.slice(i, i + MAX_LENGTH));
  }

  for (const chunk of chunks) {
    // attempt 1: Markdown V1
    try {
      await bot.sendMessage(chatId, chunk, { parse_mode: "Markdown", ...options });
      continue;
    } catch (e1) {
      console.warn("Markdown failed:", e1.message);
    }

    // attempt 2: plain text fallback
    try {
      const plain = chunk
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/_(.*?)_/g, "$1")
        .replace(/`(.*?)`/g, "$1");

      await bot.sendMessage(chatId, plain, { ...options, parse_mode: undefined });
    } catch (e2) {
      console.warn("Plain text failed:", e2.message);
      await bot.sendMessage(chatId, "⚠️ could not render part of response.");
    }
  }
}

// ── Call OpenRouter ──────────────────────────────────────────────────────
async function callOpenRouter(history, systemPrompt = SYSTEM_PROMPT, effort = "low", maxRetries = 50, delayMs = 3000, chatId = null) {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) throw new Error("Missing OPENROUTER_API_KEY in .env");

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((row) => ({ role: row.role, content: row.content })),
  ];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_KEY}`
        },
        body: JSON.stringify({
          model: "stepfun/step-3.5-flash:free",
          messages,
          reasoning: {
            effort: effort
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();

        // Detect rate limit
        if (response.status === 429 && attempt < maxRetries) {
          console.warn(`⚠️ OpenRouter 429 rate-limit hit. Retry #${attempt} in ${delayMs / 1000}s...`);
          if (attempt === 1 && chatId) {
            await bot.sendMessage(chatId, "⏳ model is a bit overloaded right now, retrying... won't be long!");
          }
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        throw new Error(`OpenRouter ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;
      return {
        content: message?.content || "",
        reasoning: message?.reasoning || null,
        reasoning_details: message?.reasoning_details || null
      };

    } catch (err) {
      if (attempt < maxRetries) {
        console.warn(`Retrying due to error: ${err.message} (attempt ${attempt})`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

function getReasoningEffort(userText, hasFile = false) {
  if (hasFile) return "high";

  const text = userText.toLowerCase();
  const length = userText.length;

  const highKeywords = [
    "analyse", "analyze", "critique", "summarise", "summarize",
    "compare", "evaluate", "plan", "strategy", "review",
    "improve", "suggest", "recommendations", "brief me", "breakdown"
  ];

  const lowKeywords = [
    "add task", "remove task", "delete task", "clear", "list",
    "what time", "remind", "when is", "draft", "write a message",
    "hi", "hello", "thanks"
  ];

  if (highKeywords.some(k => text.includes(k))) return "high";
  if (lowKeywords.some(k => text.includes(k)))  return "low";
  if (length > 300) return "medium";
  if (length > 80)  return "medium";

  return "low";
}

// ── Core: reply with AI ───────────────────────────────────────────────────
async function replyWithAI(chatId, userText, forceEffort = null) {
  if (activeChats.has(chatId)) return;
  activeChats.add(chatId);

  const typingInterval = setInterval(
    () => bot.sendChatAction(chatId, "typing").catch(() => {}),
    4000
  );

  await db.saveMessage(chatId, "user", userText);
  const history = await db.loadHistory(chatId, 40);
  const facts = await getAllFacts(chatId);
  const factsText = facts.map(f => `• ${f.key}: ${f.value}`).join("\n");

  try {
    const tasks = await db.getPendingTasks(chatId);
    const tasksText = tasks.length
      ? tasks.map(t => `${t.id}. ${t.text}`).join("\n")
      : "none";
    const systemMessage = `${SYSTEM_PROMPT}\n\n*Dynamic facts:*\n${factsText}\n\n*Current pending tasks (use these IDs for remove_task):*\n${tasksText}`;

    const effort = forceEffort || getReasoningEffort(userText);
    console.log(`🧠 Reasoning effort: ${effort}`);
    const { content: rawReply, reasoning } = await callOpenRouter(history, systemMessage, effort, 50, 3000, chatId);
    if (reasoning) console.log(`🧠 Reasoning:\n${reasoning}\n`); 

    const lines = rawReply.split("\n");
    let actions = [];
    let cleanLines = [];

    for (const line of lines) {
      const trimmed = line.trim()
        .replace(/^```json?\s*/i, "")
        .replace(/```$/, "")
        .trim();
      if (trimmed.startsWith("[{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) actions = parsed;
        } catch (_) {}
      } else if (trimmed.startsWith('{"aria_action"')) {
        try {
          const parsed = JSON.parse(trimmed);
          actions = [parsed];
        } catch (_) {}
      } else {
        cleanLines.push(line);
      }
    }

    const cleanReply = cleanLines.join("\n").trim();
    const confirmations = [];

    for (const action of actions) {
      if (action.aria_action === "add_task" && action.text) {
        await db.addTask(chatId, action.text);
        console.log(`📋 Task added: ${action.text}`);
        confirmations.push(`📋 *${action.text}*`);

      } else if (action.aria_action === "remove_task" && action.id) {
        await db.deleteTask(action.id, chatId);
        console.log(`❌ Task removed: ${action.id}`);
        confirmations.push(`✅ removed task ${action.id}`);

      } else if (action.aria_action === "add_fact" && action.key && action.value) {
        await db.setFact(chatId, action.key, action.value);
        console.log(`🧠 Fact stored: ${action.key} = ${action.value}`);
        confirmations.push(`🧠 noted: *${action.key}* = ${action.value}`);
      }
    }

    const fallback = confirmations.length > 0
      ? confirmations.join("\n")
      : "";

    const finalReply = cleanReply || fallback || "✅ done.";
    await sendSafeMessage(chatId, finalReply);
    await db.saveMessage(chatId, "assistant", rawReply);

    activeChats.delete(chatId);
  } catch (err) {
    clearInterval(typingInterval);
    console.error("OpenRouter error:", err.message);
    await sendSafeMessage(
      chatId,
      "⚠️ I had trouble reaching my AI backend. Please try again later."
    );
    activeChats.delete(chatId);
  }
  clearInterval(typingInterval);  
}

// ── /start ──────────────────────────────────────────────────────────────
bot.onText(/\/start/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || "User";

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, username);
  }

  const firstName = msg.from?.first_name || "there";
  await sendSafeMessage(chatId, `hi ${firstName}! 👋 i'm ARIA, your personal assistant. type /help for commands.`);
});

// ── /help ───────────────────────────────────────────────────────────────
bot.onText(/\/help/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  await sendSafeMessage(chatId,
`*ARIA Commands*
/start — intro
/help — show this menu
/clear — wipe conversation memory
/tasks — list pending tasks
/brief — get daily briefing
/setfact - manually set persistent facts
/getfacts - get all current facts

*Task examples:*
• "add a task: reply to Sarah by Friday"
• "mark task 3 as done"
• "what are my pending tasks?"
`);
});

// ── /clear ──────────────────────────────────────────────────────────────
bot.onText(/\/clear/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  await db.clearHistory(chatId);
  await sendSafeMessage(chatId, "🧹 conversation history cleared. starting fresh!");
});

// ── /tasks ──────────────────────────────────────────────────────────────
bot.onText(/\/tasks/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  const tasks = await db.getPendingTasks(chatId);

  if (!tasks.length) return await sendSafeMessage(chatId, "📋 you have no pending tasks. ask me to add one!");

  const lines = tasks.map(t => `${t.id}. ${t.text}`).join("\n");
  await sendSafeMessage(chatId, `📋 *your pending tasks:*\n\n${lines}\n\nsay "remove task [name]" to delete one.`);
});

// ── /brief ──────────────────────────────────────────────────────────────
bot.onText(/\/brief/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  if (!checkRateLimit(userId)) {
    return sendRateLimited(chatId);
  }

  const tasks = await db.getPendingTasks(chatId);
  const taskSummary = tasks.length
    ? `pending tasks (${tasks.length}): ${tasks.map(t => t.text).join("; ")}`
    : "no pending tasks";
  const now = new Date().toLocaleString("en-US", { weekday:"long", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" });

  await replyWithAI(chatId, `give me a sharp daily briefing. current time: ${now}. ${taskSummary}. what should i focus on?`);
});

// ── /setfact ────────────────────────────────────────────────────────────
bot.onText(/\/setfact (\S+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  const key = match[1];
  const value = match[2];
  await db.setFact(chatId, key, value);
  await sendSafeMessage(chatId, `✅ Fact updated: ${key} = ${value}`);
});

// ── /getfacts ───────────────────────────────────────────────────────────
bot.onText(/\/getfacts/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  const facts = await db.getAllFacts(chatId);
  if (!facts.length) return await sendSafeMessage(chatId, "No dynamic facts set yet.");
  const text = facts.map(f => `• ${f.key}: ${f.value}`).join("\n");
  await sendSafeMessage(chatId, `*Current facts:*\n${text}`);
});

// ── All other messages ───────────────────────────────────────────────────
bot.on("message", async msg => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  if (!checkRateLimit(userId)) {
    return sendRateLimited(chatId);
  }

  if (!msg.text || msg.text.startsWith("/")) return;
  await replyWithAI(msg.chat.id, msg.text);
});

// ── Document handler with security ───────────────────────────────────────
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const doc = msg.document;

  if (!isAuthorized(userId)) {
    return sendUnauthorized(chatId, msg.from.username || msg.from.first_name);
  }

  if (!checkRateLimit(userId)) {
    return sendRateLimited(chatId);
  }

  // Check file size
  const fileSizeMB = doc.file_size / (1024 * 1024);
  if (fileSizeMB > FILE_LIMITS.maxSizeMB) {
    return sendSafeMessage(chatId, `⚠️ File too large. Maximum size is ${FILE_LIMITS.maxSizeMB}MB.`);
  }

  const caption = msg.caption || "analyse this document and give me a summary, key points, and any improvements you'd suggest.";

  const allowed = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv"
  ];

  if (!allowed.includes(doc.mime_type)) {
    return sendSafeMessage(chatId, "⚠️ unsupported file type. i can read PDF, Word (.docx), Excel (.xlsx), CSV, and plain text files.");
  }

  await sendSafeMessage(chatId, "📄 got it, reading your file...");

  try {
    const fileLink = await bot.getFileLink(doc.file_id);
    const response = await fetch(fileLink);
    const buffer = await response.arrayBuffer();
    const text = await extractText(Buffer.from(buffer), doc.mime_type, doc.file_name);

    if (!text || text.trim().length === 0) {
      return sendSafeMessage(chatId, "⚠️ couldn't extract text from that file. try a different format.");
    }

    const userMessage = `${caption}\n\n---\n${text.slice(0, 12000)}`;
    await replyWithAI(chatId, userMessage);

  } catch (err) {
    console.error("File processing error:", err.message);
    await sendSafeMessage(chatId, "⚠️ something went wrong reading that file. try again.");
  }
});

const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");
const ExcelJS  = require("exceljs"); 

async function extractText(buffer, mimeType, fileName) {
  if (mimeType === "application/pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer); // Loads the buffer asynchronously
    
    let text = "";
    
    workbook.eachSheet((worksheet) => {
      text += `\n--- Sheet: ${worksheet.name} ---\n`;
      
      worksheet.eachRow((row) => {
        // row.values returns an array. Index 0 is empty due to ExcelJS 1-based indexing.
        // We filter out the empty first element and join with commas to mimic CSV.
        const rowData = row.values.slice(1).join(",");
        text += rowData + "\n";
      });
    });

    return text;
  }


  if (mimeType === "text/csv" || mimeType === "text/plain") {
    return buffer.toString("utf-8");
  }

  return null;
}

// ── Polling errors ───────────────────────────────────────────────────────
bot.on("polling_error", err => console.error("Polling error:", err.message));

console.log(`✅ ARIA Telegram Bot (SECURED) running`);
console.log(`🔒 Authorized users: ${ALLOWED_USER_IDS.join(', ') || 'NONE - Bot will reject all requests!'}`);
console.log(`⚙️  Rate limit: ${RATE_LIMIT.maxRequests} requests per hour per user`);