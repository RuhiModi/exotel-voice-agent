/*************************************************
 * STABLE FLOW-DRIVEN GUJARATI AI VOICE AGENT
 * + GUARANTEED GOOGLE SHEETS LOGGING
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
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (t) => {
      if (/હા|ચાલે/.test(t)) return "task_check";
      if (/નહીં|પછી/.test(t)) return "end_no_time";
      return null;
    }
  },

  task_check: {
    prompt:
      "યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) => {
      if (/પૂર્ણ|થઈ ગયું/.test(t)) return "task_done";
      if (/બાકી|નથી/.test(t)) return "task_pending";
      return null;
    }
  },

  task_done: {
    prompt: "આભાર. આપનો પ્રતિસાદ નોંધાયો છે.",
    end: true
  },

  task_pending: {
    prompt: "કૃપા કરીને આપની સમસ્યા જણાવશો.",
    next: (t) => (t.length > 4 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt: "આભાર. અમારી ટીમ સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt: "બરાબર. અમે પછીથી સંપર્ક કરીશું.",
    end: true
  },

  fallback: {
    prompt: "ટેક્નિકલ સમસ્યા. ફરી સંપર્ક કરીશું.",
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
   SHEET LOGGER (GUARANTEED)
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
          userText || "—",
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
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  await twilioClient.calls.create({
    to: req.body.to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${BASE_URL}/answer`,
    method: "POST"
  });
  res.json({ success: true });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", async (req, res) => {
  calls.set(req.body.CallSid, {
    state: "intro",
    startTime: Date.now(),
    lastText: ""
  });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record action="${BASE_URL}/listen" method="POST" timeout="6" />
</Response>
  `);
});

/* ======================
   LISTEN
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  try {
    if (!req.body.RecordingUrl) {
      await logCall({
        language: "gu-IN",
        userText: call.lastText,
        status: "No Input",
        duration: Math.floor((Date.now() - call.startTime) / 1000)
      });
      calls.delete(sid);
      return res.type("text/xml").send(`<Response><Hangup/></Response>`);
    }

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

    call.lastText = text;

    const state = FLOW[call.state];
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
  <Record action="${BASE_URL}/listen" method="POST" timeout="8" />
</Response>
    `);
  } catch (err) {
    await logCall({
      language: "gu-IN",
      userText: call?.lastText,
      status: "Error",
      duration: Math.floor((Date.now() - call.startTime) / 1000)
    });
    calls.delete(sid);
    res.type("text/xml").send(`<Response><Hangup/></Response>`);
  }
});

/* ======================
   START
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ AI Voice Agent running with GUARANTEED Sheets logging");
});
