import {
  Download,
  FileText,
  HelpCircle,
  Languages,
  Layers,
  Loader2,
  Moon,
  Paintbrush,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Upload,
  WandSparkles
} from "lucide-react";
import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { fontOptions, languages, whisperModels } from "./data/languages";
import { prepareAudioForTranscription } from "./lib/audio";
import {
  exportGreenScreenSubtitleVideo,
  exportTransparentSubtitleOverlay,
  exportVideoWithSubtitles
} from "./lib/exporter";
import {
  captionsToAss,
  captionsToSrt,
  captionsToVtt,
  createCaptionId,
  downloadTextFile,
  formatClockTime,
  getCaptionDisplayLines,
  parseSubtitleFile
} from "./lib/subtitles";
import {
  clearVideoFromStorage,
  loadVideoFromStorage,
  saveVideoToStorage
} from "./lib/storage";
import { translateCaptions } from "./lib/translation";
import type {
  Caption,
  SubtitleAnimation,
  SubtitleStyle,
  TranslationProvider
} from "./types";

const defaultStyle: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: 58,
  fontWeight: 800,
  lineHeight: 1.12,
  horizontal: 50,
  vertical: 78,
  textAlign: "center",
  textColor: "#f8fbff",
  translatedColor: "#ffd166",
  backgroundColor: "rgba(6, 15, 25, 0.72)",
  shadowColor: "rgba(0, 0, 0, 0.66)",
  outlineColor: "#000000",
  outlineWidth: 5,
  showBackground: true,
  uppercase: false,
  animation: "rise",
  sourceFirst: true,
  displayMode: "dual"
};

type WorkerResponse =
  | { type: "status"; message: string }
  | { type: "model-progress"; progress: { status?: string; progress?: number; file?: string } }
  | { type: "done"; captions: Caption[] }
  | { type: "ready" }
  | { type: "error"; message: string };

const animationOptions: Array<{ value: SubtitleAnimation; label: string }> = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "rise", label: "Rise" },
  { value: "pop", label: "Pop" }
];

const providerOptions: Array<{ value: TranslationProvider; label: string }> = [
  { value: "mymemory", label: "MyMemory" },
  { value: "libretranslate", label: "LibreTranslate" }
];

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getFileBaseName = (file: File) =>
  file.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-") || "reel";

type NumericStyleKey = "fontSize" | "vertical" | "horizontal" | "outlineWidth";
type ThemeMode = "light" | "dark";

const numericStyleLimits: Record<NumericStyleKey, [number, number]> = {
  fontSize: [28, 96],
  vertical: [8, 92],
  horizontal: [10, 90],
  outlineWidth: [0, 14]
};

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    return window.localStorage.getItem("dual-subtitle-theme") === "dark"
      ? "dark"
      : "light";
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [captions, setCaptions] = useState<Caption[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("dual_subtitle_captions");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [sourceLanguage, setSourceLanguage] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("dual_subtitle_source_lang")) || "en";
  });
  const [targetLanguage, setTargetLanguage] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("dual_subtitle_target_lang")) || "es";
  });
  const [model, setModel] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("dual_subtitle_model")) || whisperModels[1].id;
  });
  const [provider, setProvider] = useState<TranslationProvider>(() => {
    return (typeof window !== "undefined" && (window.localStorage.getItem("dual_subtitle_provider") as TranslationProvider)) || "mymemory";
  });
  const [libreTranslateUrl, setLibreTranslateUrl] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("dual_subtitle_libre_url")) || "https://libretranslate.com";
  });
  const [style, setStyle] = useState<SubtitleStyle>(() => {
    if (typeof window === "undefined") return defaultStyle;
    try {
      const saved = window.localStorage.getItem("dual_subtitle_style");
      return saved ? { ...defaultStyle, ...JSON.parse(saved) } : defaultStyle;
    } catch {
      return defaultStyle;
    }
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [videoSize, setVideoSize] = useState({ width: 1080, height: 1920 });
  const [previewSize, setPreviewSize] = useState({ width: 360, height: 640 });
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState<"transcribe" | "translate" | "export" | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [exportFps, setExportFps] = useState<30 | 60>(60);
  const [showOverlayGuide, setShowOverlayGuide] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const controlPanelRef = useRef<HTMLElement | null>(null);
  const [controlPanelHeight, setControlPanelHeight] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("dual-subtitle-theme", theme);
  }, [theme]);

  useEffect(() => {
    const element = previewRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        setPreviewSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = controlPanelRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);

      setControlPanelHeight((currentHeight) =>
        Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
      );
    });

    observer.observe(element);
    setControlPanelHeight(Math.ceil(element.getBoundingClientRect().height));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    loadVideoFromStorage().then((savedFile) => {
      if (mounted && savedFile) {
        setVideoFile(savedFile);
        const url = URL.createObjectURL(savedFile);
        setVideoUrl(url);
        setStatus("Restored session video");
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (videoFile) {
      saveVideoToStorage(videoFile);
    }
  }, [videoFile]);

  useEffect(() => {
    try {
      window.localStorage.setItem("dual_subtitle_captions", JSON.stringify(captions));
    } catch (err) {
      console.warn("Failed to persist captions:", err);
    }
  }, [captions]);

  useEffect(() => {
    try {
      window.localStorage.setItem("dual_subtitle_style", JSON.stringify(style));
    } catch (err) {
      console.warn("Failed to persist style:", err);
    }
  }, [style]);

  useEffect(() => {
    try {
      window.localStorage.setItem("dual_subtitle_source_lang", sourceLanguage);
      window.localStorage.setItem("dual_subtitle_target_lang", targetLanguage);
      window.localStorage.setItem("dual_subtitle_model", model);
      window.localStorage.setItem("dual_subtitle_provider", provider);
      window.localStorage.setItem("dual_subtitle_libre_url", libreTranslateUrl);
    } catch (err) {
      console.warn("Failed to persist settings:", err);
    }
  }, [sourceLanguage, targetLanguage, model, provider, libreTranslateUrl]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (videoFile || captions.length > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [videoFile, captions.length]);

  const activeCaption = useMemo(
    () => captions.find((caption) => currentTime >= caption.start && currentTime <= caption.end),
    [captions, currentTime]
  );

  const safeFontSize = Number.isFinite(style.fontSize)
    ? style.fontSize
    : defaultStyle.fontSize;
  const videoAspect = videoSize.width / Math.max(videoSize.height, 1);
  const previewAspect = previewSize.width / Math.max(previewSize.height, 1);
  const renderedVideoWidth =
    previewAspect > videoAspect
      ? previewSize.height * videoAspect
      : previewSize.width;
  const previewFontSize = clampNumber(
    safeFontSize * (renderedVideoWidth / Math.max(videoSize.width, 1)),
    10,
    72
  );
  const previewStrokeWidth = clampNumber(
    style.outlineWidth * (renderedVideoWidth / Math.max(videoSize.width, 1)),
    0,
    10
  );

  const previewSubtitleStyle = {
    left: `${style.horizontal}%`,
    top: `${style.vertical}%`,
    textAlign: style.textAlign,
    fontFamily: `"${style.fontFamily}", sans-serif`,
    "--subtitle-text": style.textColor,
    "--subtitle-translation": style.translatedColor,
    "--subtitle-bg": style.backgroundColor,
    "--subtitle-shadow": style.shadowColor,
    "--subtitle-outline": style.outlineColor,
    "--subtitle-stroke-width": `${previewStrokeWidth}px`,
    "--subtitle-stroke-width-negative": `${-previewStrokeWidth}px`,
    "--subtitle-size": `${previewFontSize}px`,
    "--subtitle-secondary-size": `${Math.max(10, previewFontSize * 0.72)}px`,
    "--subtitle-weight": style.fontWeight,
    "--subtitle-line-height": style.lineHeight
  } as CSSProperties;

  const orderedPreviewLines = activeCaption
    ? getCaptionDisplayLines(activeCaption, style).map((line) => ({
        value: line.text,
        className: line.role === "source" ? "source-line" : "translation-line"
      }))
    : [];

  const setStyleValue = <Key extends keyof SubtitleStyle>(
    key: Key,
    value: SubtitleStyle[Key]
  ) => {
    setStyle((current) => ({ ...current, [key]: value }));
  };

  const updateNumericStyle = (key: NumericStyleKey, value: string) => {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return;
    }

    const [min, max] = numericStyleLimits[key];

    setStyle((current) => ({
      ...current,
      [key]: clampNumber(parsed, min, max)
    }));
  };

  const handleFontSizeInput = (
    event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>
  ) => {
    updateNumericStyle("fontSize", event.currentTarget.value);
  };

  const handleVerticalInput = (
    event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>
  ) => {
    updateNumericStyle("vertical", event.currentTarget.value);
  };

  const handleHorizontalInput = (
    event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>
  ) => {
    updateNumericStyle("horizontal", event.currentTarget.value);
  };

  const handleStrokeWidthInput = (
    event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>
  ) => {
    updateNumericStyle("outlineWidth", event.currentTarget.value);
  };

  const updateCaption = (id: string, patch: Partial<Caption>) => {
    setCaptions((current) =>
      current
        .map((caption) => (caption.id === id ? { ...caption, ...patch } : caption))
        .sort((a, b) => a.start - b.start)
    );
  };

  const addCaption = () => {
    const start = Number(videoRef.current?.currentTime ?? currentTime);

    setCaptions((current) =>
      [
        ...current,
        {
          id: createCaptionId(),
          start,
          end: start + 2.5,
          source: "",
          translation: ""
        }
      ].sort((a, b) => a.start - b.start)
    );
  };

  const removeCaption = (id: string) => {
    setCaptions((current) => current.filter((caption) => caption.id !== id));
  };

  const handleVideoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setCurrentTime(0);
    setStatus("Video loaded");
    setError("");
    saveVideoToStorage(file);
  };

  const handleClearSession = async () => {
    if (!window.confirm("Are you sure you want to clear the video and captions?")) {
      return;
    }

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    setVideoFile(null);
    setVideoUrl("");
    setCaptions([]);
    setCurrentTime(0);
    setStatus("Session cleared");
    try {
      window.localStorage.removeItem("dual_subtitle_captions");
      await clearVideoFromStorage();
    } catch (err) {
      console.error("Failed to clear session:", err);
    }
  };

  const handleSubtitleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const text = await file.text();
    const result = parseSubtitleFile(text);

    if (!result.captions.length) {
      setError("No subtitle cues were found in that file.");
      return;
    }

    setCaptions(result.captions);

    let statusMsg = `${result.captions.length} subtitle cues imported`;
    if (result.detectedSourceColor || result.detectedTargetColor) {
      setStyle((current) => ({
        ...current,
        ...(result.detectedSourceColor ? { textColor: result.detectedSourceColor } : {}),
        ...(result.detectedTargetColor ? { translatedColor: result.detectedTargetColor } : {})
      }));
      statusMsg += " (custom colors preserved)";
    }

    setStatus(statusMsg);
    setError("");
  };

  const getWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("./workers/transcriber.worker.ts", import.meta.url),
        { type: "module" }
      );
    }

    return workerRef.current;
  };

  const generateCaptions = async (autoTranslate = false) => {
    if (!videoFile || busy) {
      return;
    }

    setBusy("transcribe");
    setProgress(0);
    setError("");
    setStatus("Preparing video for local transcription");

    const selectedLanguage = languages.find((language) => language.code === sourceLanguage);
    let preparedAudio: Awaited<ReturnType<typeof prepareAudioForTranscription>>;

    try {
      preparedAudio = await prepareAudioForTranscription(videoFile, (audioProgress) => {
        setStatus(audioProgress.stage);
        setProgress(audioProgress.progress * 0.45);
      });
    } catch (audioError) {
      setBusy(null);
      setProgress(0);
      setStatus("Audio preparation stopped");
      setError(
        audioError instanceof Error
          ? audioError.message
          : "Unable to prepare audio for transcription."
      );
      return;
    }

    setProgress(0.45);
    setStatus("Loading transcription model");

    const worker = getWorker();

    worker.onmessage = async (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === "status") {
        setStatus(message.message);
      }

      if (message.type === "model-progress") {
        const modelProgress = message.progress.progress;
        const label =
          message.progress.file?.split("/").pop() ??
          message.progress.status ??
          "Downloading model";

        setStatus(label);

        if (typeof modelProgress === "number") {
          setProgress(0.45 + (modelProgress / 100) * 0.35);
        }
      }

      if (message.type === "done") {
        if (autoTranslate && message.captions.length > 0) {
          setCaptions(message.captions);
          setBusy("translate");
          setStatus("Translating subtitles...");
          try {
            const translated = await translateCaptions(message.captions, {
              provider,
              sourceLanguage,
              targetLanguage,
              libreTranslateUrl,
              onProgress: (completed, total) => {
                setProgress(0.8 + (total ? (completed / total) * 0.2 : 0.2));
                setStatus(`Translated ${completed} of ${total}`);
              }
            });
            setCaptions(translated);
            setStatus(`${translated.length} dual subtitle cues ready!`);
          } catch (transErr) {
            console.warn("Auto-translation failed:", transErr);
            setStatus(`${message.captions.length} captions generated`);
          } finally {
            setBusy(null);
            setProgress(1);
          }
        } else {
          setCaptions(message.captions);
          setBusy(null);
          setProgress(1);
          setStatus(`${message.captions.length} subtitle cues generated`);
        }
      }

      if (message.type === "error") {
        setBusy(null);
        setProgress(0);
        setStatus("Transcription stopped");
        setError(message.message);
      }
    };

    worker.postMessage(
      {
        type: "transcribe",
        audio: preparedAudio.audio.buffer,
        sampleRate: preparedAudio.sampleRate,
        model,
        language: selectedLanguage?.whisper
      },
      [preparedAudio.audio.buffer]
    );
  };

  const runTranslation = async () => {
    if (!captions.length || busy) {
      return;
    }

    setBusy("translate");
    setProgress(0);
    setError("");
    setStatus("Translating captions");

    try {
      const translated = await translateCaptions(captions, {
        provider,
        sourceLanguage,
        targetLanguage,
        libreTranslateUrl,
        onProgress: (completed, total) => {
          setProgress(total ? completed / total : 1);
          setStatus(`Translated ${completed} of ${total}`);
        }
      });

      setCaptions(translated);
      setProgress(1);
      setStatus("Translation ready");
    } catch (translationError) {
      setError(
        translationError instanceof Error
          ? translationError.message
          : "Translation failed."
      );
      setStatus("Translation stopped");
    } finally {
      setBusy(null);
    }
  };

  const downloadSrt = (mode: "dual" | "source" | "translation") => {
    if (!captions.length) {
      return;
    }

    const suffix = mode === "dual" ? "dual" : mode;
    const name = videoFile ? getFileBaseName(videoFile) : "subtitles";

    downloadTextFile(captionsToSrt(captions, mode, style), `${name}-${suffix}.srt`);
  };

  const downloadAss = () => {
    if (!captions.length) {
      return;
    }

    const name = videoFile ? getFileBaseName(videoFile) : "subtitles";
    downloadTextFile(
      captionsToAss(captions, style, videoSize.width, videoSize.height),
      `${name}-styled.ass`
    );
  };

  const downloadVtt = (mode: "dual" | "source" | "translation" = "dual") => {
    if (!captions.length) {
      return;
    }

    const suffix = mode === "dual" ? "dual" : mode;
    const name = videoFile ? getFileBaseName(videoFile) : "subtitles";

    downloadTextFile(captionsToVtt(captions, mode, style), `${name}-${suffix}.vtt`);
  };

  const exportGreenScreenVideo = async () => {
    if (!captions.length || busy) {
      return;
    }

    const duration =
      videoRef.current?.duration && Number.isFinite(videoRef.current.duration)
        ? videoRef.current.duration
        : Math.max(...captions.map((c) => c.end), 10);

    setBusy("export");
    setProgress(0);
    setError("");
    setStatus(`Rendering Green Screen MP4 at ${exportFps} FPS`);

    try {
      const name = videoFile ? getFileBaseName(videoFile) : "subtitles";
      const result = await exportGreenScreenSubtitleVideo({
        captions,
        style,
        fileBaseName: name,
        duration,
        width: videoSize.width,
        height: videoSize.height,
        fps: exportFps,
        onProgress: (value) => {
          setProgress(value);
          setStatus(`Rendering Green Screen ${exportFps} FPS ${Math.round(value * 100)}%`);
        }
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = result.fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus("Green Screen MP4 ready!");
      setProgress(1);
    } catch (greenScreenError) {
      setError(
        greenScreenError instanceof Error
          ? greenScreenError.message
          : "Green Screen export failed."
      );
      setStatus("Export stopped");
    } finally {
      setBusy(null);
    }
  };

  const exportOverlayVideo = async () => {
    if (!captions.length || busy) {
      return;
    }

    const duration =
      videoRef.current?.duration && Number.isFinite(videoRef.current.duration)
        ? videoRef.current.duration
        : Math.max(...captions.map((c) => c.end), 10);

    setBusy("export");
    setProgress(0);
    setError("");
    setStatus(`Rendering transparent overlay at ${exportFps} FPS`);

    try {
      const name = videoFile ? getFileBaseName(videoFile) : "subtitles";
      const result = await exportTransparentSubtitleOverlay({
        captions,
        style,
        fileBaseName: name,
        duration,
        width: videoSize.width,
        height: videoSize.height,
        fps: exportFps,
        onProgress: (value) => {
          setProgress(value);
          setStatus(`Rendering overlay ${exportFps} FPS ${Math.round(value * 100)}%`);
        }
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = result.fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus("Overlay ready");
      setProgress(1);
    } catch (overlayError) {
      setError(
        overlayError instanceof Error ? overlayError.message : "Overlay export failed."
      );
      setStatus("Export stopped");
    } finally {
      setBusy(null);
    }
  };

  const exportVideo = async () => {
    if (!videoFile || !captions.length || busy) {
      return;
    }

    setBusy("export");
    setProgress(0);
    setError("");
    setStatus(`Rendering video at ${exportFps} FPS`);

    try {
      const result = await exportVideoWithSubtitles({
        videoFile,
        captions,
        style,
        fileBaseName: getFileBaseName(videoFile),
        fps: exportFps,
        onProgress: (value) => {
          setProgress(value);
          setStatus(`Rendering ${exportFps} FPS ${Math.round(value * 100)}%`);
        }
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = result.fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus("Export ready");
      setProgress(1);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
      setStatus("Export stopped");
    } finally {
      setBusy(null);
    }
  };

  const progressVisible = Boolean(busy);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local dual subtitle studio</p>
          <h1>Dual Subtitle Generator</h1>
        </div>
        <div className="status-cluster" aria-live="polite">
          {progressVisible && <Loader2 className="spin" size={18} />}
          <span className="status-pill">{status}</span>
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <div
          className="preview-panel"
          style={controlPanelHeight ? { height: controlPanelHeight } : undefined}
        >
          <div className="upload-row">
            <label className="file-button">
              <Upload size={18} />
              <span>Video</span>
              <input type="file" accept="video/*" onChange={handleVideoUpload} />
            </label>
            <label className="file-button secondary">
              <FileText size={18} />
              <span>SRT/VTT</span>
              <input
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain"
                onChange={handleSubtitleUpload}
              />
            </label>
            {videoFile && (
              <button
                className="icon-text-button secondary"
                type="button"
                onClick={handleClearSession}
                title="Clear current video and captions"
              >
                <RotateCcw size={16} />
                Reset
              </button>
            )}
          </div>

          <div
            className="video-stage"
            ref={previewRef}
          >
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  playsInline
                  onLoadedMetadata={(event) => {
                    const element = event.currentTarget;
                    setVideoSize({
                      width: element.videoWidth || 1080,
                      height: element.videoHeight || 1920
                    });
                  }}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                />
                {activeCaption && (
                  <div
                    key={`${activeCaption.id}-${style.animation}`}
                    className={`subtitle-preview animation-${style.animation} ${
                      style.showBackground ? "with-bg" : ""
                    }`}
                    style={previewSubtitleStyle}
                  >
                    {orderedPreviewLines
                      .filter((line) => line.value.trim())
                      .map((line, index) => (
                        <span className={line.className} key={`${line.className}-${index}`}>
                          {style.uppercase ? line.value.toUpperCase() : line.value}
                        </span>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-stage">
                <Upload size={34} />
                <span>Upload a reel</span>
              </div>
            )}
          </div>

          {progressVisible && (
            <div className="progress-track" aria-label="Progress">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}

          {error && <p className="error-message">{error}</p>}
        </div>

        <aside className="control-panel" ref={controlPanelRef}>
          <section className="control-section">
            <div className="section-title">
              <Languages size={18} />
              <h2>Languages</h2>
            </div>
            <div className="field-grid">
              <label>
                <span>Spoken</span>
                <select
                  value={sourceLanguage}
                  onChange={(event) => setSourceLanguage(event.target.value)}
                >
                  {languages.map((language) => (
                    <option value={language.code} key={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Target</span>
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                >
                  {languages.map((language) => (
                    <option value={language.code} key={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>Whisper model</span>
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                {whisperModels.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                onClick={() => generateCaptions(true)}
                disabled={!videoFile || Boolean(busy)}
                title="Transcribe speech and auto-translate into dual subtitles in one click"
              >
                <WandSparkles size={18} />
                Generate & Translate
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={runTranslation}
                disabled={!captions.length || Boolean(busy)}
                title="Translate or re-translate existing captions"
              >
                <Sparkles size={18} />
                Translate
              </button>
            </div>
            <div className="field-grid">
              <label>
                <span>Provider</span>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as TranslationProvider)}
                >
                  {providerOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Endpoint</span>
                <input
                  value={libreTranslateUrl}
                  onChange={(event) => setLibreTranslateUrl(event.target.value)}
                  disabled={provider !== "libretranslate"}
                />
              </label>
            </div>
          </section>

          <section className="control-section">
            <div className="section-title">
              <Paintbrush size={18} />
              <h2>Style</h2>
            </div>
            <div className="field-grid">
              <label>
                <span>Font</span>
                <select
                  value={style.fontFamily}
                  onChange={(event) => setStyleValue("fontFamily", event.target.value)}
                >
                  {fontOptions.map((font) => (
                    <option value={font} key={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Weight</span>
                <select
                  value={style.fontWeight}
                  onChange={(event) => setStyleValue("fontWeight", Number(event.target.value))}
                >
                  <option value={500}>Medium</option>
                  <option value={700}>Bold</option>
                  <option value={800}>Heavy</option>
                  <option value={900}>Black</option>
                </select>
              </label>
            </div>
            <label>
              <span>Size {safeFontSize}px</span>
              <input
                type="range"
                min={28}
                max={96}
                value={safeFontSize}
                onInput={handleFontSizeInput}
                onChange={handleFontSizeInput}
              />
            </label>
            <label>
              <span>Vertical</span>
              <input
                type="range"
                min={8}
                max={92}
                value={style.vertical}
                onInput={handleVerticalInput}
                onChange={handleVerticalInput}
              />
            </label>
            <label>
              <span>Horizontal</span>
              <input
                type="range"
                min={10}
                max={90}
                value={style.horizontal}
                onInput={handleHorizontalInput}
                onChange={handleHorizontalInput}
              />
            </label>
            <div className="field-grid color-grid">
              <label>
                <span>Source</span>
                <input
                  type="color"
                  value={style.textColor}
                  onChange={(event) => setStyleValue("textColor", event.target.value)}
                />
              </label>
              <label>
                <span>Target</span>
                <input
                  type="color"
                  value={style.translatedColor}
                  onChange={(event) => setStyleValue("translatedColor", event.target.value)}
                />
              </label>
            </div>
            <div className="field-grid color-grid">
              <label>
                <span>Stroke</span>
                <input
                  type="color"
                  value={style.outlineColor}
                  onChange={(event) => setStyleValue("outlineColor", event.target.value)}
                />
              </label>
              <label>
                <span>Stroke width {style.outlineWidth}px</span>
                <input
                  type="range"
                  min={0}
                  max={14}
                  value={style.outlineWidth}
                  onInput={handleStrokeWidthInput}
                  onChange={handleStrokeWidthInput}
                />
              </label>
            </div>
            <div className="segmented">
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  className={style.textAlign === align ? "active" : ""}
                  type="button"
                  key={align}
                  onClick={() => setStyleValue("textAlign", align)}
                >
                  {align}
                </button>
              ))}
            </div>
            <label>
              <span>Display</span>
              <div className="segmented">
                {(["dual", "source", "translation"] as const).map((mode) => (
                  <button
                    className={style.displayMode === mode ? "active" : ""}
                    type="button"
                    key={mode}
                    onClick={() => setStyleValue("displayMode", mode)}
                  >
                    {mode === "dual" ? "Both" : mode === "source" ? "Source" : "Target"}
                  </button>
                ))}
              </div>
            </label>
            <div className="field-grid">
              <label>
                <span>Animation</span>
                <select
                  value={style.animation}
                  onChange={(event) =>
                    setStyleValue("animation", event.target.value as SubtitleAnimation)
                  }
                >
                  {animationOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Line order</span>
                <select
                  value={style.sourceFirst ? "source" : "target"}
                  disabled={style.displayMode !== "dual"}
                  onChange={(event) =>
                    setStyleValue("sourceFirst", event.target.value === "source")
                  }
                >
                  <option value="source">Source first</option>
                  <option value="target">Target first</option>
                </select>
              </label>
            </div>
            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={style.showBackground}
                  onChange={(event) => setStyleValue("showBackground", event.target.checked)}
                />
                <span>Backdrop</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={style.uppercase}
                  onChange={(event) => setStyleValue("uppercase", event.target.checked)}
                />
                <span>Uppercase</span>
              </label>
            </div>
          </section>

          <section className="control-section">
            <div className="section-title">
              <Download size={18} />
              <h2>Export & Overlays</h2>
            </div>

            <div className="export-subsection">
              <div className="subsection-header">
                <span className="subsection-label">Subtitle Overlay Files (Instant)</span>
                <button
                  type="button"
                  className="guide-toggle-btn"
                  onClick={() => setShowOverlayGuide((prev) => !prev)}
                  title="How to overlay on video"
                >
                  <HelpCircle size={14} />
                  <span>How to use</span>
                </button>
              </div>

              {showOverlayGuide && (
                <div className="overlay-guide-box">
                  <p><strong>To overlay subtitles on your video without lag:</strong></p>
                  <ul>
                    <li><strong>Green Screen MP4 (Fastest &amp; 100% styled):</strong> Drag the <code>.mp4</code> onto Track 2 above your video. In CapCut click <em>Video &rarr; Cutout &rarr; Chroma Key</em> and pick green. In Premiere use <em>Ultra Key</em>. In DaVinci use <em>3D Keyer</em>. Your styling is 100% preserved with zero rendering lag!</li>
                    <li><strong>Transparent WebM:</strong> Drag onto Track 2 directly without needing Chroma Key.</li>
                    <li><strong>CapCut SRT:</strong> Click <em>Text</em> &rarr; <em>Local Subtitles / Import</em> to load your <code>.srt</code> or <code>.ass</code>.</li>
                    <li><strong>Premiere Pro:</strong> Drag <code>.srt</code>, <code>.ass</code>, or transparent video right onto the timeline track above your video.</li>
                    <li><strong>DaVinci Resolve:</strong> Drag <code>.srt</code> or <code>.ass</code> onto the Subtitle track.</li>
                  </ul>
                </div>
              )}

              <div className="button-grid-subtitles">
                <button
                  type="button"
                  className="download-pill-btn highlight"
                  onClick={() => downloadSrt("dual")}
                  disabled={!captions.length}
                  title="Download Dual SRT (Source & Translation)"
                >
                  <FileText size={14} />
                  <span>Dual SRT</span>
                </button>
                <button
                  type="button"
                  className="download-pill-btn highlight-ass"
                  onClick={downloadAss}
                  disabled={!captions.length}
                  title="Download Styled SubStation Alpha (.ass) with exact colors & fonts"
                >
                  <FileText size={14} />
                  <span>Styled (.ass)</span>
                </button>
                <button
                  type="button"
                  className="download-pill-btn"
                  onClick={() => downloadSrt("source")}
                  disabled={!captions.length}
                  title="Download Source Language SRT"
                >
                  <span>Source SRT</span>
                </button>
                <button
                  type="button"
                  className="download-pill-btn"
                  onClick={() => downloadSrt("translation")}
                  disabled={!captions.length}
                  title="Download Translated SRT"
                >
                  <span>Target SRT</span>
                </button>
                <button
                  type="button"
                  className="download-pill-btn"
                  onClick={() => downloadVtt("dual")}
                  disabled={!captions.length}
                  title="Download WebVTT (.vtt)"
                >
                  <span>WebVTT</span>
                </button>
              </div>
            </div>

            <div className="export-subsection" style={{ marginTop: "16px" }}>
              <span className="subsection-label">Video Overlays &amp; Burn-in</span>
              <div className="field-grid" style={{ margin: "8px 0 10px" }}>
                <label>
                  <span>Framerate</span>
                  <select
                    value={exportFps}
                    onChange={(e) => setExportFps(Number(e.target.value) as 30 | 60)}
                  >
                    <option value={60}>60 FPS (Ultra Smooth)</option>
                    <option value={30}>30 FPS (Standard)</option>
                  </select>
                </label>
              </div>

              <div className="video-export-actions">
                <button
                  className="export-button green-screen-btn"
                  type="button"
                  onClick={exportGreenScreenVideo}
                  disabled={!captions.length || Boolean(busy)}
                  title="Ultra-fast MP4 overlay (renders in seconds, 0% lag). Drop on Track 2 in CapCut / Premiere / DaVinci and click Chroma Key!"
                >
                  <Sparkles size={18} />
                  <span>Green Screen MP4 (Ultra Fast)</span>
                </button>

                <button
                  className="export-button secondary-overlay-btn"
                  type="button"
                  onClick={exportOverlayVideo}
                  disabled={!captions.length || Boolean(busy)}
                  title="Export transparent video overlay (.webm with alpha) to drop onto Track 2 in CapCut / Premiere / DaVinci"
                >
                  <Layers size={18} />
                  <span>Transparent Overlay (.webm)</span>
                </button>

                <button
                  className="export-button"
                  type="button"
                  onClick={exportVideo}
                  disabled={!videoFile || !captions.length || Boolean(busy)}
                  title="Burn subtitles directly into video file"
                >
                  <Download size={18} />
                  <span>Burn into Video ({exportFps} FPS)</span>
                </button>
              </div>
            </div>
          </section>
        </aside>

        <section
          className="editor-panel"
          style={controlPanelHeight ? { height: controlPanelHeight } : undefined}
        >
        <div className="editor-header">
          <div className="section-title">
            <Type size={18} />
            <h2>Caption Editor</h2>
          </div>
          <div className="editor-meta">
            <Settings2 size={16} />
            <span>{captions.length} cues</span>
            <span>{formatClockTime(currentTime)}</span>
            <button
              className="icon-text-button add-cue-btn"
              type="button"
              onClick={addCaption}
              title="Add caption at current playback time"
            >
              <Plus size={16} />
              <span>Add</span>
            </button>
          </div>
        </div>

        {captions.length ? (
          <div className="caption-list">
            {captions.map((caption, index) => (
              <article
                className={activeCaption?.id === caption.id ? "caption-row active" : "caption-row"}
                key={caption.id}
              >
                <div className="row-index">{index + 1}</div>
                <div className="time-fields">
                  <label>
                    <span>Start</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(caption.start.toFixed(1))}
                      onChange={(event) =>
                        updateCaption(caption.id, {
                          start: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(caption.end.toFixed(1))}
                      onChange={(event) =>
                        updateCaption(caption.id, {
                          end: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>
                <label className="text-field">
                  <span>Source line</span>
                  <textarea
                    value={caption.source}
                    onChange={(event) =>
                      updateCaption(caption.id, {
                        source: event.target.value
                      })
                    }
                  />
                </label>
                <label className="text-field">
                  <span>Target line</span>
                  <textarea
                    value={caption.translation}
                    onChange={(event) =>
                      updateCaption(caption.id, {
                        translation: event.target.value
                      })
                    }
                  />
                </label>
                <button
                  className="icon-button danger"
                  type="button"
                  title="Delete caption"
                  onClick={() => removeCaption(caption.id)}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-editor">
            <FileText size={28} />
            <span>No captions yet</span>
            {videoFile ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => generateCaptions(true)}
                disabled={Boolean(busy)}
                style={{ marginTop: "10px", gap: "8px", maxWidth: "220px" }}
              >
                <WandSparkles size={16} />
                <span>Generate Subtitles</span>
              </button>
            ) : (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "6px 0 0" }}>
                Upload a video or import an SRT file to start
              </p>
            )}
            <button
              className="icon-text-button secondary add-cue-btn"
              type="button"
              onClick={addCaption}
              style={{ maxWidth: "160px", marginTop: "8px" }}
            >
              <Plus size={14} />
              <span>Add manual cue</span>
            </button>
          </div>
        )}
      </section>
      </section>

      <footer className="app-footer">
      © All rights reserved by Ana Vassallo
      </footer>
    </main>
  );
}
