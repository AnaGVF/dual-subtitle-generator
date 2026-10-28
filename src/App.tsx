import {
  Check,
  Clock,
  Download,
  FileText,
  Film,
  HelpCircle,
  Languages,
  Layers,
  Loader2,
  Moon,
  Paintbrush,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Upload,
  WandSparkles,
  X
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
  exportGreenScreenSubtitleVideo
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
  const [showGreenScreenGuide, setShowGreenScreenGuide] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [selectedSrtMode, setSelectedSrtMode] = useState<"dual" | "source" | "translation">("dual");
  const [srtSuccess, setSrtSuccess] = useState(false);
  const [notifyFeedback, setNotifyFeedback] = useState<{ message: string; type: "save" | "reset" } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

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
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!showExportModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowExportModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showExportModal]);

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
    setNotifyFeedback({ message: "Session cleared", type: "reset" });
    setTimeout(() => setNotifyFeedback(null), 2800);
    try {
      window.localStorage.removeItem("dual_subtitle_captions");
      await clearVideoFromStorage();
    } catch (err) {
      console.error("Failed to clear session:", err);
    }
  };

  const handleSaveSession = async () => {
    try {
      if (videoFile) {
        await saveVideoToStorage(videoFile);
      }
      window.localStorage.setItem("dual_subtitle_captions", JSON.stringify(captions));
      window.localStorage.setItem("dual_subtitle_style", JSON.stringify(style));
      window.localStorage.setItem("dual_subtitle_source_lang", sourceLanguage);
      window.localStorage.setItem("dual_subtitle_target_lang", targetLanguage);
      window.localStorage.setItem("dual_subtitle_model", model);
      window.localStorage.setItem("dual_subtitle_provider", provider);
      window.localStorage.setItem("dual_subtitle_libre_url", libreTranslateUrl);

      setSavedFeedback(true);
      setNotifyFeedback({ message: "Progress saved", type: "save" });
      setStatus("Project saved!");
      setTimeout(() => setSavedFeedback(false), 2200);
      setTimeout(() => setNotifyFeedback(null), 2800);
      setTimeout(() => setStatus("Ready"), 3000);
    } catch (err) {
      console.error("Failed to save project:", err);
      setError("Failed to save project.");
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

  const handleExportSrt = () => {
    if (!captions.length) return;
    downloadSrt(selectedSrtMode);
    setSrtSuccess(true);
    setNotifyFeedback({
      message: `${selectedSrtMode === "dual" ? "Dual" : selectedSrtMode === "source" ? "Source" : "Target"} SRT downloaded`,
      type: "save"
    });
    setTimeout(() => setNotifyFeedback(null), 3000);
    setTimeout(() => {
      setShowExportModal(false);
      setSrtSuccess(false);
    }, 1200);
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
      setStatus("Download successful!");
      setProgress(1);
      setExportSuccess(true);
      setNotifyFeedback({ message: "Download successful", type: "save" });
      setTimeout(() => setNotifyFeedback(null), 3500);

      setTimeout(() => {
        setShowExportModal(false);
        setExportSuccess(false);
      }, 1400);
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

  const progressVisible = Boolean(busy);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">The dual subtitle studio</p>
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
          <button
            className="topbar-export-btn"
            type="button"
            onClick={() => setShowExportModal(true)}
            disabled={!captions.length}
            title={captions.length ? "Export Subtitles & Green Screen MP4" : "Generate captions to enable export"}
          >
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="preview-panel">
          <div className="panel-header-row">
            <div className="section-title">
              <Film size={18} />
              <h2>Preview</h2>
            </div>
            <div className="upload-row">
              {notifyFeedback && (
                <div className={`action-toast-text ${notifyFeedback.type}`} role="status">
                  {notifyFeedback.type === "save" ? <Check size={14} /> : <RotateCcw size={14} />}
                  <span>{notifyFeedback.message}</span>
                </div>
              )}
              <label className="file-button highlight">
                <Upload size={16} />
                <span>Video</span>
                <input type="file" accept="video/*" onChange={handleVideoUpload} />
              </label>
              {(videoFile || captions.length > 0) && (
                <>
                  <button
                    className="icon-text-button btn-save"
                    type="button"
                    onClick={handleSaveSession}
                    title="Save current video, captions, and styles"
                  >
                    {savedFeedback ? <Check size={15} /> : <Save size={15} />}
                    <span>{savedFeedback ? "Saved!" : "Save"}</span>
                  </button>
                  <button
                    className="icon-text-button btn-reset"
                    type="button"
                    onClick={handleClearSession}
                    title="Clear current video and captions"
                  >
                    <RotateCcw size={15} />
                    <span>Reset</span>
                  </button>
                </>
              )}
            </div>
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
                    className={`subtitle-preview animation-${style.animation} ${style.showBackground ? "with-bg" : ""
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

        <aside className="control-panel">
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
                onClick={() => generateCaptions(false)}
                disabled={!videoFile || Boolean(busy)}
                title="Transcribe speech into subtitles"
              >
                <WandSparkles size={18} />
                Generate
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
            <div className={provider === "libretranslate" ? "field-grid" : ""}>
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
              {provider === "libretranslate" && (
                <label>
                  <span>Endpoint</span>
                  <input
                    value={libreTranslateUrl}
                    onChange={(event) => setLibreTranslateUrl(event.target.value)}
                  />
                </label>
              )}
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
            <label className="slider-field">
              <div className="slider-header">
                <span>Size</span>
                <span className="slider-badge">{safeFontSize}px</span>
              </div>
              <input
                type="range"
                min={28}
                max={96}
                value={safeFontSize}
                onInput={handleFontSizeInput}
                onChange={handleFontSizeInput}
              />
            </label>
            <label className="slider-field">
              <div className="slider-header">
                <span>Vertical</span>
                <span className="slider-badge">{style.vertical}%</span>
              </div>
              <input
                type="range"
                min={8}
                max={92}
                value={style.vertical}
                onInput={handleVerticalInput}
                onChange={handleVerticalInput}
              />
            </label>
            <label className="slider-field">
              <div className="slider-header">
                <span>Horizontal</span>
                <span className="slider-badge">{style.horizontal}%</span>
              </div>
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
                <div className="slider-header">
                  <span>Source</span>
                </div>
                <div className="color-swatch-box">
                  <input
                    type="color"
                    value={style.textColor}
                    onChange={(event) => setStyleValue("textColor", event.target.value)}
                  />
                  <span className="swatch-color-dot" style={{ background: style.textColor }} />
                  <span className="color-hex">{style.textColor.toUpperCase()}</span>
                </div>
              </label>
              <label>
                <div className="slider-header">
                  <span>Target</span>
                </div>
                <div className="color-swatch-box">
                  <input
                    type="color"
                    value={style.translatedColor}
                    onChange={(event) => setStyleValue("translatedColor", event.target.value)}
                  />
                  <span className="swatch-color-dot" style={{ background: style.translatedColor }} />
                  <span className="color-hex">{style.translatedColor.toUpperCase()}</span>
                </div>
              </label>
            </div>
            <div className="field-grid color-grid">
              <label>
                <div className="slider-header">
                  <span>Stroke</span>
                </div>
                <div className="color-swatch-box">
                  <input
                    type="color"
                    value={style.outlineColor}
                    onChange={(event) => setStyleValue("outlineColor", event.target.value)}
                  />
                  <span className="swatch-color-dot" style={{ background: style.outlineColor }} />
                  <span className="color-hex">{style.outlineColor.toUpperCase()}</span>
                </div>
              </label>
              <label className="slider-field">
                <div className="slider-header">
                  <span>Stroke width</span>
                  <span className="slider-badge">{style.outlineWidth}px</span>
                </div>
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
        </aside>

        <section className="editor-panel">
          <div className="editor-header">
            <div className="section-title">
              <Type size={18} />
              <h2>Caption Editor</h2>
            </div>
            <div className="editor-meta">
              <span className="meta-pill">
                <Layers size={13} />
                <span>{captions.length} cues</span>
              </span>
              <span className="meta-pill">
                <Clock size={13} />
                <span>{formatClockTime(currentTime)}</span>
              </span>
              <button
                className="icon-text-button add-cue-btn primary-glow"
                type="button"
                onClick={addCaption}
                title="Add caption at current playback time"
              >
                <Plus size={15} />
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

      {showExportModal && (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title" id="modal-title">
                <Download size={20} className="modal-icon" />
                <h2>Export &amp; Overlays</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowExportModal(false)}
                aria-label="Close export dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="export-subsection">
                <div className="subsection-header">
                  <span className="subsection-label">Subtitle Files (SRT)</span>
                </div>

                <div className="button-grid-subtitles">
                  <button
                    type="button"
                    className={`download-pill-btn ${selectedSrtMode === "dual" ? "highlight" : ""}`}
                    onClick={() => setSelectedSrtMode("dual")}
                    title="Select Dual language subtitles (Source &amp; Translation together)"
                  >
                    <FileText size={15} />
                    <span>Dual SRT</span>
                  </button>
                  <button
                    type="button"
                    className={`download-pill-btn ${selectedSrtMode === "source" ? "highlight" : ""}`}
                    onClick={() => setSelectedSrtMode("source")}
                    title="Select Source Language subtitles only"
                  >
                    <span>Source SRT</span>
                  </button>
                  <button
                    type="button"
                    className={`download-pill-btn ${selectedSrtMode === "translation" ? "highlight" : ""}`}
                    onClick={() => setSelectedSrtMode("translation")}
                    title="Select Translated Target subtitles only"
                  >
                    <span>Target SRT</span>
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
                  <button
                    type="button"
                    className={`export-button srt-export-btn ${srtSuccess ? "success" : ""}`}
                    style={{
                      width: "100%",
                      maxWidth: "280px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px"
                    }}
                    onClick={handleExportSrt}
                    disabled={!captions.length || srtSuccess}
                    title={`Export ${selectedSrtMode === "dual" ? "Dual" : selectedSrtMode === "source" ? "Source" : "Target"} SRT file`}
                  >
                    {srtSuccess ? (
                      <>
                        <Check size={17} />
                        <span>Download successful!</span>
                      </>
                    ) : (
                      <>
                        <Download size={17} />
                        <span>
                          {selectedSrtMode === "dual"
                            ? "Export Dual SRT"
                            : selectedSrtMode === "source"
                            ? "Export Source SRT"
                            : "Export Target SRT"}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="export-subsection" style={{ marginTop: "20px" }}>
                <div className="subsection-header" style={{ justifyContent: "center" }}>
                  <span className="subsection-label">Video Overlay (Green Screen)</span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    margin: "12px 0 10px",
                    textAlign: "center"
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      width: "100%",
                      maxWidth: "280px",
                      gap: "6px"
                    }}
                  >
                    <span style={{ fontSize: "0.82rem", fontWeight: 800 }}>Framerate</span>
                    <select
                      value={exportFps}
                      onChange={(e) => setExportFps(Number(e.target.value) as 30 | 60)}
                      style={{
                        textAlign: "center",
                        textAlignLast: "center",
                        width: "100%",
                        cursor: "pointer"
                      }}
                    >
                      <option value={60}>60 FPS (Ultra Smooth)</option>
                      <option value={30}>30 FPS (Standard)</option>
                    </select>
                  </label>
                </div>

                <div
                  className="video-export-actions"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "100%"
                  }}
                >
                  <button
                    className={`export-button green-screen-btn ${exportSuccess ? "success" : ""}`}
                    type="button"
                    style={{
                      width: "100%",
                      maxWidth: "280px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    onClick={exportGreenScreenVideo}
                    disabled={!captions.length || Boolean(busy) || exportSuccess}
                    title="Export Green Screen MP4 with all styles to drop onto Track 2 in CapCut / Premiere / DaVinci"
                  >
                    {busy === "export" ? (
                      <>
                        <Loader2 className="spin" size={18} />
                        <span>Rendering {Math.round(progress * 100)}%</span>
                      </>
                    ) : exportSuccess ? (
                      <>
                        <Check size={18} />
                        <span>Download successful!</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        <span>Green Screen MP4</span>
                      </>
                    )}
                  </button>

                  {(busy === "export" || exportSuccess) && (
                    <div className="modal-progress-box" role="progressbar" aria-valuenow={exportSuccess ? 100 : Math.round(progress * 100)}>
                      <div className="modal-progress-info">
                        <span className="modal-progress-label">
                          {exportSuccess ? <Check size={14} /> : <Loader2 className="spin" size={13} />}
                          <span>{exportSuccess ? "Download successful!" : status}</span>
                        </span>
                        <span className="modal-progress-pct">{exportSuccess ? "100%" : `${Math.round(progress * 100)}%`}</span>
                      </div>
                      <div className="progress-track" aria-label="Export Progress">
                        <span style={{ width: exportSuccess ? "100%" : `${Math.round(progress * 100)}%` }} />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="guide-toggle-btn"
                    onClick={() => setShowGreenScreenGuide((prev) => !prev)}
                    title="How to use in CapCut (Intensity 85%)"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      marginTop: "10px",
                      padding: "4px 10px",
                      cursor: "pointer"
                    }}
                  >
                    <HelpCircle size={15} />
                    <span>How to use</span>
                  </button>
                </div>

                {showGreenScreenGuide && (
                  <div className="overlay-guide-box" style={{ marginTop: "12px" }}>
                    <p><strong>How to use in CapCut:</strong></p>
                    <ol style={{ margin: "0 0 4px 18px", padding: 0, fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <li>Drop the downloaded <strong>Green Screen MP4</strong> onto <strong>Track 2</strong> directly above your video.</li>
                      <li>Click the green clip on the timeline &rarr; go to <strong>Video</strong> &rarr; <strong>Remove BG</strong>.</li>
                      <li>Check <strong>Chroma key</strong>.</li>
                      <li>Click the <strong>Color picker</strong> (eyedropper) &amp; click on the green background.</li>
                      <li>Set <strong>Intensity to 85</strong>.</li>
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
