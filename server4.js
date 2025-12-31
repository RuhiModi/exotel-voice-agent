/*************************************************
 * GUJARATI AI VOICE AGENT (STABLE + LLM FALLBACK)
 * Twilio <Record> + Google STT + Groq (Intent only)
 * Trial-safe | Demo-proven
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import twilio from "twilio";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import { SpeechClient } from "@google-cloud/speech";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ======================
   ✅ TWILIO REST CLIENT (FIX)
====================== */
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   GOOGLE CLIENTS
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();
const sttClient = new SpeechClient();

/* ======================
   AUDIO CACHE
====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   CALL STATE
====================== */
const calls = new Map();

/* ======================
   FLOW (UNCHANGED – CLIENT APPROVED)
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી છે. શું હું થોડો સમય લઈ શકું?",
    next: (t) => {
      if (/હા|ચાલે|હાં/.test(t)) return "task_check";
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
      "આપનું કામ પૂર્ણ થયું તે સાંભળીને આનંદ થયો. આપના પ્રતિસાદ બદલ આભાર.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને સમસ્યાની વિગતો જણાવશો.",
    next: (t) => (t.length > 5 ? "problem_recorded" : null)
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
   GOOGLE STT (BATCH)
====================== */
async function transcribe(recordingUrl) {
  const [response] = await sttClient.recognize({
    audio: { uri: recordingUrl },
    config: {
      encoding: "LINEAR16",
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"]
    }
  });

  return response.results
    .map(r => r.alternatives[0].transcript)
    .join(" ");
}

/* ======================
   LLM INTENT FALLBACK (SAFE)
====================== */
async function llmIntentFallback(text) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "You are an intent classifier for a Gujarati government phone call. Reply ONLY with one of these words: task_done, task_pending, no_time, unclear."
          },
          { role: "user", content: text }
        ],
        temperature: 0
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  } catch {
    return null;
  }
}

/* ======================
   ANSWER (INBOUND)
====================== */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;
  calls.set(sid, { state: "intro" });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record action="${BASE_URL}/listen" method="POST" timeout="6" playBeep="false"/>
</Response>
`);
});

/* ======================
   OUTBOUND CALL (OPTIONAL)
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing 'to' number" });
  }

  try {
    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${BASE_URL}/answer`,
      method: "POST"
    });

    res.json({ success: true, sid: call.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   LISTEN (CORE LOGIC)
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  if (!call) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const recordingUrl = req.body.RecordingUrl + ".wav";
  const text = await transcribe(recordingUrl);

  const state = FLOW[call.state];
  let nextId = state.next ? state.next(text) : null;

  /* -------- LLM FALLBACK -------- */
  if (!nextId && text && text.length > 3) {
    const intent = await llmIntentFallback(text);
    if (intent === "task_done") nextId = "task_done";
    else if (intent === "task_pending") nextId = "task_pending";
    else if (intent === "no_time") nextId = "end_no_time";
  }

  const next = FLOW[nextId];

  if (!next) {
    const retryAudio = await speak(
      "માફ કરશો, કૃપા કરીને થોડું વધુ સ્પષ્ટ કહેશો?",
      "retry.mp3"
    );

    res.type("text/xml").send(`
<Response>
  <Play>${retryAudio}</Play>
  <Record action="${BASE_URL}/listen" method="POST" timeout="6" playBeep="false"/>
</Response>
`);
    return;
  }

  const audio = await speak(next.prompt, `${nextId}.mp3`);

  if (next.end) {
    calls.delete(sid);
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
`);
  } else {
    call.state = nextId;
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record action="${BASE_URL}/listen" method="POST" timeout="6" playBeep="false"/>
</Response>
`);
  }
});

/* ======================
   SERVER START
====================== */
app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (Stable + LLM fallback)");
});
