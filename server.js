/*************************************************
 * TWILIO REAL-TIME AI VOICE AGENT (UPGRADED)
 * No trial prompt | Barge-in | Groq LLM | Credit-safe
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
   LANGUAGE DETECTION (BEST-EFFORT)
====================== */
function detectLanguage(text = "") {
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN"; // Hindi
  return "en-US"; // Default English (most reliable)
}

/* ======================
   GROQ LLM CALL (SAFE)
====================== */
async function askGroq(userText) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a polite government office assistant calling citizens to verify whether their work from a government camp is completed. Keep responses short and clear."
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
  return data.choices?.[0]?.message?.content ||
    "Thank you. We will contact you again later.";
}

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Upgraded Twilio + Groq AI Voice Agent Running");
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
   ANSWER — AI SPEAKS FIRST
====================== */
app.post("/answer", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    speechTimeout="3"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="en-US">
      Hello. I am calling from the office of MLA Kaushik Jain.
      This call is to verify whether your work from the government camp has been completed.
      May I take a moment of your time?
    </Say>
  </Gather>

  <Say>
    Sorry, I could not hear you. We will call again later.
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

  // 🔐 Credit safety: empty or unclear speech
  if (!userText || userText.trim() === "") {
    return res.type("text/xml").send(`
<Response>
  <Say>
    Sorry, I could not understand clearly. We will contact you again later.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  let aiReply;
  try {
    aiReply = await askGroq(userText);
  } catch (e) {
    aiReply = "Thank you. We will follow up shortly.";
  }

  const replyLang = detectLanguage(userText);

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    action="${BASE_URL}/process"
    method="POST"
    language="${replyLang}"
    speechTimeout="3"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="${replyLang}">
      ${aiReply}
    </Say>
  </Gather>

  <Say>
    Thank you. We will contact you again later.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Upgraded Twilio + Groq AI Agent READY");
});
