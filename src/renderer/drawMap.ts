import type { ActiveBattle, GameState, Province, UnitStack } from '../engine/types';
import { NATION_TEMPLATES } from '../data/nations';
import { getEuropeLandPath, MAP_HEIGHT, MAP_WIDTH, projectGeo } from '../data/geo';
import { getDiplomaticStatus } from '../engine/combat';
import { hasIntelOnProvince } from '../engine/visibility';
import { drawFogUnknownToken, drawUnitToken } from './drawUnits';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type MapMode = 'political' | 'diplomatic';

export function totalUnits(stack: UnitStack): number {
  return stack.infantry + stack.tank + stack.artillery + stack.battleship;
}

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 1000) / 100;
}

function drawCompassRose(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(235, 224, 198, 0.25)';
  ctx.fillStyle = 'rgba(235, 224, 198, 0.22)';
  ctx.lineWidth = 1.4;

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.15);
    ctx.lineTo(r * 0.16, 0);
    ctx.lineTo(0, -r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.font = 'bold 13px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(235, 224, 198, 0.45)';
  ctx.fillText('N', 0, -r * 1.28);
  ctx.restore();
}

function drawSeaLabels(ctx: CanvasRenderingContext2D) {
  const labels: { text: string; lon: number; lat: number; size: number }[] = [
    { text: 'OCÉAN ATLANTIQUE', lon: -8.5, lat: 47.5, size: 17 },
    { text: 'MER DU NORD', lon: 3.0, lat: 56.2, size: 13 },
    { text: 'MER BALTIQUE', lon: 19.5, lat: 57.6, size: 12 },
    { text: 'MER MÉDITERRANÉE', lon: 13.0, lat: 36.4, size: 16 },
    { text: 'MER NOIRE', lon: 34.2, lat: 43.2, size: 13 },
  ];

  ctx.save();
  ctx.fillStyle = 'rgba(203, 221, 236, 0.28)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    const [x, y] = projectGeo(l.lon, l.lat);
    ctx.font = `italic 600 ${l.size}px Georgia, serif`;
    ctx.fillText(l.text, x, y);
  }
  ctx.restore();
}

function drawMountainPeaks(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(41, 35, 28, 0.35)';
  ctx.strokeStyle = 'rgba(245, 235, 214, 0.35)';
  ctx.lineWidth = 0.9;

  const peaks = [
    [-12, 10, 6],
    [0, 7, 8],
    [11, 11, 6],
  ];
  for (const [px, py, h] of peaks) {
    ctx.beginPath();
    ctx.moveTo(px - h * 0.9, py);
    ctx.lineTo(px, py - h);
    ctx.lineTo(px + h * 0.9, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Tranchées et casemates 1914 autour d'une province fortifiée */
function drawFortificationTrenches(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  level: number
) {
  ctx.save();
  ctx.translate(cx, cy - 6);

  const radius = 21 + level * 1.5;
  const segments = 16;

  // Rempart / tranchée en zigzag façon 1914
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : radius - 3.2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r * 0.68;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.strokeStyle = 'rgba(68, 52, 36, 0.9)';
  ctx.lineWidth = 2.6 + level * 0.4;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(217, 179, 124, 0.75)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Petits blockhaus aux 4 points cardinaux dès le niveau 2
  if (level >= 2) {
    ctx.fillStyle = '#57534e';
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 0.9;
    const bunkers: [number, number][] = [
      [-radius, 0],
      [radius, 0],
      [0, -radius * 0.68],
      [0, radius * 0.68],
    ];
    for (const [bx, by] of bunkers) {
      ctx.beginPath();
      ctx.roundRect(bx - 2.6, by - 2.2, 5.2, 4.4, 1);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Petite usine avec cheminées fumantes sur la carte */
function drawFactorySmoke(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  level: number,
  timeSec: number
) {
  const fx = cx - 26;
  const fy = cy + 2;

  ctx.save();
  ctx.translate(fx, fy);

  // Bâtiment industriel (toit en dents de scie)
  ctx.fillStyle = '#44403c';
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(-6, -2);
  ctx.lineTo(-2, -5);
  ctx.lineTo(-2, -2);
  ctx.lineTo(2, -5);
  ctx.lineTo(2, -2);
  ctx.lineTo(6, -2);
  ctx.lineTo(6, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cheminées (1 à 2 selon le niveau)
  const chimneys = level >= 2 ? [-4.2, 3.5] : [3.5];
  for (let i = 0; i < chimneys.length; i++) {
    const chX = chimneys[i];
    ctx.fillStyle = '#292524';
    ctx.fillRect(chX - 1.2, -10.5, 2.4, 8.5);

    // Panaches de fumée animés qui s'élèvent doucement
    for (let p = 0; p < 3; p++) {
      const cycle = (timeSec * 0.55 + p * 0.33 + i * 0.17) % 1;
      const sx = chX + cycle * 7 + Math.sin(timeSec * 2 + p) * 1.2;
      const sy = -11.5 - cycle * 11;
      const alpha = (1 - cycle) * 0.42;
      ctx.fillStyle = `rgba(214, 211, 209, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.4 + cycle * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Voies ferrées visibles entre provinces reliées équipées de rails */
function drawRailwayNetwork(ctx: CanvasRenderingContext2D, state: GameState, provinces: Province[]) {
  const drawn = new Set<string>();
  ctx.save();
  for (const p of provinces) {
    if (p.buildings.railway <= 0) continue;
    for (const nId of p.neighbors) {
      const key = p.id < nId ? `${p.id}:${nId}` : `${nId}:${p.id}`;
      if (drawn.has(key)) continue;
      const nb = state.provinces[nId];
      if (!nb || nb.owner !== p.owner) continue;
      if (nb.buildings.railway <= 0 && !p.isCapital && !nb.isCapital) continue;
      drawn.add(key);

      // Base sombre du rail
      ctx.strokeStyle = 'rgba(28, 25, 23, 0.55)';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p.center[0], p.center[1]);
      ctx.lineTo(nb.center[0], nb.center[1]);
      ctx.stroke();

      // Traverses claires en pointillés serrés
      ctx.strokeStyle = 'rgba(231, 219, 192, 0.65)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2.5, 4.5]);
      ctx.beginPath();
      ctx.moveTo(p.center[0], p.center[1]);
      ctx.lineTo(nb.center[0], nb.center[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawInfrastructureBadges(ctx: CanvasRenderingContext2D, p: Province) {
  const [cx, cy] = p.center;
  const items: { icon: string; count: number; color: string }[] = [];
  if (p.buildings.factory > 0) items.push({ icon: '⚙', count: p.buildings.factory, color: '#f59e0b' });
  if (p.buildings.fort > 0) items.push({ icon: '⛨', count: p.buildings.fort, color: '#a8a29e' });
  if (p.buildings.railway > 0) items.push({ icon: '═', count: p.buildings.railway, color: '#38bdf8' });
  if (items.length === 0) return;

  ctx.save();
  const startX = cx + 21;
  let y = cy - 16;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (const item of items) {
    ctx.fillStyle = 'rgba(20, 17, 14, 0.85)';
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.roundRect(startX, y - 6, 22, 12, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = item.color;
    ctx.fillText(`${item.icon}${item.count}`, startX + 3, y + 0.5);
    y += 13;
  }
  ctx.restore();
}

/** Éclair de bouche (tir d'arme ou canon) */
function drawMuzzleFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: 1 | -1,
  intensity: number
) {
  if (intensity <= 0.05) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * intensity, intensity);

  // Halo orange
  ctx.fillStyle = `rgba(251, 146, 60, ${0.75 * intensity})`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(10, -4.5);
  ctx.lineTo(7, -1);
  ctx.lineTo(13, 0);
  ctx.lineTo(7, 1.5);
  ctx.lineTo(10, 4.5);
  ctx.closePath();
  ctx.fill();

  // Cœur blanc incandescent
  ctx.fillStyle = `rgba(254, 249, 195, ${0.95 * intensity})`;
  ctx.beginPath();
  ctx.ellipse(3.5, 0, 4, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Effets de bataille en direct : tirs, traçantes, fumée et obus d'artillerie */
function drawBattleEffects(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  battle: ActiveBattle,
  prov: Province,
  timeSec: number
) {
  const [cx, cy] = prov.center;
  const seed = hashSeed(battle.id);

  // 1. Panaches de fumée de bataille continus
  ctx.save();
  for (let i = 0; i < 6; i++) {
    const cycle = (timeSec * 0.45 + seed + i * 0.17) % 1;
    const driftX = Math.sin(seed * 3 + i * 2.1 + timeSec * 1.4) * 10 + (i - 2.5) * 4;
    const sy = cy - 6 - cycle * 26;
    const r = 3.5 + cycle * 7.5;
    const alpha = (1 - cycle) * 0.36;
    ctx.fillStyle = i % 2 === 0 ? `rgba(55, 52, 48, ${alpha})` : `rgba(120, 113, 108, ${alpha})`;
    ctx.beginPath();
    ctx.arc(cx + driftX, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (battle.isBombardment) {
    // 2A. Pilonnage d'artillerie : obus en trajectoire parabolique depuis la province tireuse
    const adjacentIds = [...prov.neighbors, ...prov.seaNeighbors];
    let originProv = adjacentIds
      .map((id) => state.provinces[id])
      .find((p) => p && p.owner === battle.attacker && p.garrison.artillery > 0);
    if (!originProv) {
      originProv = adjacentIds
        .map((id) => state.provinces[id])
        .find((p) => p && p.owner === battle.attacker);
    }

    const ox = originProv ? originProv.center[0] : cx - 65;
    const oy = originProv ? originProv.center[1] - 10 : cy - 30;
    const ctrlX = (ox + cx) / 2;
    const ctrlY = Math.min(oy, cy) - 48;

    // 2 salves décalées en l'air
    for (let s = 0; s < 2; s++) {
      const t = (timeSec * 0.72 + seed + s * 0.5) % 1;

      if (t < 0.78) {
        const u = t / 0.78;
        const inv = 1 - u;
        const sx = inv * inv * ox + 2 * inv * u * ctrlX + u * u * cx;
        const sy = inv * inv * oy + 2 * inv * u * ctrlY + u * u * (cy - 6);

        // Traînée de l'obus
        const uPrev = Math.max(0, u - 0.14);
        const invP = 1 - uPrev;
        const px = invP * invP * ox + 2 * invP * uPrev * ctrlX + uPrev * uPrev * cx;
        const py = invP * invP * oy + 2 * invP * uPrev * ctrlY + uPrev * uPrev * (cy - 6);

        ctx.save();
        const grad = ctx.createLinearGradient(px, py, sx, sy);
        grad.addColorStop(0, 'rgba(251, 146, 60, 0)');
        grad.addColorStop(1, 'rgba(254, 240, 138, 0.95)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        // Tête incandescente de l'obus
        ctx.fillStyle = '#fef9c3';
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        // Impact explosif à l'arrivée
        const impact = (t - 0.78) / 0.22;
        const ex = cx + (s === 0 ? -5 : 6);
        const ey = cy - 6 + (s === 0 ? 2 : -3);

        ctx.save();
        ctx.fillStyle = `rgba(249, 115, 22, ${(1 - impact) * 0.85})`;
        ctx.beginPath();
        ctx.arc(ex, ey, 4 + impact * 13, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(254, 249, 195, ${(1 - impact) * 0.95})`;
        ctx.beginPath();
        ctx.arc(ex, ey, 2 + impact * 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(251, 191, 36, ${(1 - impact) * 0.8})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(ex, ey, 6 + impact * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    return;
  }

  // 2B. Bataille au sol : échanges de tirs et traçantes entre attaquant (gauche) et défenseur (droite)
  const attPhase = (timeSec * 3.8 + seed) % 1;
  const defPhase = (timeSec * 3.8 + seed + 0.48) % 1;

  // Éclairs de tir de l'attaquant vers la droite
  if (attPhase < 0.28) {
    const power = 1 - attPhase / 0.28;
    drawMuzzleFlash(ctx, cx - 10, cy - 11, 1, power);

    ctx.save();
    ctx.strokeStyle = `rgba(254, 240, 138, ${power * 0.85})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 11);
    ctx.lineTo(cx + 12, cy - 9 + Math.sin(timeSec * 19) * 3);
    ctx.stroke();
    ctx.restore();
  }

  // Éclairs de tir du défenseur vers la gauche
  if (defPhase < 0.28 && totalUnits(battle.defenderUnits) > 0) {
    const power = 1 - defPhase / 0.28;
    drawMuzzleFlash(ctx, cx + 10, cy - 10, -1, power);

    ctx.save();
    ctx.strokeStyle = `rgba(253, 186, 116, ${power * 0.85})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy - 10);
    ctx.lineTo(cx - 12, cy - 11 + Math.cos(timeSec * 17) * 3);
    ctx.stroke();
    ctx.restore();
  }

  // Petit éclat d'obus périodique au centre du front
  const burst = (timeSec * 1.15 + seed * 1.7) % 1;
  if (burst < 0.22) {
    const k = burst / 0.22;
    ctx.save();
    ctx.fillStyle = `rgba(251, 146, 60, ${(1 - k) * 0.8})`;
    ctx.beginPath();
    ctx.arc(cx, cy - 7, 3 + k * 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(254, 249, 195, ${(1 - k) * 0.9})`;
    ctx.beginPath();
    ctx.arc(cx, cy - 7, 1.5 + k * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function getDiplomaticFillColor(state: GameState, owner: Province['owner']): string {
  if (owner === state.playerNationId) return '#2563eb';
  if (owner === 'neutral') return '#a8a29e';
  const status = getDiplomaticStatus(state, state.playerNationId, owner);
  if (status === 'alliance') return '#16a34a';
  if (status === 'nap') return '#0891b2';
  if (status === 'war') return '#dc2626';
  return '#78716c';
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
  nowMs: number = performance.now()
) {
  const timeSec = nowMs / 1000;

  // 1. Fond océan style atlas militaire 1914
  ctx.fillStyle = '#1e2d3b';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Quadrillage latitude / longitude
  ctx.strokeStyle = 'rgba(218, 205, 175, 0.07)';
  ctx.lineWidth = 1 / camera.zoom;
  for (let gx = 0; gx <= MAP_WIDTH; gx += 120) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, MAP_HEIGHT);
    ctx.stroke();
  }
  for (let gy = 0; gy <= MAP_HEIGHT; gy += 120) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(MAP_WIDTH, gy);
    ctx.stroke();
  }

  drawSeaLabels(ctx);
  drawCompassRose(ctx, 130, 175, 44);

  const landPath = getEuropeLandPath();
  const provinces = Object.values(state.provinces);

  // 2. Halo d'eaux côtières + terres hors-jeu en parchemin
  ctx.save();
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.16)';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.stroke(landPath);

  ctx.fillStyle = '#c8bc9e';
  ctx.fill(landPath);
  ctx.restore();

  // 3. Provinces découpées exactement sur les côtes réelles
  ctx.save();
  ctx.clip(landPath);

  for (const p of provinces) {
    if (p.polygon.length < 3) continue;
    const isSelected = p.id === selectedProvinceId;
    const isHovered = p.id === hoveredProvinceId;

    ctx.beginPath();
    ctx.moveTo(p.polygon[0][0], p.polygon[0][1]);
    for (let i = 1; i < p.polygon.length; i++) {
      ctx.lineTo(p.polygon[i][0], p.polygon[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle =
      mapMode === 'diplomatic'
        ? getDiplomaticFillColor(state, p.owner)
        : NATION_TEMPLATES[p.owner].color;
    ctx.fill();

    // Patine parchemin / surbrillance sélection
    ctx.fillStyle = isSelected
      ? 'rgba(254, 240, 138, 0.34)'
      : isHovered
      ? 'rgba(255, 250, 235, 0.18)'
      : 'rgba(244, 233, 205, 0.12)';
    ctx.fill();

    // Frontières internes
    ctx.strokeStyle = isSelected ? '#fef08a' : 'rgba(28, 25, 23, 0.55)';
    ctx.lineWidth = isSelected ? 3 : 1.1;
    ctx.stroke();

    // Relief de montagne discret
    if (p.terrain === 'mountain') {
      drawMountainPeaks(ctx, p.center[0], p.center[1] + 10);
    }

    // Tranchées & casemates sur les provinces fortifiées
    if (p.buildings.fort > 0 && hasIntelOnProvince(state, p.id)) {
      drawFortificationTrenches(ctx, p.center[0], p.center[1], p.buildings.fort);
    }
  }

  // Réseau de voies ferrées
  drawRailwayNetwork(ctx, state, provinces);

  // Lignes de front rouge incandescent sur les frontières en guerre
  const drawnBorders = new Set<string>();
  for (const p of provinces) {
    for (const nId of p.neighbors) {
      const key = p.id < nId ? `${p.id}:${nId}` : `${nId}:${p.id}`;
      if (drawnBorders.has(key)) continue;
      drawnBorders.add(key);
      const nb = state.provinces[nId];
      if (!nb || nb.owner === p.owner) continue;

      const atWar = getDiplomaticStatus(state, p.owner, nb.owner) === 'war';
      if (!atWar) continue;

      const mx = (p.center[0] + nb.center[0]) / 2;
      const my = (p.center[1] + nb.center[1]) / 2;
      const dx = nb.center[0] - p.center[0];
      const dy = nb.center[1] - p.center[1];
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * 18;
      const py = (dx / len) * 18;

      ctx.save();
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.55 + Math.sin(timeSec * 4) * 0.25})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(mx - px, my - py);
      ctx.lineTo(mx + px, my + py);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore(); // Fin du clip côtes

  // Contour net des côtes européennes
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 1.5;
  ctx.stroke(landPath);

  // 4. Routes maritimes en pointillés
  const drawnSea = new Set<string>();
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(191, 219, 254, 0.32)';
  ctx.lineWidth = 1.5;
  for (const p of provinces) {
    for (const sId of p.seaNeighbors) {
      const key = p.id < sId ? `${p.id}:${sId}` : `${sId}:${p.id}`;
      if (drawnSea.has(key)) continue;
      drawnSea.add(key);
      const target = state.provinces[sId];
      if (!target) continue;
      ctx.beginPath();
      ctx.moveTo(p.center[0], p.center[1]);
      ctx.lineTo(target.center[0], target.center[1]);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 5. Connexions terrestres / maritimes de la province sélectionnée
  if (selectedProvinceId && state.provinces[selectedProvinceId]) {
    const sel = state.provinces[selectedProvinceId];
    ctx.save();
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.75)';
    ctx.lineWidth = 2.4;
    for (const nId of sel.neighbors) {
      const nb = state.provinces[nId];
      if (!nb) continue;
      ctx.beginPath();
      ctx.moveTo(sel.center[0], sel.center[1]);
      ctx.lineTo(nb.center[0], nb.center[1]);
      ctx.stroke();
    }
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
    for (const sId of sel.seaNeighbors) {
      const nb = state.provinces[sId];
      if (!nb) continue;
      ctx.beginPath();
      ctx.moveTo(sel.center[0], sel.center[1]);
      ctx.lineTo(nb.center[0], nb.center[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. Garnisons, usines fumantes et noms des provinces
  const battleProvinceIds = new Set(state.battles.map((b) => b.provinceId));

  for (const p of provinces) {
    const [cx, cy] = p.center;
    const intel = hasIntelOnProvince(state, p.id);
    const count = totalUnits(p.garrison);

    if (intel && p.buildings.factory > 0) {
      drawFactorySmoke(ctx, cx, cy, p.buildings.factory, timeSec);
    }

    // N'affiche pas la garnison au centre si une bataille est en cours (gérée à l'étape 8)
    if (!battleProvinceIds.has(p.id)) {
      if (!intel) {
        drawFogUnknownToken(ctx, cx, cy - 8, p.owner);
      } else if (count > 0) {
        drawUnitToken(ctx, {
          x: cx,
          y: cy - 8,
          owner: p.owner,
          units: p.garrison,
          facing: p.owner === 'germany' || p.owner === 'austria' || p.owner === 'russia' ? -1 : 1,
          isCapital: p.isCapital,
          morale: p.morale,
          timeSec,
          scale: p.isCapital ? 1.08 : 0.96,
        });
      }
    }

    if (intel) {
      drawInfrastructureBadges(ctx, p);
    }

    // Nom de la province
    if (p.isCapital || camera.zoom >= 0.72) {
      ctx.font = p.isCapital ? 'bold 11.5px Georgia, serif' : '600 9.5px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(15, 12, 10, 0.9)';
      ctx.fillText(p.isCapital ? `★ ${p.name}` : p.name, cx + 1, cy + 16);
      ctx.fillStyle = p.isCapital ? '#fef08a' : '#f5ebd6';
      ctx.fillText(p.isCapital ? `★ ${p.name}` : p.name, cx, cy + 15);
    }
  }

  // 7. Armées en déplacement (flèche tactique + silhouette orientée + ETA)
  for (const army of state.movingArmies) {
    const from = state.provinces[army.fromProvinceId];
    const to = state.provinces[army.toProvinceId];
    if (!from || !to) continue;

    const visible =
      army.owner === state.playerNationId ||
      hasIntelOnProvince(state, from.id) ||
      hasIntelOnProvince(state, to.id);
    if (!visible) continue;

    const duration = Math.max(1, army.arrivalAt - army.startedAt);
    const progress = Math.min(1, Math.max(0, (state.elapsedSeconds - army.startedAt) / duration));
    const ax = from.center[0] + (to.center[0] - from.center[0]) * progress;
    const ay = from.center[1] + (to.center[1] - from.center[1]) * progress;
    const eta = Math.max(0, Math.ceil(army.arrivalAt - state.elapsedSeconds));

    const isHostileIncoming =
      to.owner === state.playerNationId &&
      army.owner !== state.playerNationId &&
      getDiplomaticStatus(state, army.owner, state.playerNationId) !== 'alliance';

    // Flèche de trajet
    ctx.save();
    ctx.strokeStyle = isHostileIncoming ? '#ef4444' : NATION_TEMPLATES[army.owner].color;
    ctx.lineWidth = isHostileIncoming ? 3.2 : 2.5;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -timeSec * 18;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(to.center[0], to.center[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pointe de flèche à destination
    const angle = Math.atan2(to.center[1] - from.center[1], to.center[0] - from.center[0]);
    const tipX = to.center[0] - Math.cos(angle) * 16;
    const tipY = to.center[1] - Math.sin(angle) * 16;
    ctx.fillStyle = isHostileIncoming ? '#ef4444' : NATION_TEMPLATES[army.owner].color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(angle - 0.5) * 9, tipY - Math.sin(angle - 0.5) * 9);
    ctx.lineTo(tipX - Math.cos(angle + 0.5) * 9, tipY - Math.sin(angle + 0.5) * 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Silhouette d'unité en marche
    drawUnitToken(ctx, {
      x: ax,
      y: ay - 6,
      owner: army.owner,
      units: army.units,
      facing: to.center[0] >= from.center[0] ? 1 : -1,
      isMoving: true,
      isNaval: army.isNaval,
      isEnemyWarning: isHostileIncoming,
      timeSec,
      scale: 1.02,
    });

    // Pastille ETA en secondes
    ctx.save();
    ctx.fillStyle = isHostileIncoming ? 'rgba(153, 27, 27, 0.92)' : 'rgba(20, 18, 16, 0.85)';
    ctx.beginPath();
    ctx.roundRect(ax - 15, ay - 30, 30, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#fefce8';
    ctx.font = 'bold 8.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${eta}s`, ax, ay - 23.5);
    ctx.restore();
  }

  // 8. Combats en cours (face à face + éclairs de tirs, fumée et obus d'artillerie)
  for (const battle of state.battles) {
    const prov = state.provinces[battle.provinceId];
    if (!prov) continue;
    const [cx, cy] = prov.center;
    const pulse = (Math.sin(timeSec * 6) + 1) / 2;

    // Onde de choc rouge/orange au sol
    ctx.save();
    ctx.strokeStyle = battle.isBombardment
      ? `rgba(251, 146, 60, ${0.4 + pulse * 0.5})`
      : `rgba(239, 68, 68, ${0.45 + pulse * 0.5})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 18 + pulse * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Attaquant à gauche, défenseur à droite, face à face
    if (!battle.isBombardment) {
      drawUnitToken(ctx, {
        x: cx - 19,
        y: cy - 8,
        owner: battle.attacker,
        units: battle.attackerUnits,
        facing: 1,
        isMoving: false,
        timeSec,
        scale: 0.92,
      });
    }

    if (totalUnits(battle.defenderUnits) > 0) {
      drawUnitToken(ctx, {
        x: battle.isBombardment ? cx : cx + 19,
        y: cy - 8,
        owner: battle.defender,
        units: battle.defenderUnits,
        facing: -1,
        isMoving: false,
        morale: prov.morale,
        timeSec,
        scale: 0.92,
      });
    }

    // Effets visuels de combat (tirs, fumée, obus paraboliques, explosions)
    drawBattleEffects(ctx, state, battle, prov, timeSec);
  }

  ctx.restore();

  // 9. Vignettage léger « table d'état-major »
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(10, 8, 6, 0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export function hitTestProvince(
  worldX: number,
  worldY: number,
  provinces: Record<string, Province>
): string | null {
  for (const p of Object.values(provinces)) {
    if (pointInPolygon(worldX, worldY, p.polygon)) {
      return p.id;
    }
  }
  return null;
}

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