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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
