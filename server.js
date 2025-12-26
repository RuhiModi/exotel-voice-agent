/*************************************************
 * MULTI-TURN GUJARATI AI VOICE AGENT (SMOOTH)
 * Google TTS + Google STT + Groq (fast-path)
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
   AUDIO SETUP (PUBLIC)
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
આપનો સમય આપવા બદલ આભાર.`,

  THINKING: `બરાબર, એક ક્ષણ આપશો.`
};

/* ======================
   TTS CACHE (FAST)
====================== */
async function ensureTTS(key, fileName) {
  const filePath = path.join(AUDIO_DIR, fileName);
  if (fs.existsSync(filePath)) {
    return `${process.env.BASE_URL}/audio/${fileName}`;
  }
  const [res] = await ttsClient.synthesizeSpeech({
    input: { text: DIALOGUES[key] },
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
  res.send("✅ Multi-turn Gujarati AI Voice Agent (Smooth) Running");
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

  const introUrl = await ensureTTS("INTRO", "intro.mp3");

  res.send(`
<Response>
  <Play>${introUrl}</Play>
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
    const purposeUrl = await ensureTTS("PURPOSE", "purpose.mp3");

    return res.send(`
<Response>
  <Play>${purposeUrl}</Play>
  <Record
    action="${process.env.BASE_URL}/twilio/process"
    method="POST"
    timeout="3"
    maxLength="6"
    trim="trim-silence"
  />
</Response>
    `);
  }
});

/* ======================
   PROCESS USER RESPONSE (FAST)
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  try {
    const callSid = req.body.CallSid;
    const recordingUrl = req.body.RecordingUrl;
    if (!recordingUrl) throw new Error("No recording");

    // Play thinking filler immediately (no silence)
    const thinkingUrl = await ensureTTS("THINKING", "thinking.mp3");

    // Download audio
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

    // STT (fast model)
    const [stt] = await sttClient.recognize({
      audio: { content: Buffer.from(audioBuffer).toString("base64") },
      config: {
        languageCode: "gu-IN",
        alternativeLanguageCodes: ["hi-IN", "en-IN"],
        model: "latest_short",
        enableAutomaticPunctuation: true
      }
    });

    const transcript =
      stt.results?.[0]?.alternatives?.[0]?.transcript || "";
    console.log("🗣 USER:", transcript);

    // Fast-path intent (skip Groq if obvious)
    let intent = "CALLBACK";
    const t = transcript;

    if (/(થઈ ગયું|પૂર્ણ|થયું)/.test(t)) intent = "DONE";
    else if (/(નથી થયું|બાકી)/.test(t)) intent = "NOT_DONE";
    else if (/(કાલે|પછી|હજી)/.test(t)) intent = "CALLBACK";
    else if (/(રસ નથી|નથી રસ)/.test(t)) intent = "NOT_INTERESTED";
    else {
      // Fallback to Groq only if unclear
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
      const text = groqJson.choices?.[0]?.message?.content || "";
      if (/DONE/.test(text)) intent = "DONE";
      else if (/NOT_DONE/.test(text)) intent = "NOT_DONE";
      else if (/NOT_INTERESTED/.test(text)) intent = "NOT_INTERESTED";
      else intent = "CALLBACK";
    }

    // Choose reply
    let replyKey = "CALLBACK";
    if (intent === "DONE") replyKey = "DONE";
    else if (intent === "NOT_DONE") replyKey = "NOT_DONE";
    else if (intent === "NOT_INTERESTED") replyKey = "NOT_INTERESTED";

    const replyFile =
      replyKey.toLowerCase() + ".mp3";
    const replyUrl = await ensureTTS(replyKey, replyFile);

    callState.delete(callSid);

    // Play filler + reply (smooth)
    res.send(`
<Response>
  <Play>${thinkingUrl}</Play>
  <Pause length="0.5"/>
  <Play>${replyUrl}</Play>
  <Hangup/>
</Response>
    `);
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    const fallbackUrl = await ensureTTS("CALLBACK", "callback.mp3");
    res.send(`
<Response>
  <Play>${fallbackUrl}</Play>
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
  // Warm cache (optional but recommended)
  await ensureTTS("INTRO", "intro.mp3");
  await ensureTTS("PURPOSE", "purpose.mp3");
  await ensureTTS("THINKING", "thinking.mp3");
  await ensureTTS("DONE", "done.mp3");
  await ensureTTS("NOT_DONE", "not_done.mp3");
  await ensureTTS("CALLBACK", "callback.mp3");
  await ensureTTS("NOT_INTERESTED", "not_interested.mp3");
  console.log("🚀 Server started — audio cached, smooth flow ready");
});
