/************************************
 * AI VOICE AGENT – TWILIO VERSION
 * Inbound + Outbound
 * Ready for Google STT / LLM later
 ************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fetch from "node-fetch";

dotenv.config();

const app = express();

/* ======================
   MIDDLEWARE
====================== */
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   TWILIO CLIENT
====================== */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   SIMPLE IN-MEMORY STORE
   (later you can move to Redis / DB)
====================== */
const callMemory = new Map();

function getMemory(callSid) {
  if (!callMemory.has(callSid)) {
    callMemory.set(callSid, []);
  }
  return callMemory.get(callSid);
}

function saveMemory(callSid, role, text) {
  const memory = getMemory(callSid);
  memory.push({ role, text });
}

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio AI Voice Agent Server is running");
});

/* ======================
   TWILIO INBOUND ENTRY
   (Called when someone dials Twilio number)
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  const callSid = req.body.CallSid || "UNKNOWN_CALL";
  saveMemory(callSid, "system", "Call started");

  res.send(`
    <Response>
      <Say voice="alice">
        Hello! This is your AI voice assistant.
        Please speak after the beep.
      </Say>

      <Record
        action="/twilio/process"
        method="POST"
        playBeep="true"
        timeout="6"
      />
    </Response>
  `);
});

/* ======================
   PROCESS USER SPEECH
   (This is where STT + AI will come)
====================== */
app.post("/twilio/process", async (req, res) => {
  res.type("text/xml");

  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;

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

  /********************************************************
   * TEMP LOGIC (STT + AI PLACEHOLDER)
   * Later:
   * 1. Download recordingUrl
   * 2. Google STT (Gujarati / Hindi / English)
   * 3. LLM response
   ********************************************************/

  const fakeUserText = "User said something";
  saveMemory(callSid, "user", fakeUserText);

  // Fake AI reply for now
  const aiReply =
    "Thank you. This confirms two way calling is working perfectly.";

  saveMemory(callSid, "assistant", aiReply);

  res.send(`
    <Response>
      <Say voice="alice">
        ${aiReply}
      </Say>

      <Record
        action="/twilio/process"
        method="POST"
        playBeep="true"
        timeout="6"
      />
    </Response>
  `);
});

/* ======================
   OUTBOUND CALL API
   (Your system calls Indian users)
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({
        error: "Missing 'to' phone number"
      });
    }

    const call = await twilioClient.calls.create({
      to: to, // +91XXXXXXXXXX
      from: process.env.TWILIO_PHONE_NUMBER,
      url: "https://exotel-voice-agent.onrender.com/twilio/answer"
    });

    res.json({
      success: true,
      callSid: call.sid
    });
  } catch (error) {
    console.error("❌ Twilio outbound error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
