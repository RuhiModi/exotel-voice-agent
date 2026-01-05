/*************************************************
 * GUJARATI AI VOICE AGENT – STABLE + CLEAN SHEETS
 * Agent_Text & User_Text SAME LOGIC + NORMALIZED
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
   FLOW
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. શું હું આપનો થોડો સમય લઈ શકું?"
  },
  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમિયાન આપનું કામ પૂર્ણ થયું છે કે નહીં?"
  },
  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ પૂર્ણ થયું છે. આભાર.",
    end: true
  },
  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો."
  },
  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ જલદી જ સંપર્ક કરશે.",
    end: true
  }
};

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
  for (const k in FLOW) {
    await generateAudio(FLOW[k].prompt, `${k}.mp3`);
  }
}

/* ======================
   HELPERS
====================== */

// sentence must contain Gujarati to be meaningful
function hasGujarati(text) {
  return /[\u0A80-\u0AFF]/.test(text);
}

// human-like intent detection
function isTaskPendingGujarati(text) {
  const signals = [
    "નથી",
    "નથી થયું",
    "હજુ",
    "બાકી",
    "પૂર્ણ નથી",
    "થોડું થયું",
    "ચાલુ છે",
    "અટક્યું"
  ];
  return signals.some(s => text.includes(s));
}

// ✅ KEY ADDITION: normalize English → Gujarati words
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

  let normalized = text;

  for (const key in dict) {
    const regex = new RegExp(`\\b${key}\\b`, "gi");
    normalized = normalized.replace(regex, dict[key]);
  }

  return normalized;
}

/* ======================
   GOOGLE SHEET LOG
====================== */
function logToSheet(s) {
  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(s.startTime).toISOString(),
        s.sid,
        s.userPhone,
        s.agentTexts.join(" | "),
        s.userTexts.join(" | "),
        s.result,
        Math.floor((Date.now() - s.startTime) / 1000),
        "Completed"
      ]]
    }
  }).catch(console.error);
}

/* ======================
   OUTBOUND CALL
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
    state: "intro",
    agentTexts: [],
    userTexts: [],
    result: ""
  });

  res.json({ status: "calling" });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  s.agentTexts.push(FLOW.intro.prompt);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/intro.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="8" speechTimeout="auto"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   LISTEN (UPDATED)
====================== */
app.post("/listen", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  const raw = (req.body.SpeechResult || "").trim();

  if (!raw) {
    return res.type("text/xml").send(`
<Response>
  <Gather input="speech" language="gu-IN"
    timeout="8" speechTimeout="auto"
    action="${BASE_URL}/listen"/>
</Response>
`);
  }

  // ✅ FULL SENTENCE + NORMALIZED
  if (hasGujarati(raw)) {
    const normalized = normalizeMixedGujarati(raw);
    s.userTexts.push(normalized);
  }

  let next;
  if (s.state === "intro") next = "task_check";
  else if (s.state === "task_check")
    next = isTaskPendingGujarati(raw)
      ? "task_pending"
      : "task_done";
  else next = "problem_recorded";

  s.agentTexts.push(FLOW[next].prompt);

  if (FLOW[next].end) {
    s.result = next;
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
    timeout="8" speechTimeout="auto"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   CALL END
====================== */
app.post("/call-status", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  if (s && !s.result) {
    s.result = "abandoned";
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
  console.log("✅ Gujarati AI Voice Agent – FINAL & STABLE READY");
});
