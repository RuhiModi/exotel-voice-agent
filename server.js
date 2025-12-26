/*************************************************
 * MULTI-TURN AI VOICE AGENT (GUJARATI)
 * Uses approved dialogues only
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
   AUDIO SETUP
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
   CALL STATE (IN-MEMORY)
====================== */
const callState = new Map();

/* ======================
   APPROVED DIALOGUES
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
આપનો સમય આપવા બદલ આભાર.`
};

/* ======================
   HELPERS
====================== */
async function speak(text, fileName) {
  const filePath = path.join(AUDIO_DIR, fileName);

  const [res] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: "gu-IN", name: "gu-IN-Standard-A" },
    audioConfig: { audioEncoding: "MP3" }
  });

  fs.writeFileSync(filePath, res.audioContent, "binary");
  return `${process.env.BASE_URL}/audio/${fileName}`;
}

/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
  res.send("✅ Multi-turn Gujarati AI Voice Agent Running");
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
   STEP 1: INTRO
====================== */
app.post("/twilio/answer", async (req, res) => {
  res.type("text/xml");

  const callSid = req.body.CallSid;
  callState.set(callSid, "INTRO");

  const audioUrl = await speak(DIALOGUES.INTRO, `${callSid}-intro.mp3`);

  res.send(`
<Response>
  <Play>${audioUrl}</Play>
  <Redirect method="POST">${process.env.BASE_URL}/twilio/next</Redirect>
</Response>
  `);
});

/* ======================
   STEP CONTROLLER
====================== */
app.post("/twilio/next", async (req, res) => {
  res.type("text/xml");
  const callSid = req.body.CallSid;
  const state = callState.get(callSid);

  if (state === "INTRO") {
    callState.set(callSid, "PURPOSE");
    const audioUrl = await speak(DIALOGUES.PURPOSE, `${callSid}-purpose.mp3`);

    return res.send(`
<Response>
  <Play>${audioUrl}</Play>
  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    timeout="6"
    maxLength="10"
    trim="trim-silence"
  />
</Response>
    `);
  }
});

/* ======================
   PROCESS USER RESPONSE
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  try {
    const callSid = req.body.CallSid;
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

    const audioBuffer = await audioResp.arrayBuffer();

    const [stt] = await sttClient.recognize({
      audio: { content: Buffer.from(audioBuffer).toString("base64") },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"]
      }
    });

    const transcript =
      stt.results?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🗣 USER:", transcript);

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
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "Classify Gujarati response into DONE, NOT_DONE, CALLBACK, NOT_INTERESTED."
            },
            { role: "user", content: transcript }
          ]
        })
      }
    );

    const groqJson = await groqResp.json();
    const intent = groqJson.choices[0].message.content.trim();

    let replyText = DIALOGUES.CALLBACK;

    if (intent.includes("DONE")) replyText = DIALOGUES.DONE;
    else if (intent.includes("NOT_DONE")) replyText = DIALOGUES.NOT_DONE;
    else if (intent.includes("NOT_INTERESTED"))
      replyText = DIALOGUES.NOT_INTERESTED;

    const replyAudio = await speak(replyText, `${callSid}-final.mp3`);

    callState.delete(callSid);

    res.send(`
<Response>
  <Play>${replyAudio}</Play>
  <Hangup/>
</Response>
    `);
  } catch (err) {
    console.error(err);
    const fallback = await speak(DIALOGUES.CALLBACK, "fallback.mp3");

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
app.listen(PORT, () => {
  console.log("🚀 Multi-turn AI Voice Agent started");
});
