/*************************************************
 * FINAL STABLE TWILIO AI AGENT (TRIAL SAFE)
 * AI speaks first | Handles DTMF + Speech | Groq
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
            content:
              "You are a polite Indian government office assistant. Speak briefly and naturally."
          },
          { role: "user", content: userText }
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
  res.send("✅ FINAL STABLE AI AGENT RUNNING");
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
    input="dtmf speech"
    bargeIn="true"
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    timeout="6"
    speechTimeout="auto"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="gu-IN">
      નમસ્તે. હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ કાર્યાલય તરફથી બોલું છું.
      યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં તેની પુષ્ટિ માટે આ કૉલ છે.
      કૃપા કરીને હેલો કહી જવાબ આપશો.
    </Say>
  </Gather>

  <Say language="en-US">
    Sorry, we could not hear you. We will call again later.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   PROCESS INPUT (DTMF OR SPEECH)
====================== */
app.post("/process", async (req, res) => {
  const digits = req.body.Digits;
  const speech = req.body.SpeechResult || "";

  console.log("DIGITS:", digits);
  console.log("SPEECH:", speech);

  // If user only pressed a key (trial gate), re-prompt for speech
  if (digits && !speech.trim()) {
    return res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    timeout="6"
    speechTimeout="auto"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say>
      Thank you. Please say hello to continue.
    </Say>
  </Gather>

  <Say>
    We could not hear you. Goodbye.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  // If no speech even after re-prompt
  if (!speech.trim()) {
    return res.type("text/xml").send(`
<Response>
  <Say>
    Sorry, we could not understand you. We will contact you again.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  // Normal AI response
  let aiReply;
  try {
    aiReply = await askGroq(speech);
  } catch {
    aiReply = "Thank you. We will contact you again later.";
  }

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    timeout="6"
    speechTimeout="auto"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say>${aiReply}</Say>
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
  console.log("🚀 FINAL STABLE AI AGENT READY");
});
