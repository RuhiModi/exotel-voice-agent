/*************************************************
 * GUJARATI AI VOICE AGENT – HUMANATIC + ROBUST
 * State-based | Rule-driven | Scriptless
 * SINGLE + BULK CALL ENABLED
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
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
app.use(cors());
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

/* ➕ NEW – DO NOT REMOVE EXISTING HELPERS */
function normalizeUserText(text) {
  if (!text) return "";
  let out = text.toLowerCase();
  out = normalizeMixedGujarati(out);
  out = out.replace(/\b(umm|uh|hmm|ok|okay)\b/gi, "");
  return out.trim();
}

/* ✅ CRITICAL */
function normalizePhone(phone) {
  if (!phone) return "";
  return phone.toString().replace(/\D/g, "").replace(/^91/, "");
}

/* ======================
   INTENT DETECTION
====================== */
function detectTaskStatus(text) {
  const pending = ["નથી", "બાકી", "હજુ", "પૂર્ણ નથી", "ચાલુ છે", "pending"];
  const done = ["પૂર્ણ થયું", "થઈ ગયું", "થયું છે", "મળી ગયું", "done"];

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
  if (!text) return false;

  const busySignals = [
    "સમય",
    "નથી",
    "પછી",
    "બાદમાં",
    "હવે નહીં",
    "હવે નથી",
    "પછી વાત",
    "later",
    "busy",
    "not now"
  ];

  let score = 0;
  for (const w of busySignals) {
    if (text.includes(w)) score++;
  }

  return score >= 2; // 🔑 at least 2 signals = BUSY
}
 /* ======================
     FINAL USER TEXT FLUSH (DEDUP SAFE)
  ====================== */
async function groqClassify(text) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "Classify the user's intent."
        },
        {
          role: "user",
          content: `User said: "${text}"
Choose one: DONE, PENDING, BUSY, UNKNOWN`
        }
      ]
    })
  });

  const data = await response.json();
  return data.choices[0].message.content.trim().toUpperCase();
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
   GOOGLE SHEET LOG
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
        //s.rawUserSpeech.join(" | "),
        s.result,
        duration,
        s.confidenceScore ?? 0,
        s.callbackTime ?? "",
        s.conversationFlow.join("\n") 
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
    //rawUserSpeech: [],
    liveBuffer: "",
    unclearCount: 0,
    confidenceScore: 0,
    hasLogged: false,
    conversationFlow: [], 
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
         // rawUserSpeech: [],
          liveBuffer: "",
          unclearCount: 0,
          confidenceScore: 0,
          conversationFlow: [],
          hasLogged: false,  
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
  s.conversationFlow.push(`AI: ${RESPONSES[STATES.INTRO].text}`); 

  res.type("text/xml").send(`
<Response>
  <Play>${BASE_URL}/audio/${STATES.INTRO}.mp3</Play>
  <Gather input="speech" language="gu-IN"
    timeout="15" speechTimeout="auto"
    partialResultCallback="${BASE_URL}/partial"
    action="${BASE_URL}/listen"/>
</Response>
`);
});

/* ======================
   PARTIAL BUFFER
====================== */
app.post("/partial", (req, res) => {
  const s = sessions.get(req.body.CallSid);
  if (!s) return res.sendStatus(200);

  const partial = (req.body.UnstableSpeechResult || "").trim();
  if (partial) {
  s.lastPartialAt = Date.now(); // just a signal, not text
  }


  res.sendStatus(200);
});

/* ======================
   LISTEN (FINAL, STABLE)
====================== */
app.post("/listen", async (req, res) => {
  const s = sessions.get(req.body.CallSid);

  const raw = normalizeUserText(req.body.SpeechResult || "");

  s.liveBuffer = "";
 // s.rawUserSpeech.push(raw);

  /* ======================
     🔑 PRIORITY 1: BUSY INTENT (ABSOLUTE)
  ====================== */
  
   if (s.state === STATES.INTRO && isBusyIntent(raw)) {
      // ✅ Store busy sentence in user_text (since we return early)
   const lastUser = s.userTexts[s.userTexts.length - 1];
   if (raw && raw !== lastUser) {
   s.userTexts.push(raw);
   }

          // 🔑 LOG USER BEFORE EARLY RETURN
    s.conversationFlow.push(`User: ${raw}`);
      
    const next = STATES.CALLBACK_TIME;

    s.state = next;          // 🔒 lock state
    s.unclearCount = 0;
    s.userBuffer = [];
    s.agentTexts.push(RESPONSES[next].text);
    s.conversationFlow.push(`AI: ${RESPONSES[next].text}`);

    return res.type("text/xml").send(
      `<Response>
        <Play>${BASE_URL}/audio/${next}.mp3</Play>
        <Gather input="speech"
          language="gu-IN"
          timeout="15"
          speechTimeout="auto"
          partialResultCallback="${BASE_URL}/partial"
          action="${BASE_URL}/listen"/>
      </Response>`
    );
  }

  /* ======================
     🔑 PRIORITY 2: INVALID / VERY SHORT INPUT
  ====================== */
  if (!raw || raw.length < 3) {
    const next = RULES.nextOnUnclear(++s.unclearCount);
    s.agentTexts.push(RESPONSES[next].text);

    return res.type("text/xml").send(
      `<Response>
        <Play>${BASE_URL}/audio/${next}.mp3</Play>
        <Gather input="speech"
          language="gu-IN"
          timeout="15"
          speechTimeout="auto"
          partialResultCallback="${BASE_URL}/partial"
          action="${BASE_URL}/listen"/>
      </Response>`
    );
  }

  // ✅ Log final user utterance ONCE (conversation transcript) 
  s.conversationFlow.push(`User: ${raw}`);
   
  /* ======================
     NORMAL USER INPUT STORAGE
  ====================== */
  s.userBuffer.push(raw);

  /* ======================
     STATE TRANSITION LOGIC
  ====================== */
  let next;

  if (s.state === STATES.INTRO) {
    next = STATES.TASK_CHECK;

  } else if (s.state === STATES.CALLBACK_TIME) {
    s.callbackTime = raw;
    next = STATES.CALLBACK_CONFIRM;

  } else if (s.state === STATES.TASK_PENDING) {
    next = STATES.PROBLEM_RECORDED;

  } else {
  const { status, confidence } = detectTaskStatus(raw);
  s.confidenceScore = confidence;

  if (status === "DONE") {
    next = STATES.TASK_DONE;

  } else if (status === "PENDING") {
    next = STATES.TASK_PENDING;

  } else {
    // unclear case
    s.unclearCount++;

    if (s.unclearCount === 1) {
      next = STATES.RETRY_TASK_CHECK;

    } else if (s.unclearCount === 2) {
      next = STATES.CONFIRM_TASK;

    } else {
      next = STATES.ESCALATE;
    }
  }
}


  /* ======================
     FINAL USER TEXT FLUSH (DEDUP SAFE)
  ====================== */
  if (s.userBuffer.length) {
    const combined = s.userBuffer.join(" ");
    const last = s.userTexts[s.userTexts.length - 1];

    if (combined && combined !== last) {
      s.userTexts.push(combined);
    }
    s.userBuffer = [];
  }

  s.agentTexts.push(RESPONSES[next].text);

  /* ======================
     END STATE
  ====================== */
  if (RESPONSES[next].end) {
    s.result = next;
    s.endTime = Date.now();

    await logToSheet(s);
    s.hasLogged = true;

    if (s.batchId) {
      await updateBulkRowByPhone(
        s.userPhone,
        s.batchId,
        "Completed",
        s.sid
      );
    }

    sessions.delete(s.sid);

    return res.type("text/xml").send(
      `<Response>
        <Play>${BASE_URL}/audio/${next}.mp3</Play>
        <Hangup/>
      </Response>`
    );
  }

  /* ======================
     CONTINUE CONVERSATION
  ====================== */
  s.state = next;
  return res.type("text/xml").send(
    `<Response>
      <Play>${BASE_URL}/audio/${next}.mp3</Play>
      <Gather input="speech"
        language="gu-IN"
        timeout="15"
        speechTimeout="auto"
        partialResultCallback="${BASE_URL}/partial"
        action="${BASE_URL}/listen"/>
    </Response>`
  );
});


/* ======================
   CALL STATUS
====================== */
app.post("/call-status", async (req, res) => {
  const s = sessions.get(req.body.CallSid);

  if (s && !s.hasLogged) {
    s.result = s.result || "abandoned";
    s.endTime = Date.now();
    await logToSheet(s);
    s.hasLogged = true;
  }

  if (s && s.batchId) {
    await updateBulkByCallSid(req.body.CallSid, "Completed");
  }

  if (s) {
    sessions.delete(s.sid);
  }

  res.sendStatus(200);
});


/* ======================
   START CAMPAIGN (UI TRIGGER)
====================== */
app.post("/start-campaign", async (req, res) => {
  try {
    // 1️⃣ Read phone numbers from Google Sheet
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Bulk_Calls!A:C"
    });

    const rows = sheet.data.values || [];
    const phones = [];

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]) phones.push(rows[i][0]);
    }

    if (!phones.length) {
      return res.json({ success: false, message: "No phone numbers found" });
    }

    // 2️⃣ Generate Batch ID
    const batchId = "BATCH_" + Date.now();

    // 3️⃣ Call your EXISTING bulk-call route
    await fetch(`${process.env.BASE_URL}/bulk-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phones, batchId })
    });

    // 4️⃣ Respond to frontend
    return res.json({ success: true, batchId });

  } catch (err) {
    console.error("Start campaign failed:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================
   PREVIEW BULK NUMBERS (UI)
====================== */
app.get("/preview-bulk", async (req, res) => {
  try {
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Bulk_Calls!A:C"
    });

    const rows = sheet.data.values || [];
    const numbers = [];

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]) {
        numbers.push({
          phone: rows[i][0],
          status: rows[i][2] || "Pending"
        });
      }
    }

    res.json({
      total: numbers.length,
      preview: numbers.slice(0, 5)
    });

  } catch (e) {
    res.status(500).json({ error: "Failed to load preview" });
  }
});


/* ======================
   START
====================== */
app.listen(PORT, async () => {
  await preloadAll();
  console.log("✅ Gujarati AI Voice Agent – SINGLE + BULK, FULLY STABLE");
});
