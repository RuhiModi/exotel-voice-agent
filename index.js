import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Health check
app.get("/", (req, res) => {
  res.send("Exotel Voice Agent Server is running");
});

// TEMP: inbound/outbound call answer (Gujarati greeting)
app.post("/answer", (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Say language="gu-IN">
        નમસ્તે! હું તમારી મદદ માટે કોલ કરી રહ્યો છું.
      </Say>
    </Response>
  `);
});

app.post("/call", async (req, res) => {
  const { to } = req.body;

  const url = `https://api.exotel.com/v1/Accounts/${process.env.EXOTEL_SID}/Calls/connect.json`;

  const body = new URLSearchParams({
    From: process.env.EXOTEL_EXOPHONE,
    To: to,
    CallerId: process.env.EXOTEL_EXOPHONE,
    Url: "https://exotel-voice-agent.onrender.com/answer",
    CallType: "trans"
  });

  const auth = Buffer.from(
    `${process.env.EXOTEL_SID}:${process.env.EXOTEL_TOKEN}`
  ).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json();
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
