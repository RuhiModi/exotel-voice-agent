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
        નમસ્તે! શું તમારું કામ પૂરું થઈ ગયું છે?
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

/**
 * Mock STT Function
 */
function mockSpeechToText() {
  // Temporary placeholder
  return {
    text: "pending",
    language: "gu-IN"
  };
}

/**
 * process response
 */
app.post("/process-response", (req, res) => {
  res.set("Content-Type", "text/xml");

  const sttResult = mockSpeechToText();
  const userText = sttResult.text.toLowerCase();
  const language = sttResult.language;

  let replyText = "";
  let shouldTransfer = false;

  if (userText.includes("done") || userText.includes("હા")) {
    replyText = "સરસ! તમારું કામ પૂરું થઈ ગયું છે. આભાર.";
  } else if (userText.includes("pending") || userText.includes("નહીં")) {
    replyText = "સમજાયું. હું તમને માનવ એજન્ટ સાથે જોડું છું.";
    shouldTransfer = true;
  } else {
    replyText = "માફ કરશો, ફરી એકવાર કહી શકો?";
  }

  if (shouldTransfer) {
    res.send(`
      <Response>
        <Say language="${language}">
          ${replyText}
        </Say>
        <Dial>
          <Number>917874187762</Number>
        </Dial>
      </Response>
    `);
  } else {
    res.send(`
      <Response>
        <Say language="${language}">
          ${replyText}
        </Say>
      </Response>
    `);
  }
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
