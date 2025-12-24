import fetch from "node-fetch";

export async function askAI({ text, language, memory }) {
  const systemPrompt = `
You are a human-like AI caller.
Speak naturally in ${language}.
Never mention language switching.
Be polite and concise.
`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...memory,
    { role: "user", content: text },
  ];

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      messages,
      temperature: 0.3,
    }),
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

