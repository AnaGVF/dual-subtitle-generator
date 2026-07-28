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

type WordChunk = { text: string; timestamp: [number, number] };

/**
 * Returns true if the text token is a non-speech annotation that should be hidden.
 * Matches things like: (soft music), [applause], *laughing*, <music>, etc.
 */
function isNonSpeechAnnotation(text: string): boolean {
  return /^\s*[\(\[\*<][^\)\]\*>]{0,60}[\)\]\*>]\s*$/.test(text);
}

/**
 * Determines whether a word token ends a sentence (has trailing sentence punctuation).
 */
function isSentenceEnd(text: string): boolean {
  return /[.!?。！？]+$/.test(text.trim());
}


/**
 * Groups word-level chunks into sentence-level captions.
 * Each caption spans from the first word's start to the last word's end.
 * A new caption begins after sentence-ending punctuation or after long pauses.
 */
function groupWordsIntoSentences(words: WordChunk[]): Caption[] {
  const captions: Caption[] = [];
  let group: WordChunk[] = [];

  // Minimum hold time per word count: 1 word = 700ms, fades as word count grows
  const getMinHoldMs = (wordCount: number) =>
    Math.max(0, 700 - (wordCount - 1) * 120);

  const flush = (nextStartTime?: number) => {
    if (!group.length) return;
    const text = group.map((w) => w.text).join("").trim();
    if (!text) {
      group = [];
      return;
    }
    const start = group[0].timestamp[0];
    const speechEnd = group[group.length - 1].timestamp[1];
    const wordCount = group.length;

    // Add a small hold so short/single words don't vanish instantly
    const holdSec = getMinHoldMs(wordCount) / 1000;
    let end = speechEnd + holdSec;

    // Never push into the next caption's start time
    if (nextStartTime != null && end > nextStartTime - 0.05) {
      end = Math.max(speechEnd, nextStartTime - 0.05);
    }

    captions.push({
      id: createCaptionId(),
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      source: text,
      translation: ""
    });
    group = [];
  };


  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Skip non-speech annotation tokens like (soft music), [applause], etc.
    if (isNonSpeechAnnotation(word.text)) continue;

    group.push(word);

    const nextWord = words[i + 1];
    const silenceGap = nextWord
      ? nextWord.timestamp[0] - word.timestamp[1]
      : 0;

    // End sentence on punctuation OR on a silence gap > 0.8s
    if (isSentenceEnd(word.text) || silenceGap > 0.8) {
      // Pass the next word's start so we never extend into upcoming speech
      flush(nextWord?.timestamp[0]);
    }
  }

  flush(); // flush any remaining words

  return captions;
}

function normalizeChunks(output: unknown): Caption[] {
  const result = output as {
    text?: string;
    chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
  };

  if (Array.isArray(result.chunks) && result.chunks.length) {
    // Word-level timestamps: each chunk is a single word with a precise [start, end]
    const wordChunks: WordChunk[] = result.chunks
      .map((chunk) => {
        const text = chunk.text ?? "";
        const ts = chunk.timestamp;
        if (!ts || ts[0] == null || ts[1] == null) return null;
        return { text, timestamp: [ts[0], ts[1]] as [number, number] };
      })
      .filter((c): c is WordChunk => c !== null);

    if (wordChunks.length > 0) {
      // Repair non-monotonic timestamps: Whisper sometimes regresses at chunk
      // boundaries, producing a word whose start is earlier than the previous
      // word's end. Clamp those words forward so subtitles never appear early.
      let floor = 0;
      const repaired = wordChunks.map((w) => {
        const start = Math.max(w.timestamp[0], floor);
        const end = Math.max(w.timestamp[1], start + 0.02);
        floor = end;
        return { text: w.text, timestamp: [start, end] as [number, number] };
      });

      return groupWordsIntoSentences(repaired);
    }

    // Phrase-level fallback: chunks span multiple words but have real timestamps
    const phraseChunks = result.chunks
      .map((chunk, index) => {
        const text = chunk.text?.trim() ?? "";
        if (!text) return null;
        const start = Number(chunk.timestamp?.[0] ?? index * 3);
        const end = Number(chunk.timestamp?.[1] ?? start + 3);
        return { start, end: Math.max(end, start + 0.5), text };
      })
      .filter((c): c is { start: number; end: number; text: string } => c !== null);

    return phraseChunks.map((item, i) => {
      const next = phraseChunks[i + 1];
      let end = item.end;
      if (next && end > next.start) {
        end = Math.max(item.start + 0.3, next.start - 0.05);
      }
      return {
        id: createCaptionId(),
        start: Number(item.start.toFixed(2)),
        end: Number(end.toFixed(2)),
        source: item.text,
        translation: ""
      };
    });
  }

  // Fallback: no timestamps at all — evenly space words as captions
  const text = result.text?.trim();
  if (!text) return [];

  const words = text.split(/\s+/);
  const captions: Caption[] = [];

  for (let index = 0; index < words.length; index += 8) {
    const start = (index / 8) * 3;
    captions.push({
      id: createCaptionId(),
      start,
      end: start + 2.8,
      source: words.slice(index, index + 8).join(" "),
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
      return_timestamps: "word",  // word-level timestamps for accurate sentence grouping
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
