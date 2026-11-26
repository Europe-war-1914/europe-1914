import { getEuropeLandPath, MAP_HEIGHT, MAP_WIDTH, projectGeo } from '../data/geo';
import { NATION_TEMPLATES } from '../data/nations';
import { getMovingArmyWorldPos, totalStack } from '../engine/combat';
import { getDiplomaticStatus } from '../engine/diplomacy';
import { hasIntelOnProvince, isMovingArmyVisibleTo } from '../engine/visibility';
import type { DefenseType, GameState, MovingArmy, Province } from '../engine/types';
import { drawFogUnknownToken, drawUnitToken } from './drawUnits';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type MapMode = 'political' | 'diplomatic';

export interface MoveOrderPreview {
  fromId: string;
  startPos?: [number, number];
  route: string[];
  isAir: boolean;
  isSubmarineMission: boolean;
  isHostile: boolean;
}

const DEF_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

type CachedDefenseSprite = {
  source: HTMLImageElement | HTMLCanvasElement;
  ready: boolean;
};

const defenseSpriteCache: Partial<Record<DefenseType, CachedDefenseSprite | 'failed'>> = {};

function buildCutoutDefenseSprite(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
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

    const colorDist = (pixelIdx: number) => {
      const i = pixelIdx * 4;
      return Math.hypot(data[i] - bgR, data[i + 1] - bgG, data[i + 2] - bgB);
    };

    const isBackgroundPixel = (pixelIdx: number) => {
      const i = pixelIdx * 4;
      const dr = Math.abs(data[i] - bgR);
      const dg = Math.abs(data[i + 1] - bgG);
      const db = Math.abs(data[i + 2] - bgB);
      if (dr > 18 || dg > 18 || db > 18) return false;
      return dr * dr + dg * dg + db * db <= 576;
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
          if (d < 36) {
            const factor = Math.max(0.2, Math.min(1, (d - 18) / 18));
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

function loadDefenseSprite(def: DefenseType, extIndex = 0) {
  if (extIndex >= DEF_EXTENSIONS.length) {
    defenseSpriteCache[def] = 'failed';
    return;
  }
  const img = new Image();
  img.onload = () => {
    const cutout = buildCutoutDefenseSprite(img);
    defenseSpriteCache[def] = { source: cutout, ready: true };
  };
  img.onerror = () => {
    loadDefenseSprite(def, extIndex + 1);
  };
  img.src = `/defenses/${def}.${DEF_EXTENSIONS[extIndex]}`;
  defenseSpriteCache[def] = { source: img, ready: false };
}

function getDefenseSprite(def: DefenseType): HTMLImageElement | HTMLCanvasElement | null {
  if (typeof window === 'undefined') return null;
  const cached = defenseSpriteCache[def];
  if (cached === 'failed') return null;
  if (cached) {
    return cached.ready ? cached.source : null;
  }
  loadDefenseSprite(def, 0);
  return null;
}

const SEA_LABELS: { label: string; lon: number; lat: number }[] = [
  { label: 'OCÉAN ATLANTIQUE', lon: -9.5, lat: 46.5 },
  { label: 'MER DU NORD', lon: 3.4, lat: 55.8 },
  { label: 'MANCHE', lon: -1.8, lat: 49.9 },
  { label: 'MER BALTIQUE', lon: 18.8, lat: 56.5 },
  { label: 'MER MÉDITERRANÉE', lon: 7.5, lat: 39.2 },
  { label: 'MER ADRIATIQUE', lon: 15.8, lat: 43.2 },
  { label: 'MER NOIRE', lon: 34.2, lat: 43.4 },
];

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function hitTestProvince(
  wx: number,
  wy: number,
  provinces: Record<string, Province>
): string | null {
  for (const prov of Object.values(provinces)) {
    if (pointInPolygon(wx, wy, prov.polygon)) {
      return prov.id;
    }
  }
  return null;
}

export function hitTestMovingArmy(
  wx: number,
  wy: number,
  state: GameState
): MovingArmy | null {
  for (const army of state.movingArmies) {
    if (!state.devMode && army.owner !== state.playerNationId) continue;
    const [ax, ay] = getMovingArmyWorldPos(state, army);
    if (Math.hypot(wx - ax, wy - ay) <= 26) {
      return army;
    }
  }
  return null;
}

function getDiplomaticFillColor(state: GameState, prov: Province): string {
  const player = state.playerNationId;
  if (prov.owner === player) return '#3a6b4c';
  if (prov.owner === 'neutral') return '#7d7564';
  const status = getDiplomaticStatus(state, player, prov.owner);
  if (status === 'alliance') return '#2e6885';
  if (status === 'war') return '#8c2b2b';
  return '#7a7365';
}

function drawMountainRelief(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(28, 24, 19, 0.36)';
  ctx.fillStyle = 'rgba(28, 24, 19, 0.16)';
  ctx.lineWidth = 1;

  const peaks = [
    { dx: -16, dy: -16, s: 7 },
    { dx: -6, dy: -20, s: 9 },
    { dx: 7, dy: -16, s: 6.5 },
  ];
  for (const p of peaks) {
    ctx.beginPath();
    ctx.moveTo(cx + p.dx - p.s, cy + p.dy);
    ctx.lineTo(cx + p.dx, cy + p.dy - p.s * 1.15);
    ctx.lineTo(cx + p.dx + p.s, cy + p.dy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawDefenseSpriteTile(
  ctx: CanvasRenderingContext2D,
  def: DefenseType,
  x: number,
  y: number,
  level: number,
  weakened: boolean
) {
  const sprite = getDefenseSprite(def);

  ctx.save();
  ctx.translate(x, y);

  if (weakened) {
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 6, 16, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.ellipse(0, 6, 13.5, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (sprite) {
    const sw = sprite instanceof HTMLImageElement ? sprite.naturalWidth : sprite.width;
    const sh = sprite instanceof HTMLImageElement ? sprite.naturalHeight : sprite.height;
    const maxDim = 34;
    const ratio = Math.min(maxDim / Math.max(1, sw), maxDim / Math.max(1, sh));
    const dw = sw * ratio;
    const dh = sh * ratio;

    if (weakened) ctx.globalAlpha = 0.72;
    ctx.drawImage(sprite, -dw / 2, -dh / 2 - 2, dw, dh);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = weakened ? '#450a0a' : 'rgba(20, 19, 17, 0.88)';
    ctx.strokeStyle = weakened ? '#ef4444' : '#8c8370';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, -1, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = weakened ? '#fca5a5' : '#d6ccb8';
    ctx.font = 'bold 6.5px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels: Record<DefenseType, string> = {
      trenches: 'TRN',
      bunkers: 'BNK',
      aa_defense: 'DCA',
      naval_defense: 'MER',
    };
    ctx.fillText(labels[def], 0, -0.5);
  }

  ctx.fillStyle = weakened ? '#991b1b' : 'rgba(12, 11, 10, 0.92)';
  ctx.strokeStyle = weakened ? '#fca5a5' : level >= 3 ? '#d4af37' : '#c2b69e';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.roundRect(7, 3, 10, 10, 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8f4e8';
  ctx.font = 'bold 7.2px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(weakened ? '!' : String(level), 12, 8.2);

  ctx.restore();
}

function drawProvinceDefensesVisuals(
  ctx: CanvasRenderingContext2D,
  prov: Province,
  nowSec: number
) {
  const [cx, cy] = prov.center;
  const isWeak = (def: DefenseType) =>
    prov.activeWeaknesses.some((w) => w.defense === def && w.expiresAt > nowSec);

  if (prov.defenses.trenches > 0) {
    drawDefenseSpriteTile(
      ctx,
      'trenches',
      cx - 38,
      cy - 13,
      prov.defenses.trenches,
      isWeak('trenches')
    );
  }
  if (prov.defenses.naval_defense > 0) {
    drawDefenseSpriteTile(
      ctx,
      'naval_defense',
      cx - 38,
      cy + 13,
      prov.defenses.naval_defense,
      isWeak('naval_defense')
    );
  }
  if (prov.defenses.aa_defense > 0) {
    drawDefenseSpriteTile(
      ctx,
      'aa_defense',
      cx + 38,
      cy - 13,
      prov.defenses.aa_defense,
      isWeak('aa_defense')
    );
  }
  if (prov.defenses.bunkers > 0) {
    drawDefenseSpriteTile(
      ctx,
      'bunkers',
      cx + 38,
      cy + 13,
      prov.defenses.bunkers,
      isWeak('bunkers')
    );
  }
}

function drawProvinceStructures(
  ctx: CanvasRenderingContext2D,
  prov: Province,
  nowSec: number
) {
  drawProvinceDefensesVisuals(ctx, prov, nowSec);

  const [cx, cy] = prov.center;
  const totalFactories =
    prov.extractionFactories.gold +
    prov.extractionFactories.steel +
    prov.extractionFactories.gas;

  const hasWeakenedDef = prov.activeWeaknesses.some((w) => w.expiresAt > nowSec);

  ctx.save();
  const badges: { text: string; bg: string; border: string }[] = [];

  if (prov.hasLaboratory && prov.laboratoryLevel > 0) {
    badges.push({
      text: `LAB ${prov.laboratoryLevel}`,
      bg: 'rgba(23, 37, 56, 0.92)',
      border: '#60a5fa',
    });
  }
  if (totalFactories > 0) {
    badges.push({
      text: `USN ${totalFactories}`,
      bg: 'rgba(38, 33, 26, 0.9)',
      border: '#c29b40',
    });
  }

  const totalDef =
    prov.defenses.trenches +
    prov.defenses.bunkers +
    prov.defenses.aa_defense +
    prov.defenses.naval_defense;

  if (totalDef > 0) {
    badges.push({
      text: hasWeakenedDef ? 'DÉF !' : `DÉF ${totalDef}`,
      bg: hasWeakenedDef ? 'rgba(127, 29, 29, 0.94)' : 'rgba(30, 34, 30, 0.9)',
      border: hasWeakenedDef ? '#f87171' : '#9ca3af',
    });
  }

  if (badges.length > 0) {
    const startX = cx - ((badges.length - 1) * 32) / 2;
    const by = cy + 38;
    ctx.font = 'bold 7.5px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    badges.forEach((b, i) => {
      const bx = startX + i * 32;
      ctx.fillStyle = b.bg;
      ctx.strokeStyle = b.border;
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.roundRect(bx - 14.5, by - 5.5, 29, 11, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f3efe6';
      ctx.fillText(b.text, bx, by + 0.3);
    });
  }

  ctx.restore();
}

function drawBattleEffect(
  ctx: CanvasRenderingContext2D,
  prov: Province,
  attCount: number,
  defCount: number,
  timeSec: number,
  overridePos?: [number, number]
) {
  const [cx, cy] = overridePos ?? prov.center;
  ctx.save();

  for (let i = 0; i < 3; i++) {
    const phase = (timeSec * 0.7 + i * 0.33) % 1;
    const sx = cx + (i - 1) * 10 + Math.sin(timeSec + i) * 3;
    const sy = cy - 16 - phase * 18;
    ctx.fillStyle = `rgba(24, 22, 20, ${(1 - phase) * 0.42})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 4 + phase * 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const pulse = (timeSec * 1.4) % 1;
  ctx.strokeStyle = `rgba(185, 28, 28, ${(1 - pulse) * 0.75})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, 18 + pulse * 18, 0, Math.PI * 2);
  ctx.stroke();

  if (Math.sin(timeSec * 14 + cx) > 0.72) {
    ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
    ctx.beginPath();
    ctx.arc(cx + 10, cy - 8, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const txt = `⚔ ${attCount} vs ${defCount}`;
  ctx.fillStyle = 'rgba(127, 29, 29, 0.94)';
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - 32, cy - 40, 64, 14, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fef2f2';
  ctx.font = 'bold 8.5px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, cx, cy - 32.8);

  ctx.restore();
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  state: GameState,
  selectedProvinceId: string | null,
  hoveredProvinceId: string | null,
  mapMode: MapMode = 'political',
  nowMs = 0,
  movePreview: MoveOrderPreview | null = null,
  selectedArmyId: string | null = null
): void {
  const timeSec = nowMs / 1000;
  const landPath = getEuropeLandPath();

  const seaGrad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.45,
    80,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.85
  );
  seaGrad.addColorStop(0, '#273a4a');
  seaGrad.addColorStop(1, '#16232e');
  ctx.fillStyle = seaGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  ctx.strokeStyle = 'rgba(186, 206, 222, 0.08)';
  ctx.lineWidth = 1 / camera.zoom;
  for (let x = 0; x <= MAP_WIDTH; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MAP_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= MAP_HEIGHT; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MAP_WIDTH, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(116, 152, 178, 0.22)';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.stroke(landPath);
  ctx.strokeStyle = 'rgba(148, 182, 204, 0.16)';
  ctx.lineWidth = 5;
  ctx.stroke(landPath);
  ctx.restore();

  ctx.save();
  ctx.clip(landPath);

  ctx.fillStyle = '#4c463b';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  const provinces = Object.values(state.provinces);

  for (const prov of provinces) {
    if (prov.polygon.length < 3) continue;
    const isSelected = prov.id === selectedProvinceId;
    const isHovered = prov.id === hoveredProvinceId;
    const isMoveOrigin = movePreview?.fromId === prov.id && !movePreview.startPos;
    const isOnPreviewRoute = movePreview?.route.includes(prov.id);

    ctx.beginPath();
    prov.polygon.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();

    ctx.fillStyle =
      mapMode === 'diplomatic'
        ? getDiplomaticFillColor(state, prov)
        : NATION_TEMPLATES[prov.owner].color;
    ctx.fill();

    if (isSelected || isMoveOrigin) {
      ctx.fillStyle = 'rgba(235, 210, 145, 0.26)';
      ctx.fill();
    } else if (isHovered || isOnPreviewRoute) {
      ctx.fillStyle = 'rgba(255, 245, 220, 0.16)';
      ctx.fill();
    } else if (!hasIntelOnProvince(state, prov.id)) {
      ctx.fillStyle = 'rgba(15, 14, 12, 0.28)';
      ctx.fill();
    }

    ctx.strokeStyle = isSelected
      ? '#e5c158'
      : isHovered
      ? 'rgba(245, 232, 196, 0.7)'
      : 'rgba(20, 18, 15, 0.58)';
    ctx.lineWidth = isSelected ? 2.4 : 1.15;
    ctx.stroke();

    if (prov.terrain === 'mountain') {
      drawMountainRelief(ctx, prov.center[0], prov.center[1]);
    }
  }

  for (const prov of provinces) {
    for (const nId of prov.neighbors) {
      if (nId <= prov.id) continue;
      const nb = state.provinces[nId];
      if (!nb || nb.owner === prov.owner) continue;
      if (getDiplomaticStatus(state, prov.owner, nb.owner) !== 'war') continue;

      const mx = (prov.center[0] + nb.center[0]) / 2;
      const my = (prov.center[1] + nb.center[1]) / 2;
      ctx.fillStyle = 'rgba(185, 28, 28, 0.55)';
      ctx.beginPath();
      ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  ctx.strokeStyle = 'rgba(18, 16, 13, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.stroke(landPath);

  ctx.save();
  ctx.fillStyle = 'rgba(185, 206, 220, 0.28)';
  ctx.font = 'italic 600 13px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const sea of SEA_LABELS) {
    const [sx, sy] = projectGeo(sea.lon, sea.lat);
    ctx.fillText(sea.label, sx, sy);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(186, 208, 224, 0.2)';
  ctx.lineWidth = 1.1;
  ctx.setLineDash([4, 6]);
  for (const prov of provinces) {
    for (const seaId of prov.seaNeighbors) {
      if (seaId <= prov.id) continue;
      const target = state.provinces[seaId];
      if (!target) continue;
      ctx.beginPath();
      ctx.moveTo(prov.center[0], prov.center[1]);
      ctx.lineTo(target.center[0], target.center[1]);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Aperçu suivant l'itinéraire calculé (côtes/mer ou terre)
  if (
    movePreview &&
    (movePreview.route.length >= 2 || (movePreview.startPos && movePreview.route.length >= 1))
  ) {
    ctx.save();
    ctx.strokeStyle = movePreview.isSubmarineMission
      ? '#38bdf8'
      : movePreview.isAir
      ? '#f59e0b'
      : movePreview.isHostile
      ? '#ef4444'
      : '#4ade80';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.lineDashOffset = -timeSec * 28;
    ctx.beginPath();
    if (movePreview.startPos) {
      ctx.moveTo(movePreview.startPos[0], movePreview.startPos[1]);
      movePreview.route.forEach((pId) => {
        const p = state.provinces[pId];
        if (p) ctx.lineTo(p.center[0], p.center[1]);
      });
    } else {
      movePreview.route.forEach((pId, idx) => {
        const p = state.provinces[pId];
        if (!p) return;
        if (idx === 0) ctx.moveTo(p.center[0], p.center[1]);
        else ctx.lineTo(p.center[0], p.center[1]);
      });
    }
    ctx.stroke();

    const dest = state.provinces[movePreview.route[movePreview.route.length - 1]];
    if (dest) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(dest.center[0], dest.center[1], 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const prov of provinces) {
    const [cx, cy] = prov.center;
    const intel = hasIntelOnProvince(state, prov.id);

    if (camera.zoom >= 0.56 || prov.isCapital || prov.id === selectedProvinceId) {
      ctx.save();
      ctx.font = prov.isCapital ? 'bold 11.5px Georgia, serif' : '600 9.5px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = prov.isCapital ? `★ ${prov.name}` : prov.name;
      ctx.fillStyle = 'rgba(12, 10, 8, 0.85)';
      ctx.fillText(label, cx + 0.9, cy + 26.9);
      ctx.fillStyle = prov.isCapital ? '#f3d57a' : '#e6dfd0';
      ctx.fillText(label, cx, cy + 26);
      ctx.restore();
    }

    if (intel) {
      drawProvinceStructures(ctx, prov, state.elapsedSeconds);
      if (totalStack(prov.garrison) > 0) {
        drawUnitToken(ctx, {
          x: cx,
          y: cy - 3,
          owner: prov.owner,
          units: prov.garrison,
          isCapital: prov.isCapital,
          timeSec,
        });
      }
    } else if (prov.owner !== 'neutral') {
      drawFogUnknownToken(ctx, cx, cy - 3, prov.owner);
    }
  }

  // Trajectoires étape par étape (longeant les côtes / étapes de route) & pions des armées
  for (const army of state.movingArmies) {
    if (!isMovingArmyVisibleTo(state, army, state.playerNationId)) continue;

    const from = state.provinces[army.fromProvinceId];
    const to = state.provinces[army.toProvinceId];
    if (!to) continue;

    const [ax, ay] = getMovingArmyWorldPos(state, army);
    const startX = army.startPos ? army.startPos[0] : from?.center[0] ?? ax;
    const isMine = army.owner === state.playerNationId;
    const isEnemy =
      !isMine && getDiplomaticStatus(state, state.playerNationId, army.owner) !== 'alliance';

    ctx.save();
    ctx.strokeStyle =
      army.id === selectedArmyId
        ? '#facc15'
        : army.isSubmarineMission
        ? 'rgba(56, 189, 248, 0.72)'
        : army.isReturning
        ? 'rgba(212, 175, 55, 0.75)'
        : isEnemy
        ? 'rgba(220, 38, 38, 0.78)'
        : 'rgba(235, 226, 206, 0.75)';
    ctx.lineWidth = army.id === selectedArmyId ? 2.8 : 2.1;
    ctx.setLineDash(army.isAir ? [3, 4] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    for (let i = army.currentLegIndex + 1; i < army.route.length; i++) {
      const wp = state.provinces[army.route[i]];
      if (wp) ctx.lineTo(wp.center[0], wp.center[1]);
    }
    ctx.stroke();
    ctx.restore();

    const landingLeft =
      army.landingEndsAt !== undefined
        ? Math.max(0, army.landingEndsAt - state.elapsedSeconds)
        : undefined;

    drawUnitToken(ctx, {
      x: ax,
      y: ay,
      owner: army.owner,
      units: army.units,
      facing: to.center[0] >= startX ? 1 : -1,
      isMoving: landingLeft === undefined && !army.clashPos,
      isNaval: army.isNaval,
      isAir: army.isAir,
      isSubmarine: army.isSubmarineMission,
      isReturning: army.isReturning,
      isSelected: army.id === selectedArmyId,
      isEnemyWarning: isEnemy,
      landingSecondsLeft: landingLeft,
      isLandingPhase: Boolean(army.isLandingPhase),
      timeSec,
      scale: 0.94,
    });
  }

  for (const battle of state.battles) {
    const prov = state.provinces[battle.provinceId];
    if (!prov) continue;
    const defCount = battle.isFieldClash
      ? totalStack(battle.defenderUnits)
      : totalStack(prov.garrison);
    drawBattleEffect(
      ctx,
      prov,
      totalStack(battle.attackerUnits),
      defCount,
      timeSec,
      battle.clashPos
    );
  }

  ctx.restore();
}