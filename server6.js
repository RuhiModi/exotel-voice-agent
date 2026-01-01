/*************************************************
 * GUJARATI AI VOICE AGENT — HYBRID FINAL (OPTION 1)
 * ✔ Intent tolerant
 * ✔ Retry capped
 * ✔ Sheet logging restored
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

/* ================= FILE ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= AUDIO ================= */
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

const ttsClient = new textToSpeech.TextToSpeechClient();

/* ================= GOOGLE SHEETS ================= */
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = "Sheet1!A:H"; // 🔴 keep SAME tab as before

async function logToSheet(call) {
  if (call.logged) return;
  call.logged = true;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date().toISOString(),
        call.sid,
        call.from || "",
        "gu-IN",
        call.agentText || "",
        call.userText || "",
        call.status || "completed",
        call.duration || ""
      ]]
    }
  });
}

/* ================= HELPERS ================= */
function normalize(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

/* ================= MEMORY ================= */
const calls = new Map();

/* ================= FLOW ================= */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (t) => {
      if (/(હા|હાં|બરાબર|ચાલે|ok|okay)/.test(t)) return "task_check";
      if (/(નથી|સમય નથી|પછી)/.test(t)) return "end_no_time";
      return null;
    }
  },

  task_check: {
    prompt: "યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) => {
      if (/(પૂર્ણ|થઈ|થયું|થયું છે)/.test(t)) return "done";
      if (/(નથી|બાકી|રહ્યું)/.test(t)) return "pending";
      return null;
    }
  },

  done: {
    prompt: "આભાર. આપનો પ્રતિસાદ નોંધાયો છે.",
    end: true
  },

  pending: {
    prompt: "આભાર. આપની ફરિયાદ નોંધાઈ ગઈ છે.",
    end: true
  },

  end_no_time: {
    prompt: "બરાબર. આભાર.",
    end: true
  }
};

/* ================= TTS ================= */
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

/* ================= ANSWER ================= */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;

  calls.set(sid, {
    sid,
    from: req.body.From,
    state: "intro",
    agentText: FLOW.intro.prompt,
    userText: "",
    status: "in-progress",
    startTime: Date.now(),
    retryCount: 0,
    logged: false
  });

  const audio = await speak(FLOW.intro.prompt, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          timeout="6"
          speechTimeout="auto"/>
</Response>
`);
});

/* ================= LISTEN ================= */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  if (!call) {
    return res.type("text/xml").send("<Response><Hangup/></Response>");
  }

  const text = normalize(req.body.SpeechResult || "");
  if (text) call.userText += ` ${text}`;

  const state = FLOW[call.state];
  const nextId = state.next(text);
  const next = FLOW[nextId];

  if (!next) {
    call.retryCount++;

    if (call.retryCount >= 2) {
      call.status = "no-understanding";
      call.duration = Math.floor((Date.now() - call.startTime) / 1000);
      await logToSheet(call);
      calls.delete(sid);

      return res.type("text/xml").send(`
<Response>
  <Play>માફ કરશો, આપનો જવાબ સમજાઈ શક્યો નથી. આભાર.</Play>
  <Hangup/>
</Response>
`);
    }

    const retry = await speak("કૃપા કરીને ફરી કહેશો?", "retry.mp3");
    return res.type("text/xml").send(`
<Response>
  <Play>${retry}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          timeout="6"
          speechTimeout="auto"/>
</Response>
`);
  }

  call.agentText += ` | ${next.prompt}`;
  const audio = await speak(next.prompt, `${nextId}.mp3`);

  if (next.end) {
    call.status = "completed";
    call.duration = Math.floor((Date.now() - call.startTime) / 1000);
    await logToSheet(call);
    calls.delete(sid);

    return res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
`);
  }

  call.state = nextId;
  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          timeout="6"
          speechTimeout="auto"/>
</Response>
`);
});

/* ================= DISCONNECT FALLBACK ================= */
app.post("/call-status", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  if (call && !call.logged) {
    call.status = req.body.CallStatus || "disconnected";
    call.duration = Math.floor((Date.now() - call.startTime) / 1000);
    await logToSheet(call);
    calls.delete(sid);
  }

  res.sendStatus(200);
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (OPTION 1 FINAL)");
});
