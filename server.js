/*************************************************
 * GOOGLE TTS VOICE TEST – GUARANTEED SPEECH
 * AI speaks first in Gujarati using <Play>
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import textToSpeech from "@google-cloud/text-to-speech";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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
   GOOGLE TTS CLIENT
====================== */
const ttsClient = new textToSpeech.TextToSpeechClient();

/* ======================
   AUDIO DIR (PUBLIC)
====================== */
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Google TTS Gujarati Voice Agent Running");
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
   AI SPEAKS FIRST (GUJARATI)
====================== */
app.post("/twilio/answer", async (req, res) => {
  res.type("text/xml");

  const gujaratiText = `
નમસ્તે.
હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
આ કૉલનો હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી.
શું હું આપનો થોડો સમય લઈ શકું?
  `;

  const audioPath = path.join(AUDIO_DIR, "intro-gu.mp3");

  // Generate Gujarati voice using Google TTS
  const [ttsResponse] = await ttsClient.synthesizeSpeech({
    input: { text: gujaratiText },
    voice: {
      languageCode: "gu-IN",
      name: "gu-IN-Standard-A"
    },
    audioConfig: {
      audioEncoding: "MP3"
    }
  });

  fs.writeFileSync(audioPath, ttsResponse.audioContent, "binary");

  // Play audio to caller
  res.send(`
<Response>
  <Play>${process.env.BASE_URL}/audio/intro-gu.mp3</Play>
  <Pause length="1"/>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running – Google TTS active");
});
