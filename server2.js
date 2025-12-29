/*************************************************
 * STABLE FLOW-DRIVEN GUJARATI AI VOICE AGENT
 * + Google Sheets Logging (SAFE ADDITION)
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import textToSpeech from "@google-cloud/text-to-speech";
import { SpeechClient } from "@google-cloud/speech";
import { google } from "googleapis";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   AUDIO DIR
====================== */
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   CLIENTS
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const ttsClient = new textToSpeech.TextToSpeechClient();
const sttClient = new SpeechClient();

/* ======================
   GOOGLE SHEETS
====================== */
const sheets = google.sheets("v4");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

/* ======================
   CALL STATE
====================== */
const calls = new Map();

/* ======================
   FLOW (UNCHANGED)
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
    next: (t) => {
      if (t.length > 6) return "problem_recorded";
      return null;
    }
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
  },

  fallback: {
    prompt:
      "માફ કરશો, હાલમાં સિસ્ટમમાં ટેક્નિકલ સમસ્યા આવી છે. અમારી ટીમ જલદી જ આપને ફરીથી સંપર્ક કરશે.",
    end: true
  }
};

/* ======================
   TTS
====================== */
async function speak(text, file) {
  const filePath = path.join(AUDIO_DIR, file);
  if (!fs.existsSync(filePath)) {
    const [res] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "gu-IN", name: "gu-IN-Standard-B" },
      audioConfig: { audioEncoding: "MP3" }
    });
    fs.writeFileSync(filePath, res.audioContent);
  }
  return `${BASE_URL}/audio/${file}`;
}

/* ======================
   GOOGLE SHEET LOGGER
====================== */
async function logCall({ language, userText, status, duration }) {
  try {
    const client = await auth.getClient();
    await sheets.spreadsheets.values.append({
      auth: client,
      spreadsheetId: SPREADSHEET_ID,
      range: "Call_Logs!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          new Date().toISOString(),
          language,
          userText,
          status,
          duration
        ]]
      }
    });
    console.log("📊 Call logged to sheet");
  } catch (e) {
    console.error("❌ Sheet log failed:", e.message);
  }
}

/* ======================
   ANSWER
====================== */
app.post("/answer", async (req, res) => {
  calls.set(req.body.CallSid, {
    state: "intro",
    startTime: Date.now()
  });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record
    action="${BASE_URL}/listen"
    method="POST"
    timeout="4"
    playBeep="false"
  />
</Response>
  `);
});

/* ======================
   LISTEN
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);
  const state = FLOW[call.state];

  try {
    const audioResp = await fetch(`${req.body.RecordingUrl}.wav`, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64")
      }
    });

    const buffer = await audioResp.arrayBuffer();

    const [stt] = await sttClient.recognize({
      audio: { content: Buffer.from(buffer).toString("base64") },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"]
      }
    });

    const text =
      stt.results?.[0]?.alternatives?.[0]?.transcript || "";

    const nextId = state.next ? state.next(text) : null;
    const next = FLOW[nextId] || FLOW.fallback;

    const audio = await speak(next.prompt, `${nextId || "fallback"}.mp3`);

    if (next.end) {
      await logCall({
        language: "gu-IN",
        userText: text,
        status: "Completed",
        duration: Math.floor((Date.now() - call.startTime) / 1000)
      });

      calls.delete(sid);
      return res.type("text/xml").send(`<Response><Play>${audio}</Play><Hangup/></Response>`);
    }

    call.state = nextId;

    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record
    action="${BASE_URL}/listen"
    method="POST"
    timeout="8"
    playBeep="false"
  />
</Response>
    `);
  } catch (e) {
    await logCall({
      language: "gu-IN",
      userText: "Error",
      status: "Failed",
      duration: 0
    });
    res.type("text/xml").send(`<Response><Hangup/></Response>`);
  }
});

/* ======================
   START
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ AI Voice Agent running with Google Sheets logging");
});
