// server.js (ESM)
// Run: npm install express cors multer node-fetch pdfjs-dist
// Env: GEMINI_KEY=...  GOOGLE_TTS_KEY=...  VOICE_NAME=en-US-Standard-C  PORT=3000
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// PDF (works in Node): use legacy build
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_KEY || "";
const VOICE_NAME = process.env.VOICE_NAME || "en-US-Standard-C"; // safe default

if (!GEMINI_KEY) console.log("❌ Missing GEMINI_KEY");
if (!GOOGLE_TTS_KEY) console.log("❌ Missing GOOGLE_TTS_KEY");
console.log("Gemini Key:", GEMINI_KEY ? "✅ Loaded" : "❌ Missing");
console.log("GOOGLE_TTS_KEY:", GOOGLE_TTS_KEY ? "✅ Loaded" : "❌ Missing");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // serve avatar.png, index.html, etc.

// ---- In-memory store of uploaded text (simple demo)
let uploadedTexts = []; // each item: { filename, text }

// ---- Multer: in-memory (we parse directly)
const upload = multer({ storage: multer.memoryStorage() });

// ---- Gemini v1beta (2.0-flash works here)
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
  GEMINI_KEY;

// ------------------------- CHAT -------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const user = (req.body?.user || "").toString();

    // Compose context from uploaded texts (truncate to avoid huge prompts)
    const context =
      uploadedTexts.length > 0
        ? "\n\nContext from user files:\n" +
          uploadedTexts
            .map(
              (f, i) =>
                `— ${f.filename} —\n${(f.text || "").slice(0, 1500)}${
                  (f.text || "").length > 1500 ? "…[truncated]" : ""
                }\n`
            )
            .join("\n")
        : "";

    const prompt = `You are "Jarvis", a holographic AI assistant.
Be concise, intelligent, slightly futuristic but friendly.
Write like a natural human, avoid sounding canned.
At the very end, include a single line exactly:
META: {"emotion":"neutral","tone":"calm"}

User: ${user}${context}
Jarvis:`;

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("⚠️ Gemini returned non-OK:", data);
      return res
        .status(503)
        .json({ error: "Gemini temporarily overloaded. Try again." });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm thinking...";
    // Strip the META line from what we show
    const lines = text.split("\n");
    const metaLine = lines.find((l) => l.trim().startsWith("META:"));
    const reply = lines
      .filter((l) => !l.trim().startsWith("META:"))
      .join("\n")
      .trim();
    const meta = metaLine ? safeParseMeta(metaLine) : {};

    res.json({ reply, meta });
  } catch (err) {
    console.error("Gemini Error:", err);
    res.status(500).json({ error: "Gemini failed" });
  }
});

function safeParseMeta(line) {
  try {
    const json = line.replace(/^META:\s*/i, "").trim();
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// ------------------------- TTS (Google) -------------------------
app.post("/api/tts", async (req, res) => {
  try {
    if (!GOOGLE_TTS_KEY) {
      return res.status(500).json({ error: "Missing GOOGLE_TTS_KEY" });
    }
    const text = (req.body?.text || "").toString().slice(0, 1000) || "Hello.";
    const ttsUrl =
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
      GOOGLE_TTS_KEY;

    // Use text input (not SSML) for simplicity
    const payload = {
      input: { text },
      voice: {
        languageCode: VOICE_NAME.split("-").slice(0, 2).join("-") || "en-US",
        name: VOICE_NAME,
        ssmlGender: "NEUTRAL",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0,
        pitch: 0.0,
      },
    };

    const r = await fetch(ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || !data?.audioContent) {
      console.error("TTS error:", data);
      return res.status(500).json({ error: "TTS failed" });
    }
    res.json({ audioContent: data.audioContent });
  } catch (err) {
    console.error("TTS Exception:", err);
    res.status(500).json({ error: "TTS failed" });
  }
});

// ------------------------- FILE UPLOAD (PDF/TXT) -------------------------
app.post("/api/file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file" });

    const { originalname, buffer, mimetype } = req.file;
    let extracted = "";

    if (
      mimetype === "application/pdf" ||
      originalname.toLowerCase().endsWith(".pdf")
    ) {
      // pdfjs-dist requires Uint8Array
      const uint8 = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({ data: uint8 });
      const pdf = await loadingTask.promise;

      let all = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((it) => it.str).join(" ");
        all.push(text);
      }
      extracted = all.join("\n\n");
    } else {
      // Simple text-like files
      extracted = buffer.toString("utf8");
    }

    // Keep in memory (append/replace same file name)
    uploadedTexts = uploadedTexts.filter((f) => f.filename !== originalname);
    uploadedTexts.push({ filename: originalname, text: extracted || "" });

    res.json({ ok: true, filename: originalname });
  } catch (err) {
    console.error("Upload Exception:", err);
    res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

// ------------------------- SERVE INDEX -------------------------
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(
    `🚀 Jarvis (Hologram UI • Chat • TTS • Upload) → http://localhost:${PORT}`
  );
});