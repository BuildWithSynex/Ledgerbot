import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

const DB_FILE = "./expenses.json";

// load local file db
function readExpenses() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveExpenses(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

// webhook route
app.post("/telegram-webhook", async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text.trim().toLowerCase();

    // /start command
    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        "LedgerChat bot is live ✅\nSend something like: spent 150 coffee"
      );
      return res.sendStatus(200);
    }

    // simple parse: "spent 150 coffee"
    const match = text.match(/^spent\s+(\d+)\s+(.+)$/i);
    if (match) {
      const amount = Number(match[1]);
      const note = match[2];

      const expenses = readExpenses();
      expenses.push({
        chatId,
        amount,
        note,
        createdAt: new Date().toISOString(),
      });
      saveExpenses(expenses);

      await sendTelegramMessage(
        chatId,
        `Logged ₹${amount} for ${note} ✅`
      );
      return res.sendStatus(200);
    }

    if (text === "/today") {
      const expenses = readExpenses().filter(e => e.chatId === chatId);
      if (expenses.length === 0) {
        await sendTelegramMessage(chatId, "No expenses found yet.");
        return res.sendStatus(200);
      }

      const total = expenses.reduce((sum, e) => sum + e.amount, 0);
      const lines = expenses
        .slice(-5)
        .map(e => `₹${e.amount} - ${e.note}`)
        .join("\n");

      await sendTelegramMessage(
        chatId,
        `Your expenses:\n${lines}\n\nTotal: ₹${total}`
      );
      return res.sendStatus(200);
    }

    await sendTelegramMessage(
      chatId,
      "I didn’t understand that. Try: spent 150 coffee"
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("LedgerChat bot backend is running 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});