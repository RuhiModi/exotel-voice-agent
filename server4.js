/*************************************************
 * GUJARATI AI VOICE AGENT (STABLE, NO DISCONNECT)
 * Twilio Gather + Gujarati STT + Safe LLM fallback
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

const ttsClient = new textToSpeech.TextToSpeechClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

const calls = new Map();

/* ======================
   FLOW
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી છે. શું હું થોડો સમય લઈ શકું?",
    next: (t) => {
      if (/હા|હાં|ચાલે/.test(t)) return "task_check";
      if (/સમય નથી|પછી/.test(t)) return "end_no_time";
      return null;
    }
  },

  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) => {
      if (/પૂર્ણ|થઈ ગયું/.test(t)) return "task_done";
      if (/નથી|બાકી/.test(t)) return "task_pending";
      return null;
    }
  },

  task_done: {
    prompt: "આભાર. આપનો પ્રતિસાદ મળ્યો. શુભ દિવસ.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ પૂર્ણ થયું નથી. આપની ફરિયાદ નોંધવામાં આવી છે.",
    end: true
  },

  end_no_time: {
    prompt: "બરાબર. કોઈ વાત નથી. આભાર.",
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
      voice: { languageCode: "gu-IN" },
      audioConfig: { audioEncoding: "MP3" }
    });
    fs.writeFileSync(filePath, res.audioContent);
  }
  return `${BASE_URL}/audio/${file}`;
}

/* ======================
   ANSWER
====================== */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;
  calls.set(sid, { state: "intro" });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
</Response>
`);
});

/* ======================
   LISTEN (FAST & SAFE)
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  if (!call) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const text = (req.body.SpeechResult || "").trim();

  // 🔴 IMPORTANT: respond immediately if empty
  if (!text) {
    const retry = await speak(
      "કૃપા કરીને ફરીથી કહેશો?",
      "retry.mp3"
    );
    res.type("text/xml").send(`
<Response>
  <Play>${retry}</Play>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
</Response>
`);
    return;
  }

  const state = FLOW[call.state];
  let nextId = state.next(text);

  const next = FLOW[nextId];

  if (!next) {
    const retry = await speak(
      "કૃપા કરીને થોડું વધુ સ્પષ્ટ કહેશો?",
      "retry2.mp3"
    );
    res.type("text/xml").send(`
<Response>
  <Play>${retry}</Play>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
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
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
</Response>
`);
  }
});

app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (STABLE)");
});
