/*************************************************
 * GUJARATI AI VOICE AGENT – CLEAN FINAL VERSION
 * Outbound Only | Twilio + Groq + Google TTS
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
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
   CALL MEMORY (SOURCE OF TRUTH)
====================== */
const sessions = new Map();

/* ======================
   SCRIPT FLOW
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમિયાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ માટે આ કૉલ છે. શું હું આપનો થોડો સમય લઈ શકું?"
  },
  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમિયાન આપનું કામ પૂર્ણ થયું છે કે નહીં?"
  },
  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ પૂર્ણ થયું છે. આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે. આભાર.",
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
  },
  end_no_time: {
    prompt:
      "બરાબર. કોઈ સમસ્યા નથી. આપનો સમય આપવા બદલ આભાર.",
    end: true
  }
};

/* ======================
   PRELOAD AUDIO
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
  await generateAudio("કૃપા કરીને ફરીથી કહેશો?", "retry.mp3");
}

/* ======================
   LLM (ONLY WHERE NEEDED)
====================== */
async function detectNextState(state, text) {
  const prompt = `
You are a Gujarati intent classifier.

Current step: ${state}

Allowed:
intro → task_check | end_no_time
task_check → task_done | task_pending

User said:
"${text}"

Reply ONLY:
task_check, task_done, task_pending, end_no_time
`;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });

  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim();
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
   OUTBOUND CALL (CREATE SESSION HERE)
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Missing to" });

  const twilioCall = await twilioClient.calls.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER,
    url: `${BASE_URL}/answer`,
    statusCallback: `${BASE_URL}/call-status`,
    statusCallbackEvent: ["completed"],
    method: "POST"
  });

  sessions.set(twilioCall.sid, {
    sid: twilioCall.sid,
    userPhone: to,
    startTime: Date.now(),
    state: "intro",
    agentTexts: [],
    userTexts: [],
    result: ""
  });

  res.json({ status: "calling", sid: twilioCall.sid });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  if (!s) return res.sendStatus(200);

  s.agentTexts.push(FLOW.intro.prompt);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/intro.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"
    timeout="6"
    speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   LISTEN (NO LOOPS)
====================== */
app.post("/listen", async (req, res) => {
  const s = sessions.get(req.body.CallSid);
  if (!s) return res.send("<Response><Hangup/></Response>");

  const text = (req.body.SpeechResult || "").trim();
  if (!text) {
    return res.send(`
<Response>
  <Play>${BASE_URL}/audio/retry.mp3</Play>
  <Gather input="speech" action="${BASE_URL}/listen"/>
</Response>
`);
  }

  s.userTexts.push(text);

  let next;
  if (s.state === "task_pending") {
    next = "problem_recorded";
  } else {
    next = await detectNextState(s.state, text);
  }

  s.agentTexts.push(FLOW[next].prompt);

  if (FLOW[next].end) {
    s.result = next;
    logToSheet(s);
    sessions.delete(s.sid);
    return res.send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Hangup/>
</Response>
`);
  }

  s.state = next;

  res.send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech" action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   CALL END (ABANDONED)
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
  console.log("✅ Gujarati AI Voice Agent READY");
});
