export type Caption = {
  id: string;
  start: number;
  end: number;
  source: string;
  translation: string;
};

export type SubtitleAnimation = "none" | "fade" | "rise" | "pop";

export type SubtitleStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  horizontal: number;
  vertical: number;
  textAlign: "left" | "center" | "right";
  textColor: string;
  translatedColor: string;
  backgroundColor: string;
  shadowColor: string;
  outlineColor: string;
  outlineWidth: number;
  showBackground: boolean;
  uppercase: boolean;
  animation: SubtitleAnimation;
  sourceFirst: boolean;
};

export type LanguageOption = {
  code: string;
  label: string;
  whisper?: string;
};

export type TranslationProvider = "mymemory" | "libretranslate";

export type ExportResult = {
  blob: Blob;
  fileName: string;
};
