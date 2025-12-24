import speech from "@google-cloud/speech";

const client = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_STT_CREDENTIALS),
});

export async function speechToText(audioUrl) {
  if (!audioUrl) return { text: "", language: "gu-IN" };

  const request = {
    audio: { uri: audioUrl },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 8000,
      languageCode: "gu-IN",
      alternativeLanguageCodes: ["hi-IN", "en-IN"],
      enableAutomaticPunctuation: true,
    },
  };

  const [response] = await client.recognize(request);
  const result = response.results?.[0];

  return {
    text: result?.alternatives?.[0]?.transcript || "",
    language: result?.languageCode || "gu-IN",
  };
}
