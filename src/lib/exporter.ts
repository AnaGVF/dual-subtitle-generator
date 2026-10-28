import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Caption, ExportResult, SubtitleStyle } from "../types";
import { getCaptionDisplayLines } from "./subtitles";

export type ExportOptions = {
  videoFile: File;
  captions: Caption[];
  style: SubtitleStyle;
  fileBaseName: string;
  fps?: number;
  onProgress?: (progress: number) => void;
};

type AudioContextConstructor = typeof AudioContext;

type WindowWithWebAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

const mimeCandidates = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4"
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

type WrappedLine = {
  text: string;
  role: "source" | "translation";
  size: number;
  width: number;
};

type CaptionLayout = {
  wrappedLines: WrappedLine[];
  lineHeights: number[];
  blockHeight: number;
  blockWidth: number;
  gap: number;
  paddingX: number;
  paddingY: number;
};

const layoutCache = new Map<string, CaptionLayout>();

function getCaptionLayout(
  context: CanvasRenderingContext2D,
  caption: Caption,
  style: SubtitleStyle,
  canvasWidth: number,
  canvasHeight: number
): CaptionLayout {
  const cacheKey = `${caption.id}_${canvasWidth}_${style.fontSize}_${style.fontWeight}_${style.fontFamily}_${style.lineHeight}_${style.displayMode}_${style.sourceFirst}_${style.uppercase}`;
  const cached = layoutCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const primarySize = style.fontSize;
  const secondarySize = Math.round(style.fontSize * 0.72);
  const displayLines = getCaptionDisplayLines(caption, style);
  const orderedLines = displayLines.map((line) => {
    const text = style.uppercase ? line.text.toUpperCase() : line.text;
    const size =
      style.displayMode === "dual"
        ? line.role === "source"
          ? primarySize
          : secondarySize
        : primarySize;

    return { text, role: line.role, size };
  });

  const maxWidth = canvasWidth * 0.86;
  const paddingX = Math.max(18, canvasWidth * 0.02);
  const paddingY = Math.max(14, canvasHeight * 0.012);
  const gap = Math.max(6, style.fontSize * 0.2);
  const wrappedLines: WrappedLine[] = [];

  for (const line of orderedLines) {
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

  const layout: CaptionLayout = {
    wrappedLines,
    lineHeights,
    blockHeight,
    blockWidth,
    gap,
    paddingX,
    paddingY
  };

  layoutCache.set(cacheKey, layout);
  return layout;
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

  const layout = getCaptionLayout(context, caption, style, canvasWidth, canvasHeight);
  const { wrappedLines, lineHeights, blockHeight, blockWidth, gap, paddingX, paddingY } = layout;

  if (!wrappedLines.length) {
    return;
  }

  const animation = getAnimationState(style.animation, caption, time);
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

function canUseWebCodecs() {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.0001) {
      resolve();
      return;
    }

    let timer: number;
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };

    // Safety timeout in case seeked doesn't fire (e.g. past end of file)
    timer = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }, 400);

    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = Math.min(video.duration || time, Math.max(0, time));
  });
}

async function getBestVideoEncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<{ config: VideoEncoderConfig; width: number; height: number }> {
  const codecCandidates = [
    "avc1.640033", // High Profile 5.1
    "avc1.64002a", // High Profile 4.2
    "avc1.4d002a", // Main Profile 4.2
    "avc1.42001f"  // Baseline Profile 3.1
  ];

  // Try original resolution first
  for (const codec of codecCandidates) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: "quality"
    };

    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) {
        return { config, width, height };
      }
    } catch {
      // Continue to next candidate
    }
  }

  // If 4K / ultra-high res is unsupported by hardware H.264, scale to max 1920
  const maxDim = 1920;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    const scaledWidth = Math.floor((width * scale) / 2) * 2;
    const scaledHeight = Math.floor((height * scale) / 2) * 2;
    const scaledBitrate = Math.max(6_000_000, Math.round(bitrate * scale * scale));

    for (const codec of codecCandidates) {
      const config: VideoEncoderConfig = {
        codec,
        width: scaledWidth,
        height: scaledHeight,
        bitrate: scaledBitrate,
        framerate: fps,
        latencyMode: "quality"
      };

      try {
        const res = await VideoEncoder.isConfigSupported(config);
        if (res.supported) {
          return { config, width: scaledWidth, height: scaledHeight };
        }
      } catch {
        // Continue to next candidate
      }
    }
  }

  // Fallback config
  const fallbackWidth = Math.min(width, 1920);
  const fallbackHeight = Math.min(height, 1080);
  return {
    config: {
      codec: "avc1.42001f",
      width: fallbackWidth,
      height: fallbackHeight,
      bitrate: 8_000_000,
      framerate: fps,
      latencyMode: "quality"
    },
    width: fallbackWidth,
    height: fallbackHeight
  };
}

export async function exportVideoWithSubtitles(
  options: ExportOptions
): Promise<ExportResult> {
  if (canUseWebCodecs()) {
    try {
      return await exportWithWebCodecs(options);
    } catch (err) {
      console.warn("WebCodecs export failed, falling back to MediaRecorder:", err);
      return await exportWithMediaRecorder(options);
    }
  }

  return exportWithMediaRecorder(options);
}

class UnsupportedCodecError extends Error {}

async function exportWithWebCodecs({
  videoFile,
  captions,
  style,
  fileBaseName,
  fps = 60,
  onProgress
}: ExportOptions): Promise<ExportResult> {
  layoutCache.clear();

  const videoUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    URL.revokeObjectURL(videoUrl);
    throw new Error("Canvas rendering is unavailable.");
  }

  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.top = "0";
  video.style.left = "0";
  video.style.width = "320px";
  video.style.height = "240px";
  video.style.opacity = "0.01";
  video.style.pointerEvents = "none";
  video.style.zIndex = "-99999";
  document.body.append(video);

  const cleanup = () => {
    URL.revokeObjectURL(videoUrl);
    video.remove();
    layoutCache.clear();
  };

  try {
    await waitForEvent(video, "loadedmetadata");

    const rawWidth = video.videoWidth || 1080;
    const rawHeight = video.videoHeight || 1920;
    const initialWidth = Math.floor(rawWidth / 2) * 2;
    const initialHeight = Math.floor(rawHeight / 2) * 2;

    const duration = video.duration || 1;
    const outputFps = fps === 30 ? 30 : 60;

    // ---- Audio: decode the original track so it is re-encoded cleanly ----
    let audioBuffer: AudioBuffer | undefined;
    try {
      const AudioContextClass = getAudioContextConstructor();
      if (AudioContextClass) {
        const decodeContext = new AudioContextClass();
        audioBuffer = await decodeContext.decodeAudioData(
          await videoFile.arrayBuffer()
        );
        await decodeContext.close();
      }
    } catch {
      audioBuffer = undefined; // video without decodable audio
    }

    const audioCodec = audioBuffer
      ? (await AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: Math.min(2, audioBuffer.numberOfChannels),
          bitrate: 192_000
        })).supported
        ? "aac"
        : "opus"
      : undefined;

    // ---- Video encoder config negotiation ----
    const targetBitrate = Math.min(
      30_000_000,
      Math.max(8_000_000, Math.round(initialWidth * initialHeight * outputFps * 0.12))
    );
    const { config: videoConfig, width, height } = await getBestVideoEncoderConfig(
      initialWidth,
      initialHeight,
      outputFps,
      targetBitrate
    );

    canvas.width = width;
    canvas.height = height;

    const target = new ArrayBufferTarget();
    const numberOfChannels = audioBuffer
      ? Math.min(2, audioBuffer.numberOfChannels)
      : 0;
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width, height, frameRate: outputFps },
      audio: audioBuffer
        ? {
            codec: audioCodec === "aac" ? "aac" : "opus",
            numberOfChannels,
            sampleRate: audioBuffer.sampleRate
          }
        : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset"
    });

    let encoderError: Error | undefined;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        encoderError = error;
      }
    });
    videoEncoder.configure(videoConfig);

    // ---- Encode audio up front (fast, no playback needed) ----
    if (audioBuffer && audioCodec) {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (error) => {
          encoderError = error;
        }
      });
      audioEncoder.configure({
        codec: audioCodec === "aac" ? "mp4a.40.2" : "opus",
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels,
        bitrate: 192_000
      });

      const chunkFrames = 4096;
      const total = audioBuffer.length;

      for (let offset = 0; offset < total; offset += chunkFrames) {
        const frames = Math.min(chunkFrames, total - offset);
        const planar = new Float32Array(frames * numberOfChannels);

        for (let channel = 0; channel < numberOfChannels; channel += 1) {
          planar.set(
            audioBuffer.getChannelData(channel).subarray(offset, offset + frames),
            channel * frames
          );
        }

        const audioData = new AudioData({
          format: "f32-planar",
          sampleRate: audioBuffer.sampleRate,
          numberOfFrames: frames,
          numberOfChannels,
          timestamp: Math.round((offset / audioBuffer.sampleRate) * 1_000_000),
          data: planar
        });
        audioEncoder.encode(audioData);
        audioData.close();

        if (audioEncoder.encodeQueueSize > 16) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

    // ---- Frame-by-frame deterministic offline video rendering ----
    video.pause();

    const totalFrames = Math.max(1, Math.round(duration * outputFps));
    const frameDurationMicros = Math.round(1_000_000 / outputFps);
    const keyFrameInterval = outputFps; // One keyframe every second

    // Pre-seek to first frame
    await seekVideo(video, 0);

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (encoderError) {
        throw encoderError;
      }

      const frameTime = frameIndex / outputFps;

      // Seek video to exact frame timestamp
      if (frameIndex > 0) {
        await seekVideo(video, frameTime);
      }

      // Draw base video frame
      context.drawImage(video, 0, 0, width, height);

      // Draw styled subtitle if active at this timestamp
      const caption = findCaption(captions, frameTime);
      if (caption) {
        drawSubtitles(context, caption, style, frameTime, width, height);
      }

      // Encode frame with precise constant framerate timestamps
      const videoFrame = new VideoFrame(canvas, {
        timestamp: frameIndex * frameDurationMicros,
        duration: frameDurationMicros
      });

      videoEncoder.encode(videoFrame, {
        keyFrame: frameIndex % keyFrameInterval === 0
      });
      videoFrame.close();

      // Backpressure: pause if encoder buffer fills up
      if (videoEncoder.encodeQueueSize > 6) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (videoEncoder.encodeQueueSize <= 2 || encoderError) {
              resolve();
            } else {
              setTimeout(check, 8);
            }
          };
          check();
        });
      }

      // Smooth, precise progress reporting
      onProgress?.(Math.min(0.99, (frameIndex + 1) / totalFrames));
    }

    if (encoderError) {
      throw encoderError;
    }

    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();

    onProgress?.(1);

    return {
      blob: new Blob([target.buffer], { type: "video/mp4" }),
      fileName: `${fileBaseName}-dual-subtitles-${outputFps}fps.mp4`
    };
  } finally {
    cleanup();
  }
}

async function exportWithMediaRecorder({
  videoFile,
  captions,
  style,
  fileBaseName,
  fps = 60,
  onProgress
}: ExportOptions): Promise<ExportResult> {
  if (!("MediaRecorder" in window)) {
    throw new Error("This browser does not support MediaRecorder exports.");
  }

  layoutCache.clear();

  const videoUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false, desynchronized: true }) ?? canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas rendering is unavailable.");
  }

  video.src = videoUrl;
  video.muted = false;
  video.volume = 1;
  video.playsInline = true;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.top = "0";
  video.style.left = "0";
  video.style.width = "320px";
  video.style.height = "240px";
  video.style.opacity = "0.01";
  video.style.pointerEvents = "none";
  video.style.zIndex = "-99999";
  document.body.append(video);

  await waitForEvent(video, "loadedmetadata");

  const rawWidth = video.videoWidth || 1080;
  const rawHeight = video.videoHeight || 1920;
  canvas.width = Math.floor(rawWidth / 2) * 2;
  canvas.height = Math.floor(rawHeight / 2) * 2;

  const targetFps = fps || 60;
  const canvasStream = canvas.captureStream(targetFps);
  let audioContext: AudioContext | undefined;
  let audioSource: MediaElementAudioSourceNode | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;

  try {
    const AudioContextClass = getAudioContextConstructor();

    if (AudioContextClass) {
      audioContext = new AudioContextClass();
      audioSource = audioContext.createMediaElementSource(video);
      audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);

      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;
      audioSource.connect(muteGain);
      muteGain.connect(audioContext.destination);

      audioDestination.stream.getAudioTracks().forEach((track) => {
        canvasStream.addTrack(track);
      });
    }
  } catch {
    // Video-only export still works if media element audio is blocked
  }

  const mimeType = getSupportedMimeType();
  const videoBitsPerSecond = Math.min(
    14_000_000,
    Math.max(6_000_000, Math.round(canvas.width * canvas.height * (targetFps >= 60 ? 4 : 3)))
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

  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener("error", (e) => {
      console.warn("MediaRecorder event warning:", e);
      resolve();
    }, { once: true });
  });

  await audioContext?.resume();

  if (Math.abs(video.currentTime) > 0.05) {
    video.currentTime = 0;
    await Promise.race([
      waitForEvent(video, "seeked"),
      new Promise((res) => setTimeout(res, 400))
    ]);
  }

  let isRunning = true;
  let rafId: number | undefined;
  let finished = false;

  const finishExport = () => {
    if (finished) return;
    finished = true;
    isRunning = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    onProgress?.(1);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const renderFrame = () => {
    if (!isRunning || finished) return;

    if (video.readyState >= 2) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const activeCaption = findCaption(captions, video.currentTime);
      if (activeCaption) {
        drawSubtitles(
          context,
          activeCaption,
          style,
          video.currentTime,
          canvas.width,
          canvas.height
        );
      }
    }

    const current = video.currentTime;
    onProgress?.(Math.min(0.99, current / duration));

    if (video.paused && !video.ended && !finished) {
      video.play().catch(() => {});
    }

    if (video.ended || current >= duration - 0.05) {
      finishExport();
      return;
    }

    rafId = requestAnimationFrame(renderFrame);
  };

  video.addEventListener("ended", finishExport, { once: true });
  video.addEventListener("error", finishExport, { once: true });

  recorder.start(1000);
  await video.play().catch(() => {});
  renderFrame();

  const watchdog = setInterval(() => {
    if (finished) {
      clearInterval(watchdog);
      return;
    }
    if (video.ended || video.currentTime >= duration - 0.08) {
      clearInterval(watchdog);
      finishExport();
    } else if (video.paused) {
      video.play().catch(() => {});
    }
  }, 400);

  await stopped;
  clearInterval(watchdog);
  finishExport();

  audioSource?.disconnect();
  audioDestination?.disconnect();
  await audioContext?.close();
  URL.revokeObjectURL(videoUrl);
  video.remove();
  layoutCache.clear();

  canvasStream.getTracks().forEach((track) => track.stop());

  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type: mimeType || "video/webm" });

  return {
    blob,
    fileName: `${fileBaseName}-dual-subtitles-60fps.${extension}`
  };
}

export type TransparentOverlayOptions = {
  captions: Caption[];
  style: SubtitleStyle;
  fileBaseName: string;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (progress: number) => void;
};

export async function exportTransparentSubtitleOverlay({
  captions,
  style,
  fileBaseName,
  duration,
  width = 1080,
  height = 1920,
  fps = 60,
  onProgress
}: TransparentOverlayOptions): Promise<ExportResult> {
  if (!("MediaRecorder" in window)) {
    throw new Error("This browser does not support MediaRecorder exports.");
  }

  layoutCache.clear();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });

  if (!context) {
    throw new Error("Canvas context is unavailable.");
  }

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  const canvasStream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: 10_000_000
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  let finished = false;
  let rafId = 0;
  const startTime = performance.now();

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start(1000);

  const renderFrame = () => {
    if (finished) return;

    const currentTime = (performance.now() - startTime) / 1000;
    context.clearRect(0, 0, width, height);

    const activeCaption = findCaption(captions, currentTime);
    if (activeCaption) {
      drawSubtitles(context, activeCaption, style, currentTime, width, height);
    }

    onProgress?.(Math.min(0.99, currentTime / Math.max(duration, 0.1)));

    if (currentTime >= duration) {
      finish();
      return;
    }

    rafId = requestAnimationFrame(renderFrame);
  };

  renderFrame();

  await stopped;
  canvasStream.getTracks().forEach((track) => track.stop());
  layoutCache.clear();

  const blob = new Blob(chunks, { type: mimeType });

  return {
    blob,
    fileName: `${fileBaseName}-transparent-overlay-${fps}fps.webm`
  };
}

export type GreenScreenOverlayOptions = {
  captions: Caption[];
  style: SubtitleStyle;
  fileBaseName: string;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (progress: number) => void;
};

export async function exportGreenScreenSubtitleVideo({
  captions,
  style,
  fileBaseName,
  duration,
  width = 1080,
  height = 1920,
  fps = 60,
  onProgress
}: GreenScreenOverlayOptions): Promise<ExportResult> {
  if (canUseWebCodecs()) {
    try {
      return await exportGreenScreenWithWebCodecs({
        captions,
        style,
        fileBaseName,
        duration,
        width,
        height,
        fps,
        onProgress
      });
    } catch (err) {
      console.warn("WebCodecs green screen export failed, falling back to MediaRecorder:", err);
    }
  }

  return exportGreenScreenWithMediaRecorder({
    captions,
    style,
    fileBaseName,
    duration,
    width,
    height,
    fps,
    onProgress
  });
}

async function exportGreenScreenWithWebCodecs({
  captions,
  style,
  fileBaseName,
  duration,
  width = 1080,
  height = 1920,
  fps = 60,
  onProgress
}: GreenScreenOverlayOptions): Promise<ExportResult> {
  layoutCache.clear();

  const outputFps = fps === 30 ? 30 : 60;
  const initialWidth = Math.floor(width / 2) * 2;
  const initialHeight = Math.floor(height / 2) * 2;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Canvas context is unavailable.");
  }

  const targetBitrate = Math.min(
    25_000_000,
    Math.max(6_000_000, Math.round(initialWidth * initialHeight * outputFps * 0.08))
  );

  const { config: videoConfig, width: finalWidth, height: finalHeight } =
    await getBestVideoEncoderConfig(
      initialWidth,
      initialHeight,
      outputFps,
      targetBitrate
    );

  canvas.width = finalWidth;
  canvas.height = finalHeight;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: finalWidth, height: finalHeight, frameRate: outputFps },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });

  let encoderError: Error | undefined;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    }
  });
  videoEncoder.configure(videoConfig);

  const totalFrames = Math.max(1, Math.round(duration * outputFps));
  const frameDurationMicros = Math.round(1_000_000 / outputFps);
  const keyFrameInterval = outputFps; // 1 keyframe per second

  // Pure Chroma Key Green: #00FF00
  const chromaGreen = "#00FF00";

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    if (encoderError) {
      throw encoderError;
    }

    const frameTime = frameIndex / outputFps;

    // Solid green background
    context.fillStyle = chromaGreen;
    context.fillRect(0, 0, finalWidth, finalHeight);

    // Draw active subtitles
    const activeCaption = findCaption(captions, frameTime);
    if (activeCaption) {
      drawSubtitles(context, activeCaption, style, frameTime, finalWidth, finalHeight);
    }

    const videoFrame = new VideoFrame(canvas, {
      timestamp: frameIndex * frameDurationMicros,
      duration: frameDurationMicros
    });

    videoEncoder.encode(videoFrame, {
      keyFrame: frameIndex % keyFrameInterval === 0
    });
    videoFrame.close();

    // Backpressure: pause if encoder queue fills up
    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (videoEncoder.encodeQueueSize <= 3 || encoderError) {
            resolve();
          } else {
            setTimeout(check, 4);
          }
        };
        check();
      });
    }

    if (frameIndex % 10 === 0 || frameIndex === totalFrames - 1) {
      onProgress?.(Math.min(0.99, (frameIndex + 1) / totalFrames));
    }
  }

  if (encoderError) {
    throw encoderError;
  }

  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();
  layoutCache.clear();

  onProgress?.(1);

  return {
    blob: new Blob([target.buffer], { type: "video/mp4" }),
    fileName: `${fileBaseName}-green-screen-${outputFps}fps.mp4`
  };
}

async function exportGreenScreenWithMediaRecorder({
  captions,
  style,
  fileBaseName,
  duration,
  width = 1080,
  height = 1920,
  fps = 60,
  onProgress
}: GreenScreenOverlayOptions): Promise<ExportResult> {
  layoutCache.clear();

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width / 2) * 2;
  canvas.height = Math.floor(height / 2) * 2;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Canvas context is unavailable.");
  }

  const mimeType = "video/mp4";
  const actualMimeType = MediaRecorder.isTypeSupported(mimeType)
    ? mimeType
    : MediaRecorder.isTypeSupported("video/webm")
    ? "video/webm"
    : "";

  const canvasStream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(canvasStream, {
    mimeType: actualMimeType || undefined,
    videoBitsPerSecond: 12_000_000
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  let finished = false;
  let rafId = 0;
  const startTime = performance.now();

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start(1000);

  const renderFrame = () => {
    if (finished) return;

    const currentTime = (performance.now() - startTime) / 1000;
    context.fillStyle = "#00FF00";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const activeCaption = findCaption(captions, currentTime);
    if (activeCaption) {
      drawSubtitles(context, activeCaption, style, currentTime, canvas.width, canvas.height);
    }

    onProgress?.(Math.min(0.99, currentTime / Math.max(duration, 0.1)));

    if (currentTime >= duration) {
      finish();
      return;
    }

    rafId = requestAnimationFrame(renderFrame);
  };

  renderFrame();

  await stopped;
  canvasStream.getTracks().forEach((track) => track.stop());
  layoutCache.clear();

  const ext = actualMimeType.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type: actualMimeType || "video/mp4" });

  return {
    blob,
    fileName: `${fileBaseName}-green-screen-${fps}fps.${ext}`
  };
}
