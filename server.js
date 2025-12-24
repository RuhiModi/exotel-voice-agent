/*************************************************
 * AI VOICE AGENT – FINAL STABLE (NO CRASH)
 * AI speaks first | No beep | Gujarati-first
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
   CONSTANTS
====================== */
const GUJARATI_FALLBACK =
  "માફ કરશો, હાલમાં પૂરતી માહિતી નથી. અમે તમને પછી ફરી કોલ કરીશું.";

/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
  res.send("✅ AI Voice Agent Running (Stable)");
});

/* ======================
   OUTBOUND CALL
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
   AI SPEAKS FIRST
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Say>
    નમસ્તે. હું આપની સાથે થોડી માહિતી માટે વાત કરી રહ્યો છું.
  </Say>
  <Pause length="1"/>
  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    timeout="5"
    maxLength="15"
    recordingChannels="mono"
    trim="trim-silence"
  />
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  try {
    /* 1️⃣ Recording */
    const recordingUrl = req.body.RecordingUrl;
    if (!recordingUrl) {
      return endWithFallback(res);
    }

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

    /* 2️⃣ Google STT */
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
      return endWithFallback(res);
    }

    /* 3️⃣ TRY GROQ (SAFE) */
    let intent = "OUT_OF_SCOPE";
    let language = "gu";

    try {
      const groqResp = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-70b-versatile",
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content: `
You understand Gujarati, Hindi, English.
Gujarati phrases like:
"હજી ઘરે નથી પહોંચ્યો", "કાલે વાત કરીએ"
mean CALLBACK.
Return ONLY JSON.
`
              },
              {
                role: "user",
                content: `
User said: "${transcript}"

Return:
{
  "intent": "CALLBACK | STATUS_DONE | STATUS_NOT_DONE | NOT_INTERESTED | OUT_OF_SCOPE",
  "language": "gu | hi | en"
}
`
              }
            ]
          })
        }
      );

      const groqJson = await groqResp.json();

      if (
        groqJson &&
        groqJson.choices &&
        groqJson.choices.length > 0
      ) {
        const parsed = JSON.parse(
          groqJson.choices[0].message.content
        );
        intent = parsed.intent || intent;
        language = parsed.language || language;
      }
    } catch (e) {
      console.log("⚠️ Groq skipped, using fallback logic");
    }

    /* 4️⃣ HUMAN-LIKE RESPONSE (SCRIPTED) */
    let reply = GUJARATI_FALLBACK;

    if (intent === "CALLBACK") {
      reply =
        language === "gu"
          ? "બરાબર, અમે કાલે ફરી સંપર્ક કરીશું."
          : language === "hi"
          ? "ठीक है, हम कल फिर संपर्क करेंगे।"
          : "Okay, we will call you again later.";
    }

    if (intent === "STATUS_DONE") {
      reply =
        language === "gu"
          ? "બરાબર, કામ પૂર્ણ થયાનું નોંધાયું છે."
          : language === "hi"
          ? "ठीक है, काम पूरा होने की जानकारी मिल गई है।"
          : "Your work is marked as completed.";
    }

    if (intent === "STATUS_NOT_DONE") {
      reply =
        language === "gu"
          ? "સમજાયું, કામ હજી બાકી છે."
          : language === "hi"
          ? "समझ गया, काम अभी बाकी है।"
          : "Understood, the work is still pending.";
    }

    if (intent === "NOT_INTERESTED") {
      reply =
        language === "gu"
          ? "બરાબર, અમે ફરી સંપર્ક નહીં કરીએ."
          : language === "hi"
          ? "ठीक है, हम दोबारा संपर्क नहीं करेंगे।"
          : "Alright, we won’t contact you again.";
    }

    res.send(`
<Response>
  <Say>${reply}</Say>
  <Hangup/>
</Response>
    `);

  } catch (err) {
    console.error("❌ SYSTEM ERROR:", err.message);
    endWithFallback(res);
  }
});

/* ======================
   FALLBACK END
====================== */
function endWithFallback(res) {
  res.send(`
<Response>
  <Say>${GUJARATI_FALLBACK}</Say>
  <Hangup/>
</Response>
  `);
}

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
