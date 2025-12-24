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
  res.send("✅ Twilio + Retell AI Voice Agent running");
});

/* ======================
   INBOUND CALL (Twilio → Retell)
====================== */
app.post("/twilio/answer", (req, res) => {
  res.type("text/xml");

  const twiml = `
<Response>
  <Connect>
    <Stream
      url="wss://api.retellai.com/audio-websocket"
    >
      <Parameter name="agent_id" value="${process.env.RETELL_AGENT_ID}" />
      <Parameter name="call_type" value="twilio" />
    </Stream>
  </Connect>
</Response>
`;

  res.send(twiml);
});

/* ======================
   OUTBOUND CALL API
   (Call users manually)
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
      url: `${process.env.BASE_URL}/twilio/answer`
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
