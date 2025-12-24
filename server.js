/************************************
 * TWILIO → RETELL AI BRIDGE
 * SAFE VERSION (LOW CREDIT)
 ************************************/

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio → Retell bridge running");
});

/* ======================
   INBOUND CALL FROM TWILIO
====================== */
app.post("/twilio/answer", async (req, res) => {
  res.type("text/xml");

  // Retell WebSocket URL
  const RETELL_WS = `wss://api.retellai.com/voice/stream?agent_id=${process.env.RETELL_AGENT_ID}`;

  res.send(`
    <Response>
      <Connect>
        <Stream url="${RETELL_WS}" />
      </Connect>
    </Response>
  `);
});

/* ======================
   OUTBOUND CALL (MANUAL ONLY)
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "Missing number" });

    const call = await twilioClient.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.BASE_URL}/twilio/answer`
    });

    res.json({ success: true, callSid: call.sid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
