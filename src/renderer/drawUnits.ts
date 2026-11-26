import { UNIT_ORDER } from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import type { NationId, UnitStack, UnitType } from '../engine/types';

export interface UnitTokenOptions {
  x: number;
  y: number;
  owner: NationId;
  units: UnitStack;
  facing?: 1 | -1;
  isMoving?: boolean;
  isNaval?: boolean;
  isAir?: boolean;
  isSubmarine?: boolean;
  isReturning?: boolean;
  isSelected?: boolean;
  isCapital?: boolean;
  isEnemyWarning?: boolean;
  landingSecondsLeft?: number;
  isLandingPhase?: boolean;
  timeSec?: number;
  scale?: number;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

type CachedSprite = {
  source: HTMLImageElement | HTMLCanvasElement;
  ready: boolean;
};

const spriteCache: Partial<Record<UnitType, CachedSprite | 'failed'>> = {};

function buildCutoutSprite(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  try {
    const size = 256;
    const work = document.createElement('canvas');
    work.width = size;
    work.height = size;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    if (!wctx) return img;

    wctx.drawImage(img, 0, 0, size, size);
    const imgData = wctx.getImageData(0, 0, size, size);
    const data = imgData.data;

    const corners = [
      0,
      (size - 1) * 4,
      (size - 1) * size * 4,
      ((size - 1) * size + (size - 1)) * 4,
    ];
    if (corners.some((idx) => data[idx + 3] < 200)) {
      return img;
    }

    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    for (const idx of corners) {
      bgR += data[idx];
      bgG += data[idx + 1];
      bgB += data[idx + 2];
    }
    bgR /= 4;
    bgG /= 4;
    bgB /= 4;

    const isBackgroundPixel = (pixelIdx: number) => {
      const i = pixelIdx * 4;
      const dr = Math.abs(data[i] - bgR);
      const dg = Math.abs(data[i + 1] - bgG);
      const db = Math.abs(data[i + 2] - bgB);
      if (dr > 11 || dg > 11 || db > 11) return false;
      return dr * dr + dg * dg + db * db <= 256;
    };

    const colorDist = (pixelIdx: number) => {
      const i = pixelIdx * 4;
      return Math.hypot(data[i] - bgR, data[i + 1] - bgG, data[i + 2] - bgB);
    };

    const totalPixels = size * size;
    const visited = new Uint8Array(totalPixels);
    const removed = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;

    const tryEnqueue = (p: number) => {
      if (visited[p]) return;
      if (isBackgroundPixel(p)) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    };

    for (let x = 0; x < size; x++) {
      tryEnqueue(x);
      tryEnqueue((size - 1) * size + x);
    }
    for (let y = 0; y < size; y++) {
      tryEnqueue(y * size);
      tryEnqueue(y * size + (size - 1));
    }

    while (head < tail) {
      const p = queue[head++];
      removed[p] = 1;
      data[p * 4 + 3] = 0;

      const x = p % size;
      const y = (p - x) / size;
      if (x > 0) tryEnqueue(p - 1);
      if (x < size - 1) tryEnqueue(p + 1);
      if (y > 0) tryEnqueue(p - size);
      if (y < size - 1) tryEnqueue(p + size);
    }

    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const p = y * size + x;
        if (removed[p]) continue;
        if (
          removed[p - 1] ||
          removed[p + 1] ||
          removed[p - size] ||
          removed[p + size]
        ) {
          const d = colorDist(p);
          if (d < 28) {
            const factor = Math.max(0.25, Math.min(1, (d - 14) / 14));
            data[p * 4 + 3] = Math.round(data[p * 4 + 3] * factor);
          }
        }
      }
    }

    wctx.putImageData(imgData, 0, 0);

    let minX = size;
    let minY = size;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * 4 + 3] > 30) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX <= minX || maxY <= minY) return img;

    const pad = 2;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(size - sx, maxX - minX + 1 + pad * 2);
    const sh = Math.min(size - sy, maxY - minY + 1 + pad * 2);

    const trimmed = document.createElement('canvas');
    trimmed.width = sw;
    trimmed.height = sh;
    const tctx = trimmed.getContext('2d');
    if (!tctx) return work;
    tctx.drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh);
    return trimmed;
  } catch {
    return img;
  }
}

function loadUnitSprite(unit: UnitType, extIndex = 0) {
  if (extIndex >= IMAGE_EXTENSIONS.length) {
    spriteCache[unit] = 'failed';
    return;
  }
  const img = new Image();
  img.onload = () => {
    const cutout = buildCutoutSprite(img);
    spriteCache[unit] = { source: cutout, ready: true };
  };
  img.onerror = () => {
    loadUnitSprite(unit, extIndex + 1);
  };
  img.src = `/units/${unit}.${IMAGE_EXTENSIONS[extIndex]}`;
  spriteCache[unit] = { source: img, ready: false };
}

export function getUnitSprite(unit: UnitType): HTMLImageElement | HTMLCanvasElement | null {
  if (typeof window === 'undefined') return null;
  const cached = spriteCache[unit];
  if (cached === 'failed') return null;
  if (cached) {
    return cached.ready ? cached.source : null;
  }
  loadUnitSprite(unit, 0);
  return null;
}

export function getDominantUnitType(
  units: UnitStack,
  isNaval = false,
  isAir = false,
  isSubmarine = false
): UnitType {
  if (isSubmarine || (isNaval && units.submarine > 0 && units.frigate === 0)) return 'submarine';
  if (isNaval || units.frigate > 0) return 'frigate';
  if (isAir || units.bomber > 0 || units.fighter > 0) {
    return units.bomber >= units.fighter && units.bomber > 0 ? 'bomber' : 'fighter';
  }
  if (units.heavy_tank > 0) return 'heavy_tank';
  if (units.light_tank > 0) return 'light_tank';
  if (units.soldier > 0) return 'soldier';
  return 'scout';
}

function getStackTotal(units: UnitStack): number {
  let total = 0;
  for (const t of UNIT_ORDER) total += units[t] ?? 0;
  return total;
}

function drawMiniFlag(ctx: CanvasRenderingContext2D, owner: NationId, x: number, y: number) {
  const w = 13;
  const h = 8.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  switch (owner) {
    case 'france':
      ctx.fillStyle = '#1d3b72';
      ctx.fillRect(0, 0, w / 3, h);
      ctx.fillStyle = '#ebe6dc';
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = '#9e2222';
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 'germany':
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#ebe6dc';
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#9e2222';
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 'uk':
      ctx.fillStyle = '#172e60';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ebe6dc';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.strokeStyle = '#9e2222';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      break;
    case 'italy':
      ctx.fillStyle = '#1d5634';
      ctx.fillRect(0, 0, w / 3, h);
      ctx.fillStyle = '#ebe6dc';
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = '#9e2222';
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 'austria':
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#bd9428';
      ctx.fillRect(0, h / 2, w, h / 2);
      break;
    case 'russia':
      ctx.fillStyle = '#ebe6dc';
      ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#1d3b72';
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#9e2222';
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 'spain':
      ctx.fillStyle = '#8c1d1d';
      ctx.fillRect(0, 0, w, h * 0.28);
      ctx.fillStyle = '#c49b2b';
      ctx.fillRect(0, h * 0.28, w, h * 0.44);
      ctx.fillStyle = '#8c1d1d';
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      break;
    case 'ottoman':
      ctx.fillStyle = '#7d1b1b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ebe6dc';
      ctx.beginPath();
      ctx.arc(w * 0.42, h * 0.5, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7d1b1b';
      ctx.beginPath();
      ctx.arc(w * 0.52, h * 0.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = NATION_TEMPLATES[owner].color;
      ctx.fillRect(0, 0, w, h);
      break;
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 0.85;
  ctx.strokeRect(x, y, w, h);
}

function drawTacticalFallback(ctx: CanvasRenderingContext2D, unit: UnitType, color: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(18, 17, 15, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, -4, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f3efe6';
  ctx.font = 'bold 7.5px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tags: Record<UnitType, string> = {
    scout: 'ÉCL',
    soldier: 'INF',
    light_tank: 'BL-L',
    heavy_tank: 'BL-H',
    fighter: 'CHS',
    bomber: 'BMB',
    submarine: 'U-BT',
    frigate: 'FRG',
  };
  ctx.fillText(tags[unit], 0, -3.5);
  ctx.restore();
}

export function drawUnitToken(ctx: CanvasRenderingContext2D, opts: UnitTokenOptions) {
  const total = getStackTotal(opts.units);
  if (total <= 0) return;

  const {
    x,
    y,
    owner,
    units,
    facing = 1,
    isMoving = false,
    isNaval = false,
    isAir = false,
    isSubmarine = false,
    isReturning = false,
    isSelected = false,
    isCapital = false,
    isEnemyWarning = false,
    landingSecondsLeft,
    isLandingPhase = false,
    timeSec = 0,
    scale = 1,
  } = opts;

  const tpl = NATION_TEMPLATES[owner];
  const dominant = getDominantUnitType(units, isNaval, isAir, isSubmarine);
  const sprite = getUnitSprite(dominant);
  const bob = isMoving ? Math.sin(timeSec * 8 + x * 0.06) * 1.1 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (isSubmarine && landingSecondsLeft === undefined) {
    ctx.globalAlpha = 0.82;
  }

  if (isSelected || isEnemyWarning || landingSecondsLeft !== undefined) {
    const pulse = 0.65 + 0.35 * Math.sin(timeSec * 7);
    ctx.strokeStyle =
      landingSecondsLeft !== undefined || isEnemyWarning
        ? `rgba(239, 68, 68, ${pulse})`
        : `rgba(250, 204, 21, ${pulse})`;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.ellipse(0, 7, 21, 7.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.beginPath();
  ctx.ellipse(0, 7, 17, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (sprite) {
    const sw = sprite instanceof HTMLImageElement ? sprite.naturalWidth : sprite.width;
    const sh = sprite instanceof HTMLImageElement ? sprite.naturalHeight : sprite.height;
    const maxDim = isAir ? 48 : 44;
    const ratio = Math.min(maxDim / Math.max(1, sw), maxDim / Math.max(1, sh));
    const dw = sw * ratio;
    const dh = sh * ratio;

    ctx.save();
    ctx.translate(0, (isAir ? -10 : -5) + bob);
    if (facing === -1) ctx.scale(-1, 1);
    ctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    drawTacticalFallback(ctx, dominant, tpl.color);
  }

  const label = isReturning ? `↩${total}` : String(total);
  const pillW = Math.max(20, label.length * 6.2 + 9);
  const pillH = 12;
  const totalBadgeW = 13 + 3 + pillW;
  const startX = -totalBadgeW / 2;
  const badgeY = 9;

  ctx.globalAlpha = 1;
  drawMiniFlag(ctx, owner, startX, badgeY + 1.8);

  const pillX = startX + 16;
  ctx.fillStyle = 'rgba(12, 11, 10, 0.94)';
  ctx.strokeStyle = isCapital ? '#d4af37' : isEnemyWarning ? '#ef4444' : '#b8ae99';
  ctx.lineWidth = isCapital || isEnemyWarning ? 1.25 : 0.95;
  ctx.beginPath();
  ctx.roundRect(pillX, badgeY, pillW, pillH, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8f4e8';
  ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pillX + pillW / 2, badgeY + pillH / 2 + 0.4);

  if (landingSecondsLeft !== undefined && landingSecondsLeft > 0) {
    const sec = Math.ceil(landingSecondsLeft);
    const alertText = isLandingPhase ? `DÉBARQ. ${sec}s` : `ANNEXION ${sec}s`;
    ctx.fillStyle = isLandingPhase ? 'rgba(127, 29, 29, 0.96)' : 'rgba(120, 53, 15, 0.96)';
    ctx.strokeStyle = isLandingPhase ? '#fca5a5' : '#fcd34d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-40, -34, 80, 13, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fef2f2';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.fillText(alertText, 0, -27.2);
  }

  ctx.restore();
}

export function drawFogUnknownToken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  owner: NationId
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(20, 19, 17, 0.84)';
  ctx.strokeStyle = NATION_TEMPLATES[owner].borderColor;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-10, -8, 20, 16, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#b8ae99';
  ctx.font = 'bold 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 0.5);

  ctx.restore();
}