/*************************************************
 * AI VOICE AGENT – OUTBOUND ONLY (SAFE VERSION)
 * Twilio + Google STT (Gujarati/Hindi)
 * Rule-based decision logic (NO LLM)
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fs from "fs";
import fetch from "node-fetch";
import { SpeechClient } from "@google-cloud/speech";
import { google } from "googleapis";

dotenv.config();
const app = express();

/* ======================
   MIDDLEWARE
====================== */
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   TWILIO CLIENT
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   GOOGLE STT CLIENT
====================== */
const speechClient = new SpeechClient();

/* ======================
   GOOGLE SHEET
====================== */
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Outbound AI Voice Agent running");
});

/* ======================
   OUTBOUND CALL TRIGGER
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Missing 'to' number" });
    }

    const call = await twilioClient.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.BASE_URL}/twilio/answer`,
      method: "POST",
    });

    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   CALL ANSWER (TWIML)
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Say voice="alice" language="hi-IN">
    नमस्ते, मैं हरियाणा सरकार की डिजिटल सेवा से बोल रहा हूँ।
    कृपया बीप के बाद जवाब दें।
  </Say>
  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    playBeep="true"
    timeout="6"
  />
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  const recordingUrl = req.body.RecordingUrl;
  const from = req.body.From || "Unknown";

  if (!recordingUrl) {
    return res.send(`
<Response>
  <Say>मुझे आपकी आवाज़ सुनाई नहीं दी। धन्यवाद।</Say>
  <Hangup/>
</Response>
    `);
  }

  // Download audio
  const audioResponse = await fetch(`${recordingUrl}.wav`);
  const audioBuffer = await audioResponse.arrayBuffer();

  // Google STT
  const [sttResponse] = await speechClient.recognize({
    audio: { content: Buffer.from(audioBuffer).toString("base64") },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 8000,
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"],
    },
  });

  const userText =
    sttResponse.results?.[0]?.alternatives?.[0]?.transcript || "";

  /* ======================
     DECISION LOGIC (NO AI)
  ====================== */
  let reply = "";
  let status = "";

  if (userText.includes("હા") || userText.includes("yes")) {
    reply = "આભાર. આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે.";
    status = "Completed";
  } else if (userText.includes("બાકી")) {
    reply =
      "સમજી લીધું. હવે તમને માનવી એજન્ટ સાથે જોડવામાં આવે છે.";
    status = "Transferred";
  } else if (
    userText.includes("ના") ||
    userText.includes("સમય નથી")
  ) {
    reply = "કોઈ વાત નથી. અમે પછી સંપર્ક કરીશું.";
    status = "Not Available";
  } else {
    reply =
      "માફ કરશો, હું સમજી શક્યો નહીં. હવે માનવી એજન્ટ જોડાય છે.";
    status = "Fallback";
  }

  // Save to Google Sheet
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Sheet1!A:D",
    valueInputOption: "RAW",
    requestBody: {
      values: [[from, status, userText, new Date().toISOString()]],
    },
  });

  // Transfer or end
  if (status === "Transferred" || status === "Fallback") {
    return res.send(`
<Response>
  <Say>${reply}</Say>
  <Dial>${process.env.HUMAN_AGENT_NUMBER}</Dial>
</Response>
    `);
  }

  res.send(`
<Response>
  <Say>${reply}</Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Outbound AI Voice Agent live");
});
