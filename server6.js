/*************************************************
 * GUJARATI AI VOICE AGENT – FINAL PRODUCTION FILE
 * Outbound + Inbound | Twilio + Groq + Google TTS
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
   APP SETUP
====================== */
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ======================
   TWILIO CLIENT
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
   CALL SESSION MEMORY
====================== */
const callSessions = new Map();

/* ======================
   FIXED SCRIPT FLOW
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
   TTS CACHE
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

async function preloadAllAudio() {
  for (const key in FLOW) {
    await generateAudio(FLOW[key].prompt, `${key}.mp3`);
  }
  await generateAudio("કૃપા કરીને ફરીથી કહેશો?", "retry.mp3");
}

/* ======================
   LLM INTENT CLASSIFIER
====================== */
async function detectNextState(currentState, userText) {
  const prompt = `
You are a Gujarati phone-call intent classifier.

Current step: ${currentState}

Allowed transitions:
intro → task_check | end_no_time
task_check → task_done | task_pending

User said (Gujarati):
"${userText}"

Reply ONLY with:
task_check, task_done, task_pending, end_no_time, unknown
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
function logToSheet(session) {
  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(session.startTime).toISOString(),
        session.sid,
        session.from,
        session.agentTexts.join(" | "),
        session.userTexts.join(" | "),
        session.result,
        Math.floor((Date.now() - session.startTime) / 1000),
        "Completed"
      ]]
    }
  }).catch(console.error);
}

/* ======================
   OUTBOUND CALL API
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) return res.status(400).json({ error: "Missing 'to' number" });
    if (!process.env.TWILIO_FROM_NUMBER)
      return res.status(500).json({ error: "TWILIO_FROM_NUMBER not set" });

    const twilioCall = await twilioClient.calls.create({
      to,
      from: process.env.TWILIO_FROM_NUMBER,
      url: `${BASE_URL}/answer`,
      method: "POST",
      statusCallback: `${BASE_URL}/call-status`,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST"
    });

    res.json({ status: "calling", sid: twilioCall.sid, to });
  } catch (err) {
    console.error("Outbound call error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   ANSWER WEBHOOK
====================== */
app.post("/answer", (req, res) => {
  const sid = req.body.CallSid;

  callSessions.set(sid, {
    sid,
    state: "intro",
    startTime: Date.now(),
    agentTexts: [FLOW.intro.prompt],
    userTexts: [],
    from: req.body.From,
    result: ""
  });

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/intro.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   LISTEN LOOP (FIXED)
====================== */
app.post("/listen", async (req, res) => {
  const session = callSessions.get(req.body.CallSid);
  if (!session) return res.type("text/xml").send("<Response><Hangup/></Response>");

  const text = (req.body.SpeechResult || "").trim();
  if (!text) {
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/retry.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"/>
</Response>
`);
  }

  session.userTexts.push(text);

  let nextState;

  // 🔒 HARD STOP LOGIC
  if (session.state === "task_pending") {
    nextState = "problem_recorded";
  } else {
    nextState = await detectNextState(session.state, text);
  }

  if (!FLOW[nextState]) {
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/retry.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"/>
</Response>
`);
  }

  session.agentTexts.push(FLOW[nextState].prompt);

  if (FLOW[nextState].end) {
    session.result = nextState;
    logToSheet(session);
    callSessions.delete(session.sid);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${nextState}.mp3</Play>
  <Hangup/>
</Response>
`);
  }

  session.state = nextState;

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${nextState}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   CALL STATUS CALLBACK
====================== */
app.post("/call-status", (req, res) => {
  const sid = req.body.CallSid;
  const session = callSessions.get(sid);

  if (session && !session.result) {
    session.result = "abandoned";
    logToSheet(session);
    callSessions.delete(sid);
  }

  res.sendStatus(200);
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, async () => {
  await preloadAllAudio();
  console.log("✅ Gujarati AI Voice Agent running (Production Ready)");
});
