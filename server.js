/*************************************************
 * REAL HUMAN-LIKE AI VOICE AGENT (GUJARATI)
 * TRUE TWO-WAY CONVERSATION (LOOP)
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
   CALL MEMORY
====================== */
const calls = new Map();

/* ======================
   DIALOGUES (YOUR FLOW)
====================== */
const D = {
  INTRO: "નમસ્તે. હું દરિયાપુરના ધારાસભ્ય શ્રી કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.",
  PURPOSE:
    "યોજનાકીય કેમ્પ દરમિયાન આપ દ્વારા રજૂ કરાયેલ કામ અંગે માહિતી મેળવવા માટે આ કૉલ છે. શું હું આપનો થોડો સમય લઈ શકું?",
  STATUS:
    "યોજનાકીય કેમ્પ દરમિયાન આપ દ્વારા રજૂ કરાયેલ કામ પૂર્ણ થયું છે કે નહીં, તે જણાવશો?",
  DONE:
    "બરાબર. આપનું કામ પૂર્ણ થયાનું નોંધવામાં આવ્યું છે. આપનો સમય આપવા બદલ ખૂબ આભાર.",
  NOT_DONE:
    "સમજાયું. આપનું કામ હજી બાકી હોવાનું નોંધવામાં આવ્યું છે. આપનો સમય આપવા બદલ આભાર.",
  CALLBACK:
    "બરાબર. અમે આપને અનુકૂળ સમયે ફરી સંપર્ક કરીશું. આપનો સમય આપવા બદલ આભાર."
};

/* ======================
   TTS (MALE)
====================== */
async function speak(text, file) {
  const p = path.join(AUDIO_DIR, file);
  if (!fs.existsSync(p)) {
    const [res] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "gu-IN", name: "gu-IN-Standard-B" },
      audioConfig: { audioEncoding: "MP3" }
    });
    fs.writeFileSync(p, res.audioContent);
  }
  return `${process.env.BASE_URL}/audio/${file}`;
}

/* ======================
   START CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;
  const call = await twilioClient.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${process.env.BASE_URL}/answer`,
    method: "POST"
  });
  res.json({ success: true, sid: call.sid });
});

/* ======================
   ANSWER
====================== */
app.post("/answer", async (req, res) => {
  const sid = req.body.CallSid;
  calls.set(sid, { step: "INTRO" });

  const audio = await speak(D.INTRO, "intro.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Redirect>${process.env.BASE_URL}/next</Redirect>
</Response>
  `);
});

/* ======================
   NEXT STEP
====================== */
app.post("/next", async (req, res) => {
  const sid = req.body.CallSid;
  const call = calls.get(sid);

  let text;
  if (call.step === "INTRO") {
    text = D.PURPOSE;
    call.step = "PURPOSE";
  } else {
    text = D.STATUS;
    call.step = "STATUS";
  }

  const audio = await speak(text, `${call.step}.mp3`);

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Record
    action="${process.env.BASE_URL}/listen"
    timeout="4"
    maxLength="6"
    playBeep="false"
    trim="trim-silence"
  />
</Response>
  `);
});

/* ======================
   LISTEN & RESPOND (LOOP)
====================== */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;

  const audioResp = await fetch(`${recordingUrl}.wav`, {
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
  if (/થઈ|પૂર્ણ/.test(text)) reply = D.DONE;
  else if (/નથી|બાકી/.test(text)) reply = D.NOT_DONE;
  else reply = D.CALLBACK;

  const audio = await speak(reply, "reply.mp3");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START
====================== */
app.listen(process.env.PORT || 3000, () =>
  console.log("✅ TRUE two-way AI conversation running")
);
