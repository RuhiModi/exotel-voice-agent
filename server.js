/*************************************************
 * TWILIO GATHER AI VOICE AGENT – FINAL STABLE
 * Fixes silent Gather + no response issues
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
   LANGUAGE DETECTION
====================== */
function detectLanguage(text = "") {
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu-IN";
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  return "en-US";
}

/* ======================
   SIMPLE AI LOGIC (DEMO)
====================== */
function aiReply(text, lang) {
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

  if (/not now/i.test(text)) return "No problem, we will call you later.";
  if (/done|completed/i.test(text))
    return "Glad to hear your work is completed. Thank you.";
  if (/pending/i.test(text)) return "Please tell us what issue you are facing.";
  return "Could you please repeat that?";
}

/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
  res.send("✅ Twilio Gather AI Agent Running");
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  await client.calls.create({
    to: req.body.to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${BASE_URL}/answer`,
    method: "POST"
  });

  res.json({ success: true });
});

/* ======================
   ANSWER – AI SPEAKS FIRST
====================== */
app.post("/answer", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    action="${BASE_URL}/process"
    method="POST"
    language="gu-IN"
    speechTimeout="3"
    actionOnEmptyResult="true"
    enhanced="true"
  >
    <Say voice="alice" language="gu-IN">
      નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
      યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં તેની પુષ્ટિ માટે કૉલ છે.
      શું હું આપનો થોડો સમય લઈ શકું?
    </Say>
  </Gather>

  <Redirect>${BASE_URL}/process</Redirect>
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH
====================== */
app.post("/process", (req, res) => {
  const userText = req.body.SpeechResult || "";
  console.log("USER SAID:", userText);

  const lang = detectLanguage(userText);
  const reply = aiReply(userText, lang);

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    action="${BASE_URL}/process"
    method="POST"
    language="${lang}"
    speechTimeout="3"
    actionOnEmptyResult="true"
    enhanced="true"
  >
    <Say voice="alice" language="${lang}">
      ${reply}
    </Say>
  </Gather>

  <Redirect>${BASE_URL}/process</Redirect>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Twilio Gather AI Agent READY");
});
