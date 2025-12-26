/*************************************************
 * TWILIO STREAMING AI VOICE AGENT
 * Human-like | No pause | Barge-in | Multi-language
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

/* ======================
   SIMPLE CALL MEMORY
====================== */
const callState = new Map();

/* ======================
   LANGUAGE DETECTION
====================== */
function detectLanguage(text) {
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  return "en";
}

/* ======================
   AI REPLY LOGIC (RULE BASED DEMO)
====================== */
function aiReply(text, lang) {
  if (lang === "gu") {
    if (/સમય નથી/.test(text))
      return "બરાબર, કોઈ સમસ્યા નથી. અમે પછીથી સંપર્ક કરીશું.";
    if (/પૂર્ણ/.test(text))
      return "ખૂબ આનંદ થયો કે આપનું કામ પૂર્ણ થયું છે. આભાર.";
    if (/બાકી/.test(text))
      return "માફ કરશો. કૃપા કરીને આપની સમસ્યાની વિગતો જણાવશો.";
    return "કૃપા કરીને ફરીથી કહી શકશો?";
  }

  if (lang === "hi") {
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
  res.send("✅ Twilio Streaming AI Voice Agent Running");
});

/* ======================
   OUTBOUND CALL
====================== */
app.post("/call", async (req, res) => {
  const { to } = req.body;

  await client.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${process.env.BASE_URL}/answer`,
    method: "POST"
  });

  res.json({ success: true });
});

/* ======================
   CALL ANSWER (AI SPEAKS FIRST)
====================== */
app.post("/answer", (req, res) => {
  callState.set(req.body.CallSid, "intro");

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    speechTimeout="auto"
    action="/process"
    method="POST"
    language="gu-IN"
  >
    <Say voice="alice">
      નમસ્તે, હું દરિયાપુરના ધારાસભ્ય કૌશિક જૈનના ઇ-કાર્યાલય તરફથી બોલું છું.
      યોજનાકીય કેમ્પ દરમ્યાન આપનું કામ પૂર્ણ થયું છે કે નહીં તેની પુષ્ટિ માટે કૉલ છે.
      શું હું આપનો થોડો સમય લઈ શકું?
    </Say>
  </Gather>
</Response>
  `);
});

/* ======================
   PROCESS USER SPEECH (REAL-TIME)
====================== */
app.post("/process", (req, res) => {
  const speech = req.body.SpeechResult || "";
  const lang = detectLanguage(speech);
  const reply = aiReply(speech, lang);

  let sayLang = "en-US";
  if (lang === "gu") sayLang = "gu-IN";
  if (lang === "hi") sayLang = "hi-IN";

  res.type("text/xml").send(`
<Response>
  <Gather
    input="speech"
    bargeIn="true"
    speechTimeout="auto"
    action="/process"
    method="POST"
    language="${sayLang}"
  >
    <Say voice="alice" language="${sayLang}">
      ${reply}
    </Say>
  </Gather>
</Response>
  `);
});

/* ======================
   START SERVER
====================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Twilio human-like AI agent running");
});
