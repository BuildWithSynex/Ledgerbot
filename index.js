const express = require("express");
const fs = require("fs");
const axios = require("axios");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = "./expenses.json";

function readEntries() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveEntries(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function sendTelegramMessage(chatId, text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
  });
}

function formatCurrency(amount) {
  return `₹${Number(amount).toFixed(0)}`;
}

function isSameDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function isSameMonth(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth()
  );
}

/**
 * Parse user message into a ledger entry
 * Returns:
 * {
 *   type: "expense" | "income",
 *   amount: number,
 *   note: string
 * }
 * or null if not understood
 */
function parseLedgerMessage(text) {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  let match;

  // =========================
  // EXPENSE PATTERNS
  // =========================

  // spent 50 coffee
  // spent 50 on coffee
  match = lower.match(/^spent\s+(\d+)\s+(?:on\s+)?(.+)$/i);
  if (match) {
    return {
      type: "expense",
      amount: Number(match[1]),
      note: match[2].trim(),
    };
  }

  // paid 120 for lunch
  // paid 120 lunch
  match = lower.match(/^paid\s+(\d+)\s+(?:for\s+)?(.+)$/i);
  if (match) {
    return {
      type: "expense",
      amount: Number(match[1]),
      note: match[2].trim(),
    };
  }

  // 50 coffee
  match = lower.match(/^(\d+)\s+(.+)$/i);
  if (match) {
    return {
      type: "expense",
      amount: Number(match[1]),
      note: match[2].trim(),
    };
  }

  // coffee 50
  match = lower.match(/^(.+?)\s+(\d+)$/i);
  if (match) {
    return {
      type: "expense",
      amount: Number(match[2]),
      note: match[1].trim(),
    };
  }

  // =========================
  // INCOME PATTERNS
  // =========================

  // income 5000 freelance
  match = lower.match(/^income\s+(\d+)\s+(.+)$/i);
  if (match) {
    return {
      type: "income",
      amount: Number(match[1]),
      note: match[2].trim(),
    };
  }

  // received 800 refund
  match = lower.match(/^received\s+(\d+)\s+(.+)$/i);
  if (match) {
    return {
      type: "income",
      amount: Number(match[1]),
      note: match[2].trim(),
    };
  }

  // salary 25000
  match = lower.match(/^salary\s+(\d+)$/i);
  if (match) {
    return {
      type: "income",
      amount: Number(match[1]),
      note: "salary",
    };
  }

  return null;
}

function getTodaySummary(entries, chatId) {
  const now = new Date();
  const todayEntries = entries.filter(
    (e) => e.chatId === chatId && isSameDay(new Date(e.createdAt), now)
  );

  if (todayEntries.length === 0) {
    return "No entries for today yet.";
  }

  let income = 0;
  let expense = 0;

  const lines = todayEntries.map((e) => {
    if (e.type === "income") income += e.amount;
    else expense += e.amount;

    const emoji = e.type === "income" ? "🟢" : "🔴";
    return `${emoji} ${formatCurrency(e.amount)} • ${e.note}`;
  });

  const balance = income - expense;

  return [
    `📅 *Today's Summary*`,
    "",
    ...lines,
    "",
    `💸 Expense: ${formatCurrency(expense)}`,
    `💰 Income: ${formatCurrency(income)}`,
    `📊 Net: ${balance >= 0 ? "+" : ""}${formatCurrency(balance)}`,
  ].join("\n");
}

function getMonthSummary(entries, chatId) {
  const now = new Date();
  const monthEntries = entries.filter(
    (e) => e.chatId === chatId && isSameMonth(new Date(e.createdAt), now)
  );

  if (monthEntries.length === 0) {
    return "No entries for this month yet.";
  }

  let income = 0;
  let expense = 0;

  const recent = monthEntries.slice(-10).map((e) => {
    if (e.type === "income") income += e.amount;
    else expense += e.amount;

    const emoji = e.type === "income" ? "🟢" : "🔴";
    return `${emoji} ${formatCurrency(e.amount)} • ${e.note}`;
  });

  const balance = income - expense;

  return [
    `🗓️ *This Month*`,
    "",
    ...recent,
    "",
    `💸 Expense: ${formatCurrency(expense)}`,
    `💰 Income: ${formatCurrency(income)}`,
    `📊 Net: ${balance >= 0 ? "+" : ""}${formatCurrency(balance)}`,
  ].join("\n");
}

app.post("/telegram-webhook", async (req, res) => {
  try {
    console.log("Webhook hit:", JSON.stringify(req.body));

    const message = req.body?.message;
    if (!message?.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text.trim();

    let entries = readEntries();

    // ===== COMMANDS =====
    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        `👋 LedgerBot is live!

Send expenses like:
• spent 50 coffee
• spent 120 on lunch
• coffee 80
• 200 fuel

Send income like:
• income 5000 freelance
• received 800 refund
• salary 25000

Commands:
• /today
• /month
• /undo
• /help`
      );
      return res.sendStatus(200);
    }

    if (text === "/help") {
      await sendTelegramMessage(
        chatId,
        `📘 *LedgerBot Help*

Expense examples:
• spent 50 coffee
• spent 120 on lunch
• paid 200 for petrol
• coffee 80
• 150 snacks

Income examples:
• income 5000 freelance
• received 800 refund
• salary 25000

Commands:
• /today → today's summary
• /month → this month's summary
• /undo → remove last entry`
      );
      return res.sendStatus(200);
    }

    if (text === "/today") {
      const summary = getTodaySummary(entries, chatId);
      await sendTelegramMessage(chatId, summary);
      return res.sendStatus(200);
    }

    if (text === "/month") {
      const summary = getMonthSummary(entries, chatId);
      await sendTelegramMessage(chatId, summary);
      return res.sendStatus(200);
    }

    if (text === "/undo") {
      const userEntries = entries.filter((e) => e.chatId === chatId);

      if (userEntries.length === 0) {
        await sendTelegramMessage(chatId, "No entries found to undo.");
        return res.sendStatus(200);
      }

      const lastEntry = userEntries[userEntries.length - 1];

      // remove only that exact last entry
      const index = entries.findIndex(
        (e) =>
          e.chatId === lastEntry.chatId &&
          e.amount === lastEntry.amount &&
          e.note === lastEntry.note &&
          e.type === lastEntry.type &&
          e.createdAt === lastEntry.createdAt
      );

      if (index !== -1) {
        entries.splice(index, 1);
        saveEntries(entries);

        await sendTelegramMessage(
          chatId,
          `↩️ Removed last entry: ${lastEntry.type === "income" ? "🟢" : "🔴"} ${formatCurrency(lastEntry.amount)} • ${lastEntry.note}`
        );
      } else {
        await sendTelegramMessage(chatId, "Couldn't find the last entry to remove.");
      }

      return res.sendStatus(200);
    }

    // ===== PARSE NORMAL MESSAGE =====
    const parsed = parseLedgerMessage(text);

    if (!parsed) {
      await sendTelegramMessage(
        chatId,
        `I couldn't understand that 🤔

Try examples:
• spent 50 coffee
• spent 120 on lunch
• coffee 80
• income 5000 freelance
• /help`
      );
      return res.sendStatus(200);
    }

    const entry = {
      chatId,
      type: parsed.type,
      amount: parsed.amount,
      note: parsed.note,
      createdAt: new Date().toISOString(),
    };

    entries.push(entry);
    saveEntries(entries);

    const emoji = parsed.type === "income" ? "🟢" : "🔴";
    const label = parsed.type === "income" ? "Income added" : "Expense added";

    await sendTelegramMessage(
      chatId,
      `${emoji} ${label}\n${formatCurrency(parsed.amount)} • ${parsed.note}`
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message || err);
    return res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("LedgerChat bot backend is running 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("BOT TOKEN PRESENT:", !!BOT_TOKEN);
});