/*************************************************
 * FLOW-DRIVEN GUJARATI AI VOICE AGENT (DEMO READY)
 * Two-way | ACK | No beep | Stable | Deterministic
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = process.env.BASE_URL;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   AUDIO DIRECTORY
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
   CALL STATE
====================== */
const calls = new Map();

/* ======================
   ACK TEXT (INSTANT RESPONSE)
====================== */
const ACK_TEXT = "હા… સમજાયું.";

/* ======================
   FLOW (FROM YOUR JSON)
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
      if (/હાલ નહીં|નથી આપી/.test(t)) return "no_details";
      return null;
    }
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ આપની સમસ્યાના નિરાકરણ માટે જલદી જ સંપર્ક કરશે.",
    end: true
  },

  no_details: {
    prompt:
      "બરાબર. કોઈ વાત નથી. જો આપ ઈચ્છો તો પછીથી અમારી ઇ-કાર્યાલય હેલ્પલાઈન પર સંપર્ક કરી શકો છો. આભાર.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર, કોઈ સમસ્યા નથી. આભાર, અમે પછીથી સંપર્ક કરીશું.",
    end: true
  },

  fallback: {
    prompt:
      "માફ કરશો, હાલમાં સિસ્ટમમાં ટેક્નિકલ સમસ્યા આવી છે. અમારી ટીમ જલદી જ આપને ફરીથી સંપર્ક કરશે.",
    end: true
  }
};

/* ======================
   TTS (GUJARATI MALE)
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
  const call = await twilioClient.calls.create({
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
  calls.set(req.body.CallSid, "intro");
  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record
    action="${BASE_URL}/listen"
    method="POST"
    playBeep="false"
    timeout="8"
    maxLength="12"
    trim="trim-silence"
  />
</Response>
  `);
});

/* ======================
   LISTEN LOOP
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const stateId = calls.get(sid);
  const state = FLOW[stateId];

  // No speech captured
  if (!req.body.RecordingUrl) {
    const audio = await speak(FLOW.end_no_time.prompt, "noinput.mp3");
    calls.delete(sid);
    return res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
    `);
  }

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

    console.log("USER:", text);

    const nextId = state.next ? state.next(text) : null;
    const next = FLOW[nextId] || FLOW.fallback;

    const ackUrl = await speak(ACK_TEXT, "ack.mp3");
    const replyUrl = await speak(next.prompt, `${nextId || "fallback"}.mp3`);

    if (next.end) {
      calls.delete(sid);
      return res.type("text/xml").send(`
<Response>
  <Play>${ackUrl}</Play>
  <Play>${replyUrl}</Play>
  <Hangup/>
</Response>
      `);
    }

    calls.set(sid, nextId);

    res.type("text/xml").send(`
<Response>
  <Play>${ackUrl}</Play>
  <Play>${replyUrl}</Play>
  <Record
    action="${BASE_URL}/listen"
    method="POST"
    playBeep="false"
    timeout="8"
    maxLength="12"
    trim="trim-silence"
  />
</Response>
    `);
  } catch (err) {
    console.error("ERROR:", err);
    const audio = await speak(FLOW.fallback.prompt, "fallback.mp3");
    calls.delete(sid);
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
    `);
  }
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, async () => {
  await speak(ACK_TEXT, "ack.mp3");
  console.log("✅ Demo-ready Gujarati AI voice agent running");
});
