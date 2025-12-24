/************************************
 * OUTBOUND AI VOICE AGENT – TWILIO
 * Safe | Deterministic | No STT yet
 ************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio Outbound Voice Agent Running");
});

/* ======================
   ENTRY POINT FOR CALL
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Say voice="alice">
    Hello. This is your AI voice assistant.
    Please speak after the beep.
  </Say>

  <Record
    action="https://exotel-voice-agent.onrender.com/twilio/process"
    method="POST"
    playBeep="true"
    timeout="3"
    maxLength="6"
    finishOnKey="#"
  />
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH
====================== */
app.post("/twilio/process", (req, res) => {
  res.type("text/xml");

  const recordingUrl = req.body.RecordingUrl;

  // If nothing recorded
  if (!recordingUrl) {
    return res.send(`
<Response>
  <Say voice="alice">
    I did not hear anything. Goodbye.
  </Say>
  <Hangup/>
</Response>
    `);
  }

  // TEMP RESPONSE (AI will go here later)
  res.send(`
<Response>
  <Say voice="alice">
    Thank you. This confirms two way calling is working perfectly.
  </Say>
  <Hangup/>
</Response>
  `);
});

/* ======================
   OUTBOUND CALL API
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Missing 'to' number" });
    }

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: "https://exotel-voice-agent.onrender.com/twilio/answer",
      method: "POST"
    });

    res.json({
      success: true,
      callSid: call.sid
    });
  } catch (err) {
    console.error("❌ Call error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
