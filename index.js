import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import speech from "@google-cloud/speech";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Exotel Inbound Voice Agent Running");
});

/* ======================
   GOOGLE STT
====================== */
const speechClient = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_STT_CREDENTIALS),
});

async function speechToTextFromUrl(audioUrl) {
  if (!audioUrl) return "";

  const request = {
    audio: { uri: audioUrl },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 8000,
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"],
      enableAutomaticPunctuation: true,
    },
  };

  try {
    const [response] = await speechClient.recognize(request);
    return response.results?.[0]?.alternatives?.[0]?.transcript || "";
  } catch (err) {
    console.error("STT Error:", err.message);
    return "";
  }
}

/* ======================
   SIMPLE AI LOGIC
====================== */
function getReply(text) {
  if (!text) {
    return "મને તમારો અવાજ સ્પષ્ટ સંભળાયો નથી. કૃપા કરીને ફરીથી બોલો.";
  }

  if (text.includes("માનવ") || text.includes("human")) {
    return "હું તમને માનવ એજન્ટ સાથે જોડું છું. કૃપા કરીને રાહ જુઓ.";
  }

  return `તમારું કહેવું હતું: ${text}. આભાર.`;
}

/* ======================
   ANSWER INCOMING CALL
   (EXOTEL XML — NOT TWILIO)
====================== */
app.post("/answer", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>https://www.exotel.com/assets/exotel-welcome.wav</Play>

  <Speak language="gu-IN">
    નમસ્તે. આ એક ડેમો એઆઈ વોઇસ એજન્ટ છે.
    કૃપા કરીને તમારું પ્રશ્ન બોલો.
  </Speak>

  <Record
    action="/process"
    method="POST"
    maxLength="6"
    playBeep="true"
  />
</Response>
`);
});

/* ======================
   PROCESS RECORDING
====================== */
app.post("/process", async (req, res) => {
  res.set("Content-Type", "text/xml");

  const recordingUrl = req.body.RecordingUrl;
  const userText = await speechToTextFromUrl(recordingUrl);
  const reply = getReply(userText);

  res.send(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak language="gu-IN">${reply}</Speak>
  <Hangup/>
</Response>
`);
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Inbound Voice Agent live on port", PORT);
});
