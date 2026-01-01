/*************************************************
 * FINAL STABLE GUJARATI AI VOICE AGENT
 * Twilio Voice + LLM + Human Conversation
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

Choose ONE intent:
${Object.keys(mapping).join(", ")}

Reply ONLY with intent name.
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
    return mapping[j.choices?.[0]?.message?.content?.trim()] || null;
  } catch {
    return null;
  }
}

/* ---------------- HUMAN FLOW ---------------- */
const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ માટે કૉલ છે. શું હું આપનો થોડો સમય લઈ શકું?",
    next: (t) =>
      classify(t, { yes: "task_check", no: "end_no_time" })
  },

  task_check: {
    prompt:
      "કૃપા કરીને જણાવશો કે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં?",
    next: (t) =>
      classify(t, { done: "task_done", pending: "task_pending" })
  },

  task_done: {
    prompt:
      "ખૂબ આનંદ થયો કે આપનું કામ સફળતાપૂર્વક પૂર્ણ થયું છે. આપનો પ્રતિસાદ બદલ આભાર. કૌશિક જૈનનું ઇ-કાર્યાલય હંમેશાં આપની સાથે છે.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ હજુ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગત જણાવશો.",
    next: (t) => (t.length > 5 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ જલદી સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર, કોઈ સમસ્યા નથી. આપનો સમય બદલ આભાર.",
    end: true
  }
};

/* ---------------- TWILIO ENTRY ---------------- */
app.post("/answer", (req, res) => {
  calls.set(req.body.CallSid, { state: "intro" });

  res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi">
    ${FLOW.intro.prompt}
  </Say>
  <Gather input="speech"
          action="${BASE_URL}/listen"
          method="POST"
          speechTimeout="auto"
          timeout="6"
          speechModel="phone_call"/>
</Response>
`);
});

/* ---------------- LISTEN ---------------- */
app.post("/listen", async (req, res) => {
  const session = calls.get(req.body.CallSid);
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
  <Say voice="Polly.Aditi">
    માફ કરશો, ફરી એક વખત સ્પષ્ટ રીતે કહી શકશો?
  </Say>
  <Gather input="speech"
          action="${BASE_URL}/listen"
          method="POST"
          speechTimeout="auto"
          timeout="6"
          speechModel="phone_call"/>
</Response>
`);
    return;
  }

  session.state = next;
  const step = FLOW[next];

  if (step.end) {
    calls.delete(req.body.CallSid);
    res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi">${step.prompt}</Say>
  <Hangup/>
</Response>
`);
  } else {
    res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Aditi">${step.prompt}</Say>
  <Gather input="speech"
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
