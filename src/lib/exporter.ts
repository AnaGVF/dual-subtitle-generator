import type { Caption, ExportResult, SubtitleStyle } from "../types";

type ExportOptions = {
  videoFile: File;
  captions: Caption[];
  style: SubtitleStyle;
  fileBaseName: string;
  onProgress?: (progress: number) => void;
};

type AudioContextConstructor = typeof AudioContext;

type WindowWithWebAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

const mimeCandidates = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm"
];

function getSupportedMimeType() {
  return (
    mimeCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ??
    ""
  );
}

function getAudioContextConstructor() {
  const browserWindow = window as WindowWithWebAudio;
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
}

function waitForEvent<T extends Event>(
  target: EventTarget,
  eventName: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onEvent = (event: Event) => {
      cleanup();
      resolve(event as T);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Unable to load video for ${eventName}`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };

    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function findCaption(captions: Caption[], time: number) {
  return captions.find((caption) => time >= caption.start && time <= caption.end);
}

function splitLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function getAnimationState(
  animation: SubtitleStyle["animation"],
  caption: Caption,
  time: number
) {
  if (animation === "none") {
    return { alpha: 1, offsetY: 0, scale: 1 };
  }

  const intro = Math.min(1, Math.max(0, (time - caption.start) / 0.28));
  const outro = Math.min(1, Math.max(0, (caption.end - time) / 0.22));
  const amount = Math.min(intro, outro);
  const eased = 1 - Math.pow(1 - amount, 3);

  if (animation === "rise") {
    return { alpha: eased, offsetY: (1 - eased) * 24, scale: 1 };
  }

  if (animation === "pop") {
    return { alpha: eased, offsetY: 0, scale: 0.92 + eased * 0.08 };
  }

  return { alpha: eased, offsetY: 0, scale: 1 };
}

function drawTextBlock(
  context: CanvasRenderingContext2D,
  lines: Array<{ text: string; role: "source" | "translation"; size: number }>,
  caption: Caption,
  style: SubtitleStyle,
  time: number,
  canvasWidth: number,
  canvasHeight: number
) {
  if (!lines.length) {
    return;
  }

  const animation = getAnimationState(style.animation, caption, time);
  const maxWidth = canvasWidth * 0.86;
  const paddingX = Math.max(18, canvasWidth * 0.02);
  const paddingY = Math.max(14, canvasHeight * 0.012);
  const gap = Math.max(6, style.fontSize * 0.2);
  const wrappedLines: Array<{
    text: string;
    role: "source" | "translation";
    size: number;
    width: number;
  }> = [];

  for (const line of lines) {
    context.font = `${style.fontWeight} ${line.size}px "${style.fontFamily}", sans-serif`;
    splitLines(context, line.text, maxWidth).forEach((piece) => {
      wrappedLines.push({
        ...line,
        text: piece,
        width: context.measureText(piece).width
      });
    });
  }

  const lineHeights = wrappedLines.map((line) => line.size * style.lineHeight);
  const blockHeight =
    lineHeights.reduce((total, height) => total + height, 0) +
    gap * Math.max(0, wrappedLines.length - 1);
  const blockWidth =
    Math.min(
      maxWidth,
      Math.max(...wrappedLines.map((line) => line.width), style.fontSize * 4)
    ) +
    paddingX * 2;
  const centerX = (style.horizontal / 100) * canvasWidth;
  const centerY = (style.vertical / 100) * canvasHeight + animation.offsetY;
  const boxX = Math.min(
    canvasWidth - blockWidth - 12,
    Math.max(12, centerX - blockWidth / 2)
  );
  const boxY = Math.min(
    canvasHeight - blockHeight - paddingY * 2 - 12,
    Math.max(12, centerY - blockHeight / 2)
  );

  context.save();
  context.globalAlpha = animation.alpha;
  context.translate(centerX, centerY);
  context.scale(animation.scale, animation.scale);
  context.translate(-centerX, -centerY);

  if (style.showBackground) {
    context.fillStyle = style.backgroundColor;
    roundRect(
      context,
      boxX,
      boxY,
      blockWidth,
      blockHeight + paddingY * 2,
      Math.max(10, style.fontSize * 0.22)
    );
    context.fill();
  }

  let cursorY = boxY + paddingY;

  for (let index = 0; index < wrappedLines.length; index += 1) {
    const line = wrappedLines[index];
    const lineHeight = lineHeights[index];
    const y = cursorY + lineHeight * 0.78;
    const x =
      style.textAlign === "left"
        ? boxX + paddingX
        : style.textAlign === "right"
          ? boxX + blockWidth - paddingX
          : boxX + blockWidth / 2;

    context.font = `${style.fontWeight} ${line.size}px "${style.fontFamily}", sans-serif`;
    context.textAlign = style.textAlign;
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.shadowColor = style.shadowColor;
    context.shadowBlur = Math.max(2, line.size * 0.13);
    context.strokeStyle = style.outlineColor;
    context.lineWidth = Math.max(
      0,
      style.outlineWidth * (line.size / Math.max(style.fontSize, 1))
    );
    context.fillStyle =
      line.role === "translation" ? style.translatedColor : style.textColor;

    if (context.lineWidth > 0) {
      context.strokeText(line.text, x, y);
    }

    context.fillText(line.text, x, y);
    cursorY += lineHeight + gap;
  }

  context.restore();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawSubtitles(
  context: CanvasRenderingContext2D,
  caption: Caption | undefined,
  style: SubtitleStyle,
  time: number,
  canvasWidth: number,
  canvasHeight: number
) {
  if (!caption) {
    return;
  }

  const source = style.uppercase
    ? caption.source.toUpperCase()
    : caption.source;
  const translation = style.uppercase
    ? caption.translation.toUpperCase()
    : caption.translation;

  const primarySize = style.fontSize;
  const secondarySize = Math.round(style.fontSize * 0.72);
  const orderedLines = style.sourceFirst
    ? [
        { text: source, role: "source" as const, size: secondarySize },
        { text: translation, role: "translation" as const, size: primarySize }
      ]
    : [
        { text: translation, role: "translation" as const, size: primarySize },
        { text: source, role: "source" as const, size: secondarySize }
      ];

  drawTextBlock(
    context,
    orderedLines.filter((line) => line.text.trim()),
    caption,
    style,
    time,
    canvasWidth,
    canvasHeight
  );
}

export async function exportVideoWithSubtitles({
  videoFile,
  captions,
  style,
  fileBaseName,
  onProgress
}: ExportOptions): Promise<ExportResult> {
  if (!("MediaRecorder" in window)) {
    throw new Error("This browser does not support MediaRecorder exports.");
  }

  const videoUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas rendering is unavailable.");
  }

  video.src = videoUrl;
  video.muted = false;
  video.volume = 1;
  video.playsInline = true;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.append(video);

  await waitForEvent(video, "loadedmetadata");

  canvas.width = video.videoWidth || 1080;
  canvas.height = video.videoHeight || 1920;

  const fps = 30;
  const canvasStream = canvas.captureStream(fps);
  let audioContext: AudioContext | undefined;
  let audioSource: MediaElementAudioSourceNode | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;

  try {
    const AudioContextClass = getAudioContextConstructor();

    if (!AudioContextClass) {
      throw new Error("AudioContext is unavailable.");
    }

    audioContext = new AudioContextClass();
    audioSource = audioContext.createMediaElementSource(video);
    audioDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioDestination);
    audioDestination.stream.getAudioTracks().forEach((track) => {
      canvasStream.addTrack(track);
    });
  } catch {
    // Video-only export still works if the browser blocks media element audio.
  }

  const mimeType = getSupportedMimeType();
  const videoBitsPerSecond = Math.min(
    50_000_000,
    Math.max(12_000_000, canvas.width * canvas.height * 8)
  );
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    audioBitsPerSecond: 192_000,
    videoBitsPerSecond
  });
  const lastCaption = captions[captions.length - 1];
  const duration = video.duration || lastCaption?.end || 1;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) {
      chunks.push(event.data);
    }
  });

  const stopped = waitForEvent(recorder, "stop");

  await audioContext?.resume();

  video.currentTime = 0;
  await waitForEvent(video, "seeked");

  const drawFrame = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawSubtitles(
      context,
      findCaption(captions, video.currentTime),
      style,
      video.currentTime,
      canvas.width,
      canvas.height
    );
    onProgress?.(Math.min(0.99, video.currentTime / duration));

    if (!video.ended && !video.paused) {
      requestAnimationFrame(drawFrame);
    }
  };

  recorder.start(1000);
  await video.play();
  drawFrame();

  await new Promise<void>((resolve) => {
    video.addEventListener(
      "ended",
      () => {
        onProgress?.(1);
        recorder.stop();
        resolve();
      },
      { once: true }
    );
  });

  await stopped;
  audioSource?.disconnect();
  audioDestination?.disconnect();
  await audioContext?.close();
  URL.revokeObjectURL(videoUrl);
  video.remove();

  canvasStream.getTracks().forEach((track) => track.stop());

  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type: mimeType || "video/webm" });

  return {
    blob,
    fileName: `${fileBaseName}-dual-subtitles.${extension}`
  };
}
