/*************************************************
 * GUJARATI AI VOICE AGENT – HUMANATIC + ROBUST
 * State-based | Rule-driven | Scriptless
 * SINGLE + BULK CALL ENABLED
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";
import textToSpeech from "@google-cloud/text-to-speech";
import { google } from "googleapis";

import { STATES } from "./conversation/states.js";
import { RESPONSES } from "./conversation/responses.js";
import { RULES } from "./conversation/rules.js";

dotenv.config();

/* ======================
   BASIC SETUP
====================== */
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
   SESSION MEMORY
====================== */
const sessions = new Map();

/* ======================
   AUDIO CACHE
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

async function preloadAll() {
  for (const key in RESPONSES) {
    await generateAudio(RESPONSES[key].text, `${key}.mp3`);
  }
}

/* ======================
   TIME HELPERS
====================== */
function formatIST(ts) {
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true
  });
}

/* ======================
   HELPERS
====================== */
function hasGujarati(text) {
  return /[\u0A80-\u0AFF]/.test(text);
}

function normalizeMixedGujarati(text) {
  const dict = {
    aadhar: "આધાર",
    aadhaar: "આધાર",
    card: "કાર્ડ",
    data: "ડેટા",
    entry: "એન્ટ્રી",
    update: "સુધારો",
    correction: "સુધારો",
    name: "નામ",
    address: "સરનામું",
    mobile: "મોબાઇલ",
    number: "નંબર",
    change: "ફેરફાર"
  };

  let out = text;
  for (const k in dict) {
    out = out.replace(new RegExp(`\\b${k}\\b`, "gi"), dict[k]);
  }
  return out;
}

/* ✅ CRITICAL */
function normalizePhone(phone) {
  if (!phone) return "";
  return phone.toString().replace(/\D/g, "").replace(/^91/, "");
}

// 🔹 LLM ASSIST — intent helper only (SAFE)
async function llmAssist(text) {
  try {
    const resp = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-70b-versatile",
          messages: [
            {
              role: "system",
              content:
                "You classify Gujarati user speech. Respond ONLY in JSON."
            },
            {
              role: "user",
              content: `
Text:
"${text}"

Return ONLY:
{
  "intent": "DONE | PENDING | BUSY | OTHER",
  "confidence": 0-100,
  "summary": "short Gujarati summary"
}`
            }
          ],
          temperature: 0
        })
      }
    );

    const data = await resp.json();
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { intent: "OTHER", confidence: 0, summary: text };
  }
}

/* ======================
   INTENT DETECTION
====================== */
function detectTaskStatus(text) {
  const pending = ["નથી", "બાકી", "હજુ", "પૂર્ણ નથી", "ચાલુ છે"];
  const done = ["પૂર્ણ થયું", "થઈ ગયું", "થયું છે", "મળી ગયું"];

  const p = pending.some(w => text.includes(w));
  const d = done.some(w => text.includes(w));

  if (p && !d) return { status: "PENDING", confidence: 90 };
  if (d && !p) return { status: "DONE", confidence: 90 };
  if (p && d) return { status: "UNCLEAR", confidence: 40 };
  return { status: "UNCLEAR", confidence: 30 };
}

/* ======================
   BUSY INTENT
====================== */
function isBusyIntent(text) {
  return [
    "સમય નથી",
    "હવે નથી",
    "પછી ફોન",
    "બાદમાં ફોન",
    "હવે વાત નહીં",
    "બાદમાં વાત"
  ].some(p => text.includes(p));
}

/* ======================
   BULK HELPERS
====================== */
async function updateBulkRowByPhone(phone, batchId, status, callSid = "") {
  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Bulk_Calls!A:D"
  });

  const rows = sheet.data.values || [];
  const cleanPhone = normalizePhone(phone);

  for (let i = 1; i < rows.length; i++) {
    if (
      normalizePhone(rows[i][0]) === cleanPhone &&
      rows[i][1] === batchId
    ) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Bulk_Calls!C${i + 1}:D${i + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[status, callSid || rows[i][3] || ""]]
        }
      });
      return true;
    }
  }
  return false;
}

async function updateBulkByCallSid(callSid, status) {
  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Bulk_Calls!A:D"
  });

  const rows = sheet.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][3] === callSid) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Bulk_Calls!C${i + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[status]] }
      });
      return true;
    }
  }
  return false;
}

/* ======================
   GOOGLE SHEET LOG (ASYNC)
====================== */
async function logToSheet(s) {
  const duration = s.endTime
    ? Math.floor((s.endTime - s.startTime) / 1000)
    : 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Call_Logs!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        formatIST(s.startTime),
        formatIST(s.endTime),
        s.sid,
        s.userPhone,
        s.agentTexts.join(" | "),
        s.userTexts.join(" | "),
        s.result,
        duration,
        s.confidenceScore ?? 0,
        s.callbackTime ?? ""
      ]]
    }
  });
}

/* ======================
   SINGLE CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  const call = await twilioClient.calls.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER,
    url: `${BASE_URL}/answer`,
    statusCallback: `${BASE_URL}/call-status`,
    statusCallbackEvent: ["completed"],
    method: "POST"
  });

  sessions.set(call.sid, {
    sid: call.sid,
    userPhone: to,
    startTime: Date.now(),
    endTime: null,
    callbackTime: null,
    state: STATES.INTRO,
    agentTexts: [],
    userTexts: [],
    userBuffer: [],
    unclearCount: 0,
    confidenceScore: 0,
    result: ""
  });

  res.json({ status: "calling" });
});

/* ======================
   BULK CALL
====================== */
app.post("/bulk-call", async (req, res) => {
  const { phones = [], batchId } = req.body;

  phones.forEach((phone, index) => {
    setTimeout(async () => {
      try {
        const call = await twilioClient.calls.create({
          to: phone,
          from: process.env.TWILIO_FROM_NUMBER,
          url: `${BASE_URL}/answer`,
          statusCallback: `${BASE_URL}/call-status`,
          statusCallbackEvent: ["completed"],
          method: "POST"
        });

        await updateBulkRowByPhone(phone, batchId, "Calling", call.sid);

        sessions.set(call.sid, {
          sid: call.sid,
          userPhone: phone,
          batchId,
          startTime: Date.now(),
          endTime: null,
          callbackTime: null,
          state: STATES.INTRO,
          agentTexts: [],
          userTexts: [],
          userBuffer: [],
          unclearCount: 0,
          confidenceScore: 0,
          result: ""
        });
      } catch (e) {
        console.error("Bulk call failed:", phone, e.message);
        await updateBulkRowByPhone(phone, batchId, "Failed");
      }
    }, index * 1500);
  });

  res.json({ status: "bulk calling started", total: phones.length });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  s.agentTexts.push(RESPONSES[STATES.INTRO].text);

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${STATES.INTRO}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   LISTEN (IVR + LLM HYBRID – FINAL STABLE)
====================== */
app.post("/listen", async (req, res) => {
  const s = sessions.get(req.body.CallSid);
  const raw = (req.body.SpeechResult || "").trim();

  /* ---------- No speech detected ---------- */
  if (!raw) {
    const next = RULES.nextOnUnclear(++s.unclearCount);
    s.agentTexts.push(RESPONSES[next].text);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
  }

  /* ---------- Normalize Gujarati ---------- */
  if (hasGujarati(raw)) {
    s.userBuffer.push(normalizeMixedGujarati(raw));
  }

  let next; // IMPORTANT: declared once

  /* ---------- FLOW LOGIC ---------- */
  if (s.state === STATES.INTRO) {
    next = isBusyIntent(raw) ? STATES.CALLBACK_TIME : STATES.TASK_CHECK;

  } else if (s.state === STATES.CALLBACK_TIME) {
    s.callbackTime = raw;
    next = STATES.CALLBACK_CONFIRM;

  } else {
    /* ---------- IVR detection ---------- */
    let { status, confidence } = detectTaskStatus(raw);
    s.confidenceScore = confidence;

    /* ---------- LLM fallback ONLY if IVR unsure ---------- */
    if (confidence < 50) {
      const llm = await llmAssist(raw);

      if (llm.summary) {
        s.userTexts.push(llm.summary);
      }

      if (llm.intent === "DONE") {
        status = "DONE";
        s.confidenceScore = llm.confidence || 70;

      } else if (llm.intent === "PENDING") {
        status = "PENDING";
        s.confidenceScore = llm.confidence || 70;

      } else if (llm.intent === "BUSY") {
        next = STATES.CALLBACK_TIME;
      }
    }

    /* ---------- Decide next ONLY if not already set ---------- */
    if (!next) {
      next =
        status === "DONE"
          ? STATES.TASK_DONE
          : status === "PENDING"
          ? STATES.TASK_PENDING
          : RULES.nextOnUnclear(++s.unclearCount);
    }
  }

  /* ---------- Flush user buffer ---------- */
  if (s.userBuffer.length) {
    s.userTexts.push(s.userBuffer.join(" "));
    s.userBuffer = [];
  }

  s.agentTexts.push(RESPONSES[next].text);

  /* ---------- END STATE ---------- */
  if (RESPONSES[next].end) {
    s.result = next;
    s.endTime = Date.now();

    await logToSheet(s);

    if (s.batchId) {
      await updateBulkRowByPhone(
        s.userPhone,
        s.batchId,
        "Completed",
        s.sid
      );
    }

    sessions.delete(s.sid);

    return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Hangup/>
</Response>
`);
  }

  /* ---------- Continue conversation ---------- */
  s.state = next;
  return res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${next}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="12" speechTimeout="1"
    action="${BASE_URL}/listen"/>
</Response>
`);
});


/* ======================
   CALL STATUS
====================== */
app.post("/call-status", async (req, res) => {
  const s = sessions.get(req.body.CallSid);

  if (s) {
    if (!s.result) {
      s.result = "abandoned";
      s.endTime = Date.now();
      await logToSheet(s);
    }

    if (s.batchId) {
      await updateBulkByCallSid(req.body.CallSid, "Completed");
    }

    sessions.delete(s.sid);
  }

  res.sendStatus(200);
});

/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – SINGLE + BULK, FULLY STABLE");
});
