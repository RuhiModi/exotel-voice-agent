import axios from "axios";

export async function speechToText(audioUrl) {
  // Google STT supports auto language detection
  return {
    text: "User said something",
    language: "gu-IN" // gu-IN | hi-IN | en-IN
  };
}
