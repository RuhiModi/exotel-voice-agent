/*************************************************
 * AI VOICE CALL AGENT – FINAL SAFE VERSION
 * Twilio + Google STT (Gujarati) + Groq fallback
 * Render compatible | Trial safe
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = "https://exotel-voice-agent.onrender.com";

/* =======================
   Twilio Client
======================= */
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* =======================
   Call State Store
======================= */
const calls = new Map();

/* =======================
   Conversation Flow
======================= */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (input) => {
      if (/હા|yes/i.test(input)) return "task_check";
      if (/ના|no/i.test(input)) return "goodbye";
      return "clarify";
    },
  },

  task_check: {
    prompt: "કૃપા કરીને જણાવશો કે આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (input) => {
      if (/થયું|પૂર્ણ|yes/i.test(input)) return "thanks";
      if (/નથી|no/i.test(input)) return "complaint";
      return "clarify";
    },
  },

  complaint: {
    prompt:
      "આભાર. આપની ફરિયાદ નોંધવામાં આવી છે. ટૂંક સમયમાં અમારી ટીમ સંપર્ક કરશે.",
    next: () => "end",
  },

  thanks: {
    prompt:
      "આભાર. આપનો પ્રતિસાદ અમારાં માટે મહત્વનો છે. શુભ દિવસ!",
    next: () => "end",
  },

  clarify: {
    prompt: "માફ કરશો, કૃપા કરીને ફરી એકવાર સ્પષ્ટ કહી શકશો?",
    next: () => "intro",
  },

  goodbye: {
    prompt: "આભાર. શુભ દિવસ!",
    next: () => "end",
  },
};

/* =======================
   /answer – ENTRY POINT
======================= */
app.post("/answer", (req, res) => {
  const sid = req.body.CallSid;
  calls.set(sid, { state: "intro" });

  res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">${FLOW.intro.prompt}</Say>
  <Gather
    input="speech"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="4"
    speechTimeout="auto"
  />
</Response>
`);
});

/* =======================
   /listen – MAIN LOOP
======================= */
app.post("/listen", async (req, res) => {
  const sid = req.body.CallSid;
  let call = calls.get(sid);

  /* -------- SAFETY GUARD -------- */
  if (!call) {
    calls.set(sid, { state: "intro" });
    res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">${FLOW.intro.prompt}</Say>
  <Gather
    input="speech"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="4"
    speechTimeout="auto"
  />
</Response>
`);
    return;
  }

  /* -------- USER INPUT -------- */
  const userText =
    req.body.SpeechResult || "";

  let nextState = FLOW[call.state].next(userText);

  /* -------- GROQ FALLBACK (INTENT CLARIFY) -------- */
  if (nextState === "clarify" && userText) {
    try {
      const groqResp = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content:
                  "You are an intent classifier for Gujarati phone calls. Reply with one word: yes, no, done, not_done, unclear.",
              },
              { role: "user", content: userText },
            ],
          }),
        }
      );

      const data = await groqResp.json();
      const intent = data.choices?.[0]?.message?.content || "";

      if (intent.includes("yes")) nextState = "task_check";
      else if (intent.includes("no")) nextState = "goodbye";
    } catch (e) {
      // Groq failure is NON-BLOCKING
    }
  }

  call.state = nextState;
  calls.set(sid, call);

  /* -------- END CALL -------- */
  if (nextState === "end") {
    res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">${FLOW[call.state]?.prompt || "આભાર."}</Say>
  <Hangup/>
</Response>
`);
    return;
  }

  /* -------- CONTINUE LOOP -------- */
  res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">${FLOW[nextState].prompt}</Say>
  <Gather
    input="speech"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="4"
    speechTimeout="auto"
  />
</Response>
`);
});

/* =======================
   /call – OUTBOUND (OPTIONAL)
======================= */
app.post("/call", async (req, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ error: "Missing 'to' number" });
  }

  try {
    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${BASE_URL}/answer`,
    });

    res.json({ success: true, sid: call.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   SERVER START
======================= */
app.listen(PORT, () => {
  console.log("✅ Streaming AI Voice Agent running (FINAL SAFE MODE)");
});
