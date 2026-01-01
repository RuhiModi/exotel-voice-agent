/*************************************************
 * GUJARATI AI VOICE AGENT – FINAL STABLE
 * - Twilio Gather
 * - Gujarati Google TTS
 * - Google Sheet logging (ALWAYS logs)
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

// ================= FILE PATH =================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= AUDIO =================
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

const ttsClient = new textToSpeech.TextToSpeechClient();

// ================= GOOGLE SHEET =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ================= MEMORY =================
const calls = new Map();

// ================= FLOW =================
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (t) => {
      if (/હા|ચાલે|લઈ શકો/.test(t)) return "task_check";
      if (/સમય નથી|પછી/.test(t)) return "end_no_time";
      return null;
    },
  },

  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) => {
      if (/પૂર્ણ|થઈ ગયું/.test(t)) return "task_done";
      if (/બાકી|નથી થયું/.test(t)) return "task_pending";
      return null;
    },
  },

  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે. આભાર.",
    end: true,
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. અમારી ટીમ જલદી સંપર્ક કરશે.",
    end: true,
  },

  end_no_time: {
    prompt: "બરાબર. કોઈ વાત નથી. આભાર.",
    end: true,
  },
};

// ================= TTS =================
async function speak(text, filename) {
  const filePath = path.join(AUDIO_DIR, filename);

  if (!fs.existsSync(filePath)) {
    const [res] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "gu-IN" },
      audioConfig: { audioEncoding: "MP3" },
    });
    fs.writeFileSync(filePath, res.audioContent);
  }

  return `${BASE_URL}/audio/${filename}`;
}

// ================= SHEET LOG =================
async function logToSheet(call) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            new Date().toISOString(),
            call.sid,
            call.from || "",
            "gu-IN",
            call.agentText || "",
            call.userText || "",
            call.result || "completed",
            call.duration || 0,
          ],
        ],
      },
    });
  } catch (e) {
    console.error("Sheet logging failed:", e.message);
  }
}

// ================= ANSWER =================
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
    sid,
    from: req.body.From,
    state: "intro",
    agentText: FLOW.intro.prompt,
    userText: "",
    result: "in-progress",
    startTime: Date.now(),
  });

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

// ================= LISTEN =================
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  if (!call) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const text = (req.body.SpeechResult || "").trim();
  if (text) call.userText += ` ${text}`;

  const state = FLOW[call.state];
  const nextId = state.next(text);
  const next = FLOW[nextId];

  if (!next) {
    const retry = await speak(
      "કૃપા કરીને થોડું વધુ સ્પષ્ટ કહેશો?",
      "retry.mp3"
    );
    res.type("text/xml").send(`
<Response>
  <Play>${retry}</Play>
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    timeout="6" speechTimeout="auto"/>
</Response>
`);
    return;
  }

  call.agentText += ` | ${next.prompt}`;
  const audio = await speak(next.prompt, `${nextId}.mp3`);

  if (next.end) {
    call.result = "completed";
    call.duration = Math.floor((Date.now() - call.startTime) / 1000);
    await logToSheet(call);
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
  <Gather input="speech" language="gu-IN"
    action="${BASE_URL}/listen" method="POST"
    timeout="6" speechTimeout="auto"/>
</Response>
`);
  }
});

// ================= DISCONNECT SAFETY =================
app.post("/call-status", async (req, res) => {
  const sid = req.body.CallSid;
  const status = req.body.CallStatus;

  const call = calls.get(sid);
  if (call) {
    call.result = status || "disconnected";
    call.duration = Math.floor((Date.now() - call.startTime) / 1000);
    await logToSheet(call);
    calls.delete(sid);
  }

  res.sendStatus(200);
});

// ================= START =================
app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL STABLE)");
});
