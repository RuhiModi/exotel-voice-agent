/*************************************************
 * HYBRID AI VOICE AGENT (OUTBOUND)
 * Twilio + Google STT + Groq (Intent Only)
 * Human-like | Safe | Trial-friendly
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

/* ======================
   CLIENTS
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const speechClient = new SpeechClient();

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Hybrid AI Voice Agent Running");
});

/* ======================
   OUTBOUND CALL TRIGGER
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Missing 'to'" });

  const call = await twilioClient.calls.create({
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
    timeout="4"
    maxLength="12"
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
    /* 1️⃣ Download recording (AUTH REQUIRED) */
    const recordingUrl = req.body.RecordingUrl;
    if (!recordingUrl) throw new Error("No recording");

    const audioResp = await fetch(`${recordingUrl}.wav`, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64")
      }
    });

    const audioBuffer = await audioResp.arrayBuffer();

    /* 2️⃣ Google STT (AUTO from WAV header) */
    const [stt] = await speechClient.recognize({
      audio: { content: Buffer.from(audioBuffer).toString("base64") },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"],
        enableAutomaticPunctuation: true
      }
    });

    const transcript =
      stt.results?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🗣 USER SAID:", transcript);

    if (!transcript) {
      return res.send(`
<Response>
  <Say>Sorry, I could not understand. I will connect you to a human.</Say>
  <Dial>${process.env.HUMAN_AGENT_NUMBER}</Dial>
</Response>
      `);
    }

    /* 3️⃣ Groq — INTENT UNDERSTANDING ONLY */
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an intent extractor. Return ONLY valid JSON."
          },
          {
            role: "user",
            content: `
User said: "${transcript}"

Return JSON only:
{
  "intent": "STATUS_DONE | STATUS_NOT_DONE | CALLBACK | NOT_INTERESTED | OUT_OF_SCOPE",
  "confidence": number (0 to 1),
  "language": "gu | hi | en",
  "summary": "short meaning"
}`
          }
        ]
      })
    });

    const groqJson = await groqResp.json();
    const parsed = JSON.parse(
      groqJson.choices[0].message.content
    );

    console.log("🧠 GROQ:", parsed);

    /* 4️⃣ DECISION ENGINE (YOU CONTROL) */
    if (parsed.confidence < 0.7 || parsed.intent === "OUT_OF_SCOPE") {
      return res.send(`
<Response>
  <Say>I am connecting you to a human for better help.</Say>
  <Dial>${process.env.HUMAN_AGENT_NUMBER}</Dial>
</Response>
      `);
    }

    let reply = "Thank you.";

    if (parsed.intent === "STATUS_DONE") {
      reply =
        parsed.language === "gu"
          ? "બરાબર, કામ પૂર્ણ થયાનું નોંધાયું છે."
          : parsed.language === "hi"
          ? "ठीक है, काम पूरा होने की जानकारी मिल गई है।"
          : "Okay, your work is marked as completed.";
    }

    if (parsed.intent === "STATUS_NOT_DONE") {
      reply =
        parsed.language === "gu"
          ? "સમજાયું, કામ હજી બાકી છે."
          : parsed.language === "hi"
          ? "समझ गया, काम अभी बाकी है।"
          : "Understood, the work is still pending.";
    }

    if (parsed.intent === "CALLBACK") {
      reply =
        parsed.language === "gu"
          ? "બરાબર, અમે પછી સંપર્ક કરીશું."
          : parsed.language === "hi"
          ? "ठीक है, हम बाद में कॉल करेंगे।"
          : "Okay, we will call you later.";
    }

    if (parsed.intent === "NOT_INTERESTED") {
      reply =
        parsed.language === "gu"
          ? "બરાબર, અમે ફરી સંપર્ક નહીં કરીએ."
          : parsed.language === "hi"
          ? "ठीक है, हम दोबारा संपर्क नहीं करेंगे।"
          : "Alright, we won’t contact you again.";
    }

    /* 5️⃣ SPEAK & END */
    res.send(`
<Response>
  <Say>${reply}</Say>
  <Hangup/>
</Response>
    `);

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.send(`
<Response>
  <Say>Sorry, I am transferring you to a human.</Say>
  <Dial>${process.env.HUMAN_AGENT_NUMBER}</Dial>
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
