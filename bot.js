const TELEGRAM_TOKEN = "8748196308:AAEg56pF-9Kec85-iRGrjdSkJoNsUYItp0c";
const SUPABASE_URL = "https://wiyjjelyoejeripncjiq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpeWpqZWx5b2VqZXJpcG5jamlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MjI0MDEsImV4cCI6MjA5ODE5ODQwMX0.FmrG4tX77h3n2vtBdyG60wgiTrd3g_Q62uBJFGEgrtI";

const CATEGORY_KEYWORDS = {
  food: ["food", "lunch", "dinner", "breakfast", "meal", "biryani", "pizza", "burger", "restaurant", "eat", "snack", "sabji", "roti", "dal", "rice", "chai", "tea"],
  grocery: ["grocery", "groceries", "milk", "vegetables", "fruits", "sabzi", "market", "kirana", "doodh", "atta", "sugar", "oil"],
  transport: ["petrol", "fuel", "auto", "uber", "ola", "taxi", "bus", "metro", "train", "cab", "rickshaw", "transport"],
  coffee: ["coffee", "cafe", "starbucks", "nescafe", "cappuccino", "latte"],
  shopping: ["shopping", "clothes", "shirt", "shoes", "amazon", "flipkart", "purchase", "buy"],
  health: ["medicine", "doctor", "pharmacy", "medical", "gym", "health", "hospital"],
  entertainment: ["movie", "netflix", "game", "fun", "party", "outing", "cinema", "ott"],
  utilities: ["electricity", "water", "internet", "wifi", "bill", "recharge", "mobile", "phone"],
};

function inferCategory(description) {
  const lower = description.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  return "other";
}

function parseMessage(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const expenses = [];

  for (const line of lines) {
    // Match: optional currency, number, then description
    const match = line.match(/^(?:rs\.?|₹|inr)?\s*(\d+(?:\.\d+)?)\s+(.+)$/i);
    if (match) {
      const amount = parseFloat(match[1]);
      const description = match[2].trim();
      const category = inferCategory(description);
      expenses.push({ amount, description, category });
    }
  }
  return expenses;
}

async function saveToSupabase(expenses, chat_id, username) {
  const rows = expenses.map(e => ({
    amount: e.amount,
    description: e.description,
    category: e.category,
    chat_id: String(chat_id),
    username: username || "unknown",
    created_at: new Date().toISOString()
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  return rows;
}

async function getTodayTotal(chat_id) {
  const today = new Date().toISOString().split("T")[0];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/expenses?chat_id=eq.${chat_id}&created_at=gte.${today}T00:00:00&select=amount`,
    {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  const data = await res.json();
  return data.reduce((sum, r) => sum + parseFloat(r.amount), 0);
}

async function sendTelegram(chat_id, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" })
  });
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chat_id = msg.chat.id;
  const username = msg.from?.first_name || msg.from?.username || "friend";
  const text = msg.text.trim();

  // Commands
  if (text === "/start") {
    await sendTelegram(chat_id, `👋 Hey *${username}*! I'm your Spend Tracker bot.\n\nJust send me your expenses like:\n\`\`\`\n210 coffee\n500 petrol\n1200 groceries\n\`\`\`\nI'll log them instantly! 💰`);
    return;
  }

  if (text === "/today") {
    const total = await getTodayTotal(chat_id);
    await sendTelegram(chat_id, `📊 *Today's total:* ₹${total.toFixed(0)}`);
    return;
  }

  if (text === "/help") {
    await sendTelegram(chat_id, `*How to log expenses:*\nSend one or multiple lines:\n\`210 coffee\`\n\`500 petrol work\`\n\`1200 groceries\`\n\n*Commands:*\n/today — today's total\n/help — this message`);
    return;
  }

  // Parse expenses
  const expenses = parseMessage(text);
  if (expenses.length === 0) {
    await sendTelegram(chat_id, `❓ Couldn't parse that. Try:\n\`210 coffee\`\n\`500 petrol\``);
    return;
  }

  try {
    await saveToSupabase(expenses, chat_id, username);
    const todayTotal = await getTodayTotal(chat_id);
    const categoryEmojis = { food:"🍽️", grocery:"🛒", transport:"🚗", coffee:"☕", shopping:"🛍️", health:"💊", entertainment:"🎬", utilities:"💡", other:"📌" };

    let reply = `✅ *Logged ${expenses.length} expense${expenses.length > 1 ? "s" : ""}:*\n`;
    for (const e of expenses) {
      reply += `${categoryEmojis[e.category] || "📌"} ₹${e.amount} — ${e.description} _(${e.category})_\n`;
    }
    const thisTotal = expenses.reduce((s, e) => s + e.amount, 0);
    reply += `\n💰 *Today's total: ₹${todayTotal.toFixed(0)}*`;

    await sendTelegram(chat_id, reply);
  } catch (err) {
    await sendTelegram(chat_id, `❌ Error saving: ${err.message}`);
  }
}

// Polling
async function poll(offset = 0) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
    const data = await res.json();
    if (data.result && data.result.length > 0) {
      for (const update of data.result) {
        await handleUpdate(update);
        offset = update.update_id + 1;
      }
    }
    return offset;
  } catch (e) {
    console.error("Poll error:", e.message);
    return offset;
  }
}

// Keep Render alive with a tiny HTTP server
const { createServer } = require("http");
const PORT = process.env.PORT || 3000;
createServer((req, res) => {
  res.writeHead(200);
  res.end("Spend Tracker Bot is running 🤖");
}).listen(PORT, () => console.log(`HTTP server on port ${PORT}`));

async function main() {
  console.log("🤖 Spend Tracker Bot is running...");
  let offset = 0;
  while (true) {
    offset = await poll(offset);
    await new Promise(r => setTimeout(r, 1000));
  }
}

main();
