/*************************************************
 * TWILIO AI VOICE AGENT – GUJARATI FIRST (STABLE)
 * AI speaks first | Groq LLM | Human-like
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
function detectReplyLanguage(text = "") {
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN"; // Hindi
  if (/[a-zA-Z]/.test(text)) return "en-US";       // English
  return "gu-IN";                                  // Gujarati fallback
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
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content: `
You are a polite Indian government office assistant.
Your job is to verify whether the citizen’s work from a government camp is completed.
Be respectful, short, and natural.
If the user is busy, politely end the call.
If work is completed, thank them.
If work is pending, ask briefly about the issue.
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
  res.send("✅ Gujarati-first AI Voice Agent Running");
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
   ANSWER — AI SPEAKS FIRST (GUJARATI)
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
    <Say voice="alice" language="gu-IN">
      નમસ્તે. હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
      યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં તેની પુષ્ટિ માટે આ કૉલ છે.
      શું હું આપનો થોડો સમય લઈ શકું?
    </Say>
  </Gather>

  <Say language="gu-IN">
    માફ કરશો, અવાજ સ્પષ્ટ સાંભળાયો નથી. અમે પછીથી સંપર્ક કરીશું.
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
  <Say language="gu-IN">
    બરાબર. અમે પછીથી ફરી સંપર્ક કરીશું. આભાર.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  let aiReply;
  try {
    aiReply = await askGroq(userText);
  } catch {
    aiReply = "Thank you. We will contact you again later.";
  }

  const replyLang = detectReplyLanguage(userText);

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    action="${BASE_URL}/process"
    method="POST"
    language="${replyLang === "hi-IN" ? "hi-IN" : "en-US"}"
    speechTimeout="3"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="${replyLang}">
      ${aiReply}
    </Say>
  </Gather>

  <Say language="${replyLang}">
    આભાર. અમે ફરી સંપર્ક કરીશું.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Gujarati-first AI Agent READY");
});
