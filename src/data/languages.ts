import type { LanguageOption } from "../types";

export const languages: LanguageOption[] = [
  { code: "en", label: "English", whisper: "english" },
  { code: "es", label: "Spanish", whisper: "spanish" },
  { code: "fr", label: "French", whisper: "french" },
  { code: "de", label: "German", whisper: "german" },
  { code: "it", label: "Italian", whisper: "italian" },
  { code: "pt", label: "Portuguese", whisper: "portuguese" },
  { code: "nl", label: "Dutch", whisper: "dutch" },
  { code: "pl", label: "Polish", whisper: "polish" },
  { code: "tr", label: "Turkish", whisper: "turkish" },
  { code: "ar", label: "Arabic", whisper: "arabic" },
  { code: "hi", label: "Hindi", whisper: "hindi" },
  { code: "id", label: "Indonesian", whisper: "indonesian" },
  { code: "ja", label: "Japanese", whisper: "japanese" },
  { code: "ko", label: "Korean", whisper: "korean" },
  { code: "zh", label: "Chinese", whisper: "chinese" },
  { code: "ru", label: "Russian", whisper: "russian" },
  { code: "uk", label: "Ukrainian", whisper: "ukrainian" },
  { code: "sv", label: "Swedish", whisper: "swedish" },
  { code: "no", label: "Norwegian", whisper: "norwegian" },
  { code: "da", label: "Danish", whisper: "danish" },
  { code: "fi", label: "Finnish", whisper: "finnish" },
  { code: "el", label: "Greek", whisper: "greek" },
  { code: "ro", label: "Romanian", whisper: "romanian" },
  { code: "cs", label: "Czech", whisper: "czech" },
  { code: "hu", label: "Hungarian", whisper: "hungarian" }
];

export const whisperModels = [
  {
    id: "Xenova/whisper-tiny",
    label: "Fast"
  },
  {
    id: "Xenova/whisper-base",
    label: "Balanced"
  },
  {
    id: "Xenova/whisper-small",
    label: "Sharper"
  }
];

export const fontOptions = [
  "Inter",
  "Arial",
  "Helvetica",
  "Verdana",
  "Georgia",
  "Trebuchet MS",
  "Impact",
  "Courier New",
  "Times New Roman"
];

