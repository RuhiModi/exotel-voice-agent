/*************************************************
 * TRIAL-SAFE TWILIO AI VOICE AGENT
 * USER SPEAKS FIRST | GROQ LLM | NO DISCONNECT
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
   LANGUAGE DETECTION
====================== */
function detectLanguage(text = "") {
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  if (/[a-zA-Z]/.test(text)) return "en-US";
  return "en-US";
}

/* ======================
   GROQ LLM
====================== */
async function askGroq(userText) {
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
            content: `
You are a polite Indian government office assistant.
The user has called you.
Confirm whether their work from a government camp is completed.
Keep replies short and respectful.
End the call politely when appropriate.
`
          },
          {
            role: "user",
            content: userText
          }
        ]
      })
    }
  );

  const data = await response.json();
  return (
    data.choices?.[0]?.message?.content ||
    "Thank you. We will contact you again later."
  );
}

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ TRIAL SAFE AI AGENT RUNNING");
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
   ANSWER — USER SPEAKS FIRST
====================== */
app.post("/answer", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Gather
    input="dtmf speech"
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    speechTimeout="5"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say>
      Please say hello to continue.
    </Say>
  </Gather>

  <Say>
    We did not hear you. Goodbye.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH
====================== */
app.post("/process", async (req, res) => {
  const userText = req.body.SpeechResult || "";
  console.log("USER SAID:", userText);

  if (!userText.trim()) {
    return res.type("text/xml").send(`
<Response>
  <Say>
    Sorry, we could not understand you. Goodbye.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  let aiText;
  try {
    aiText = await askGroq(userText);
  } catch {
    aiText = "Thank you. We will contact you again later.";
  }

  const replyLang = detectLanguage(userText);

  res.type("text/xml").send(`
<Response>
  <Gather
    input="dtmf speech"
    action="${BASE_URL}/process"
    method="POST"
    language="${replyLang}"
    speechTimeout="5"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say language="${replyLang}">
      ${aiText}
    </Say>
  </Gather>

  <Say>
    Thank you for your time. Goodbye.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 TRIAL SAFE AI AGENT READY");
});
