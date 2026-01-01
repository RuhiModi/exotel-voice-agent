/*************************************************
 * GUJARATI AI VOICE AGENT
 * FINAL STABLE + SAFE LLM FALLBACK
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";

dotenv.config();

/* ======================
   ENV SAFETY GUARDS
====================== */
if (!process.env.BASE_URL) {
  console.error("❌ BASE_URL missing");
  process.exit(1);
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}

if (!process.env.GOOGLE_SHEET_ID) {
  console.error("❌ GOOGLE_SHEET_ID missing");
  process.exit(1);
}

/* ======================
   BASIC SETUP
====================== */
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;
const USE_LLM = process.env.USE_LLM === "true";

/* ======================
   PATHS
====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   GOOGLE TTS
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();

/* ======================
   GOOGLE SHEETS
====================== */
const sheets = google.sheets("v4");
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = "Sheet1!A:H";

/* ======================
   CALL MEMORY
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
      if (/બાકી|નથી/.test(t)) return "task_pending";
      return null;
    }
  },

  task_done: {
    prompt:
      "આભાર. આપનો પ્રતિસાદ નોંધાયો છે. શુભ દિવસ.",
    end: true
  },

  task_pending: {
    prompt:
      "આભાર. આપની ફરિયાદ નોંધાઈ ગઈ છે. અમારી ટીમ સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર. કોઈ વાત નથી. આભાર.",
    end: true
  }
};

/* ======================
   TTS HELPER
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
   SAFE GROQ LLM
====================== */
async function askGroq(userText) {
  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a Gujarati government call assistant. Reply briefly and politely in Gujarati. Ask one clarification or give a short helpful response."
            },
            { role: "user", content: userText }
          ]
        })
      }
    );

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "કૃપા કરીને ફરીથી કહેશો?";
  } catch {
    return "કૃપા કરીને ફરીથી કહેશો?";
  }
}

/* ======================
   LOG TO SHEET (A–H)
====================== */
async function logToSheet(call) {
  try {
    const client = await auth.getClient();

    await sheets.spreadsheets.values.append({
      auth: client,
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_RANGE,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          new Date().toISOString(),
          call.sid,
          call.from || "",
          "gu-IN",
          call.agentText.join(" | "),
          call.userText.join(" | "),
          call.status,
          Math.floor((Date.now() - call.start) / 1000)
        ]]
      }
    });
  } catch (e) {
    console.error("❌ Sheet log failed:", e.message);
  }
}

/* ======================
   ANSWER (CALL START)
====================== */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
    sid,
    from: req.body.From,
    state: "intro",
    start: Date.now(),
    agentText: [],
    userText: [],
    status: "IN_PROGRESS"
  });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");
  calls.get(sid).agentText.push(FLOW.intro.prompt);

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          timeout="6"
          speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   LISTEN (HYBRID)
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  if (!call) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const userText = (req.body.SpeechResult || "").trim();

  if (!userText) {
    call.status = "NO_INPUT";
    await logToSheet(call);
    calls.delete(sid);
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  call.userText.push(userText);

  const state = FLOW[call.state];
  const nextId = state.next(userText);
  const next = FLOW[nextId];

  /* ===== RULE FLOW ===== */
  if (next) {
    const audio = await speak(next.prompt, `${nextId}.mp3`);
    call.agentText.push(next.prompt);

    if (next.end) {
      call.status = "COMPLETED";
      await logToSheet(call);
      calls.delete(sid);
      res.type("text/xml").send(`<Response><Play>${audio}</Play><Hangup/></Response>`);
      return;
    }

    call.state = nextId;
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          timeout="6"
          speechTimeout="auto"/>
</Response>
`);
    return;
  }

  /* ===== LLM FALLBACK ===== */
  let reply = "કૃપા કરીને ફરીથી કહેશો?";
  if (USE_LLM && process.env.GROQ_API_KEY) {
    reply = await askGroq(userText);
  }

  const audio = await speak(reply, "llm.mp3");
  call.agentText.push(reply);

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          timeout="6"
          speechTimeout="auto"/>
</Response>
`);
});

/* ======================
   SERVER START
====================== */
app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL STABLE + LLM)");
});
