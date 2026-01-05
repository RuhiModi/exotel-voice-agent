/*************************************************
 * GUJARATI AI VOICE AGENT (VOICE ONLY + LLM)
 * Twilio Voice + Google TTS + Groq LLM + Sheets
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";
import twilio from "twilio";

dotenv.config();

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
   CALL MEMORY
====================== */
const calls = new Map();

/* ======================
   SCRIPT FLOW (FIXED)
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
   PRELOAD TTS
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
   LLM INTENT CLASSIFIER
====================== */
async function detectNextState(currentState, userText) {
  const prompt = `
You are a Gujarati voice-call intent classifier.

Current step: ${currentState}

Valid next steps:
intro → task_check → task_done / task_pending / end_no_time
task_pending → problem_recorded

User said (Gujarati):
"${userText}"

Reply ONLY with one of:
task_check, task_done, task_pending, problem_recorded, end_no_time, unknown
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
function logToSheet(call) {
  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(call.startTime).toISOString(),
        call.sid,
        call.from,
        call.agentTexts.join(" | "),
        call.userTexts.join(" | "),
        call.result,
        Math.floor((Date.now() - call.startTime) / 1000),
        "Completed"
      ]]
    }
  }).catch(console.error);
}

/* ======================
   ANSWER (CALL START)
====================== */
app.post("/answer", (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
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
   LISTEN (LLM LOGIC)
====================== */
app.post("/listen", async (req, res) => {
  const call = calls.get(req.body.CallSid);
  if (!call) return res.type("text/xml").send("<Response><Hangup/></Response>");

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

  call.userTexts.push(text);

  const nextId = await detectNextState(call.state, text);

  if (!FLOW[nextId]) {
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

  call.agentTexts.push(FLOW[nextId].prompt);

  if (FLOW[nextId].end) {
    call.result = nextId;
    logToSheet(call);
    calls.delete(call.sid);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${nextId}.mp3</Play>
  <Hangup/>
</Response>
`);
  }

  call.state = nextId;

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${nextId}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent running (LLM + Voice Only)");
});
