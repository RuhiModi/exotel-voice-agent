/*************************************************
 * TWILIO REAL-TIME VOICE AGENT (GATHER MODE)
 * No pause | Barge-in | Multi-language | Stable
 *************************************************/

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const BASE_URL = process.env.BASE_URL;

/* ======================
   SIMPLE LANGUAGE DETECTION
====================== */
function detectLanguage(text = "") {
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu-IN"; // Gujarati
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN"; // Hindi
  return "en-US";
}

/* ======================
   AI LOGIC (RULE-BASED DEMO)
====================== */
function getReply(text, lang) {
  if (lang === "gu-IN") {
    if (/સમય નથી/.test(text))
      return "બરાબર, કોઈ સમસ્યા નથી. અમે પછીથી સંપર્ક કરીશું.";
    if (/પૂર્ણ/.test(text))
      return "ખૂબ આનંદ થયો કે આપનું કામ પૂર્ણ થયું છે. આભાર.";
    if (/બાકી/.test(text))
      return "કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો.";
    return "કૃપા કરીને ફરીથી કહેશો?";
  }

  if (lang === "hi-IN") {
    if (/समय नहीं/.test(text))
      return "ठीक है, हम बाद में संपर्क करेंगे।";
    if (/पूरा/.test(text))
      return "यह जानकर खुशी हुई कि आपका काम पूरा हो गया है।";
    if (/बाकी/.test(text))
      return "कृपया अपनी समस्या बताइए।";
    return "कृपया दोबारा बताएं।";
  }

  // English
  if (/not now/.test(text)) return "No problem, we will call you later.";
  if (/done|completed/.test(text))
    return "Glad to hear your work is completed. Thank you.";
  if (/pending/.test(text)) return "Please tell us what issue you are facing.";
  return "Could you please repeat that?";
}

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio real-time AI voice agent running");
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  await client.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${BASE_URL}/answer`,
    method: "POST"
  });

  res.json({ success: true });
});

/* ======================
   CALL ANSWER (AI SPEAKS FIRST)
====================== */
app.post("/answer", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    speechTimeout="auto"
    action="${BASE_URL}/process"
    method="POST"
    language="gu-IN"
  >
    <Say voice="alice" language="gu-IN">
      નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
      યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં તેની પુષ્ટિ માટે કૉલ છે.
      શું હું આપનો થોડો સમય લઈ શકું?
    </Say>
  </Gather>

  <!-- REQUIRED FALLBACK -->
  <Say language="gu-IN">
    માફ કરશો, મને આપનો અવાજ સાંભળાયો નથી.
  </Say>
  <Redirect>${BASE_URL}/answer</Redirect>
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH (CONTINUOUS LOOP)
====================== */
app.post("/process", (req, res) => {
  const userText = req.body.SpeechResult || "";
  const lang = detectLanguage(userText);
  const reply = getReply(userText, lang);

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    speechTimeout="auto"
    action="${BASE_URL}/process"
    method="POST"
    language="${lang}"
  >
    <Say voice="alice" language="${lang}">
      ${reply}
    </Say>
  </Gather>

  <!-- REQUIRED FALLBACK -->
  <Say language="${lang}">
    માફ કરશો, મને ફરીથી કહેશો?
  </Say>
  <Redirect>${BASE_URL}/process</Redirect>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Stable Twilio Gather AI agent running");
});
