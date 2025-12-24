import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import twilio from "twilio";

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
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("Twilio AI Voice Agent Server running");
});

/* ======================
   INBOUND CALL (TWILIO → SERVER)
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
    <Response>
      <Say voice="alice">
        Hello! This is your AI voice assistant.
        Please speak after the beep.
      </Say>

      <Record
        action="https://exotel-voice-agent.onrender.com/twilio/process"
        method="POST"
        playBeep="true"
        timeout="6"
      />
    </Response>
  `);
});

/* ======================
   PROCESS SPEECH
====================== */
app.post("/twilio/process", (req, res) => {
  res.type("text/xml");

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

    const call = await twilioClient.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: "https://exotel-voice-agent.onrender.com/twilio/answer"
    });

    res.json({ success: true, sid: call.sid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
