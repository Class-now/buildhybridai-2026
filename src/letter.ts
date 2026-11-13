/**
 * Draws a text document as a photographed paper letter (canvas, no network, no asset).
 * Used by "Try a scanned letter" so the Scan feature can be tried without a real photo.
 */
export async function renderLetterImage(text: string): Promise<Blob> {
  const W = 1240;
  const M = 104;
  const FONT = 25;
  const LH = 35;
  const body = `${FONT}px Georgia, 'Times New Roman', serif`;
  const bold = `bold ${FONT + 5}px Georgia, 'Times New Roman', serif`;

  const measure = document.createElement('canvas').getContext('2d')!;
  const lines: Array<{ t: string; head: boolean }> = [];
  text.split('\n').forEach((para, pi) => {
    const head = pi === 0;
    measure.font = head ? bold : body;
    if (!para.trim()) {
      lines.push({ t: '', head: false });
      return;
    }
    let cur = '';
    for (const word of para.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (measure.measureText(next).width > W - 2 * M && cur) {
        lines.push({ t: cur, head });
        cur = word;
      } else cur = next;
    }
    lines.push({ t: cur, head });
  });

  const H = Math.max(900, M * 2 + lines.length * LH + 40);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // Desk, then a slightly rotated sheet with a soft shadow.
  ctx.fillStyle = '#5b5249';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.006);
  ctx.translate(-W / 2, -H / 2);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  const paper = ctx.createLinearGradient(0, 0, W, H);
  paper.addColorStop(0, '#fbf8ef');
  paper.addColorStop(1, '#efe9da');
  ctx.fillStyle = paper;
  ctx.fillRect(26, 22, W - 52, H - 44);
  ctx.shadowColor = 'transparent';

  // Fold line and letter text.
  ctx.strokeStyle = 'rgba(120,105,80,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(26, H / 2);
  ctx.lineTo(W - 26, H / 2);
  ctx.stroke();

  ctx.fillStyle = '#1d1b18';
  ctx.textBaseline = 'top';
  let y = M;
  for (const l of lines) {
    ctx.font = l.head ? bold : body;
    ctx.fillText(l.t, M, y);
    y += LH;
  }
  ctx.restore();

  // Light sensor noise so it looks like a phone photo rather than a render.
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  let seed = 7;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = ((seed >> 16) % 13) - 6;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the sample letter.'))), 'image/jpeg', 0.9));
}
