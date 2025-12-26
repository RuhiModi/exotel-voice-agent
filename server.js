/*************************************************
 * FINAL CREDIT-SAFE TWILIO AI VOICE AGENT
 * DEMO READY — NO SILENT LOOPS — NO CREDIT BURN
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import twilio from "twilio";

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
   SIMPLE LANGUAGE DETECTION (RESPONSE ONLY)
====================== */
function detectReplyLanguage(text = "") {
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  return "en-US";
}

/* ======================
   DEMO AI LOGIC (CREDIT SAFE)
====================== */
function aiReply(text = "") {
  const t = text.toLowerCase();

  if (t.includes("not now") || t.includes("later")) {
    return {
      reply: "Okay, no problem. We will call you later. Thank you.",
      end: true
    };
  }

  if (t.includes("done") || t.includes("completed")) {
    return {
      reply:
        "Thank you for confirming. We are happy your work is completed. Have a great day.",
      end: true
    };
  }

  if (t.includes("pending") || t.includes("not completed")) {
    return {
      reply:
        "Sorry to hear that. Please briefly tell us what issue you are facing.",
      end: false
    };
  }

  return {
    reply: "Sorry, I could not understand clearly. We will call again later.",
    end: true
  };
}

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Credit-safe Twilio AI Voice Agent Running");
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
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    speechTimeout="3"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say voice="alice" language="en-US">
      Hello. I am calling from the office of MLA Kaushik Jain.
      This call is regarding verification of work done during the government camp.
      May I take a moment of your time?
    </Say>
  </Gather>

  <Say>
    Sorry, I could not hear you clearly. We will call again later.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH (CREDIT SAFE)
====================== */
app.post("/process", (req, res) => {
  const userText = req.body.SpeechResult || "";

  console.log("USER SAID:", userText);

  // 🚨 CREDIT SAFETY: EMPTY SPEECH → END CALL
  if (!userText || userText.trim() === "") {
    return res.type("text/xml").send(`
<Response>
  <Say>
    Sorry, I could not understand. We will call again later.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  const ai = aiReply(userText);
  const replyLang = detectReplyLanguage(userText);

  if (ai.end) {
    return res.type("text/xml").send(`
<Response>
  <Say language="${replyLang}">
    ${ai.reply}
  </Say>
  <Hangup/>
</Response>
    `);
  }

  // Continue conversation
  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    action="${BASE_URL}/process"
    method="POST"
    language="en-US"
    speechTimeout="3"
    enhanced="true"
    actionOnEmptyResult="true"
  >
    <Say language="${replyLang}">
      ${ai.reply}
    </Say>
  </Gather>

  <Say>
    Sorry, I could not hear you clearly. We will call again later.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 FINAL CREDIT-SAFE AI AGENT READY");
});
