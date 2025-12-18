import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";
import speech from "@google-cloud/speech";
import { google } from "googleapis";


const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("Exotel Voice Agent Server is running");
});

/* ======================
   ANSWER CALL (GREETING)
====================== */
app.post("/answer", (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Say language="gu-IN">
        નમસ્તે! શું તમારું કામ પૂરું થઈ ગયું છે?
      </Say>
      <Record
        action="/process-response"
        method="POST"
        maxLength="5"
        playBeep="true"
      />
    </Response>
  `);
});

/* ======================
   GOOGLE STT CLIENT
====================== */
const speechClient = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_STT_CREDENTIALS),
});

async function speechToTextFromUrl(audioUrl) {
  if (!audioUrl) {
    return { text: "", language: "gu-IN" };
  }

  const request = {
    audio: { uri: audioUrl },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 8000,
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"],
      enableAutomaticPunctuation: true,
    },
  };

  const [response] = await speechClient.recognize(request);
  const result = response.results?.[0];

  if (!result) {
    return { text: "", language: "gu-IN" };
  }

  return {
    text: result.alternatives[0].transcript,
    language: result.languageCode || "gu-IN",
  };
}

/* ======================
   GOOGLE SHEETS CONFIG
====================== */
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_STT_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth: sheetsAuth,
});

// ⬇️ ADD YOUR SHEET ID HERE
const SPREADSHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";


/* ======================
   GROQ AI BRAIN
====================== */
async function askGroq({ text, language }) {
  const systemPrompt = `
You are a polite AI voice assistant.

Language rules:
- gu-IN → Gujarati
- hi-IN → Hindi
- en-IN → English

Decision rules:
- Work completed → status = completed
- Pending / later → status = pending
- Ask for human / agent / help → status = handoff

Respond ONLY in JSON:
{
  "reply": "...",
  "status": "continue | completed | pending | handoff"
}
`;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
      }),
    }
  );

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

/* ======================
   Logging Function
====================== */
async function logCallToSheet({
  language,
  userText,
  status,
  duration,
}) {
  const timestamp = new Date().toLocaleString("en-IN");

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "A:E",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        timestamp,
        language,
        userText,
        status,
        duration,
      ]],
    },
  });
}

/* ======================
   PROCESS USER RESPONSE
====================== */
app.post("/process-response", async (req, res) => {
  res.set("Content-Type", "text/xml");

  const recordingUrl = req.body.RecordingUrl;
  const { text, language } = await speechToTextFromUrl(recordingUrl);

  const aiResult = await askGroq({
    text: text || "No response",
    language,
  });

  const reply = aiResult.reply;
  const status = aiResult.status;

   await logCallToSheet({
  language,
  userText: text,
  status,
  duration: 0 // placeholder for now
});

  if (status === "handoff") {
    res.send(`
      <Response>
        <Say language="${language}">
          ${reply}
        </Say>
        <Dial>
          <Number>917874187762</Number>
        </Dial>
      </Response>
    `);
  } else {
    res.send(`
      <Response>
        <Say language="${language}">
          ${reply}
        </Say>
      </Response>
    `);
  }
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "Missing 'to' number" });

    const url = `https://api.exotel.com/v1/Accounts/${process.env.EXOTEL_ACCOUNT_SID}/Calls/connect.json`;

    const body = new URLSearchParams({
      From: process.env.EXOTEL_EXOPHONE,
      To: to,
      CallerId: process.env.EXOTEL_EXOPHONE,
      Url: "https://exotel-voice-agent.onrender.com/answer",
    });

    const auth = Buffer.from(
      `${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`
    ).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    res.send(await response.text());
  } catch (err) {
    console.error(err);
    res.status(500).send("Call failed");
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

/* ======================
   Safe Test
====================== */
app.get("/test-log", async (req, res) => {
  await logCallToSheet({
    language: "Gujarati",
    userText: "ટેસ્ટ એન્ટ્રી",
    status: "Test",
    duration: 5,
  });
  res.send("Test log added");
});
