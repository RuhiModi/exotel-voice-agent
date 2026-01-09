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
   BULK CALL STATUS HELPER
====================== */
async function updateBulkCallStatus(phone, batchId, status) {
  try {
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Bulk_Calls!A:C"
    });

    const rows = sheet.data.values || [];

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === phone && rows[i][1] === batchId) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Bulk_Calls!C${i + 1}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[status]] }
        });
        break;
      }
    }
  } catch (err) {
    console.error("Sheet status update failed:", err.message);
  }
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
function logToSheet(s) {
  const durationSec = s.endTime
    ? Math.floor((s.endTime - s.startTime) / 1000)
    : 0;

  sheets.spreadsheets.values.append({
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
        durationSec,
        s.confidenceScore ?? 0,
        s.callbackTime ?? ""
      ]]
    }
  }).catch(console.error);
}

/* ======================
   BULK CALL API
====================== */
app.post("/bulk-call", async (req, res) => {
  const { phones, batchId } = req.body;

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

        await updateBulkCallStatus(phone, batchId, "Calling");

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
    }, index * 1500);
  });

  res.json({ message: "Bulk call started", batchId });
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
   CALL STATUS (FIXED)
====================== */
app.post("/call-status", async (req, res) => {
  const s = sessions.get(req.body.CallSid);

  if (s && !s.result) {
    s.result = "abandoned";
    s.endTime = Date.now();

    if (s.batchId) {
      await updateBulkCallStatus(s.userPhone, s.batchId, "Completed");
    }

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
  console.log("✅ Gujarati AI Voice Agent – CLEAN, HUMAN & CALLBACK-READY");
});
