export function sayAndRecord(text, language) {
  return `
<Response>
  <Say language="${language}">${text}</Say>
  <Record action="/process-response" method="POST" />
</Response>`;
}

export function sayAndHandoff(text, language, number) {
  return `
<Response>
  <Say language="${language}">${text}</Say>
  <Dial><Number>${number}</Number></Dial>
</Response>`;
}
