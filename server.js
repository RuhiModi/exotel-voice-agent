/*************************************************
 * GUJARATI AI VOICE AGENT – PROMPT FAITHFUL
 * Two-way | Multi-turn | Male voice | No beep
 *************************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import textToSpeech from "@google-cloud/text-to-speech";
import { SpeechClient } from "@google-cloud/speech";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   AUDIO DIR
====================== */
const AUDIO_DIR = path.join(__dirname, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
app.use("/audio", express.static(AUDIO_DIR));

/* ======================
   CLIENTS
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const ttsClient = new textToSpeech.TextToSpeechClient();
const sttClient = new SpeechClient();

/* ======================
   CALL STATE
====================== */
const calls = new Map();

/* ======================
   EXACT PROMPT TEXTS
====================== */
const P = {
  INTRO: `નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી.
શું હું આપનો થોડો સમય લઈ શકું?`,

  ASK_STATUS: `કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?`,

  DONE: `ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે.
આભાર, આપનો પ્રતિસાદ અમારા માટે મહત્વનો છે.
દરિયાપુરના ધારાસભ્ય કૌશિક જૈનનું ઇ-કાર્યાલય આપની સેવા માટે હંમેશાં તૈયાર છે.`,

  NOT_DONE: `માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી.
કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો જેથી અમે યોગ્ય વિભાગ સુધી પહોંચાડી શકીએ.`,

  DETAILS_SAVED: `આભાર, આપની માહિતી નોંધાઈ ગઈ છે.
અમારી ટીમ આપની સમસ્યાના નિરાકરણ માટે જલદી જ સંપર્ક કરશે.`,

  NO_DETAILS: `બરાબર, કોઈ વાત નથી.
જો આપ ઈચ્છો તો પછીથી અમારી ઇ-કાર્યાલય હેલ્પલાઈન પર સંપર્ક કરી શકો છો.
આભાર.`,

  NO_TIME: `બરાબર, કોઈ સમસ્યા નથી.
આભાર, અમે પછીથી સંપર્ક કરીશું.`,

  FALLBACK: `માફ કરશો, હાલમાં સિસ્ટમમાં ટેક્નિકલ સમસ્યા આવી છે.
અમારી ટીમ જલદી જ આપને ફરીથી સંપર્ક કરશે.`
};

/* ======================
   TTS (MALE GUJARATI)
====================== */
async function speak(text, file) {
  const filePath = path.join(AUDIO_DIR, file);
  if (!fs.existsSync(filePath)) {
    const [res] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "gu-IN",
        name: "gu-IN-Standard-B"
      },
      audioConfig: { audioEncoding: "MP3" }
    });
    fs.writeFileSync(filePath, res.audioContent);
  }
  return `${process.env.BASE_URL}/audio/${file}`;
}

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  const call = await twilioClient.calls.create({
    to: req.body.to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${process.env.BASE_URL}/answer`,
    method: "POST"
  });
  res.json({ success: true });
});

/* ======================
   CALL ANSWER
====================== */
app.post("/answer", async (req, res) => {
  calls.set(req.body.CallSid, { step: "INTRO" });
  const audio = await speak(P.INTRO, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record action="/listen" playBeep="false" timeout="4" />
</Response>
  `);
});

/* ======================
   LISTEN LOOP
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const state = calls.get(sid);

  try {
    const audioResp = await fetch(`${req.body.RecordingUrl}.wav`, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64")
      }
    });

    const buffer = await audioResp.arrayBuffer();

    const [stt] = await sttClient.recognize({
      audio: { content: Buffer.from(buffer).toString("base64") },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"]
      }
    });

    const text =
      stt.results?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("USER:", text);

    let reply;

    // No time
    if (/સમય નથી|પછી/.test(text)) {
      reply = P.NO_TIME;
      calls.delete(sid);
    }

    // Yes, continue
    else if (state.step === "INTRO") {
      reply = P.ASK_STATUS;
      state.step = "ASK_STATUS";
    }

    // Work done
    else if (/પૂર્ણ|થઈ ગયું/.test(text)) {
      reply = P.DONE;
      calls.delete(sid);
    }

    // Work not done
    else if (/બાકી|નથી થયું/.test(text)) {
      reply = P.NOT_DONE;
      state.step = "ASK_DETAILS";
    }

    // Details provided
    else if (state.step === "ASK_DETAILS" && text.length > 6) {
      reply = P.DETAILS_SAVED;
      calls.delete(sid);
    }

    // No details
    else {
      reply = P.NO_DETAILS;
      calls.delete(sid);
    }

    const audio = await speak(reply, "reply.mp3");

    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  ${calls.has(sid) ? `<Record action="/listen" playBeep="false" timeout="4"/>` : `<Hangup/>`}
</Response>
    `);
  } catch {
    const audio = await speak(P.FALLBACK, "fallback.mp3");
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
    `);
  }
});

/* ======================
   START
====================== */
app.listen(process.env.PORT || 3000, () =>
  console.log("✅ Prompt-faithful Gujarati AI Agent running")
);
