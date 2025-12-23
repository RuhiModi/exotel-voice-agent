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
  res.send("Exotel Inbound Voice Agent is running");
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

  const [response] = await speechClient.recognize(request);
  return response.results?.[0]?.alternatives?.[0]?.transcript || "";
}

/* ======================
   SIMPLE AI (NO GROQ CONFUSION)
====================== */
function getReply(userText) {
  if (!userText) {
    return "કૃપા કરીને ફરીથી બોલો.";
  }

  if (userText.includes("માનવ") || userText.includes("human")) {
    return "હું તમને માનવ એજન્ટ સાથે જોડું છું.";
  }

  return `તમારો જવાબ મળ્યો: ${userText}. આભાર.`;
}

/* ======================
   ANSWER INCOMING CALL
====================== */
app.post("/answer", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(`
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say language="gu-IN">
        નમસ્તે, આ એક ડેમો AI વોઇસ એજન્ટ છે.
        કૃપા કરીને તમારું પ્રશ્ન બોલો.
      </Say>
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
   PROCESS USER SPEECH
====================== */
app.post("/process", async (req, res) => {
  res.set("Content-Type", "text/xml");

  const recordingUrl = req.body.RecordingUrl;
  const userText = await speechToTextFromUrl(recordingUrl);
  const reply = getReply(userText);

  res.send(`
    <Response>
      <Say language="gu-IN">${reply}</Say>
      <Hangup/>
    </Response>
  `);
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Inbound Voice Agent running on port", PORT);
});
