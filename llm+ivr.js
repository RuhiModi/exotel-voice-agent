/*************************************************
 * GUJARATI AI VOICE AGENT – HUMANATIC + ROBUST
 * State-based | Rule-driven | Scriptless
 * SINGLE + BULK CALL ENABLED
 * IVR + GROQ LLM (SAFE FALLBACK ONLY)
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";
import fetch from "node-fetch"; // ✅ ADD ONLY

import { STATES } from "./conversation/states.js";
import { RESPONSES } from "./conversation/responses.js";
import { RULES } from "./conversation/rules.js";

dotenv.config();

/* ======================
   BASIC SETUP
====================== */
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ======================
   TWILIO
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   GOOGLE TTS
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();

/* ======================
   GOOGLE SHEETS
====================== */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

/* ======================
   FILE SYSTEM
====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, "audio");

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   SESSION MEMORY
====================== */
const sessions = new Map();

/* ======================
   AUDIO CACHE
====================== */
async function generateAudio(text, file) {
  const filePath = path.join(AUDIO_DIR, file);
  if (fs.existsSync(filePath)) return;

  const [res] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: "gu-IN" },
    audioConfig: { audioEncoding: "MP3" }
  });

  fs.writeFileSync(filePath, res.audioContent);
}

async function preloadAll() {
  for (const key in RESPONSES) {
    await generateAudio(RESPONSES[key].text, `${key}.mp3`);
  }
}

/* ======================
   TIME HELPERS
====================== */
function formatIST(ts) {
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true
  });
}

/* ======================
   HELPERS
====================== */
function hasGujarati(text) {
  return /[\u0A80-\u0AFF]/.test(text);
}

function normalizeMixedGujarati(text) {
  const dict = {
    aadhar: "આધાર",
    aadhaar: "આધાર",
    card: "કાર્ડ",
    data: "ડેટા",
    entry: "એન્ટ્રી",
    update: "સુધારો",
    correction: "સુધારો",
    name: "નામ",
    address: "સરનામું",
    mobile: "મોબાઇલ",
    number: "નંબર",
    change: "ફેરફાર"
  };

  let out = text;
  for (const k in dict) {
    out = out.replace(new RegExp(`\\b${k}\\b`, "gi"), dict[k]);
  }
  return out;
}

function normalizePhone(phone) {
  if (!phone) return "";
  return phone.toString().replace(/\D/g, "").replace(/^91/, "");
}

/* ======================
   INTENT DETECTION (IVR)
====================== */
function detectTaskStatus(text) {
  const pending = ["નથી", "બાકી", "હજુ", "પૂર્ણ નથી", "ચાલુ છે"];
  const done = ["પૂર્ણ થયું", "થઈ ગયું", "થયું છે", "મળી ગયું"];

  const p = pending.some(w => text.includes(w));
  const d = done.some(w => text.includes(w));

  if (p && !d) return { status: "PENDING", confidence: 90 };
  if (d && !p) return { status: "DONE", confidence: 90 };
  if (p && d) return { status: "UNCLEAR", confidence: 40 };
  return { status: "UNCLEAR", confidence: 30 };
}

/* ======================
   BUSY INTENT
====================== */
function isBusyIntent(text) {
  return [
    "સમય નથી",
    "હવે નથી",
    "પછી ફોન",
    "બાદમાં ફોન",
    "હવે વાત નહીં",
    "બાદમાં વાત"
  ].some(p => text.includes(p));
}

/* ======================
   🔥 GROQ LLM (SAFE FALLBACK)
====================== */
async function groqAssist(text) {
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "Classify Gujarati intent strictly. Return JSON only."
          },
          {
            role: "user",
            content: `
"${text}"

Return:
{
  "intent": "DONE | PENDING | BUSY | OTHER",
  "summary": "Gujarati summary"
}`
          }
        ]
      })
    });

    const data = await r.json();
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { intent: "OTHER", summary: text };
  }
}

/* ======================
   GOOGLE SHEET LOG
====================== */
async function logToSheet(s) {
  const duration = s.endTime
    ? Math.floor((s.endTime - s.startTime) / 1000)
    : 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        formatIST(s.startTime),
        formatIST(s.endTime),
        s.sid,
        s.userPhone,
        s.agentTexts.join(" | "),
        s.userTexts.join(" | "),
        s.result,
        duration,
        s.confidenceScore ?? 0,
        s.callbackTime ?? ""
      ]]
    }
  });
}

/* ======================
   LISTEN (IVR + GROQ SAFE)
====================== */
app.post("/listen", async (req, res) => {
  const s = sessions.get(req.body.CallSid);
  const raw = (req.body.SpeechResult || "").trim();

  if (!raw) {
    const next = RULES.nextOnUnclear(++s.unclearCount);
    s.agentTexts.push(RESPONSES[next].text);
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech" language="gu-IN" timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
  }

  let { status, confidence } = detectTaskStatus(raw);

  if (confidence < 50) {
    const llm = await groqAssist(raw);
    s.userTexts.push(llm.summary);

    if (llm.intent === "DONE") status = "DONE";
    if (llm.intent === "PENDING") status = "PENDING";
    if (llm.intent === "BUSY") status = "BUSY";
  }

  let next =
    status === "DONE"
      ? STATES.TASK_DONE
      : status === "PENDING"
      ? STATES.TASK_PENDING
      : status === "BUSY"
      ? STATES.CALLBACK_TIME
      : RULES.nextOnUnclear(++s.unclearCount);

  s.agentTexts.push(RESPONSES[next].text);

  if (RESPONSES[next].end) {
    s.result = next;
    s.endTime = Date.now();
    await logToSheet(s);
    sessions.delete(s.sid);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Hangup/>
</Response>
`);
  }

  s.state = next;
  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech" language="gu-IN" timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – IVR + GROQ SAFE HYBRID READY");
});
