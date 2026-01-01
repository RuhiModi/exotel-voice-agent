/*************************************************
 * FINAL CLEAN GUJARATI AI VOICE AGENT (STABLE)
 * Twilio Voice + LLM + Human Flow
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

/* -------------------- BASIC SETUP -------------------- */

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

/* -------------------- HEALTH CHECK -------------------- */

app.get("/", (req, res) => {
  res.status(200).send("AI Voice Agent OK");
});

/* -------------------- AUDIO SETUP -------------------- */

const AUDIO_DIR = path.join(process.cwd(), "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

app.use("/audio", express.static(AUDIO_DIR));

/* -------------------- MEMORY -------------------- */

const calls = new Map();

/* -------------------- LLM HELPER -------------------- */

async function classify(userText, mapping) {
  const labels = Object.keys(mapping);

  const prompt = `
You are a Gujarati intent classifier.
User said: "${userText}"

Choose ONE from:
${labels.join(", ")}

Reply with only the label.
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

/* -------------------- TTS (TWILIO TTS SAFE) -------------------- */

async function speak(text, filename) {
  const filePath = path.join(AUDIO_DIR, filename);

  // Twilio-compatible Polly voice
  const twiml = `
<Response>
  <Say language="gu-IN" voice="Polly.Aditi">${text}</Say>
</Response>
`;

  fs.writeFileSync(filePath, Buffer.from(twiml));
  return `${BASE_URL}/audio/${filename}`;
}

/* -------------------- FLOW (UNCHANGED) -------------------- */

const FLOW = {
  intro: {
    prompt:
      "નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું. આ કૉલનો મુખ્ય હેતુ છે યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ થયેલ છે કે નહીં તેની પુષ્ટિ કરવી. શું હું આપનો થોડો સમય લઈ શકું?",
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
      "ખૂબ આનંદ થયો કે આપનું કામ પૂર્ણ થયું છે. આપનો પ્રતિસાદ બદલ આભાર. કૌશિક જૈનનું ઇ-કાર્યાલય આપની સેવા માટે હંમેશાં તૈયાર છે.",
    end: true
  },

  task_pending: {
    prompt:
      "માફ કરશો કે આપનું કામ પૂર્ણ થયું નથી. કૃપા કરીને આપની સમસ્યાની વિગત જણાવશો.",
    next: (t) => (t.length > 5 ? "problem_recorded" : null)
  },

  problem_recorded: {
    prompt:
      "આભાર. આપની માહિતી નોંધાઈ ગઈ છે. અમારી ટીમ આપની સાથે જલદી સંપર્ક કરશે.",
    end: true
  },

  end_no_time: {
    prompt:
      "બરાબર. કોઈ વાત નથી. આપનો સમય બદલ આભાર.",
    end: true
  }
};

/* -------------------- TWILIO ENTRY -------------------- */

app.post("/answer", async (req, res) => {
  const callSid = req.body.CallSid;
  calls.set(callSid, { state: "intro" });

  const audio = await speak(FLOW.intro.prompt, "intro.xml");

  res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Gather input="speech"
          language="gu-IN"
          action="${BASE_URL}/listen"
          method="POST"
          speechTimeout="auto"
          timeout="6"/>
</Response>
`);
});

/* -------------------- USER SPEECH -------------------- */

app.post("/listen", async (req, res) => {
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult || "";

  const session = calls.get(callSid);
  if (!session) return res.end();

  const current = FLOW[session.state];
  let nextState = null;

  if (current.next) {
    nextState = await current.next(userSpeech);
  }

  // clarification fallback
  if (!nextState) {
    res.type("text/xml").send(`
<Response>
  <Say language="gu-IN">માફ કરશો, ફરી એક વખત કહી શકશો?</Say>
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

  const audio = await speak(node.prompt, `${nextState}.xml`);

  if (node.end) {
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
  <Hangup/>
</Response>
`);
    calls.delete(callSid);
  } else {
    res.type("text/xml").send(`
<Response>
  <Play>${audio}</Play>
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

/* -------------------- START SERVER -------------------- */

app.listen(PORT, () => {
  console.log("✅ Gujarati AI Voice Agent running (FINAL CLEAN)");
});
