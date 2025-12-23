import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import speech from "@google-cloud/speech";

/* ======================
   APP SETUP
====================== */
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   IN-MEMORY CALL SESSIONS
====================== */
const callSessions = new Map();
/*
callSessions.get(CallSid) = {
  stage: "name_collect" | "name_confirm" | "work_status",
  name: ""
}
*/

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("Exotel Voice Agent Server is running");
});

/* ======================
   GOOGLE STT CLIENT
====================== */
const speechClient = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_STT_CREDENTIALS),
});

async function speechToTextFromUrl(audioUrl) {
  if (!audioUrl) return { text: "", language: "gu-IN" };

  const request = {
    audio: { uri: audioUrl },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 8000,
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"],
      enableAutomaticPunctuation: true,
    },
  };

  const [response] = await speechClient.recognize(request);
  const result = response.results?.[0];

  if (!result) return { text: "", language: "gu-IN" };

  return {
    text: result.alternatives[0].transcript,
    language: result.languageCode || "gu-IN",
  };
}

/* ======================
   GROQ AI LOGIC
====================== */
async function askGroq({ text, stage }) {
  const systemPrompt = `
You are a polite government AI voice assistant.

You must strictly follow stages.

STAGES:
1. name_collect → ask user's full name
2. name_confirm → repeat name and ask confirmation
3. work_status → ask if work is completed

Rules:
- If name confirmed → move to work_status
- If name denied → ask name again
- Work completed → status=completed
- Work pending → status=pending
- Ask for human → status=handoff

Reply ONLY in JSON:
{
  "reply": "",
  "nextStage": "name_collect | name_confirm | work_status | end",
  "status": "continue | completed | pending | handoff"
}
`;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Stage: ${stage}\nUser said: ${text}` },
        ],
        temperature: 0.3,
      }),
    }
  );

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

/* ======================
   ANSWER CALL (OPENING)
====================== */
app.post("/answer", (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send(`
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say language="gu-IN">
        નમસ્તે,
        હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
        કૃપા કરીને તમારું પૂરું નામ બોલો.
      </Say>
      <Record
        action="/process-response"
        method="POST"
        maxLength="5"
        playBeep="true"
      />
    </Response>
  `);
});

/* ======================
   PROCESS RESPONSE
====================== */
app.post("/process-response", async (req, res) => {
  res.set("Content-Type", "text/xml");

  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;

  const session = callSessions.get(callSid) || {
    stage: "name_collect",
    name: "",
  };

  const { text, language } = await speechToTextFromUrl(recordingUrl);

  const ai = await askGroq({
    text,
    stage: session.stage,
  });

  if (ai.nextStage === "name_confirm") {
    session.name = text;
  }

  if (ai.nextStage) {
    session.stage = ai.nextStage;
  }

  callSessions.set(callSid, session);

  if (ai.status === "handoff") {
    res.send(`
      <Response>
        <Say language="${language}">${ai.reply}</Say>
        <Dial>
          <Number>917874187762</Number>
        </Dial>
      </Response>
    `);
    return;
  }

  res.send(`
    <Response>
      <Say language="${language}">${ai.reply}</Say>
      <Record action="/process-response" method="POST" maxLength="5" playBeep="true"/>
    </Response>
  `);
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "Missing number" });

    const url = `https://api.exotel.com/v1/Accounts/${process.env.EXOTEL_ACCOUNT_SID}/Calls/connect.json`;

    const body = new URLSearchParams({
      From: process.env.EXOTEL_EXOPHONE,
      To: to,
      CallerId: process.env.EXOTEL_EXOPHONE,
      Url: "https://exotel-voice-agent.onrender.com/answer",
    });

    const auth = Buffer.from(
      `${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`
    ).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    res.send(await response.text());
  } catch (err) {
    console.error(err);
    res.status(500).send("Call failed");
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
