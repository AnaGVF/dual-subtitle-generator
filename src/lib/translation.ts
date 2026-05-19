import type { Caption, TranslationProvider } from "../types";

type TranslateOptions = {
  provider: TranslationProvider;
  sourceLanguage: string;
  targetLanguage: string;
  libreTranslateUrl: string;
  onProgress?: (completed: number, total: number) => void;
};

const normalizeLibreTranslateUrl = (url: string) =>
  url.replace(/\/+$/, "").replace(/\/translate$/, "");

async function translateWithMyMemory(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
) {
  const params = new URLSearchParams({
    q: text,
    langpair: `${sourceLanguage}|${targetLanguage}`
  });

  const response = await fetch(
    `https://api.mymemory.translated.net/get?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`MyMemory returned ${response.status}`);
  }

  const data = (await response.json()) as {
    responseData?: { translatedText?: string };
    matches?: Array<{ translation?: string }>;
  };

  return (
    data.responseData?.translatedText ??
    data.matches?.find((match) => match.translation)?.translation ??
    text
  );
}

async function translateWithLibreTranslate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  libreTranslateUrl: string
) {
  const baseUrl = normalizeLibreTranslateUrl(libreTranslateUrl);
  const response = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: text,
      source: sourceLanguage,
      target: targetLanguage,
      format: "text"
    })
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate returned ${response.status}`);
  }

  const data = (await response.json()) as { translatedText?: string };
  return data.translatedText ?? text;
}

export async function translateCaptions(
  captions: Caption[],
  options: TranslateOptions
): Promise<Caption[]> {
  const total = captions.filter((caption) => caption.source.trim()).length;
  let completed = 0;

  const translated: Caption[] = [];

  for (const caption of captions) {
    const text = caption.source.trim();

    if (!text) {
      translated.push(caption);
      continue;
    }

    const translation =
      options.provider === "mymemory"
        ? await translateWithMyMemory(
            text,
            options.sourceLanguage,
            options.targetLanguage
          )
        : await translateWithLibreTranslate(
            text,
            options.sourceLanguage,
            options.targetLanguage,
            options.libreTranslateUrl
          );

    completed += 1;
    options.onProgress?.(completed, total);

    translated.push({
      ...caption,
      translation
    });
  }

  return translated;
}

