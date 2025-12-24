/*************************************************
 * OUTBOUND VOICE AGENT – STEP 3 (ABSOLUTE FINAL)
 * Twilio + Google Speech-to-Text (MULAW FIX)
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fetch from "node-fetch";
import { SpeechClient } from "@google-cloud/speech";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const speechClient = new SpeechClient();

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio Outbound Voice Agent Running");
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
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
});

/* ======================
   ANSWER CALL
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Say>Hello. Please speak after the beep.</Say>
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
   PROCESS SPEECH
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  try {
    const recordingUrl = req.body.RecordingUrl;

    if (!recordingUrl) {
      throw new Error("No RecordingUrl");
    }

    // 🔑 Download recording WITH AUTH
    const audioResponse = await fetch(`${recordingUrl}.wav`, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64")
      }
    });

    const audioBuffer = await audioResponse.arrayBuffer();

    // 🔑 CORRECT Google STT CONFIG FOR TWILIO
    const [sttResponse] = await speechClient.recognize({
      audio: {
        content: Buffer.from(audioBuffer).toString("base64")
      },
      config: {
        encoding: "MULAW",
        sampleRateHertz: 8000,
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"]
      }
    });

    const transcript =
      sttResponse.results?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🗣 USER SAID:", transcript);

    res.send(`
<Response>
  <Say>
    Thank you. I heard you say: ${transcript || "nothing clear"}.
  </Say>
  <Hangup/>
</Response>
    `);

  } catch (err) {
    console.error("❌ STT ERROR:", err.message);

    res.send(`
<Response>
  <Say>
    Sorry, I could not understand your speech.
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
