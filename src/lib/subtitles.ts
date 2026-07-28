import type { Caption, SubtitleDisplayMode, SubtitleStyle } from "../types";

export type CaptionDisplayLine = {
  text: string;
  role: "source" | "translation";
};

const timePattern =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?/;

export const createCaptionId = () =>
  `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function parseTimestamp(value: string): number {
  const match = value.trim().match(timePattern);

  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const ms = Number((match[4] ?? "0").padEnd(3, "0").slice(0, 3));

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

export function formatClockTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;

  return `${minutes}:${remaining.toFixed(1).padStart(4, "0")}`;
}

export function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function parseSubtitleFile(input: string): Caption[] {
  const normalized = input.replace(/\r/g, "").replace(/^WEBVTT.*\n/i, "");
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));

      if (timingIndex === -1) {
        return null;
      }

      const [startRaw, endRaw] = lines[timingIndex].split("-->");
      const text = lines.slice(timingIndex + 1).join(" ").trim();

      return {
        id: createCaptionId(),
        start: parseTimestamp(startRaw),
        end: parseTimestamp(endRaw),
        source: text,
        translation: ""
      };
    })
    .filter((caption): caption is Caption => Boolean(caption))
    .sort((a, b) => a.start - b.start);
}

export function getCaptionDisplayLines(
  caption: Caption,
  options: Pick<SubtitleStyle, "displayMode" | "sourceFirst">
): CaptionDisplayLine[] {
  const source = caption.source.trim();
  const translation = caption.translation.trim();

  if (options.displayMode === "source") {
    return source ? [{ text: source, role: "source" }] : [];
  }

  if (options.displayMode === "translation") {
    const text = translation || source;

    if (!text) {
      return [];
    }

    return [{ text, role: translation ? "translation" : "source" }];
  }

  const lines = options.sourceFirst
    ? [
        { text: source, role: "source" as const },
        { text: translation, role: "translation" as const }
      ]
    : [
        { text: translation, role: "translation" as const },
        { text: source, role: "source" as const }
      ];

  return lines.filter((line) => line.text);
}

export function captionsToSrt(
  captions: Caption[],
  lineMode: SubtitleDisplayMode = "dual"
): string {
  return captions
    .map((caption, index) => {
      const lines = getCaptionDisplayLines(caption, {
        displayMode: lineMode,
        sourceFirst: true
      }).map((line) => line.text);

      return [
        index + 1,
        `${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}`,
        ...lines
      ].join("\n");
    })
    .join("\n\n");
}

export function downloadTextFile(
  content: string,
  fileName: string,
  type = "text/plain;charset=utf-8"
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

