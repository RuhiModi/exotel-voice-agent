/*************************************************
 * GUJARATI AI VOICE AGENT (FINAL – CLEAN LOGGING)
 * Stable Twilio Gather + Gujarati
 * Separate Agent / User columns in Google Sheets
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";

dotenv.config();

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
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS),
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
   FLOW (YOUR WORDING)
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (t) => {
      if (/હા|ચાલે|લઈ શકો/.test(t)) return "task_check";
      if (/સમય નથી|પછી/.test(t)) return "end_no_time";
      return null;
    }
  },

  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) => {
      if (/પૂર્ણ|થઈ ગયું/.test(t)) return "task_done";
      if (/બાકી|નથી થયું/.test(t)) return "task_pending";
      return null;
    }
  },

  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે. આભાર. દરિયાપુરના ધારાસભ્ય કૌશિક જૈનનું ઇ-કાર્યાલય આપની સેવા માટે હંમેશાં તૈયાર છે.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો જેથી અમે યોગ્ય વિભાગ સુધી પહોંચાડી શકીએ.",
    next: (t) => (t.length > 6 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ આપની સમસ્યાના નિરાકરણ માટે જલદી જ સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર. કોઈ વાત નથી. જો આપ ઈચ્છો તો પછીથી અમારી ઇ-કાર્યાલય હેલ્પલાઈન પર સંપર્ક કરી શકો છો. આભાર.",
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

/* ======================
   PRELOAD
====================== */
async function preloadAll() {
  for (const k in FLOW) {
    await generateAudio(FLOW[k].prompt, `${k}.mp3`);
  }
  await generateAudio("કૃપા કરીને ફરીથી કહેશો?", "retry.mp3");
  await generateAudio("કૃપા કરીને થોડું વધુ સ્પષ્ટ કહેશો?", "retry2.mp3");
}

/* ======================
   SHEET LOGGER
====================== */
async function logToSheet(call) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(call.startTime).toISOString(),
        call.sid,
        "gu-IN",
        call.agentTexts.join(" | "),
        call.userTexts.join(" | "),
        "Completed",
        Math.floor((Date.now() - call.startTime) / 1000)
      ]]
    }
  });
}

/* ======================
   ANSWER
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
    sid,
    state: "intro",
    startTime: Date.now(),
    agentTexts: [FLOW.intro.prompt],
    userTexts: []
  });

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/intro.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    timeout="6" speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   LISTEN
====================== */
app.post("/listen", (req, res) => {
  const call = calls.get(req.body.CallSid);
  if (!call) return res.type("text/xml").send("<Response><Hangup/></Response>");

  const text = (req.body.SpeechResult || "").trim();

  if (!text) {
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/retry.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    timeout="6" speechTimeout="auto"/>
</Response>
`);
  }

  call.userTexts.push(text);

  const current = FLOW[call.state];
  const nextId = current.next(text);
  const next = FLOW[nextId];

  if (!next) {
    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/retry2.mp3</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    timeout="6" speechTimeout="auto"/>
</Response>
`);
  }

  call.agentTexts.push(next.prompt);

  if (next.end) {
    await logToSheet(call);
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
    action="${BASE_URL}/listen" method="POST"
    timeout="6" speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent running (CLEAN LOGGING)");
});
