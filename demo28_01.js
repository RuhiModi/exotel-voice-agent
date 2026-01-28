/*************************************************
 * GUJARATI AI VOICE AGENT – HUMANATIC v2
 * Stable | Buffer-based | Long-speech safe
 * SINGLE + BULK CALL ENABLED
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
function normalizeMixedGujarati(text) {
  const dict = {
    aadhar: "આધાર",
    aadhaar: "આધાર",
    card: "કાર્ડ",
    update: "સુધારો",
    correction: "સુધારો",
    name: "નામ",
    address: "સરનામું",
    mobile: "મોબાઇલ",
    number: "નંબર"
  };

  let out = text;
  for (const k in dict) {
    out = out.replace(new RegExp(`\\b${k}\\b`, "gi"), dict[k]);
  }
  return out;
}

function normalizeUserText(text) {
  if (!text) return "";
  let out = text.toLowerCase();
  out = normalizeMixedGujarati(out);
  out = out.replace(/\b(umm|uh|hmm|ok|okay)\b/gi, "");
  return out.trim();
}

function detectTaskStatus(text) {
  const pending = ["નથી", "બાકી", "હજુ", "પૂર્ણ નથી", "pending"];
  const done = ["પૂર્ણ થયું", "થઈ ગયું", "થયું છે", "મળી ગયું", "done"];

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
    "later",
    "call later",
    "પછી ફોન",
    "બાદમાં વાત"
  ].some(p => text.includes(p));
}

/* ======================
   GOOGLE SHEET LOG
====================== */
async function logToSheet(s) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(s.startTime).toLocaleString("en-IN"),
        new Date(s.endTime).toLocaleString("en-IN"),
        s.sid,
        s.userPhone,
        s.agentTexts.join(" | "),
        s.userTexts.join(" | "),
        s.rawUserSpeech.join(" | "),
        s.result,
        Math.floor((s.endTime - s.startTime) / 1000),
        s.confidenceScore || 0
      ]]
    }
  });
}

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const s = sessions.get(req.body.CallSid);

  s.agentTexts.push(RESPONSES[STATES.INTRO].text);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${STATES.INTRO}.mp3</Play>
  <Gather input="speech"
    language="gu-IN"
    timeout="15"
    speechTimeout="auto"
    partialResultCallback="${BASE_URL}/partial"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   PARTIAL SPEECH BUFFER
====================== */
app.post("/partial", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  if (!s) return res.sendStatus(200);

  const partial = (req.body.UnstableSpeechResult || "").trim();
  if (partial) {
    s.liveBuffer = (s.liveBuffer || "") + " " + partial;
  }
  res.sendStatus(200);
});

/* ======================
   LISTEN
====================== */
app.post("/listen", async (req, res) => {
  const s = sessions.get(req.body.CallSid);

  const finalSpeech = normalizeUserText(
    `${s.liveBuffer || ""} ${req.body.SpeechResult || ""}`
  );

  s.liveBuffer = "";
  s.rawUserSpeech.push(finalSpeech);

  if (finalSpeech.split(" ").length < 3) {
    const next = RULES.nextOnUnclear(++s.unclearCount);
    s.agentTexts.push(RESPONSES[next].text);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech"
    language="gu-IN"
    timeout="15"
    speechTimeout="auto"
    partialResultCallback="${BASE_URL}/partial"
    action="${BASE_URL}/listen"/>
</Response>
`);
  }

  let next;

  if (s.state === STATES.INTRO) {
    next = isBusyIntent(finalSpeech)
      ? STATES.CALLBACK_TIME
      : STATES.TASK_CHECK;
  } else if (s.state === STATES.TASK_PENDING) {
    s.userTexts.push(finalSpeech);
    next = STATES.PROBLEM_RECORDED;
  } else {
    const { status, confidence } = detectTaskStatus(finalSpeech);
    s.confidenceScore = confidence;

    if (RULES.shouldConfirm(confidence)) {
      next = STATES.CONFIRM_TASK;
    } else {
      next =
        status === "DONE"
          ? STATES.TASK_DONE
          : status === "PENDING"
          ? STATES.TASK_PENDING
          : RULES.nextOnUnclear(++s.unclearCount);
    }
  }

  s.userTexts.push(finalSpeech);
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
  <Gather input="speech"
    language="gu-IN"
    timeout="15"
    speechTimeout="auto"
    partialResultCallback="${BASE_URL}/partial"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent v2 – Stable & Humanatic");
});
