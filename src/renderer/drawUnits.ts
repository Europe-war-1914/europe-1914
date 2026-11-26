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
  timeSec?: number;
  scale?: number;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'webp'] as const;
const spriteCache: Partial<Record<UnitType, HTMLImageElement | 'failed'>> = {};

function loadUnitSprite(unit: UnitType, extIndex = 0) {
  if (extIndex >= IMAGE_EXTENSIONS.length) {
    spriteCache[unit] = 'failed';
    return;
  }
  const img = new Image();
  img.onerror = () => {
    loadUnitSprite(unit, extIndex + 1);
  };
  img.src = `/units/${unit}.${IMAGE_EXTENSIONS[extIndex]}`;
  spriteCache[unit] = img;
}

export function getUnitSprite(unit: UnitType): HTMLImageElement | null {
  if (typeof window === 'undefined') return null;
  const cached = spriteCache[unit];
  if (cached === 'failed') return null;
  if (cached) {
    return cached.complete && cached.naturalWidth > 0 ? cached : null;
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
  const w = 12;
  const h = 7.5;
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

  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x, y, w, h);
}

function drawTacticalFallback(ctx: CanvasRenderingContext2D, unit: UnitType) {
  ctx.save();
  ctx.fillStyle = '#d6ccb8';
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
  ctx.fillText(tags[unit], 0, 2.5);
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
    isNaval = false,
    isAir = false,
    isSubmarine = false,
    isReturning = false,
    isSelected = false,
    isCapital = false,
    isEnemyWarning = false,
    landingSecondsLeft,
    timeSec = 0,
    scale = 1,
  } = opts;

  const tpl = NATION_TEMPLATES[owner];
  const dominant = getDominantUnitType(units, isNaval, isAir, isSubmarine);
  const sprite = getUnitSprite(dominant);

  const cardW = 46;
  const cardH = 34;
  const headerH = 5;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (isSubmarine && landingSecondsLeft === undefined) {
    ctx.globalAlpha = 0.85;
  }

  if (isSelected) {
    const pulse = 0.7 + 0.3 * Math.sin(timeSec * 6);
    ctx.strokeStyle = `rgba(250, 204, 21, ${pulse})`;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.roundRect(-cardW / 2 - 3.5, -cardH / 2 - 3.5, cardW + 7, cardH + 7, 5);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
  ctx.beginPath();
  ctx.roundRect(-cardW / 2 + 2, -cardH / 2 + 3, cardW, cardH, 3.5);
  ctx.fill();

  const bgGrad = ctx.createLinearGradient(0, -cardH / 2, 0, cardH / 2);
  bgGrad.addColorStop(0, '#2a2723');
  bgGrad.addColorStop(1, '#12110f');
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3);
  ctx.fill();

  const imgX = -cardW / 2 + 1.5;
  const imgY = -cardH / 2 + headerH + 1;
  const imgW = cardW - 3;
  const imgH = cardH - headerH - 2.5;

  if (sprite) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(imgX, imgY, imgW, imgH, [0, 0, 2, 2]);
    ctx.clip();

    const srcRatio = sprite.naturalWidth / sprite.naturalHeight;
    const dstRatio = imgW / imgH;
    let sx = 0;
    let sy = 0;
    let sw = sprite.naturalWidth;
    let sh = sprite.naturalHeight;
    if (srcRatio > dstRatio) {
      sw = sprite.naturalHeight * dstRatio;
      sx = (sprite.naturalWidth - sw) / 2;
    } else {
      sh = sprite.naturalWidth / dstRatio;
      sy = (sprite.naturalHeight - sh) / 2;
    }

    if (facing === -1) {
      ctx.scale(-1, 1);
      ctx.drawImage(sprite, sx, sy, sw, sh, -imgX - imgW, imgY, imgW, imgH);
    } else {
      ctx.drawImage(sprite, sx, sy, sw, sh, imgX, imgY, imgW, imgH);
    }

    const vig = ctx.createLinearGradient(0, imgY, 0, imgY + imgH);
    vig.addColorStop(0, 'rgba(0,0,0,0.14)');
    vig.addColorStop(0.6, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vig;
    ctx.fillRect(imgX, imgY, imgW, imgH);
    ctx.restore();
  } else {
    drawTacticalFallback(ctx, dominant);
  }

  ctx.fillStyle = tpl.color;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2 + 1, -cardH / 2 + 1, cardW - 2, headerH, [2, 2, 0, 0]);
  ctx.fill();

  ctx.strokeStyle =
    landingSecondsLeft !== undefined || isEnemyWarning
      ? '#ef4444'
      : isSelected
      ? '#facc15'
      : isCapital
      ? '#d4af37'
      : '#9a907c';
  ctx.lineWidth = isSelected || isCapital || isEnemyWarning ? 1.6 : 1.15;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3);
  ctx.stroke();

  drawMiniFlag(ctx, owner, -cardW / 2 - 3, -cardH / 2 - 3.5);

  const label = isReturning ? `↩${total}` : String(total);
  const pillW = Math.max(17, label.length * 6.2 + 7);
  const pillH = 12;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(12, 11, 10, 0.96)';
  ctx.strokeStyle = isCapital ? '#d4af37' : '#b8ae99';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cardW / 2 - pillW + 3.5, cardH / 2 - pillH + 3.5, pillW, pillH, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8f4e8';
  ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cardW / 2 - pillW / 2 + 3.5, cardH / 2 - pillH / 2 + 3.9);

  if (landingSecondsLeft !== undefined && landingSecondsLeft > 0) {
    const alertText = `DÉBARQ. ${Math.ceil(landingSecondsLeft)}s`;
    ctx.fillStyle = 'rgba(127, 29, 29, 0.96)';
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-36, -cardH / 2 - 18, 72, 13, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fef2f2';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.fillText(alertText, 0, -cardH / 2 - 11.2);
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