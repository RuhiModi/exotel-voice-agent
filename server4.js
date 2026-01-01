/*************************************************
 * HUMAN-LIKE GUIDED AI VOICE AGENT (FINAL)
 * Twilio + Google STT + Groq + Google Sheets
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import fetch from "node-fetch";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ---------- FILE SYSTEM ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ---------- TTS ---------- */
const ttsClient = new textToSpeech.TextToSpeechClient();

/* ---------- GOOGLE SHEETS ---------- */
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.JWT(
  creds.client_email,
  null,
  creds.private_key,
  ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = "Sheet1!A:H";

/* ---------- MEMORY ---------- */
const calls = new Map();

/* ---------- FLOW ---------- */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી. શું હું આપનો થોડો સમય લઈ શકું?",
    outcomes: ["agree", "busy"]
  },
  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    outcomes: ["completed", "pending"]
  },
  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે. આભાર. દરિયાપુરના ધારાસભ્ય કૌશિક જૈનનું ઇ-કાર્યાલય આપની સેવા માટે હંમેશાં તૈયાર છે.",
    end: true
  },
  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો જેથી અમે યોગ્ય વિભાગ સુધી પહોંચાડી શકીએ.",
    outcomes: ["problem"]
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
  }
};

/* ---------- TTS ---------- */
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

/* ---------- LLM UNDERSTANDING ---------- */
async function understand(question, answer, expected) {
  const prompt = `
You are a Gujarati language understanding engine.

Question:
"${question}"

User reply:
"${answer}"

Choose ONLY one meaning from:
${expected.join(", ")}

Return JSON:
{ "meaning": "<one_value>" }
`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });

  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content).meaning;
  } catch {
    return null;
  }
}

/* ---------- SHEET LOG ---------- */
async function logToSheet(call, status) {
  if (call.logged) return;
  call.logged = true;

  const duration = Math.floor((Date.now() - call.start) / 1000);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date().toISOString(),
        call.sid,
        call.from,
        "Gujarati",
        call.agentText.trim(),
        call.userText.trim(),
        status,
        duration
      ]]
    }
  });
}

/* ---------- ANSWER ---------- */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;
  const from = req.body.From || "";

  calls.set(sid, {
    sid,
    from,
    node: "intro",
    retry: 0,
    start: Date.now(),
    agentText: FLOW.intro.prompt,
    userText: "",
    logged: false
  });

  const audio = await speak(FLOW.intro.prompt, `intro-${sid}.mp3`);

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech" language="gu-IN"
          action="${BASE_URL}/listen"
          timeout="6" speechTimeout="auto"/>
</Response>
`);
});

/* ---------- LISTEN ---------- */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);
  if (!call) return res.type("text/xml").send("<Response><Hangup/></Response>");

  const userSpeech = (req.body.SpeechResult || "").trim();
  call.userText += ` ${userSpeech}`;

  const node = FLOW[call.node];
  const meaning = await understand(node.prompt, userSpeech, node.outcomes || []);

  let nextNode = null;

  if (!meaning && call.retry === 0) {
    call.retry++;
    const retryText = "માફ કરશો, હું સ્પષ્ટ સમજી શક્યો નથી. કૃપા કરીને થોડું સ્પષ્ટ કહેશો.";
    const audio = await speak(retryText, `retry-${sid}.mp3`);
    return res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech" language="gu-IN"
          action="${BASE_URL}/listen"
          timeout="6" speechTimeout="auto"/>
</Response>
`);
  }

  call.retry = 0;

  if (call.node === "intro") {
    nextNode = meaning === "agree" ? "task_check" : "end_no_time";
  } else if (call.node === "task_check") {
    nextNode = meaning === "completed" ? "task_done" : "task_pending";
  } else if (call.node === "task_pending") {
    nextNode = "problem_recorded";
  }

  const next = FLOW[nextNode];
  call.agentText += ` ${next.prompt}`;

  if (next.end) {
    await logToSheet(call, nextNode);
    calls.delete(sid);
    const audio = await speak(next.prompt, `end-${sid}.mp3`);
    return res.type("text/xml").send(`<Response><Play>${audio}</Play><Hangup/></Response>`);
  }

  call.node = nextNode;
  const audio = await speak(next.prompt, `step-${sid}.mp3`);

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech" language="gu-IN"
          action="${BASE_URL}/listen"
          timeout="6" speechTimeout="auto"/>
</Response>
`);
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("✅ Human-like Guided AI Voice Agent running");
});
