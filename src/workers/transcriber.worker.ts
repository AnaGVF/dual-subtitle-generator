import { env, pipeline } from "@huggingface/transformers";
import type { Caption } from "../types";
import { createCaptionId } from "../lib/subtitles";

env.allowLocalModels = false;

type WorkerRequest =
  | {
      type: "transcribe";
      audio: ArrayBuffer;
      sampleRate: number;
      model: string;
      language?: string;
    }
  | {
      type: "warm";
      model: string;
    };

type PipelineProgress = {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let currentModel = "";
type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>
) => Promise<unknown>;

let transcriber: Transcriber | null = null;

const post = (message: Record<string, unknown>) => {
  self.postMessage(message);
};

async function getTranscriber(model: string) {
  if (transcriber && currentModel === model) {
    return transcriber;
  }

  post({
    type: "status",
    message: "Loading local Whisper model"
  });

  transcriber = (await pipeline("automatic-speech-recognition", model, {
    progress_callback: (progress: PipelineProgress) => {
      post({
        type: "model-progress",
        progress
      });
    }
  })) as unknown as Transcriber;
  currentModel = model;

  return transcriber;
}

function normalizeChunks(output: unknown): Caption[] {
  const result = output as {
    text?: string;
    chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
  };

  if (Array.isArray(result.chunks) && result.chunks.length) {
    return result.chunks
      .map((chunk, index) => {
        const start = Number(chunk.timestamp?.[0] ?? index * 3);
        const end = Number(chunk.timestamp?.[1] ?? start + 3);

        return {
          id: createCaptionId(),
          start,
          end: Math.max(end, start + 0.8),
          source: chunk.text?.trim() ?? "",
          translation: ""
        };
      })
      .filter((caption) => caption.source);
  }

  const text = result.text?.trim();

  if (!text) {
    return [];
  }

  const words = text.split(/\s+/);
  const captions: Caption[] = [];

  for (let index = 0; index < words.length; index += 10) {
    const start = (index / 10) * 3;
    captions.push({
      id: createCaptionId(),
      start,
      end: start + 3,
      source: words.slice(index, index + 10).join(" "),
      translation: ""
    });
  }

  return captions;
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    const recognizer = await getTranscriber(request.model);

    if (request.type === "warm") {
      post({
        type: "ready"
      });
      return;
    }

    post({
      type: "status",
      message:
        request.sampleRate === 16_000
          ? "Transcribing audio"
          : "Transcribing resampled audio"
    });

    const options: Record<string, unknown> = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: "transcribe"
    };

    if (request.language) {
      options.language = request.language;
    }

    const output = await recognizer(new Float32Array(request.audio), options);

    post({
      type: "done",
      captions: normalizeChunks(output)
    });
  } catch (error) {
    post({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Transcription failed in the browser worker."
    });
  }
});
