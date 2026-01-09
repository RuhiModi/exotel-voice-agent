/*************************************************
 * GUJARATI AI VOICE AGENT – HUMANATIC + ROBUST
 * State-based | Rule-driven | Scriptless
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
   INTENT DETECTION
   (ONLY FOR STATUS)
====================== */
function detectTaskStatus(text) {
  const pending = ["નથી", "બાકી", "હજુ", "પૂર્ણ નથી", "ચાલુ છે"];
  const done = ["પૂર્ણ થયું", "થઈ ગયું", "થયું છે", "મળી ગયું"];

  const p = pending.some(w => text.includes(w));
  const d = done.some(w => text.includes(w));

  if (p && !d) return { status: "PENDING", confidence: 90 };
  if (d && !p) return { status: "DONE", confidence: 90 };
  return { status: "UNCLEAR", confidence: 30 };
}

/* ======================
   GOOGLE SHEET LOG
====================== */
function logToSheet(s) {
  const duration =
    s.endTime && s.startTime
      ? Math.floor((s.endTime - s.startTime) / 1000)
      : 0;

  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(s.startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        new Date(s.endTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
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
  }).catch(console.error);
}

/* ======================
   SINGLE CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  const call = await twilioClient.calls.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER,
    url: `${BASE_URL}/answer`,
    statusCallback: `${BASE_URL}/call-status`,
    statusCallbackEvent: ["completed"],
    method: "POST"
  });

  sessions.set(call.sid, {
    sid: call.sid,
    userPhone: to,
    startTime: Date.now(),
    endTime: null,
    state: STATES.INTRO,
    agentTexts: [],
    userTexts: [],
    unclearCount: 0,
    confidenceScore: 0,
    result: ""
  });

  res.json({ status: "calling" });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  s.agentTexts.push(RESPONSES[STATES.INTRO].text);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${STATES.INTRO}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   LISTEN (FIXED)
====================== */
app.post("/listen", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  const raw = (req.body.SpeechResult || "").trim();

  /* 🔒 FINAL PROBLEM RECORD (NO LOOP) */
  if (s.state === STATES.PROBLEM_RECORDED) {
    if (raw) s.userTexts.push(raw);

    s.result = STATES.PROBLEM_RECORDED;
    s.endTime = Date.now();

    logToSheet(s);
    sessions.delete(s.sid);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/problem_recorded.mp3</Play>
  <Hangup/>
</Response>
`);
  }

  if (!raw) {
    const next = RULES.nextOnUnclear(++s.unclearCount);
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
  }

  s.userTexts.push(raw);

  let next;
  if (s.state === STATES.INTRO) {
    next = STATES.TASK_CHECK;
  } else {
    const { status, confidence } = detectTaskStatus(raw);
    s.confidenceScore = confidence;

    if (status === "DONE") next = STATES.TASK_DONE;
    else if (status === "PENDING") next = STATES.PROBLEM_RECORDED;
    else next = RULES.nextOnUnclear(++s.unclearCount);
  }

  s.agentTexts.push(RESPONSES[next].text);

  if (RESPONSES[next].end) {
    s.result = next;
    s.endTime = Date.now();

    logToSheet(s);
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
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   CALL STATUS
====================== */
app.post("/call-status", async (req, res) => {
  const s = sessions.get(req.body.CallSid);

  if (s && !s.result) {
    s.endTime = Date.now();
    s.result = req.body.CallStatus || "completed";

    logToSheet(s);
    sessions.delete(s.sid);
  }

  res.sendStatus(200);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – STABLE, HUMAN & LOOP-FREE");
});
