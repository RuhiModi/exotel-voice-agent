/*************************************************
 * GUJARATI AI VOICE AGENT – EXOTEL + GROQ LLM
 * Two-way AI | STT | LLM | TTS | Retry | Escalation
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import speech from "@google-cloud/speech";
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
   GOOGLE CLIENTS
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();
const sttClient = new speech.SpeechClient();

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
   GROQ LLM – INTENT CLASSIFIER
====================== */
async function classifyWithLLM(text) {
  const prompt = `
User said (Gujarati or mixed):
"${text}"

Classify intent as ONE of:
DONE – work completed
PENDING – work not completed
UNCLEAR – cannot understand

Reply in JSON only:
{ "intent": "...", "confidence": number }
`;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });

  const data = await r.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { intent: "UNCLEAR", confidence: 30 };
  }
}

/* ======================
   GOOGLE SHEET LOG
====================== */
function logToSheet(s) {
  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:I",
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
        "Completed",
        s.confidenceScore ?? 0
      ]]
    }
  }).catch(console.error);
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
  <Record action="${BASE_URL}/exotel/recording" maxLength="8" playBeep="false"/>
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

  const audioRes = await fetch(recordingUrl);
  const audioBuffer = await audioRes.arrayBuffer();

  const [stt] = await sttClient.recognize({
    audio: { content: Buffer.from(audioBuffer).toString("base64") },
    config: { encoding: "LINEAR16", languageCode: "gu-IN" }
  });

  const transcript =
    stt.results?.map(r => r.alternatives[0].transcript).join(" ") || "";

  if (transcript) s.userTexts.push(transcript);

  let next = null;

  if (s.state === "intro") {
    next = "task_check";
  } else {
    const { intent, confidence } = await classifyWithLLM(transcript);
    s.confidenceScore = confidence;

    if (intent === "DONE") next = "task_done";
    else if (intent === "PENDING") next = "task_pending";
    else {
      s.unclearCount += 1;
      if (s.unclearCount === 1) next = "retry_task_check";
      else if (s.unclearCount === 2) next = "confirm_task";
      else next = "escalate";
    }
  }

  s.agentTexts.push(FLOW[next].prompt);

  if (FLOW[next].end) {
    s.result = next;
    logToSheet(s);
    sessions.delete(callId);

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
  <Record action="${BASE_URL}/exotel/recording" maxLength="8" playBeep="false"/>
</Response>
`);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – EXOTEL + GROQ LLM READY");
});
