/*************************************************
 * GUJARATI AI VOICE AGENT – FINAL STABLE VERSION
 * Voice Calls + Google Sheet + Safe WhatsApp
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ======================
   TWILIO
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   GOOGLE TTS
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();

/* ======================
   GOOGLE SHEETS
====================== */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
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
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે. આભાર.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો.",
    next: (t) => (t.length > 6 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ જલદી જ સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર. કોઈ વાત નથી. જો આપ ઈચ્છો તો પછીથી સંપર્ક કરી શકો છો. આભાર.",
    end: true
  }
};

/* ======================
   AUDIO GENERATION
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

async function preloadAudio() {
  for (const k in FLOW) {
    await generateAudio(FLOW[k].prompt, `${k}.mp3`);
  }
  await generateAudio("કૃપા કરીને ફરીથી કહેશો?", "retry.mp3");
  await generateAudio("કૃપા કરીને થોડું વધુ સ્પષ્ટ કહેશો?", "retry2.mp3");
}

/* ======================
   GOOGLE SHEET LOG
====================== */
function logToSheet(call) {
  sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date(call.startTime).toISOString(),
        call.sid,
        "gu-IN",
        call.agentTexts.join(" → "),
        call.userTexts.join(" | "),
        call.result,
        Math.floor((Date.now() - call.startTime) / 1000),
        call.workflow.join(" → ")
      ]]
    }
  }).catch(err => {
    console.error("Sheet log failed:", err.message);
  });
}

/* ======================
   SAFE WHATSAPP SENDER
====================== */
async function sendWhatsAppSummary(call) {
  try {
    if (!process.env.TWILIO_WHATSAPP_FROM) return;
    if (!call.from) return;

    const message = `
📞 AI Call Summary

Status: ${call.result}
Duration: ${Math.floor((Date.now() - call.startTime) / 1000)} sec

🤖 Agent:
${call.agentTexts.join(" | ")}

🧑 User:
${call.userTexts.join(" | ")}

— Dariyapur E-Office
`;

    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${call.from.replace("whatsapp:", "")}`,
      body: message
    });

    console.log("✅ WhatsApp summary sent");

  } catch (err) {
    // 🔒 NEVER crash the server
    console.error("WhatsApp failed:", err.message);
  }
}

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
    sid,
    state: "intro",
    startTime: Date.now(),
    agentTexts: [FLOW.intro.prompt],
    userTexts: [],
    workflow: ["Intro"],
    from: req.body.From,
    result: ""
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
  if (!call) {
    return res.type("text/xml").send("<Response><Hangup/></Response>");
  }

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

  const nextId = FLOW[call.state].next(text);
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
  call.workflow.push(nextId);

  if (next.end) {
    call.result = nextId;

    logToSheet(call);
    sendWhatsAppSummary(call);

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
   START SERVER
====================== */
app.listen(PORT, async () => {
  await preloadAudio();
  console.log("✅ Gujarati AI Voice Agent running (FINAL STABLE)");
});
