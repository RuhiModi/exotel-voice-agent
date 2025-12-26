/*************************************************
 * HUMAN-LIKE GUJARATI AI CALLER (MALE VOICE)
 * No beep | No silence | Smooth flow
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
   AUDIO PUBLIC DIR
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
const callState = new Map();

/* ======================
   DIALOGUES (APPROVED)
====================== */
const DIALOGUES = {
  INTRO: `નમસ્તે.
હું દરિયાપુરના ધારાસભ્ય શ્રી કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.`,

  PURPOSE: `આ કૉલનો મુખ્ય હેતુ એ છે કે યોજનાકીય કેમ્પ દરમિયાન આપ દ્વારા રજૂ કરાયેલ કામ અંગે માહિતી મેળવવી.
શું હું આપનો થોડો સમય લઈ શકું?`,

  STATUS: `યોજનાકીય કેમ્પ દરમિયાન આપ દ્વારા રજૂ કરાયેલ કામ પૂર્ણ થયું છે કે નહીં, તે અંગે આપ જણાવશો?`,

  DONE: `બરાબર. આપનું કામ પૂર્ણ થયાનું નોંધ લેવામાં આવ્યું છે.
આપનો સમય આપવા બદલ ખૂબ આભાર.`,

  NOT_DONE: `સમજાયું. આપનું કામ હજી બાકી હોવાનું નોંધવામાં આવ્યું છે.
આ માહિતી સંબંધિત વિભાગ સુધી પહોંચાડવામાં આવશે.
આપનો સમય આપવા બદલ આભાર.`,

  CALLBACK: `બરાબર. અમે આપને અનુકૂળ સમય પર ફરી સંપર્ક કરીશું.
આપનો સમય આપવા બદલ આભાર.`,

  NOT_INTERESTED: `બરાબર. આપની નોંધ લઈ લેવામાં આવી છે.
આપનો સમય આપવા બદલ આભાર.`,

  LISTENING: `બરાબર, જણાવશો.`
};

/* ======================
   TTS CACHE (MALE VOICE)
====================== */
async function tts(key, file) {
  const filePath = path.join(AUDIO_DIR, file);
  if (fs.existsSync(filePath)) {
    return `${process.env.BASE_URL}/audio/${file}`;
  }

  const [res] = await ttsClient.synthesizeSpeech({
    input: { text: DIALOGUES[key] },
    voice: {
      languageCode: "gu-IN",
      name: "gu-IN-Standard-B" // MALE VOICE
    },
    audioConfig: { audioEncoding: "MP3" }
  });

  fs.writeFileSync(filePath, res.audioContent, "binary");
  return `${process.env.BASE_URL}/audio/${file}`;
}

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;
  const call = await twilioClient.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${process.env.BASE_URL}/twilio/answer`,
    method: "POST"
  });
  res.json({ success: true, sid: call.sid });
});

/* ======================
   AI STARTS TALKING
====================== */
app.post("/twilio/answer", async (req, res) => {
  res.type("text/xml");
  const callSid = req.body.CallSid;
  callState.set(callSid, "INTRO");

  const intro = await tts("INTRO", "intro.mp3");

  res.send(`
<Response>
  <Play>${intro}</Play>
  <Redirect method="POST">${process.env.BASE_URL}/twilio/next</Redirect>
</Response>
  `);
});

/* ======================
   FLOW CONTROL
====================== */
app.post("/twilio/next", async (req, res) => {
  res.type("text/xml");
  const callSid = req.body.CallSid;
  const state = callState.get(callSid);

  if (state === "INTRO") {
    callState.set(callSid, "PURPOSE");
    const purpose = await tts("PURPOSE", "purpose.mp3");
    const listening = await tts("LISTENING", "listening.mp3");

    return res.send(`
<Response>
  <Play>${purpose}</Play>
  <Play>${listening}</Play>
  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    timeout="3"
    maxLength="6"
    trim="trim-silence"
    playBeep="false"
  />
</Response>
    `);
  }
});

/* ======================
   PROCESS USER SPEECH
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  try {
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
        alternativeLanguageCodes: ["hi-IN", "en-IN"],
        enableAutomaticPunctuation: true
      }
    });

    const text =
      stt.results?.[0]?.alternatives?.[0]?.transcript || "";
    console.log("🗣 USER:", text);

    let reply = "CALLBACK";
    if (/થઈ|પૂર્ણ/.test(text)) reply = "DONE";
    else if (/નથી|બાકી/.test(text)) reply = "NOT_DONE";
    else if (/કાલે|પછી/.test(text)) reply = "CALLBACK";
    else if (/રસ નથી/.test(text)) reply = "NOT_INTERESTED";

    const audio = await tts(reply, `${reply}.mp3`);
    callState.delete(req.body.CallSid);

    res.send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
    `);
  } catch {
    const fallback = await tts("CALLBACK", "callback.mp3");
    res.send(`
<Response>
  <Play>${fallback}</Play>
  <Hangup/>
</Response>
    `);
  }
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await tts("INTRO", "intro.mp3");
  await tts("PURPOSE", "purpose.mp3");
  await tts("LISTENING", "listening.mp3");
  await tts("DONE", "done.mp3");
  await tts("NOT_DONE", "not_done.mp3");
  await tts("CALLBACK", "callback.mp3");
  await tts("NOT_INTERESTED", "not_interested.mp3");
  console.log("🚀 Human-like Gujarati AI Caller (Male) ready");
});
