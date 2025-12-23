import express from "express";
import bodyParser from "body-parser";

const app = express();

// Exotel sends application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Phase-1: Exotel call test server running");
});

/* ======================
   ANSWER INCOMING CALL
====================== */
app.post("/answer", (req, res) => {
  console.log("📞 Incoming call received from Exotel");

  res.set("Content-Type", "text/xml");

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak language="en-IN">
    Hello. This is a phase one connectivity test.
    Please stay on the line.
  </Speak>

  <Pause length="10"/>

  <Speak language="en-IN">
    Thank you. The call test is complete.
    Goodbye.
  </Speak>

  <Hangup/>
</Response>`);
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Phase-1 server listening on port", PORT);
});
