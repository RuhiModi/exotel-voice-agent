/*************************************************
 * TWILIO TRIAL-SAFE AI VOICE AGENT (HINDI FIRST)
 * DTMF → Speech → Groq LLM
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import twilio from "twilio";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const BASE_URL = process.env.BASE_URL;

/* ======================
   GROQ LLM
====================== */
async function askGroq(text) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "आप एक विनम्र सरकारी कार्यालय सहायक हैं। संक्षिप्त, स्पष्ट और स्वाभाविक उत्तर दें।"
          },
          { role: "user", content: text }
        ]
      })
    }
  );

  const data = await response.json();
  return (
    data.choices?.[0]?.message?.content ||
    "धन्यवाद। हम आपसे बाद में संपर्क करेंगे।"
  );
}

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Hindi-first Trial Safe AI Agent Running");
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  await client.calls.create({
    to: req.body.to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${BASE_URL}/answer`,
    method: "POST"
  });

  res.json({ success: true });
});

/* ======================
   ANSWER — CLEAR TRIAL GATE
====================== */
app.post("/answer", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Gather input="dtmf" action="${BASE_URL}/start" method="POST">
    <Say>
      कृपया आगे बढ़ने के लिए कोई भी कुंजी दबाएं।
    </Say>
  </Gather>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SPEECH (HINDI)
====================== */
app.post("/start", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    action="${BASE_URL}/process"
    method="POST"
    language="hi-IN"
    timeout="6"
    speechTimeout="auto"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="hi-IN">
      नमस्ते। मैं दरियापुर के विधायक कौशिक जैन के कार्यालय से बोल रहा हूँ।
      यह कॉल सरकारी शिविर में हुए आपके काम की पुष्टि के लिए है।
      कृपया हाँ या नहीं में उत्तर दें।
    </Say>
  </Gather>

  <Say>
    हमें आपकी आवाज़ नहीं सुनाई दी। हम बाद में संपर्क करेंगे।
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   PROCESS SPEECH
====================== */
app.post("/process", async (req, res) => {
  const speech = req.body.SpeechResult || "";

  console.log("USER SAID:", speech);

  if (!speech.trim()) {
    return res.type("text/xml").send(`
<Response>
  <Say>
    हमें आपकी बात समझ नहीं आई। धन्यवाद।
  </Say>
  <Hangup/>
</Response>
    `);
  }

  let aiReply;
  try {
    aiReply = await askGroq(speech);
  } catch {
    aiReply = "धन्यवाद। हम आपसे बाद में संपर्क करेंगे।";
  }

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    action="${BASE_URL}/process"
    method="POST"
    language="hi-IN"
    timeout="6"
    speechTimeout="auto"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="hi-IN">
      ${aiReply}
    </Say>
  </Gather>

  <Say>
    आपका समय देने के लिए धन्यवाद। नमस्कार।
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Hindi-first Trial Safe AI Agent READY");
});
