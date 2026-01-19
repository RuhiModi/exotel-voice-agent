/*************************************************
 * GUJARATI AI VOICE AGENT – EXOTEL VERSION
 * State-based | Rule-driven | Scriptless
 * SINGLE + BULK CALL ENABLED
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";

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
   EXOTEL CONFIG
====================== */
const EXOTEL_SID = process.env.EXOTEL_SID;
const EXOTEL_TOKEN = process.env.EXOTEL_TOKEN;
const EXOTEL_CALLER_ID = process.env.EXOTEL_CALLER_ID;

const EXOTEL_URL = `https://${EXOTEL_SID}:${EXOTEL_TOKEN}@api.exotel.com/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;

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
    await generateAudio(RESPONSES[key].text, `${key.toLowerCase()}.mp3`);
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
   TEXT HELPERS
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
  return phone?.toString().replace(/\D/g, "").replace(/^91/, "");
}

/* ======================
   INTENT DETECTION
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
   EXOTEL OUTBOUND CALL
====================== */
async function makeOutboundCall(to) {
  const res = await axios.post(EXOTEL_URL, {
    From: EXOTEL_CALLER_ID,
    To: normalizePhone(to),
    Url: `${BASE_URL}/answer`,
    StatusCallback: `${BASE_URL}/call-status`
  });
  return res.data.Call.Sid;
}

/* ======================
   SINGLE CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  const sid = await makeOutboundCall(to);

  sessions.set(sid, {
    sid,
    userPhone: to,
    startTime: Date.now(),
    state: STATES.INTRO,
    agentTexts: [],
    userTexts: [],
    userBuffer: [],
    unclearCount: 0,
    confidenceScore: 0,
    result: ""
  });

  res.json({ status: "calling", sid });
});

/* ======================
   BULK CALL
====================== */
app.post("/bulk-call", async (req, res) => {
  const { phones = [] } = req.body;

  phones.forEach((phone, i) => {
    setTimeout(async () => {
      const sid = await makeOutboundCall(phone);
      sessions.set(sid, {
        sid,
        userPhone: phone,
        startTime: Date.now(),
        state: STATES.INTRO,
        agentTexts: [],
        userTexts: [],
        userBuffer: [],
        unclearCount: 0,
        confidenceScore: 0,
        result: ""
      });
    }, i * 1500);
  });

  res.json({ status: "bulk calling started", total: phones.length });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const sid = req.body.CallSid;
  const s = sessions.get(sid);

  s.agentTexts.push(RESPONSES[STATES.INTRO].text);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${STATES.INTRO.toLowerCase()}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   LISTEN
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const s = sessions.get(sid);
  const raw = (req.body.SpeechResult || "").trim();

  if (!raw) {
    const next = RULES.nextOnUnclear(++s.unclearCount);
    s.agentTexts.push(RESPONSES[next].text);
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next.toLowerCase()}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"/>
</Response>
`);
  }

  if (hasGujarati(raw)) s.userBuffer.push(normalizeMixedGujarati(raw));

  let next;
  if (s.state === STATES.INTRO) {
    next = isBusyIntent(raw) ? STATES.CALLBACK_TIME : STATES.TASK_CHECK;
  } else if (s.state === STATES.CALLBACK_TIME) {
    s.callbackTime = raw;
    next = STATES.CALLBACK_CONFIRM;
  } else {
    const { status, confidence } = detectTaskStatus(raw);
    s.confidenceScore = confidence;
    next =
      status === "DONE"
        ? STATES.TASK_DONE
        : status === "PENDING"
        ? STATES.TASK_PENDING
        : RULES.nextOnUnclear(++s.unclearCount);
  }

  if (s.userBuffer.length) {
    s.userTexts.push(s.userBuffer.join(" "));
    s.userBuffer = [];
  }

  s.agentTexts.push(RESPONSES[next].text);

  if (RESPONSES[next].end) {
    s.result = next;
    s.endTime = Date.now();
    await logToSheet(s);
    sessions.delete(sid);

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
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   CALL STATUS
====================== */
app.post("/call-status", async (req, res) => {
  const sid = req.body.CallSid;
  const s = sessions.get(sid);

  if (s && !s.result) {
    s.result = "abandoned";
    s.endTime = Date.now();
    await logToSheet(s);
    sessions.delete(sid);
  }

  res.sendStatus(200);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  console.log("STATES.INTRO =", STATES.INTRO); // 👈 ADD THIS
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – EXOTEL VERSION READY");
});
