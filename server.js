/*************************************************
 * TWO-WAY AI VOICE AGENT (HUMAN-LIKE)
 * AI speaks first → User replies → AI responds
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
const FALLBACK_GU =
  "માફ કરશો, હાલમાં પૂરતી માહિતી નથી. અમે તમને પછી ફરી કોલ કરીશું.";

/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
  res.send("✅ Two-way AI Voice Agent Running");
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
   STEP 1: AI SPEAKS FIRST
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Say language="gu-IN">
    નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
    આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી.
    શું હું આપનો થોડો સમય લઈ શકું?
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
   STEP 2: USER SPEAKS → AI UNDERSTANDS → AI REPLIES
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  try {
    const recordingUrl = req.body.RecordingUrl;
    if (!recordingUrl) return endCall(res, FALLBACK_GU);

    /* Download audio */
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

    /* Google STT */
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

    if (!transcript) return endCall(res, FALLBACK_GU);

    /* Groq – intent understanding */
    let intent = "OUT_OF_SCOPE";
    let lang = "gu";

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
Gujarati phrases like "હજી ઘરે નથી પહોંચ્યો" or "કાલે વાત કરીએ"
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
      if (groqJson?.choices?.length) {
        const parsed = JSON.parse(groqJson.choices[0].message.content);
        intent = parsed.intent || intent;
        lang = parsed.language || lang;
      }
    } catch {
      console.log("⚠️ Groq skipped");
    }

    /* AI reply (your flow) */
    let reply = FALLBACK_GU;

    if (intent === "CALLBACK") {
      reply =
        lang === "gu"
          ? "બરાબર, અમે કાલે ફરી સંપર્ક કરીશું."
          : lang === "hi"
          ? "ठीक है, हम कल फिर संपर्क करेंगे।"
          : "Okay, we will call you again later.";
    }

    if (intent === "STATUS_DONE") {
      reply =
        lang === "gu"
          ? "બરાબર, આપનું કામ પૂર્ણ થયાનું નોંધાયું છે."
          : lang === "hi"
          ? "ठीक है, काम पूरा हो चुका है।"
          : "Your work is marked as completed.";
    }

    if (intent === "STATUS_NOT_DONE") {
      reply =
        lang === "gu"
          ? "સમજાયું, કામ હજી બાકી છે."
          : lang === "hi"
          ? "समझ गया, काम अभी बाकी है।"
          : "Understood, the work is still pending.";
    }

    if (intent === "NOT_INTERESTED") {
      reply =
        lang === "gu"
          ? "બરાબર, અમે ફરી સંપર્ક નહીં કરીએ."
          : lang === "hi"
          ? "ठीक है, हम दोबारा संपर्क नहीं करेंगे।"
          : "Alright, we won’t contact you again.";
    }

    endCall(res, reply);

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    endCall(res, FALLBACK_GU);
  }
});

/* ======================
   END CALL
====================== */
function endCall(res, message) {
  res.send(`
<Response>
  <Say language="gu-IN">${message}</Say>
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
