/*************************************************
 * OUTBOUND VOICE AGENT – STEP 3 (FIXED)
 * Twilio + Google Speech-to-Text
 * Gujarati / Hindi / English
 * NO AI | NO loops | Credit safe
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fetch from "node-fetch";
import { SpeechClient } from "@google-cloud/speech";

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
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   GOOGLE STT CLIENT
====================== */
const speechClient = new SpeechClient();

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio Outbound Voice Agent Running");
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

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.BASE_URL}/twilio/answer`,
      method: "POST"
    });

    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error("❌ Call error:", err.message);
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
  <Say voice="alice">
    Hello. Please speak after the beep.
  </Say>

  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    playBeep="true"
    timeout="3"
    maxLength="6"
    finishOnKey="#"
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

  if (!recordingUrl) {
    return res.send(`
<Response>
  <Say>I did not hear anything. Goodbye.</Say>
  <Hangup/>
</Response>
    `);
  }

  try {
    /* 1️⃣ Download Twilio audio (no format assumptions) */
    const audioResponse = await fetch(recordingUrl);
    const audioBuffer = await audioResponse.arrayBuffer();

    /* 2️⃣ Google Speech-to-Text (AUTO-DETECT) */
    const [sttResponse] = await speechClient.recognize({
      audio: {
        content: Buffer.from(audioBuffer).toString("base64")
      },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"]
      }
    });

    const transcript =
      sttResponse.results?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🗣 USER SAID:", transcript);

    /* 3️⃣ Confirm speech */
    res.send(`
<Response>
  <Say>
    Thank you. I heard you say: ${transcript || "nothing clear"}.
    Speech recognition is now working.
  </Say>
  <Hangup/>
</Response>
    `);

  } catch (error) {
    console.error("❌ STT error:", error);

    res.send(`
<Response>
  <Say>
    Sorry, there was an error understanding your speech.
  </Say>
  <Hangup/>
</Response>
    `);
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
