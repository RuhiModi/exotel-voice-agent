import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("Exotel Voice Agent Server is running");
});

/**
 * Call answer webhook (Exotel hits this after user picks up)
 */
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

/**
 * Trigger outbound call
 */
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Missing 'to' number" });
    }

    const exotelAccountSid = process.env.EXOTEL_ACCOUNT_SID;
    const exotelApiKey = process.env.EXOTEL_API_KEY;
    const exotelApiToken = process.env.EXOTEL_API_TOKEN;
    const exotelExoPhone = process.env.EXOTEL_EXOPHONE;

    const url = `https://api.exotel.com/v1/Accounts/${exotelAccountSid}/Calls/connect.json`;

    const body = new URLSearchParams({
      From: exotelExoPhone,
      To: to,
      CallerId: exotelExoPhone,
      Url: "https://exotel-voice-agent.onrender.com/answer"
    });

    // ✅ CORRECT EXOTEL AUTH (API KEY : API TOKEN)
    const auth = Buffer.from(
      `${exotelApiKey}:${exotelApiToken}`
    ).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const text = await response.text(); // Exotel may not return JSON
    res.send(text);

  } catch (err) {
    console.error("Call error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
