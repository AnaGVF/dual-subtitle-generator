# Dual Subtitle Generator

A local-first React editor for creating dual subtitles on reels.

## What it does

- Upload a video reel in the browser.
- Generate source-language captions with free local Whisper models through Transformers.js.
- Translate captions with free text translation providers.
- Edit timing, source text, and translated text manually.
- Choose font, placement, colors, line order, backdrop, and simple subtitle animations.
- Export a final video with burned-in dual subtitles using the browser MediaRecorder.
- Download source, target, or dual `.srt` files.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints, usually:

```text
http://127.0.0.1:5173/
```

## Notes

The transcription model downloads the first time you use it. That is free, but it can take a while depending on the model and connection. Translation is text-only and uses free providers; for more privacy, run your own LibreTranslate server and paste its endpoint in the app.
