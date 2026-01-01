/*************************************************
 * FINAL STABLE AI VOICE AGENT (TWILIO-SAFE)
 * English Voice (TTS) + Gujarati STT + LLM Logic
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ---------------- HEALTH CHECK ---------------- */
app.get("/", (req, res) => {
  res.send("AI Voice Agent OK");
});

/* ---------------- SESSION MEMORY ---------------- */
const calls = new Map();

/* ---------------- LLM INTENT CLASSIFIER ---------------- */
async function classify(text, mapping) {
  if (!text || text.length < 2) return null;

  const prompt = `
User said (Gujarati):
"${text}"

Choose ONE intent from this list:
${Object.keys(mapping).join(", ")}

Reply with ONLY the intent name.
`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const j = await r.json();
    const intent = j?.choices?.[0]?.message?.content?.trim();
    return mapping[intent] || null;
  } catch (e) {
    return null;
  }
}

/* ---------------- HUMAN CONVERSATION FLOW ---------------- */
const FLOW = {
  intro: {
    prompt:
      "Hello. I am calling from the office of MLA Kaushik Jain. This call is to confirm whether your work from the government camp has been completed. May I take a moment of your time?",
    next: (t) =>
      classify(t, {
        yes: "task_check",
        okay: "task_check",
        no: "end_no_time"
      })
  },

  task_check: {
    prompt:
      "Please tell me, has your work from the government camp been completed?",
    next: (t) =>
      classify(t, {
        done: "task_done",
        completed: "task_done",
        pending: "task_pending",
        not_done: "task_pending"
      })
  },

  task_done: {
    prompt:
      "Thank you for confirming. We are happy that your work is completed. Have a good day.",
    end: true
  },

  task_pending: {
    prompt:
      "Sorry to hear that your work is still pending. Please briefly describe your problem.",
    next: (t) => (t.length > 5 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "Thank you. Your issue has been noted and our team will contact you soon.",
    end: true
  },

  end_no_time: {
    prompt:
      "No problem at all. Thank you for your time. Goodbye.",
    end: true
  }
};

/* ---------------- TWILIO ENTRY ---------------- */
app.post("/answer", (req, res) => {
  const callSid = req.body.CallSid;
  calls.set(callSid, { state: "intro" });

  res.type("text/xml").send(`
<Response>
  <Say voice="alice" language="en-IN">
    ${FLOW.intro.prompt}
  </Say>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
</Response>
`);
});

/* ---------------- LISTEN ---------------- */
app.post("/listen", async (req, res) => {
  const callSid = req.body.CallSid;
  const session = calls.get(callSid);
  const userText = (req.body.SpeechResult || "").trim();

  if (!session) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const node = FLOW[session.state];
  const next = node.next ? await node.next(userText) : null;

  if (!next) {
    res.type("text/xml").send(`
<Response>
  <Say voice="alice" language="en-IN">
    Sorry, could you please repeat that clearly?
  </Say>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
</Response>
`);
    return;
  }

  session.state = next;
  const step = FLOW[next];

  if (step.end) {
    calls.delete(callSid);
    res.type("text/xml").send(`
<Response>
  <Say voice="alice" language="en-IN">
    ${step.prompt}
  </Say>
  <Hangup/>
</Response>
`);
  } else {
    res.type("text/xml").send(`
<Response>
  <Say voice="alice" language="en-IN">
    ${step.prompt}
  </Say>
  <Gather
    input="speech"
    language="gu-IN"
    action="${BASE_URL}/listen"
    method="POST"
    timeout="6"
    speechTimeout="auto"
  />
</Response>
`);
  }
});

/* ---------------- START ---------------- */
app.listen(PORT, () => {
  console.log("✅ AI Voice Agent running (Twilio-safe, audio guaranteed)");
});
