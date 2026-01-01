import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { google } from "googleapis";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ===============================
   GOOGLE SHEETS AUTH (SAFE)
================================ */
const auth = new google.auth.GoogleAuth({
  keyFile: "/etc/secrets/serviceAccount.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function logToSheet(row) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [row],
      },
    });
  } catch (err) {
    console.error("❌ Sheet log failed:", err.message);
  }
}

/* ===============================
   CALL STATE STORE
================================ */
const calls = new Map();

/* ===============================
   SIMPLE LLM REPLY (GROQ)
================================ */
async function getLLMReply(userText) {
  if (!userText) {
    return "કૃપા કરીને ફરી કહેશો?";
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "system",
            content:
              "You are a polite Gujarati government helpdesk voice agent.",
          },
          { role: "user", content: userText },
        ],
      }),
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "બરાબર.";
  } catch (e) {
    return "માફ કરશો, ફરી પ્રયાસ કરીએ.";
  }
}

/* ===============================
   TWILIO ANSWER
================================ */
app.post("/answer", (req, res) => {
  const { CallSid, From } = req.body;

  calls.set(CallSid, {
    start: Date.now(),
    caller: From || "",
    agentText: "",
    userText: "",
    lang: "gu-IN",
  });

  res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">
    નમસ્તે, હું સરકારના ઇ-કાર્યાલય તરફથી બોલું છું.
  </Say>
  <Gather input="speech" language="gu-IN" timeout="6" action="/listen" method="POST"/>
</Response>
`);
});

/* ===============================
   LISTEN
================================ */
app.post("/listen", async (req, res) => {
  const { CallSid, SpeechResult } = req.body;
  const call = calls.get(CallSid);

  if (!call) {
    return res.type("text/xml").send("<Response><Hangup/></Response>");
  }

  const userText = (SpeechResult || "").trim();
  call.userText = userText;

  const reply = await getLLMReply(userText);
  call.agentText = reply;

  res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">${reply}</Say>
  <Gather input="speech" language="gu-IN" timeout="6" action="/listen" method="POST"/>
</Response>
`);
});

/* ===============================
   CALL STATUS (DISCONNECT LOGGING)
================================ */
app.post("/status", async (req, res) => {
  const { CallSid, CallStatus } = req.body;
  const call = calls.get(CallSid);

  if (!call) return res.sendStatus(200);

  if (["completed", "failed", "busy", "no-answer"].includes(CallStatus)) {
    const duration = Math.floor((Date.now() - call.start) / 1000);

    await logToSheet([
      new Date().toISOString(), // A
      CallSid,                  // B
      call.caller,              // C
      call.lang,                // D
      call.agentText || "",     // E
      call.userText || "",      // F
      CallStatus,               // G
      duration,                 // H
    ]);

    calls.delete(CallSid);
  }

  res.sendStatus(200);
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL CLEAN)");
});
