/*************************************************
 * GUJARATI AI VOICE AGENT — FINAL STABLE VERSION
 * ✔ Disconnect-safe
 * ✔ Silent-user safe
 * ✔ Google Sheet logging (always)
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ======================
   GOOGLE SHEETS
====================== */
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

async function logToSheet(call) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Call_Logs!A:H",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          new Date().toISOString(),
          call.sid,
          call.from || "",
          "gu-IN",
          call.agentText || "",
          call.userText || "",
          call.status || "unknown",
          call.duration || ""
        ]]
      }
    });
  } catch (err) {
    console.error("Sheet log failed:", err.message);
  }
}

/* ======================
   AUDIO / TTS
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

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
   CALL STATE STORE
====================== */
const calls = new Map();

/* ======================
   FLOW
====================== */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (t) => /હા|ચાલે/.test(t) ? "task_check" : null
  },
  task_check: {
    prompt: "યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) => /પૂર્ણ/.test(t) ? "done" : /નથી/.test(t) ? "pending" : null
  },
  done: {
    prompt: "આભાર. આપનો પ્રતિસાદ નોંધાયો છે.",
    end: true
  },
  pending: {
    prompt: "આભાર. આપની ફરિયાદ નોંધવામાં આવી છે.",
    end: true
  }
};

/* ======================
   ANSWER
====================== */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;
  calls.set(sid, {
    sid,
    from: req.body.From,
    state: "intro",
    agentText: FLOW.intro.prompt,
    userText: "",
    status: "in-progress"
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
  <Redirect>${BASE_URL}/listen</Redirect>
</Response>
`);
});

/* ======================
   LISTEN
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);
  if (!call) return res.type("text/xml").send("<Response><Hangup/></Response>");

  const text = (req.body.SpeechResult || "").trim();
  call.userText += text ? ` ${text}` : "";

  if (!text) {
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

  const state = FLOW[call.state];
  const nextKey = state.next(text);
  const next = FLOW[nextKey];

  if (!next) {
    const retry = await speak("થોડું વધુ સ્પષ્ટ કહેશો?", "clarify.mp3");
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

  call.agentText += ` ${next.prompt}`;
  call.state = nextKey;

  const audio = await speak(next.prompt, `${nextKey}.mp3`);

  if (next.end) {
    call.status = "completed";
    await logToSheet(call);
    calls.delete(sid);
    return res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
`);
  }

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

/* ======================
   STATUS CALLBACK (DISCONNECT LOGGING)
====================== */
app.post("/call-status", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid) || {
    sid,
    from: req.body.From,
    agentText: "",
    userText: ""
  };

  call.status = req.body.CallStatus;
  call.duration = req.body.CallDuration || "";

  await logToSheet(call);
  calls.delete(sid);

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL STABLE)");
});
