# Jarvis Holographic Companion

1. Edit `.env` with your Gemini & Google TTS keys.
2. Run `npm install`
3. Start the app: `npm start`
4. Open http://localhost:3000

Type something, Jarvis will respond in real time with voice.
Upload a file for Jarivs to review.

Create a .env file with the follow contents
# Jarvis Hologram Environment Variables

# Google Gemini API Key (required for AI chat functionality)
# Get your key from: https://makersuite.google.com/app/apikey
GEMINI_KEY=your_gemini_api_key_here

# Google Text-to-Speech API Key (required for voice synthesis)
# Get your key from: https://console.cloud.google.com/apis/credentials
GOOGLE_TTS_KEY=your_google_tts_api_key_here

# Voice configuration for TTS (optional - has default)
VOICE_NAME=en-US-Standard-C

# Server port (optional - defaults to 3000)
PORT=3000
