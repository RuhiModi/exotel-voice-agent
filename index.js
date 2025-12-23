import express from "express";
import bodyParser from "body-parser";
import speech from "@google-cloud/speech";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("Exotel Voice Agent is running");
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
   SIMPLE AI LOGIC
====================== */
function getReply(text) {
  if (!text) return "મને તમારો અવાજ સ્પષ્ટ સંભળાયો નથી. કૃપા કરીને ફરી બોલો.";
  return `તમારો જવાબ નોંધાયો છે: ${text}. આભાર.`;
}

/* ======================
   ANSWER CALL (GET + POST)
====================== */
app.all("/answer", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="gu-IN">
    નમસ્તે,
    હું એક ડેમો AI વોઇસ એજન્ટ છું.
    કૃપા કરીને બીપ પછી બોલો.
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
   PROCESS RECORDING
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
  console.log("🚀 Voice Agent running on port", PORT);
});
