/*************************************************
 * REAL-TIME GUJARATI AI VOICE AGENT (STREAMING)
 * FIXED: Call hold + Proper Twilio playback
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";
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
const DOMAIN = process.env.DOMAIN;

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
  task_done: { prompt: "આભાર, આપનું કામ પૂર્ણ થયું તે સાંભળીને આનંદ થયો.", end: true },
  task_pending: {
    prompt: "કૃપા કરીને સમસ્યાની વિગતો જણાવશો.",
    next: (t) => (t.length > 6 ? "problem_recorded" : null)
  },
  problem_recorded: { prompt: "આભાર, આપની માહિતી નોંધાઈ ગઈ છે.", end: true },
  end_no_time: { prompt: "બરાબર, પછીથી ફરી સંપર્ક કરશો.", end: true },
  fallback: { prompt: "માફ કરશો, કૃપા કરીને થોડું સ્પષ્ટ કહેશો?", end: false }
};

/* ======================
   CALL STATE
====================== */
const calls = new Map();

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
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  await twilioClient.calls.create({
    to: req.body.to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${BASE_URL}/answer-stream`,
    method: "POST"
  });
  res.json({ success: true });
});

/* ======================
   ANSWER (KEEP CALL ALIVE)
====================== */
app.post("/answer-stream", async (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, { state: "intro", startTime: Date.now() });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Stream url="wss://${DOMAIN}/media?sid=${sid}" />
  <Pause length="600"/>
</Response>
`);
});

/* ======================
   SAY (CORRECT PLAYBACK)
====================== */
app.post("/say", async (req, res) => {
  const { audio } = req.body;
  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Pause length="600"/>
</Response>
`);
});

/* ======================
   WEBSOCKET (MEDIA STREAM)
====================== */
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  const sid = new URL(req.url, `http://${req.headers.host}`).searchParams.get("sid");
  const call = calls.get(sid);
  if (!call) return ws.close();

  const recognizeStream = sttClient.streamingRecognize({
    config: { encoding: "MULAW", sampleRateHertz: 8000, languageCode: "gu-IN" },
    interimResults: true
  });

  recognizeStream.on("data", async (data) => {
    const text = data.results?.[0]?.alternatives?.[0]?.transcript;
    if (!text) return;

    const current = FLOW[call.state];
    const nextId = current.next ? current.next(text) : null;
    if (!nextId) return;

    const audio = await speak(FLOW[nextId].prompt, `${nextId}.mp3`);

    await twilioClient.calls(sid).update({
      url: `${BASE_URL}/say`,
      method: "POST",
      twiml: `<Response><Play>${audio}</Play><Pause length="600"/></Response>`
    });

    if (FLOW[nextId].end) calls.delete(sid);
    else call.state = nextId;
  });

  ws.on("message", (msg) => {
    const event = JSON.parse(msg.toString());
    if (event.event === "media") {
      recognizeStream.write(Buffer.from(event.media.payload, "base64"));
    }
  });

  ws.on("close", () => recognizeStream.end());
});

/* ======================
   SERVER START
====================== */
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Streaming AI Voice Agent running (FIXED)");
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/media")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else socket.destroy();
});

/* =====================================================
   OLD WS PLAY LOGIC (KEPT FOR REFERENCE – DO NOT DELETE)
===================================================== */
/*
// ws.send({ event: "play", audio }); ❌ NOT SUPPORTED BY TWILIO
*/
