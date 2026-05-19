const TARGET_SAMPLE_RATE = 16_000;

export type AudioPreparationProgress = {
  stage: string;
  progress: number;
};

type ProgressCallback = (progress: AudioPreparationProgress) => void;

type AudioContextConstructor = typeof AudioContext;

type WindowWithWebAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

export type PreparedAudio = {
  audio: Float32Array;
  sampleRate: number;
};

function getAudioContextConstructor() {
  const browserWindow = window as WindowWithWebAudio;
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
}

function mixToMono(audioBuffer: AudioBuffer) {
  const output = new Float32Array(audioBuffer.length);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);

    for (let index = 0; index < channelData.length; index += 1) {
      output[index] += channelData[index] / audioBuffer.numberOfChannels;
    }
  }

  return output;
}

function resampleLinear(
  audio: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
) {
  if (sourceSampleRate === targetSampleRate) {
    return audio;
  }

  const outputLength = Math.max(
    1,
    Math.round(audio.length * (targetSampleRate / sourceSampleRate))
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(audio.length - 1, lower + 1);
    const fraction = position - lower;

    output[index] = audio[lower] * (1 - fraction) + audio[upper] * fraction;
  }

  return output;
}

function concatenateChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

async function decodeWithAudioContext(
  file: File,
  onProgress?: ProgressCallback
): Promise<PreparedAudio> {
  const AudioContextClass = getAudioContextConstructor();

  if (!AudioContextClass) {
    throw new Error("AudioContext is not available in this browser.");
  }

  onProgress?.({
    stage: "Decoding audio",
    progress: 0.05
  });

  const context = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE });

  try {
    const buffer = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const mono = mixToMono(decoded);
    const audio = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);

    onProgress?.({
      stage: "Audio decoded",
      progress: 1
    });

    return {
      audio,
      sampleRate: TARGET_SAMPLE_RATE
    };
  } finally {
    await context.close();
  }
}

function waitForMediaEvent<T extends Event>(
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
      reject(new Error("The browser could not load audio from this video."));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };

    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function captureFromMediaElement(
  file: File,
  onProgress?: ProgressCallback
): Promise<PreparedAudio> {
  const AudioContextClass = getAudioContextConstructor();

  if (!AudioContextClass) {
    throw new Error("AudioContext is not available in this browser.");
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  const context = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE });
  const source = context.createMediaElementSource(video);
  const processor = context.createScriptProcessor(4096, 2, 1);
  const silentOutput = context.createGain();
  const chunks: Float32Array[] = [];
  let animationFrame = 0;

  silentOutput.gain.value = 0;
  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(context.destination);

  video.src = url;
  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  video.volume = 1;
  video.style.position = "fixed";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.append(video);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer;
    const chunk = new Float32Array(input.length);

    for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
      const channelData = input.getChannelData(channel);

      for (let index = 0; index < input.length; index += 1) {
        chunk[index] += channelData[index] / input.numberOfChannels;
      }
    }

    chunks.push(chunk);
  };

  const reportProgress = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const progress = duration ? Math.min(video.currentTime / duration, 0.98) : 0.35;

    onProgress?.({
      stage: "Extracting audio from video",
      progress
    });

    animationFrame = requestAnimationFrame(reportProgress);
  };

  try {
    await waitForMediaEvent(video, "loadedmetadata");
    await context.resume();

    video.currentTime = 0;
    reportProgress();
    await video.play();
    await waitForMediaEvent(video, "ended");

    const captured = concatenateChunks(chunks);
    const audio = resampleLinear(captured, context.sampleRate, TARGET_SAMPLE_RATE);

    onProgress?.({
      stage: "Audio extracted",
      progress: 1
    });

    return {
      audio,
      sampleRate: TARGET_SAMPLE_RATE
    };
  } finally {
    cancelAnimationFrame(animationFrame);
    processor.disconnect();
    source.disconnect();
    silentOutput.disconnect();
    video.remove();
    URL.revokeObjectURL(url);
    await context.close();
  }
}

export async function prepareAudioForTranscription(
  file: File,
  onProgress?: ProgressCallback
): Promise<PreparedAudio> {
  try {
    const decoded = await decodeWithAudioContext(file, onProgress);

    if (decoded.audio.length) {
      return decoded;
    }
  } catch {
    onProgress?.({
      stage: "Switching to video audio extraction",
      progress: 0
    });
  }

  const captured = await captureFromMediaElement(file, onProgress);

  if (!captured.audio.length) {
    throw new Error("No audio samples could be extracted from this video.");
  }

  return captured;
}

