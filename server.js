/*************************************************
 * GOOGLE TTS + TWILIO PLAY (RENDER SAFE)
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
   PATHS
====================== */
const AUDIO_DIR = path.join(__dirname, "audio");
const AUDIO_FILE = path.join(AUDIO_DIR, "intro-gu.mp3");

/* ======================
   ENSURE AUDIO DIR
====================== */
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR);
  console.log("📁 audio/ directory created");
}

/* ======================
   STATIC FILE SERVING
====================== */
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   CLIENTS
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const ttsClient = new textToSpeech.TextToSpeechClient();

/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
  res.send("✅ Voice server running");
});

/* ======================
   DEBUG: CHECK AUDIO EXISTS
====================== */
app.get("/debug/audio", (req, res) => {
  if (fs.existsSync(AUDIO_FILE)) {
    return res.send("✅ Audio file exists");
  }
  res.status(404).send("❌ Audio file missing");
});

/* ======================
   GENERATE AUDIO (MANUAL)
====================== */
app.get("/generate-audio", async (req, res) => {
  try {
    const text = `
નમસ્તે.
હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
આ કૉલનો હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી.
શું હું આપનો થોડો સમય લઈ શકું?
    `;

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "gu-IN",
        name: "gu-IN-Standard-A"
      },
      audioConfig: {
        audioEncoding: "MP3"
      }
    });

    fs.writeFileSync(AUDIO_FILE, response.audioContent, "binary");
    console.log("🔊 Gujarati audio generated");

    res.send("✅ Audio generated");
  } catch (err) {
    console.error("❌ TTS ERROR:", err.message);
    res.status(500).send(err.message);
  }
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

  res.json({ success: true, sid: call.sid });
});

/* ======================
   TWILIO ANSWER
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Play>${process.env.BASE_URL}/audio/intro-gu.mp3</Play>
  <Pause length="1"/>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server started");
});
