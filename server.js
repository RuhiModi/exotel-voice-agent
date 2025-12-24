/*************************************************
 * OUTBOUND VOICE AGENT – STT FINAL (HEADER SAFE)
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
  if (!to) return res.status(400).json({ error: "Missing 'to'" });

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
  <Say>Hello. Please speak clearly after the beep.</Say>
  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    playBeep="true"
    timeout="4"
    maxLength="10"
    recordingChannels="mono"
    trim="trim-silence"
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
    if (!recordingUrl) throw new Error("No recording");

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

    // ✅ DO NOT SET encoding or sampleRate
    const [sttResponse] = await speechClient.recognize({
      audio: {
        content: Buffer.from(audioBuffer).toString("base64")
      },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"],
        enableAutomaticPunctuation: true
      }
    });

    const transcript =
      sttResponse.results?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🗣 USER SAID:", transcript);

    if (!transcript) {
      return res.send(`
<Response>
  <Say>Sorry, I could not understand your speech.</Say>
  <Hangup/>
</Response>
      `);
    }

    res.send(`
<Response>
  <Say>
    Thank you. I heard you say: ${transcript}.
  </Say>
  <Hangup/>
</Response>
    `);

  } catch (err) {
    console.error("❌ STT ERROR:", err.message);

    res.send(`
<Response>
  <Say>Sorry, there was a system error.</Say>
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
