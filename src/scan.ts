import { runVision, visionModel } from './ai';

/**
 * Scan: read a photo of a paper letter with Gemini Nano's image input.
 *
 * The image is decoded, resized and cut into tiles in this page, then handed to a
 * model created with ONLY_ON_DEVICE (see visionModel in ai.ts). No code path in this
 * file touches the network.
 */

export interface Tile {
  data: string; // base64, no data: prefix
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export interface PreparedImage {
  tiles: Tile[];
  previewUrl: string; // object URL of a small preview, revoke when done
  width: number;
  height: number;
  bytes: number; // size of the file the user gave us
}

const MAX_SIDE = 2000;
const OVERLAP = 0.08;

export const ACCEPTED_IMAGE = /^image\/(png|jpe?g|webp|gif|bmp)$/i;

const SYSTEM = `You are an OCR engine that runs entirely on the user's device.
Transcribe all the text in the image exactly as it is printed, from top to bottom, keeping the line breaks.
Do not translate, summarize, correct, explain or add anything. Keep numbers, names and punctuation exactly as written.
If a part cannot be read, write [illegible] in its place. Output only the transcribed text.`;

const INSTRUCTION = 'Transcribe the text in this image.';

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
}

function canvasBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, q));
}

/**
 * Decode, downscale and tile a photo. A page-shaped photo is cut into overlapping
 * horizontal bands so that small print keeps enough resolution for the on-device model.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file could not be opened as an image. Use a JPEG or PNG photo (HEIC photos need to be converted first).');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const ctx = full.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const ratio = h / w;
  const bands = h < 900 || ratio < 1.15 ? 1 : ratio < 1.9 ? 2 : 3;
  const tiles: Tile[] = [];
  const bandH = Math.ceil(h / bands);
  const pad = bands > 1 ? Math.round(h * OVERLAP) : 0;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.max(0, i * bandH - (i ? pad : 0));
    const y1 = Math.min(h, (i + 1) * bandH + (i < bands - 1 ? pad : 0));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = y1 - y0;
    c.getContext('2d')!.drawImage(full, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
    tiles.push({ data: await toBase64(await canvasBlob(c, 'image/jpeg', 0.92)), mimeType: 'image/jpeg', width: w, height: y1 - y0 });
  }

  const pv = document.createElement('canvas');
  const ps = Math.min(1, 360 / w);
  pv.width = Math.round(w * ps);
  pv.height = Math.round(h * ps);
  pv.getContext('2d')!.drawImage(full, 0, 0, pv.width, pv.height);
  const previewUrl = URL.createObjectURL(await canvasBlob(pv, 'image/jpeg', 0.8));
  return { tiles, previewUrl, width: w, height: h, bytes: file.size };
}

const normLine = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Join the text of two overlapping bands, dropping the lines both of them saw. */
export function joinBands(a: string, b: string): string {
  const la = a.trimEnd().split('\n');
  const lb = b.trimStart().split('\n');
  const max = Math.min(8, la.length, lb.length);
  for (let k = max; k >= 1; k--) {
    const tail = la.slice(-k).map(normLine).join('\n');
    const head = lb.slice(0, k).map(normLine).join('\n');
    if (tail && tail === head) return [...la, ...lb.slice(k)].join('\n');
  }
  // A line cut in half by the band edge: keep the longer reading.
  const last = normLine(la[la.length - 1] ?? '');
  const first = normLine(lb[0] ?? '');
  if (last.length > 6 && first.length > 6 && (last.includes(first) || first.includes(last))) {
    if (first.length > last.length) la[la.length - 1] = lb[0];
    return [...la, ...lb.slice(1)].join('\n');
  }
  return [...la, ...lb].join('\n');
}

function clean(text: string): string {
  return text
    .replace(/^\s*```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Transcript {
  text: string;
  ms: number;
  tiles: number;
}

/** Transcribe a prepared photo on the device. Calls onProgress with the text so far. */
export async function transcribe(
  img: PreparedImage,
  onProgress: (text: string, part: number, parts: number) => void,
  signal?: AbortSignal,
): Promise<Transcript> {
  const m = visionModel(SYSTEM);
  const t0 = performance.now();
  let done = '';
  for (let i = 0; i < img.tiles.length; i++) {
    const t = img.tiles[i];
    const r = await runVision(
      m,
      { data: t.data, mimeType: t.mimeType },
      INSTRUCTION,
      (partial) => onProgress(done ? `${done}\n${partial}` : partial, i + 1, img.tiles.length),
      signal,
    );
    const part = clean(r.text);
    done = done ? joinBands(done, part) : part;
  }
  return { text: clean(done), ms: performance.now() - t0, tiles: img.tiles.length };
}
