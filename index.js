import express from "express";
import bodyParser from "body-parser";
import speech from "@google-cloud/speech";

const app = express();

// Exotel sends form-urlencoded data
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Exotel Inbound Voice Agent is running");
});

/* ======================
   GOOGLE STT CLIENT
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

  return (
    response.results?.[0]?.alternatives?.[0]?.transcript || ""
  );
}

/* ======================
   SIMPLE AI LOGIC
====================== */
function getReply(userText) {
  if (!userText) {
    return "મને તમારો અવાજ સ્પષ્ટ સંભળાયો નથી. કૃપા કરીને ફરી પ્રયાસ કરો.";
  }

  if (
    userText.includes("માનવ") ||
    userText.includes("human")
  ) {
    return "ડેમો મોડમાં માનવ એજન્ટ ઉપલબ્ધ નથી.";
  }

  return `તમારો પ્રશ્ન હતો: ${userText}. આભાર.`;
}

/* ======================
   ANSWER INCOMING CALL
====================== */
app.post("/answer", (req, res) => {
  console.log("📞 Incoming call received");

  res.set("Content-Type", "text/xml");

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="gu-IN">
    નમસ્તે. આ એક ડેમો AI વોઇસ એજન્ટ છે.
    કૃપા કરીને બીપ પછી તમારો પ્રશ્ન બોલો.
  </Say>

  <Record
    action="https://exotel-voice-agent.onrender.com/process"
    method="POST"
    maxLength="6"
    playBeep="true"
  />
</Response>`);
});

/* ======================
   PROCESS RECORDED SPEECH
====================== */
app.post("/process", async (req, res) => {
  console.log("🎙️ PROCESS HIT");
  console.log("BODY:", req.body);

  res.set("Content-Type", "text/xml");

  const recordingUrl = req.body.RecordingUrl;

  let userText = "";
  try {
    userText = await speechToTextFromUrl(recordingUrl);
  } catch (err) {
    console.error("STT ERROR:", err);
  }

  const reply = getReply(userText);

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="gu-IN">${reply}</Say>
  <Hangup/>
</Response>`);
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Inbound Voice Agent running on port", PORT);
});
