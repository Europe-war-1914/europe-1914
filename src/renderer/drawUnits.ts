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

// Chargeur optionnel d'images réalistes depuis public/units/{unitType}.png
const spriteCache: Partial<Record<UnitType, HTMLImageElement | 'failed'>> = {};

function getCustomUnitImage(unit: UnitType): HTMLImageElement | null {
  if (typeof window === 'undefined') return null;
  const cached = spriteCache[unit];
  if (cached === 'failed') return null;
  if (cached) {
    return cached.complete && cached.naturalWidth > 0 ? cached : null;
  }

  const img = new Image();
  img.onerror = () => {
    spriteCache[unit] = 'failed';
  };
  img.src = `/units/${unit}.png`;
  spriteCache[unit] = img;
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
  const w = 10;
  const h = 6.5;
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
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.strokeStyle = '#9e2222';
      ctx.lineWidth = 1;
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
      ctx.arc(w * 0.42, h * 0.5, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7d1b1b';
      ctx.beginPath();
      ctx.arc(w * 0.52, h * 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = NATION_TEMPLATES[owner].color;
      ctx.fillRect(0, 0, w, h);
      break;
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x, y, w, h);
}

function drawTacticalEmblem(
  ctx: CanvasRenderingContext2D,
  unit: UnitType,
  facing: 1 | -1
) {
  ctx.save();
  ctx.strokeStyle = '#e7e0cf';
  ctx.fillStyle = '#e7e0cf';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (unit) {
    case 'soldier': {
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(-7, 4.5);
      ctx.lineTo(7, -4.5);
      ctx.moveTo(7, 4.5);
      ctx.lineTo(-7, -4.5);
      ctx.stroke();

      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(5.8, -3.7);
      ctx.lineTo(8.4, -5.4);
      ctx.moveTo(-5.8, -3.7);
      ctx.lineTo(-8.4, -5.4);
      ctx.stroke();

      ctx.fillStyle = '#d4af37';
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'scout': {
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(-8, 4.8);
      ctx.lineTo(8, -4.8);
      ctx.stroke();

      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-4, -4.2);
      ctx.lineTo(0, -1.2);
      ctx.lineTo(4, -4.2);
      ctx.stroke();

      ctx.strokeStyle = '#e7e0cf';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(-4.2, -1.8, 2.0, 0, Math.PI * 2);
      ctx.arc(4.2, 2.0, 2.0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'light_tank': {
      ctx.scale(facing, 1);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(-8, 0.5, 16, 4.2, 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-6, 0.5);
      ctx.lineTo(-4, -3.8);
      ctx.lineTo(4.5, -3.8);
      ctx.lineTo(7, 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(3, -2.5);
      ctx.lineTo(10, -2.8);
      ctx.stroke();
      break;
    }

    case 'heavy_tank': {
      ctx.scale(facing, 1);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-9.5, 1.5);
      ctx.lineTo(-6.5, -4.2);
      ctx.lineTo(6.5, -4.6);
      ctx.lineTo(10, 0.5);
      ctx.lineTo(8, 4.4);
      ctx.lineTo(-8, 4.4);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#181614';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-5, 0.5);
      ctx.lineTo(5, 0.5);
      ctx.stroke();

      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(4, -2.2);
      ctx.lineTo(11.5, -2.5);
      ctx.stroke();
      break;
    }

    case 'fighter': {
      ctx.scale(facing, 1);
      ctx.beginPath();
      ctx.moveTo(9.5, 0);
      ctx.lineTo(2, -1.6);
      ctx.lineTo(1, -6.5);
      ctx.lineTo(-1.8, -6.5);
      ctx.lineTo(-1.2, -1.4);
      ctx.lineTo(-7.8, -0.9);
      ctx.lineTo(-9.5, -3.4);
      ctx.lineTo(-9.5, 3.4);
      ctx.lineTo(-7.8, 0.9);
      ctx.lineTo(-1.2, 1.4);
      ctx.lineTo(-1.8, 6.5);
      ctx.lineTo(1, 6.5);
      ctx.lineTo(2, 1.6);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'bomber': {
      ctx.scale(facing, 1);
      ctx.beginPath();
      ctx.moveTo(9.5, 0);
      ctx.lineTo(3, -1.8);
      ctx.lineTo(2.4, -7.8);
      ctx.lineTo(-1.4, -7.8);
      ctx.lineTo(-1.0, -1.8);
      ctx.lineTo(-8.2, -1.2);
      ctx.lineTo(-9.6, -4.4);
      ctx.lineTo(-9.6, 4.4);
      ctx.lineTo(-8.2, 1.2);
      ctx.lineTo(-1.0, 1.8);
      ctx.lineTo(-1.4, 7.8);
      ctx.lineTo(2.4, 7.8);
      ctx.lineTo(3, 1.8);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#d4af37';
      ctx.fillRect(0.2, -5.2, 3.2, 1.4);
      ctx.fillRect(0.2, 3.8, 3.2, 1.4);
      break;
    }

    case 'submarine': {
      ctx.scale(facing, 1);
      ctx.beginPath();
      ctx.moveTo(-10, 2.2);
      ctx.quadraticCurveTo(-7, -1.5, 0, -1.5);
      ctx.quadraticCurveTo(7.5, -1.5, 10.5, 2.2);
      ctx.lineTo(8.5, 3.6);
      ctx.lineTo(-8.5, 3.6);
      ctx.closePath();
      ctx.fill();

      ctx.fillRect(-2.4, -4.8, 4.6, 3.4);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0.4, -4.8);
      ctx.lineTo(0.4, -7.2);
      ctx.lineTo(2.4, -7.2);
      ctx.stroke();
      break;
    }

    case 'frigate': {
      ctx.scale(facing, 1);
      ctx.beginPath();
      ctx.moveTo(-10.5, 0.8);
      ctx.lineTo(10.5, 0.2);
      ctx.lineTo(8.5, 4.2);
      ctx.lineTo(-8.5, 4.2);
      ctx.closePath();
      ctx.fill();

      ctx.fillRect(-4, -3.2, 7.5, 3.6);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(-2.5, -6.2, 1.6, 3.1);
      ctx.fillRect(0.8, -6.2, 1.6, 3.1);

      ctx.strokeStyle = '#e7e0cf';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(4.5, -1.0);
      ctx.lineTo(9.5, -2.0);
      ctx.stroke();
      break;
    }
  }

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
  const customImg = getCustomUnitImage(dominant);

  const cardW = 34;
  const cardH = 24;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (isSubmarine && landingSecondsLeft === undefined) {
    ctx.globalAlpha = 0.82;
  }

  if (isSelected) {
    const pulse = 0.7 + 0.3 * Math.sin(timeSec * 6);
    ctx.strokeStyle = `rgba(250, 204, 21, ${pulse})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(-cardW / 2 - 3.5, -cardH / 2 - 3.5, cardW + 7, cardH + 7, 5);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
  ctx.beginPath();
  ctx.roundRect(-cardW / 2 + 1.5, -cardH / 2 + 2.5, cardW, cardH, 3.5);
  ctx.fill();

  const bgGrad = ctx.createLinearGradient(0, -cardH / 2, 0, cardH / 2);
  bgGrad.addColorStop(0, '#2a2825');
  bgGrad.addColorStop(1, '#141311');
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3);
  ctx.fill();

  ctx.fillStyle = tpl.color;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2 + 1, -cardH / 2 + 1, cardW - 2, 5.5, [2, 2, 0, 0]);
  ctx.fill();

  ctx.strokeStyle =
    landingSecondsLeft !== undefined || isEnemyWarning
      ? '#ef4444'
      : isSelected
      ? '#facc15'
      : isCapital
      ? '#d4af37'
      : '#8c8370';
  ctx.lineWidth = isSelected || isCapital || isEnemyWarning ? 1.5 : 1.05;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3);
  ctx.stroke();

  if (customImg) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-cardW / 2 + 1.5, -cardH / 2 + 6.5, cardW - 3, cardH - 8, 1.5);
    ctx.clip();
    ctx.drawImage(customImg, -cardW / 2 + 1.5, -cardH / 2 + 6.5, cardW - 3, cardH - 8);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(0, 2.6);
    drawTacticalEmblem(ctx, dominant, facing);
    ctx.restore();
  }

  drawMiniFlag(ctx, owner, -cardW / 2 - 2.5, -cardH / 2 - 3);

  const label = isReturning ? `↩${total}` : String(total);
  const pillW = Math.max(15, label.length * 5.8 + 6);
  const pillH = 11;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0c0b0a';
  ctx.strokeStyle = isCapital ? '#d4af37' : '#a89f8c';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.roundRect(cardW / 2 - pillW + 3, cardH / 2 - pillH + 3, pillW, pillH, 2.2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8f4e8';
  ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cardW / 2 - pillW / 2 + 3, cardH / 2 - pillH / 2 + 3.4);

  if (landingSecondsLeft !== undefined && landingSecondsLeft > 0) {
    const alertText = `DÉBARQ. ${Math.ceil(landingSecondsLeft)}s`;
    ctx.fillStyle = 'rgba(127, 29, 29, 0.96)';
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-34, -cardH / 2 - 17, 68, 13, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fef2f2';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.fillText(alertText, 0, -cardH / 2 - 10.2);
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