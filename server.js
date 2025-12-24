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
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio AI Voice Agent running (safe mode)");
});

/* ======================
   CALL ANSWER (Twilio hits this)
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  res.send(`
<Response>
  <Say voice="alice">
    Hello. This is an automated AI call.
    Please speak after the beep.
  </Say>

  <Record
    action="/twilio/process"
    method="POST"
    playBeep="true"
    timeout="5"
    maxLength="6"
  />
</Response>
`);
});

/* ======================
   PROCESS USER SPEECH
   (NO LOOP, NO SECOND RECORD)
====================== */
app.post("/twilio/process", (req, res) => {
  res.type("text/xml");

  // Later: use RecordingUrl → Google STT → AI
  res.send(`
<Response>
  <Say voice="alice">
    AI-generated reply from your script
  </Say>
  <Hangup/>
</Response>
`);
});

/* ======================
   OUTBOUND CALL API
   (YOU control when call happens)
====================== */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Missing 'to' phone number" });
    }

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.BASE_URL}/twilio/answer`
    });

    res.json({
      success: true,
      callSid: call.sid
    });
  } catch (err) {
    console.error("❌ Twilio error:", err.message);
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
