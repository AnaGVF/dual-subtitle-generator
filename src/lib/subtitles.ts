import type { Caption, SubtitleDisplayMode, SubtitleStyle } from "../types";

export type CaptionDisplayLine = {
  text: string;
  role: "source" | "translation";
};

export type ParsedSubtitleResult = {
  captions: Caption[];
  detectedSourceColor?: string;
  detectedTargetColor?: string;
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

const namedColors: Record<string, string> = {
  white: "#ffffff",
  yellow: "#ffd166",
  gold: "#ffd166",
  cyan: "#087f8c",
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#22c55e",
  black: "#000000",
  orange: "#f97316"
};

function normalizeColor(raw: string): string | undefined {
  const clean = raw.trim().toLowerCase();
  if (namedColors[clean]) {
    return namedColors[clean];
  }
  if (/^#[0-9a-f]{6}$/i.test(clean)) {
    return clean;
  }
  if (/^#[0-9a-f]{3}$/i.test(clean)) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return `#${clean}`;
  }
  return undefined;
}

function extractColorFromText(line: string): string | undefined {
  const fontMatch = line.match(/<font[^>]+color=['"]?([^'">\s]+)['"]?[^>]*>/i);
  if (fontMatch) {
    const normalized = normalizeColor(fontMatch[1]);
    if (normalized) return normalized;
  }

  const assMatch = line.match(/\{\\(?:1c|c)&H([0-9a-fA-F]{6})&\}/i);
  if (assMatch) {
    const bgr = assMatch[1];
    const r = bgr.slice(4, 6);
    const g = bgr.slice(2, 4);
    const b = bgr.slice(0, 2);
    return `#${r}${g}${b}`.toLowerCase();
  }

  return undefined;
}

function cleanSubtitleText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .trim();
}

export function parseSubtitleFile(input: string): ParsedSubtitleResult {
  const normalized = input.replace(/\r/g, "").replace(/^WEBVTT.*\n/i, "");
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  let detectedSourceColor: string | undefined;
  let detectedTargetColor: string | undefined;

  const captions = blocks
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));

      if (timingIndex === -1) {
        return null;
      }

      const [startRaw, endRaw] = lines[timingIndex].split("-->");
      const contentLines = lines.slice(timingIndex + 1);

      const extracted: Array<{ text: string; color?: string }> = [];

      for (const line of contentLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const color = extractColorFromText(trimmed);
        const text = cleanSubtitleText(trimmed);
        if (text) {
          extracted.push({ text, color });
        }
      }

      if (!extracted.length) {
        return null;
      }

      let source = "";
      let translation = "";

      if (extracted.length === 1) {
        source = extracted[0].text;
        if (!detectedSourceColor && extracted[0].color) {
          detectedSourceColor = extracted[0].color;
        }
      } else if (extracted.length === 2) {
        source = extracted[0].text;
        translation = extracted[1].text;
        if (!detectedSourceColor && extracted[0].color) {
          detectedSourceColor = extracted[0].color;
        }
        if (!detectedTargetColor && extracted[1].color) {
          detectedTargetColor = extracted[1].color;
        }
      } else {
        const mid = Math.ceil(extracted.length / 2);
        source = extracted.slice(0, mid).map((l) => l.text).join(" ");
        translation = extracted.slice(mid).map((l) => l.text).join(" ");
        if (!detectedSourceColor && extracted[0].color) {
          detectedSourceColor = extracted[0].color;
        }
        if (!detectedTargetColor && extracted[mid]?.color) {
          detectedTargetColor = extracted[mid].color;
        }
      }

      return {
        id: createCaptionId(),
        start: parseTimestamp(startRaw),
        end: parseTimestamp(endRaw),
        source,
        translation
      };
    })
    .filter((caption): caption is Caption => Boolean(caption))
    .sort((a, b) => a.start - b.start);

  return {
    captions,
    detectedSourceColor,
    detectedTargetColor
  };
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

export function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100);

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(",", ".");
}

export function hexToAssColor(hex: string, alphaHex = "00"): string {
  const cleaned = hex.replace("#", "").trim();
  let r = "FF";
  let g = "FF";
  let b = "FF";

  if (cleaned.length === 6) {
    r = cleaned.slice(0, 2);
    g = cleaned.slice(2, 4);
    b = cleaned.slice(4, 6);
  } else if (cleaned.length === 3) {
    r = cleaned[0] + cleaned[0];
    g = cleaned[1] + cleaned[1];
    b = cleaned[2] + cleaned[2];
  }

  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

export function captionsToAss(
  captions: Caption[],
  style: SubtitleStyle,
  videoWidth = 1920,
  videoHeight = 1080
): string {
  const primaryAssColor = hexToAssColor(style.textColor);
  const secondaryAssColor = hexToAssColor(style.translatedColor);
  const outlineAssColor = hexToAssColor(style.outlineColor);
  const bgAssColor = hexToAssColor(style.backgroundColor, "80");

  const primarySize = style.fontSize;
  const secondarySize = Math.round(style.fontSize * 0.72);
  const isBold = Number(style.fontWeight) >= 600 ? 1 : 0;
  const marginV = Math.round(((100 - style.vertical) / 100) * videoHeight);

  // Alignment: 2 is bottom-center, 1 is bottom-left, 3 is bottom-right
  const alignment = style.textAlign === "left" ? 1 : style.textAlign === "right" ? 3 : 2;

  const header = `[Script Info]
Title: Dual Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${primarySize},${primaryAssColor},&H000000FF,${outlineAssColor},${bgAssColor},${isBold},0,0,0,100,100,0,0,1,${style.outlineWidth},1,${alignment},30,30,${Math.max(20, marginV)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogues = captions.map((caption) => {
    const displayLines = getCaptionDisplayLines(caption, style);
    const formattedPieces = displayLines.map((line) => {
      const text = style.uppercase ? line.text.toUpperCase() : line.text;
      const isSource = line.role === "source";
      const color = isSource ? primaryAssColor : secondaryAssColor;
      const size = style.displayMode === "dual" ? (isSource ? primarySize : secondarySize) : primarySize;
      return `{\\c${color}&\\fs${size}}${text}`;
    });

    const text = formattedPieces.join("\\N");
    return `Dialogue: 0,${formatAssTime(caption.start)},${formatAssTime(caption.end)},Default,,0,0,0,,${text}`;
  });

  return header + dialogues.join("\n");
}

export function captionsToVtt(
  captions: Caption[],
  lineMode: SubtitleDisplayMode = "dual",
  style?: Pick<SubtitleStyle, "textColor" | "translatedColor">
): string {
  const entries = captions.map((caption, index) => {
    const displayLines = getCaptionDisplayLines(caption, {
      displayMode: lineMode,
      sourceFirst: true
    });

    const lines = displayLines.map((line) => {
      if (style && lineMode === "dual") {
        const color = line.role === "source" ? style.textColor : style.translatedColor;
        if (color) {
          return `<c.${line.role}><font color="${color}">${line.text}</font></c>`;
        }
      }
      return line.text;
    });

    return [
      index + 1,
      `${formatVttTime(caption.start)} --> ${formatVttTime(caption.end)}`,
      ...lines
    ].join("\n");
  });

  return `WEBVTT\n\n` + entries.join("\n\n");
}

export function captionsToSrt(
  captions: Caption[],
  lineMode: SubtitleDisplayMode = "dual",
  style?: Pick<SubtitleStyle, "textColor" | "translatedColor">
): string {
  return captions
    .map((caption, index) => {
      const displayLines = getCaptionDisplayLines(caption, {
        displayMode: lineMode,
        sourceFirst: true
      });

      const lines = displayLines.map((line) => {
        if (style && lineMode === "dual") {
          const color = line.role === "source" ? style.textColor : style.translatedColor;
          if (color) {
            return `<font color="${color}">${line.text}</font>`;
          }
        }
        return line.text;
      });

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
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
