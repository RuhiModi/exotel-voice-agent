/*************************************************
 * FINAL STABLE GUJARATI AI VOICE AGENT
 * Twilio Voice + LLM + Human-like Flow
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

/* ---------------- BASIC SETUP ---------------- */

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* ---------------- HEALTH CHECK ---------------- */

app.get("/", (req, res) => {
  res.status(200).send("AI Voice Agent OK");
});

/* ---------------- MEMORY ---------------- */

const calls = new Map();

/* ---------------- LLM CLASSIFIER ---------------- */

async function classify(userText, mapping) {
  if (!userText || userText.trim().length < 2) return null;

  const labels = Object.keys(mapping);

  const prompt = `
You are a Gujarati intent classifier.

User said:
"${userText}"

Choose ONE intent from:
${labels.join(", ")}

Reply ONLY with intent label.
`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const j = await r.json();
    const label = j.choices?.[0]?.message?.content?.trim();
    return mapping[label] || null;
  } catch (e) {
    console.error("LLM error:", e);
    return null;
  }
}

/* ---------------- FLOW (HUMAN QUESTIONS) ---------------- */

const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ માટે કૉલ છે. શું હું આપનો થોડો સમય લઈ શકું?",
    next: async (t) =>
      await classify(t, {
        yes: "task_check",
        no: "end_no_time"
      })
  },

  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: async (t) =>
      await classify(t, {
        done: "task_done",
        pending: "task_pending"
      })
  },

  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ બદલ આભાર. કૌશિક જૈનનું ઇ-કાર્યાલય આપની સેવા માટે હંમેશાં તૈયાર છે.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગત જણાવશો.",
    next: (t) => (t && t.length > 5 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ આપની સમસ્યાના નિરાકરણ માટે જલદી સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર, કોઈ સમસ્યા નથી. આપનો સમય બદલ આભાર.",
    end: true
  }
};

/* ---------------- TWILIO ENTRY ---------------- */

app.post("/answer", async (req, res) => {
  const callSid = req.body.CallSid;
  calls.set(callSid, { state: "intro" });

  res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi" language="gu-IN">
    ${FLOW.intro.prompt}
  </Say>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          speechTimeout="auto"
          timeout="6"/>
</Response>
`);
});

/* ---------------- LISTEN ---------------- */

app.post("/listen", async (req, res) => {
  const callSid = req.body.CallSid;
  const userSpeech = (req.body.SpeechResult || "").trim();

  const session = calls.get(callSid);
  if (!session) {
    res.type("text/xml").send("<Response><Hangup/></Response>");
    return;
  }

  const current = FLOW[session.state];
  let nextState = null;

  if (current.next) {
    nextState = await current.next(userSpeech);
  }

  // clarification
  if (!nextState) {
    res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi" language="gu-IN">
    માફ કરશો, ફરી એક વખત સ્પષ્ટ રીતે કહી શકશો?
  </Say>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          speechTimeout="auto"
          timeout="6"/>
</Response>
`);
    return;
  }

  session.state = nextState;
  const node = FLOW[nextState];

  if (node.end) {
    res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi" language="gu-IN">
    ${node.prompt}
  </Say>
  <Hangup/>
</Response>
`);
    calls.delete(callSid);
  } else {
    res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi" language="gu-IN">
    ${node.prompt}
  </Say>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          speechTimeout="auto"
          timeout="6"/>
</Response>
`);
  }
});

/* ---------------- START ---------------- */

app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL CLEAN)");
});
