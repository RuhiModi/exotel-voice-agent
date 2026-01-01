/*************************************************
 * GUJARATI AI VOICE AGENT – FINAL CLEAN
 * Human-like | LLM-driven | No IVR | Stable
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";

dotenv.config();


app.get("/", (req, res) => {
  res.status(200).send("AI Voice Agent OK");
});

/* -------------------- BASIC SETUP -------------------- */

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!BASE_URL) {
  console.error("❌ BASE_URL missing");
  process.exit(1);
}
if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY missing");
  process.exit(1);
}

/* -------------------- PATHS -------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

app.use("/audio", express.static(AUDIO_DIR));

/* -------------------- TTS -------------------- */

const ttsClient = new textToSpeech.TextToSpeechClient();

async function speak(text, fileName) {
  const filePath = path.join(AUDIO_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    const [res] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "gu-IN",
        name: "gu-IN-Standard-A"
      },
      audioConfig: { audioEncoding: "MP3" }
    });
    fs.writeFileSync(filePath, res.audioContent);
  }

  return `${BASE_URL}/audio/${fileName}`;
}

/* -------------------- MEMORY -------------------- */

const calls = new Map();

/* -------------------- CONVERSATION FLOW -------------------- */

const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી છે. શું હું આપનો થોડો સમય લઈ શકું?",
    next: async (user) => await classify(user, {
      yes: "task_check",
      no: "end_no_time"
    })
  },

  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: async (user) => await classify(user, {
      done: "task_done",
      pending: "task_pending"
    })
  },

  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે. આભાર.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગતો થોડું સમજાવશો.",
    next: async (user) => (user.length > 4 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ જલદી જ આપનો સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર, કોઈ વાત નથી. તમે ઈચ્છો તો પછીથી અમારી ઇ-કાર્યાલય હેલ્પલાઈન પર સંપર્ક કરી શકો છો. આભાર.",
    end: true
  }
};

/* -------------------- LLM INTENT CLASSIFIER -------------------- */

async function classify(userText, mapping) {
  const labels = Object.keys(mapping).join(", ");

  const prompt = `
User said (Gujarati):
"${userText}"

Decide best intent from:
${labels}

Respond ONLY with intent word.
`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const j = await r.json();
    const intent = j.choices?.[0]?.message?.content?.trim();

    return mapping[intent] || null;
  } catch (e) {
    console.error("LLM error:", e);
    return null;
  }
}

/* -------------------- TWILIO ENTRY -------------------- */

app.post("/answer", async (req, res) => {
  const callSid = req.body.CallSid;
  calls.set(callSid, { state: "intro" });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    speechTimeout="auto"
    timeout="6"
  />
</Response>
`);
});

/* -------------------- USER RESPONSE -------------------- */

app.post("/listen", async (req, res) => {
  const callSid = req.body.CallSid;
  const call = calls.get(callSid);

  if (!call) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const userText = (req.body.SpeechResult || "").trim();

  if (!userText) {
    const retry = await speak("કૃપા કરીને ફરી કહેશો?", "retry.mp3");
    res.type("text/xml").send(`
<Response>
  <Play>${retry}</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    speechTimeout="auto" timeout="6"/>
</Response>
`);
    return;
  }

  const state = FLOW[call.state];
  const nextState = state.next ? await state.next(userText) : null;

  if (!nextState || !FLOW[nextState]) {
    const retry = await speak("થોડું વધુ સ્પષ્ટ કહેશો?", "clarify.mp3");
    res.type("text/xml").send(`
<Response>
  <Play>${retry}</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    speechTimeout="auto" timeout="6"/>
</Response>
`);
    return;
  }

  const next = FLOW[nextState];
  const audio = await speak(next.prompt, `${nextState}.mp3`);

  if (next.end) {
    calls.delete(callSid);
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
`);
  } else {
    call.state = nextState;
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    speechTimeout="auto" timeout="6"/>
</Response>
`);
  }
});

/* -------------------- START -------------------- */

app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL CLEAN)");
});
