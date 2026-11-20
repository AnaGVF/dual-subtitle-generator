# 🎬 Dual Subtitle Generator

<p align="center">
  <strong>A high-performance, privacy-first web studio for generating, translating, styling, and exporting dual-language subtitles for Reels, TikToks, Shorts, and videos.</strong>
</p>

<p align="center">
  <a href="https://dual-subtitle-generator.vercel.app/"><strong>Explore the Live Studio »</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Live%20on%20Vercel-success?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel Status" />
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.4-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/AI-Whisper%20WASM-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black" alt="Whisper AI" />
  <img src="https://img.shields.io/badge/Privacy-100%25%20In--Browser-10B981?style=for-the-badge" alt="Privacy First" />
</p>

<p align="center">
  <img src="./images/dual%20subtitle%20generator%20preview.png" alt="Dual Subtitle Generator UI Preview" width="100%" />
</p>

---

## 💡 Why Dual Subtitle Generator?

Creating dual-language subtitles for Instagram Reels, TikTok, YouTube Shorts, or language-learning videos usually comes with frustrating tradeoffs:
- **Expensive subscriptions**: Most tools charge monthly fees just to generate basic captions.
- **Privacy concerns**: Cloud-based tools require uploading your private videos to remote servers.
- **Video quality degradation**: Burning subtitles directly into your video forces a re-compression that degrades resolution and colors.

**Dual Subtitle Generator** solves all of this:
1. **100% Client-Side & Private**: AI speech transcription, translation, and rendering happen right in your browser via WebAssembly and Web Workers. Your video never leaves your computer.
2. **Zero Subscriptions or API Keys Needed**: Use free local Whisper models and free translation providers out of the box.
3. **The Green Screen Overlay Innovation**: Instead of re-encoding your original video, export a lightweight, transparent **Green Screen MP4** at up to 60 FPS. Drop it directly onto Track 2 in CapCut, Premiere Pro, or DaVinci Resolve, apply a Chroma Key in 3 clicks, and keep 100% of your camera's native 4K quality!

---

## 🚀 Key Features

### 🎙️ In-Browser Speech-to-Text (Whisper AI)
- **Local Neural Speech Recognition**: Uses OpenAI's Whisper models via `@huggingface/transformers` and ONNX Runtime WebAssembly.
- **Non-Blocking Performance**: Transcription runs inside a dedicated background Web Worker, so your UI, video playback, and controls never freeze or stutter.
- **Model Flexibility**: Choose between *Faster* (`whisper-tiny`), *Balanced* (`whisper-base`), or English-optimized models depending on your hardware.

### 🌐 Dual-Language Translation
- **Multiple Languages**: Supports English, Spanish, German, French, Italian, Portuguese, Dutch, Japanese, Chinese, and more.
- **Decoupled Workflow**: Generate your source transcript first, review or edit the cues, and then translate into your target language.
- **Flexible Providers**: Integrated with public translation providers or your own self-hosted **LibreTranslate** endpoint for complete data sovereignty.

### ✏️ Real-Time Caption & Timeline Editor
- **Interactive Cue Number Jump**: Click directly on any cue number badge (`[ 1 ]`, `[ 2 ]`, etc.) to instantly seek video playback to that exact start timestamp and preview the subtitle.
- **Precision Millisecond Editing**: Tweak start and end timestamps down to deciseconds without clunky number spinner arrows getting in the way.
- **Side-by-Side Dual Lines**: Edit both the spoken line and translated line simultaneously with auto-expanding textareas.
- **Cue Control & Auto-Scroll**: Add manual cues, delete pauses, and enjoy automatic scrolling that highlights the currently spoken caption during playback.

### 🎨 Typography & Visual Studio
- **Curated Font Roster**: Modern creator typography including *Inter*, *Roboto*, *Poppins*, *Outfit*, *Plus Jakarta Sans*, and *Montserrat*.
- **Live Slider Badges**: Adjust Font Size, Vertical Position, Horizontal Position, and Stroke/Outline Width with real-time numeric badges.
- **Dynamic Color Pickers**: Interactive color swatches with live hex tags for Source text, Target text, and Outline stroke.
- **Display Configurations**:
  - Align text: `Left`, `Center`, or `Right`.
  - Mode: `Both` (dual subtitles), `Source only`, or `Target only`.
  - Line Order: Switch between `Source first` or `Target first`.
- **Backdrop & Uppercase**: Toggle high-contrast background pill boxes and instant uppercase text transform.
- **Entrance Micro-Animations**: Choose smooth caption animations (`Fade`, `Rise`, `Pop`).

### 📥 Export & Overlays Hub
- **Interactive Subtitle Files (SRT)**: Select your desired format (`Dual SRT`, `Source SRT`, or `Target SRT`) and click the dynamic export button to trigger an instant download.
- **Green Screen MP4 Video Overlay**:
  - Export a transparent green screen video overlay at **60 FPS (Ultra Smooth)** or **30 FPS (Standard)**.
  - Features an in-modal loading bar with live rendering progress, percentage indicator, completion confirmation, and auto-closing dialog.
  - Drop it into CapCut or Premiere, key out the green, and you have instant animated dual captions!

### 💾 Safe Session Recovery
- **Automatic Caching**: Large video files are saved in your browser's **IndexedDB**, while your captions, styles, and settings are saved in **LocalStorage**.
- **Accidental Close Protection**: Prevents accidental loss of work if you refresh or close the tab while editing.

---

## 🏗️ How it Works Under the Hood

```
   [ Upload Video / Audio ]
              │
              ▼
   [ Web Audio API ] ──────────────► Extracts 16kHz Mono Float32 Audio
              │
              ▼
   [ Web Worker (WASM) ] ──────────► In-Browser Whisper AI Speech Recognition
              │
              ▼
   [ Translation Engine ] ─────────► Dual Subtitle Alignment (Source + Target)
              │
              ▼
   [ Interactive Studio ] ─────────► Real-Time Styling, Typography & Live Preview
              │
              ├───► [ Export SRT Files (Dual / Source / Target) ]
              │
              └───► [ 60 FPS Green Screen MP4 (HTML5 Canvas 2D + mp4-muxer) ]
```

---

## 🎬 How to Use the Green Screen Overlay (CapCut / Premiere / DaVinci)

Exporting a **Green Screen MP4** is the recommended workflow for top content quality:

1. In the studio, click **📥 Export** in the top navigation bar.
2. Select your desired framerate (**60 FPS** for butter-smooth animations or **30 FPS** for standard).
3. Click **Green Screen MP4** and wait for the in-modal progress bar to finish downloading.
4. Open your video editing software (e.g., **CapCut**):
   - Place your original video on **Track 1**.
   - Place the downloaded **Green Screen MP4** on **Track 2** directly above it.
   - Select the green clip on the timeline &rarr; go to **Video** &rarr; **Remove BG** &rarr; check **Chroma Key**.
   - Use the eyedropper color picker to select the green background.
   - Set **Intensity to 85%**.
5. Done! Your dual subtitles now float seamlessly over your video with zero loss in footage quality.

---

## 💻 Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **[React 18](https://react.dev/)** | Reactive user interface & component hierarchy |
| **[TypeScript 5.6](https://www.typescriptlang.org/)** | Type-safe development across workers, audio pipelines, and storage |
| **[Vite 5](https://vitejs.dev/)** | Fast developer server and optimized production bundling |
| **[@huggingface/transformers](https://huggingface.co/docs/transformers.js)** | Client-side neural models (Whisper) running on ONNX Runtime WebAssembly |
| **[mp4-muxer](https://github.com/Vanilagy/mp4-muxer)** & **[mp4box](https://github.com/gpac/mp4box.js)** | Blazing-fast client-side MP4 container creation and multiplexing |
| **Web Audio API** | Real-time audio decoding, resampling, and channel downmixing |
| **HTML5 Canvas 2D** | Frame-by-frame text rendering and 60 FPS video stream generation |
| **IndexedDB & LocalStorage** | Persistent client storage for gigabyte video files and editing sessions |
| **[Lucide Icons](https://lucide.dev/)** | Clean, accessible iconography |
| **Vanilla CSS3** | Custom design tokens, glassmorphism, responsive container queries, and dark/light themes |

---

## 🛠️ Local Development & Setup

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (version **18.0.0** or higher) installed.

### 1. Clone the repository
```bash
git clone https://github.com/AnaGVF/dual-subtitle-generator.git
cd dual-subtitle-generator
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the development server
```bash
npm run dev
```
Open your browser and navigate to:
```text
http://127.0.0.1:5173/
```

### 4. Build for production
```bash
npm run build
npm run preview
```

---

## 🌐 Deployment

The project is pre-configured for one-click deployment on **[Vercel](https://vercel.com/)** via the included `vercel.json` configuration. Simply import the GitHub repository, and Vercel will automatically build and deploy it with global CDN caching.

---

## 👩‍💻 Author & Credits

Created and maintained by:

**Ana Graciela Vassallo Fedotkin**  
- 🌐 **Live Website**: [https://dual-subtitle-generator.vercel.app/](https://dual-subtitle-generator.vercel.app/)  
- 🐙 **GitHub**: [@AnaGVF](https://github.com/AnaGVF)  
- 📁 **Repository**: [dual-subtitle-generator](https://github.com/AnaGVF/dual-subtitle-generator)

---

## 📄 License & Intellectual Property

*Copyright © 2026 Ana Graciela Vassallo Fedotkin. All rights reserved.*  
Personal project built with passion for creators, polyglots, and video editors worldwide.
