/**
 * Languages Veil can read and answer in. These are the languages Chrome's Prompt API
 * (Gemini Nano) accepts for text input and output, so the device path and the cloud
 * path cover the same set.
 */
export type Lang = 'en' | 'es' | 'ja';
export type AnswerLang = 'same' | Lang;

export const LANGS: Lang[] = ['en', 'es', 'ja'];

export const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Español', ja: '日本語' };
const LANG_ENGLISH_NAME: Record<Lang, string> = { en: 'English', es: 'Spanish', ja: 'Japanese' };

const SPANISH_WORDS = /\b(?:el|la|los|las|de|del|que|usted|su|para|por|con|una|un|se|es|está|fecha|pago|señor|señora|estimado|estimada)\b/gi;
const ENGLISH_WORDS = /\b(?:the|and|of|to|you|your|for|is|are|with|this|that|please|date|payment)\b/gi;

/** Cheap, local guess at the document language. Nothing is sent anywhere to decide this. */
export function detectLang(text: string): Lang {
  const sample = text.slice(0, 4000);
  const letters = sample.replace(/[\s\d\p{P}\p{S}]/gu, '').length || 1;
  const cjk = (sample.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  if (cjk / letters > 0.2) return 'ja';
  const es = (sample.match(SPANISH_WORDS) ?? []).length + 3 * (sample.match(/[ñ¿¡áéíóú]/gi) ?? []).length;
  const en = (sample.match(ENGLISH_WORDS) ?? []).length;
  return es > en * 1.2 && es >= 3 ? 'es' : 'en';
}

export function resolveAnswerLang(choice: AnswerLang, docLang: Lang): Lang {
  return choice === 'same' ? docLang : choice;
}

/** The line added to the system instruction (cloud) and the session prompt (device). */
export function answerInstruction(lang: Lang): string {
  return lang === 'en'
    ? 'Write in plain English.'
    : `Write your whole answer in ${LANG_ENGLISH_NAME[lang]} (${LANG_NAME[lang]}), even if the document is in another language. Keep placeholders such as [PERSON_1] exactly as they are; do not translate them.`;
}
