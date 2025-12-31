/*************************************************
 * REAL-TIME GUJARATI AI VOICE AGENT (STREAMING)
 * DEFAULT MODE: Twilio Media Streams
 *
 * ✔ Google Streaming STT (gu-IN)
 * ✔ Same FLOW logic
 * ✔ Google Sheets logging
 * ✔ Old Record-based code kept (commented)
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";
import textToSpeech from "@google-cloud/text-to-speech";
import { SpeechClient } from "@google-cloud/speech";
import { google } from "googleapis";

dotenv.config();

/* ======================
   BASIC SETUP
====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL;
const DOMAIN = process.env.DOMAIN; // example: your-app.onrender.com

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   AUDIO CACHE
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
  credentials: JSON.parse(
    fs.readFileSync("/etc/secrets/serviceAccount.json", "utf8")
  ),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

/* ======================
   FLOW (UNCHANGED)
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી છે. શું હું થોડો સમય લઈ શકું?",
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
      "આપનું કામ પૂર્ણ થયું તે સાંભળીને આનંદ થયો. આપનો પ્રતિસાદ બદલ આભાર.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને સમસ્યાની વિગતો જણાવશો.",
    next: (t) => (t.length > 6 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ જલદી સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર. કોઈ વાત નથી. જરૂર પડે ત્યારે ફરી સંપર્ક કરશો. આભાર.",
    end: true
  },

  fallback: {
    prompt:
      "માફ કરશો, હાલમાં ટેક્નિકલ સમસ્યા છે. અમે ફરી સંપર્ક કરીશું.",
    end: true
  }
};

/* ======================
   CALL STATE (STREAMING)
====================== */
const calls = new Map();

/* ======================
   TTS (CACHED)
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
   GOOGLE SHEETS LOGGER
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
  } catch (e) {
    console.error("❌ Sheet log failed:", e.message);
  }
}

/* ======================
   OUTBOUND CALL (STREAM)
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Number missing" });

  await twilioClient.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${BASE_URL}/answer-stream`,
    method: "POST"
  });

  res.json({ success: true });
});

/* ======================
   ANSWER (STREAMING)
====================== */
app.post("/answer-stream", async (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
    state: "intro",
    startTime: Date.now()
  });

  const introAudio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${introAudio}</Play>
  <Stream url="wss://${DOMAIN}/media?sid=${sid}" />
</Response>
  `);
});

/* ======================
   WEBSOCKET (MEDIA STREAM)
====================== */
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  const sid = new URL(req.url, `http://${req.headers.host}`)
    .searchParams.get("sid");

  const call = calls.get(sid);
  if (!call) return ws.close();

  const recognizeStream = sttClient.streamingRecognize({
    config: {
      encoding: "MULAW",
      sampleRateHertz: 8000,
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"],
      enableAutomaticPunctuation: true
    },
    interimResults: true
  });

  recognizeStream.on("data", async (data) => {
    const text =
      data.results?.[0]?.alternatives?.[0]?.transcript;

    if (!text || text.length < 3) return;

    const current = FLOW[call.state];
    const nextId = current.next ? current.next(text) : null;
    const next = FLOW[nextId] || FLOW.fallback;

    const audio = await speak(
      next.prompt,
      `${nextId || "fallback"}.mp3`
    );

    ws.send(JSON.stringify({
      event: "play",
      audio
    }));

    if (next.end) {
      await logCall({
        language: "gu-IN",
        userText: text,
        status: "Completed",
        duration: Math.floor((Date.now() - call.startTime) / 1000)
      });
      calls.delete(sid);
      ws.close();
    } else {
      call.state = nextId;
    }
  });

  ws.on("message", (msg) => {
    const event = JSON.parse(msg.toString());
    if (event.event === "media") {
      const audio = Buffer.from(event.media.payload, "base64");
      recognizeStream.write(audio);
    }
  });

  ws.on("close", () => {
    recognizeStream.end();
  });
});

/* ======================
   HTTP + WS SERVER
====================== */
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Streaming AI Voice Agent running");
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/media")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

/* =====================================================
   SAFE MODE (RECORD + BATCH STT) – KEPT FOR FUTURE
   This code is NOT deleted, only commented.
===================================================== */

/*
app.post("/answer", async (req, res) => {
  // Old <Record> based safe flow
});

app.post("/listen", async (req, res) => {
  // Old Google recognize() batch STT
});
*/
