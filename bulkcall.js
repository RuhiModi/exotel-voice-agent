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
   TIME HELPERS (IST)
====================== */
function formatIST(ts) {
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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

/* ======================
   BUSY INTENT
====================== */
function isBusyIntent(text) {
  const busyPhrases = [
    "સમય નથી",
    "હવે નથી",
    "પછી ફોન",
    "બાદમાં ફોન",
    "હવે વાત નહીં",
    "બાદમાં વાત"
  ];
  return busyPhrases.some(p => text.includes(p));
}

/* ======================
   GOOGLE SHEET LOG
====================== */
function logToSheet(s) {
  const durationSec = s.endTime
    ? Math.floor((s.endTime - s.startTime) / 1000)
    : 0;

  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:K",
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
        durationSec,
        s.confidenceScore ?? 0,
        s.callbackTime ?? "",
        s.batchId ?? ""
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
    batchId: null,
    startTime: Date.now(),
    endTime: null,
    callbackTime: null,
    state: STATES.INTRO,
    agentTexts: [],
    userTexts: [],
    userBuffer: [],
    unclearCount: 0,
    confidenceScore: 0,
    result: ""
  });

  res.json({ status: "calling" });
});

/* ======================
   BULK CALL (NEW)
====================== */
app.post("/bulk-call", async (req, res) => {
  const { phones, batchId } = req.body;

  if (!Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ error: "No phone numbers provided" });
  }

  phones.forEach((phone, index) => {
    setTimeout(async () => {
      try {
        const call = await twilioClient.calls.create({
          to: phone,
          from: process.env.TWILIO_FROM_NUMBER,
          url: `${BASE_URL}/answer`,
          statusCallback: `${BASE_URL}/call-status`,
          statusCallbackEvent: ["completed"],
          method: "POST"
        });

        sessions.set(call.sid, {
          sid: call.sid,
          userPhone: phone,
          batchId,
          startTime: Date.now(),
          endTime: null,
          callbackTime: null,
          state: STATES.INTRO,
          agentTexts: [],
          userTexts: [],
          userBuffer: [],
          unclearCount: 0,
          confidenceScore: 0,
          result: ""
        });
      } catch (err) {
        console.error("Bulk call failed:", phone, err.message);
      }
    }, index * 1500); // ⏱️ safe throttling
  });

  res.json({
    message: "Bulk call started",
    batchId,
    total: phones.length
  });
});

/* ======================
   ANSWER / LISTEN / CALL-STATUS
   (UNCHANGED)
====================== */
/* your existing answer, listen, call-status code remains exactly same */

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – BULK CALL READY");
});
