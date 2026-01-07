/*************************************************
 * GUJARATI AI VOICE AGENT – EXOTEL VERSION
 * Two-way AI | Confidence | Retry | Escalation
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
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
   FLOW (UNCHANGED)
====================== */
const FLOW = {
  intro: { prompt: "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. શું હું આપનો થોડો સમય લઈ શકું?" },
  task_check: { prompt: "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમિયાન આપનું કામ પૂર્ણ થયું છે કે નહીં?" },
  retry_task_check: { prompt: "માફ કરશો, હું સ્પષ્ટ સમજી શક્યો નથી. કૃપા કરીને ફરીથી કહેશો — આપનું કામ પૂર્ણ થયું છે કે નહીં?" },
  confirm_task: { prompt: "ફક્ત પુષ્ટિ માટે પૂછું છું — આપનું કામ પૂર્ણ થયું છે કે હજુ બાકી છે?" },
  task_done: { prompt: "ખૂબ આનંદ થયો કે આપનું કામ પૂર્ણ થયું છે. આભાર.", end: true },
  task_pending: { prompt: "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો." },
  problem_recorded: { prompt: "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ જલદી જ સંપર્ક કરશે.", end: true },
  escalate: { prompt: "માફ કરશો, તમારી માહિતી સ્પષ્ટ રીતે મળી નથી. અમે તમને માનવીય સહાયક સાથે જોડશું.", end: true }
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
   INTENT LOGIC (UNCHANGED)
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
   EXOTEL OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  const r = await fetch(
    `https://api.exotel.com/v1/Accounts/${process.env.EXOTEL_SID}/Calls/connect.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`
          ).toString("base64"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        From: process.env.EXOTEL_CALLER_ID,
        To: to,
        Url: `${BASE_URL}/exotel/answer`
      })
    }
  );

  const data = await r.json();
  const callId = data?.Call?.Sid;

  sessions.set(callId, {
    sid: callId,
    userPhone: to,
    startTime: Date.now(),
    state: "intro",
    agentTexts: [],
    userTexts: [],
    unclearCount: 0,
    confidenceScore: 0,
    result: ""
  });

  res.json({ status: "calling", callId });
});

/* ======================
   EXOTEL ANSWER
====================== */
app.post("/exotel/answer", (req, res) => {
  const callId = req.body.CallSid;
  const s = sessions.get(callId);

  s.agentTexts.push(FLOW.intro.prompt);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/intro.mp3</Play>
  <Record
    action="${BASE_URL}/exotel/recording"
    maxLength="8"
    playBeep="false"
  />
</Response>
`);
});

/* ======================
   RECORDING CALLBACK
====================== */
app.post("/exotel/recording", async (req, res) => {
  const callId = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;
  const s = sessions.get(callId);

  // TODO:
  // 1. Download recordingUrl
  // 2. Send to Google STT
  // 3. Get text
  // 4. Run detectTaskStatus()
  // 5. Decide next FLOW
  // 6. Respond with <Play> next audio or <Hangup>

  res.type("text/xml").send(`<Response><Hangup/></Response>`);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – EXOTEL READY");
});
