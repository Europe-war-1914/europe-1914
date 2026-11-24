import { getEuropeLandPath, MAP_HEIGHT, MAP_WIDTH, projectGeo } from '../data/geo';
import { NATION_TEMPLATES } from '../data/nations';
import { getDiplomaticStatus } from '../engine/combat';
import { hasIntelOnProvince } from '../engine/visibility';
import type { ActiveBattle, GameState, Province, UnitStack } from '../engine/types';

export type MapMode = 'political' | 'diplomatic';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface BorderEdge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  isInternational: boolean;
  isWarFront: boolean;
}

const SEA_LABELS: { name: string; lon: number; lat: number }[] = [
  { name: 'OCÉAN ATLANTIQUE', lon: -8.6, lat: 46.8 },
  { name: 'MER DU NORD', lon: 3.3, lat: 56.2 },
  { name: 'MER BALTIQUE', lon: 19.2, lat: 57.5 },
  { name: 'MER MÉDITERRANÉE', lon: 5.5, lat: 39.2 },
  { name: 'MER NOIRE', lon: 34.0, lat: 43.3 },
];

export function totalUnits(stack: UnitStack): number {
  return stack.infantry + stack.tank + stack.artillery + stack.battleship;
}

function getProvinceStyle(
  state: GameState,
  prov: Province,
  mapMode: MapMode
): { fill: string; border: string; alpha: number } {
  if (mapMode === 'political') {
    const nation = NATION_TEMPLATES[prov.owner];
    return {
      fill: nation.color,
      border: nation.borderColor,
      alpha: prov.owner === 'neutral' ? 0.52 : 0.72,
    };
  }

  if (prov.owner === state.playerNationId) {
    return { fill: '#16a34a', border: '#14532d', alpha: 0.78 };
  }
  if (prov.owner === 'neutral') {
    return { fill: '#a8a29e', border: '#57534e', alpha: 0.46 };
  }

  const status = getDiplomaticStatus(state, state.playerNationId, prov.owner);
  if (status === 'alliance') return { fill: '#0d9488', border: '#115e59', alpha: 0.76 };
  if (status === 'nap') return { fill: '#0284c7', border: '#075985', alpha: 0.72 };
  if (status === 'war') return { fill: '#dc2626', border: '#7f1d1d', alpha: 0.78 };
  return { fill: '#78716c', border: '#44403c', alpha: 0.58 };
}

function drawCompassRose(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(235, 224, 198, 0.28)';
  ctx.fillStyle = 'rgba(235, 224, 198, 0.25)';
  ctx.lineWidth = 1.5;

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
    ctx.lineTo(r * 0.18, 0);
    ctx.lineTo(0, -r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.font = 'bold 14px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(235, 224, 198, 0.5)';
  ctx.fillText('N', 0, -r * 1.28);
  ctx.restore();
}

function drawSeaLabels(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.font = 'italic 600 15px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(205, 222, 235, 0.24)';

  for (const sea of SEA_LABELS) {
    const [sx, sy] = projectGeo(sea.lon, sea.lat);
    ctx.fillText(sea.name, sx, sy);
  }
  ctx.restore();
}

function drawMountainMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(42, 33, 24, 0.45)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 4);
  ctx.lineTo(x - 4, y - 5);
  ctx.lineTo(x + 2, y + 4);
  ctx.moveTo(x - 1, y + 4);
  ctx.lineTo(x + 5, y - 4);
  ctx.lineTo(x + 11, y + 4);
  ctx.stroke();
  ctx.restore();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.58);
  ctx.lineTo(-size * 0.72, 0);
  ctx.lineTo(-size, size * 0.58);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBattleMarker(
  ctx: CanvasRenderingContext2D,
  prov: Province,
  battle: ActiveBattle,
  nowMs: number
) {
  const [cx, cy] = prov.center;
  const pulse = (nowMs % 1200) / 1200;
  const ringRadius = 15 + pulse * 22;
  const ringAlpha = (1 - pulse) * 0.85;

  ctx.save();

  ctx.strokeStyle = battle.isBombardment
    ? `rgba(251, 146, 60, ${ringAlpha.toFixed(2)})`
    : `rgba(239, 68, 68, ${ringAlpha.toFixed(2)})`;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy - 6, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  const bx = cx;
  const by = cy - 30;
  ctx.fillStyle = battle.isBombardment ? '#9a3412' : '#991b1b';
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#fef3c7';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';

  if (battle.isBombardment) {
    ctx.beginPath();
    ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
    ctx.moveTo(bx - 8.5, by);
    ctx.lineTo(bx + 8.5, by);
    ctx.moveTo(bx, by - 8.5);
    ctx.lineTo(bx, by + 8.5);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(bx - 5.5, by + 5.5);
    ctx.lineTo(bx + 5.5, by - 5.5);
    ctx.moveTo(bx + 5.5, by + 5.5);
    ctx.lineTo(bx - 5.5, by - 5.5);
    ctx.stroke();
  }

  const attCount = totalUnits(battle.attackerUnits);
  const defCount = totalUnits(prov.garrison);
  const label = battle.isBombardment ? `ART ${attCount}` : `${attCount} vs ${defCount}`;
  ctx.font = 'bold 9.5px sans-serif';
  const textW = ctx.measureText(label).width + 10;

  ctx.fillStyle = 'rgba(20, 14, 10, 0.88)';
  ctx.strokeStyle = 'rgba(253, 230, 138, 0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx - textW / 2, by - 26, textW, 14, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fef3c7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx, by - 19);

  ctx.restore();
}

function tracePolygon(ctx: CanvasRenderingContext2D, poly: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0], poly[i][1]);
  }
  ctx.closePath();
}

function classifyProvinceEdges(
  state: GameState,
  province: Province,
  allProvinces: Province[]
): BorderEdge[] {
  const poly = province.polygon;
  const [cx, cy] = province.center;
  const nearby = allProvinces.filter(
    (o) =>
      o.id !== province.id &&
      Math.abs(o.center[0] - cx) < 380 &&
      Math.abs(o.center[1] - cy) < 380
  );

  const edges: BorderEdge[] = [];

  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;

    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;

    let nx = -dy / len;
    let ny = dx / len;
    if (nx * (mx - cx) + ny * (my - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const qx = mx + nx * 2.5;
    const qy = my + ny * 2.5;

    let neighborProv: Province | null = null;
    for (const other of nearby) {
      if (pointInPolygon(qx, qy, other.polygon)) {
        neighborProv = other;
        break;
      }
    }

    const sameNation =
      neighborProv !== null &&
      province.owner !== 'neutral' &&
      neighborProv.owner === province.owner;

    const isWarFront =
      neighborProv !== null &&
      !sameNation &&
      getDiplomaticStatus(state, province.owner, neighborProv.owner) === 'war';

    edges.push({
      ax,
      ay,
      bx,
      by,
      isInternational: !sameNation,
      isWarFront,
    });
  }

  return edges;
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera,
  state: GameState,
  selectedProvinceId: string | null,
  hoveredProvinceId: string | null,
  mapMode: MapMode = 'political'
) {
  const nowMs = Date.now();

  // Fond océan style atlas 1914
  ctx.fillStyle = '#213342';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Quadrillage cartographique
  ctx.strokeStyle = 'rgba(222, 208, 178, 0.075)';
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

  drawCompassRose(ctx, 165, 310, 52);
  drawSeaLabels(ctx);

  const landPath = getEuropeLandPath();
  const provinces = Object.values(state.provinces);

  // 1. Halo d'eaux côtières peu profondes
  ctx.save();
  ctx.strokeStyle = 'rgba(165, 198, 214, 0.22)';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.stroke(landPath);
  ctx.restore();

  // 2. Fond parchemin des terres émergées
  ctx.fillStyle = '#c8ba9b';
  ctx.fill(landPath);

  // 3. Superposition des provinces découpées sur les vraies côtes
  ctx.save();
  ctx.clip(landPath);

  const classifiedBorders: { province: Province; edges: BorderEdge[] }[] = [];

  for (const p of provinces) {
    if (p.polygon.length < 3) continue;
    const style = getProvinceStyle(state, p, mapMode);
    const isSelected = p.id === selectedProvinceId;
    const isHovered = p.id === hoveredProvinceId;
    const edges = classifyProvinceEdges(state, p, provinces);
    classifiedBorders.push({ province: p, edges });

    tracePolygon(ctx, p.polygon);

    ctx.save();
    ctx.globalAlpha = style.alpha;
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.restore();

    // Liseré coloré intérieur sur les frontières nationales
    ctx.save();
    tracePolygon(ctx, p.polygon);
    ctx.clip();
    ctx.strokeStyle = style.border;
    ctx.globalAlpha = p.owner === 'neutral' ? 0.28 : 0.48;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const edge of edges) {
      if (!edge.isInternational) continue;
      ctx.moveTo(edge.ax, edge.ay);
      ctx.lineTo(edge.bx, edge.by);
    }
    ctx.stroke();
    ctx.restore();

    if (isSelected || isHovered) {
      tracePolygon(ctx, p.polygon);
      ctx.fillStyle = isSelected ? 'rgba(254, 240, 138, 0.3)' : 'rgba(255, 251, 235, 0.18)';
      ctx.fill();
    }
  }

  // Frontières internes pointillées
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(34, 26, 18, 0.36)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const { edges } of classifiedBorders) {
    for (const edge of edges) {
      if (edge.isInternational) continue;
      ctx.moveTo(edge.ax, edge.ay);
      ctx.lineTo(edge.bx, edge.by);
    }
  }
  ctx.stroke();
  ctx.restore();

  // Frontières internationales épaisses
  ctx.save();
  ctx.strokeStyle = '#1b140d';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const { edges } of classifiedBorders) {
    for (const edge of edges) {
      if (!edge.isInternational || edge.isWarFront) continue;
      ctx.moveTo(edge.ax, edge.ay);
      ctx.lineTo(edge.bx, edge.by);
    }
  }
  ctx.stroke();
  ctx.restore();

  // Lignes de front actives entre nations en guerre (rouge incandescent)
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.42)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const { edges } of classifiedBorders) {
    for (const edge of edges) {
      if (!edge.isWarFront) continue;
      ctx.moveTo(edge.ax, edge.ay);
      ctx.lineTo(edge.bx, edge.by);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.restore();

  // Contour doré de la province sélectionnée
  if (selectedProvinceId && state.provinces[selectedProvinceId]) {
    const sel = state.provinces[selectedProvinceId];
    if (sel.polygon.length >= 3) {
      tracePolygon(ctx, sel.polygon);
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }
  }

  // Repères de relief montagneux
  for (const p of provinces) {
    if (p.terrain === 'mountain') {
      drawMountainMarker(ctx, p.center[0] + 22, p.center[1] - 12);
    }
  }

  ctx.restore();

  // 4. Trait d'encre fin sur toutes les côtes
  ctx.strokeStyle = '#241d15';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke(landPath);

  // 5. Routes maritimes
  const drawnSea = new Set<string>();
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(219, 234, 254, 0.32)';
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

  // 6. Liaisons terrestres de la province sélectionnée
  if (selectedProvinceId && state.provinces[selectedProvinceId]) {
    const sel = state.provinces[selectedProvinceId];
    ctx.save();
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.78)';
    ctx.lineWidth = 2.4;
    for (const nId of sel.neighbors) {
      const nb = state.provinces[nId];
      if (!nb) continue;
      ctx.beginPath();
      ctx.moveTo(sel.center[0], sel.center[1]);
      ctx.lineTo(nb.center[0], nb.center[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Armées en déplacement (flèches directionnelles + ETA + alerte menace)
  for (const army of state.movingArmies) {
    const from = state.provinces[army.fromProvinceId];
    const to = state.provinces[army.toProvinceId];
    if (!from || !to) continue;

    // Respecte le brouillard de guerre pour les mouvements lointains de l'IA
    if (
      army.owner !== state.playerNationId &&
      !hasIntelOnProvince(state, from.id) &&
      !hasIntelOnProvince(state, to.id)
    ) {
      continue;
    }

    const progress = Math.min(
      1,
      Math.max(
        0,
        (state.elapsedSeconds - army.startedAt) / Math.max(1, army.arrivalAt - army.startedAt)
      )
    );
    const dx = to.center[0] - from.center[0];
    const dy = to.center[1] - from.center[1];
    const angle = Math.atan2(dy, dx);
    const ax = from.center[0] + dx * progress;
    const ay = from.center[1] + dy * progress;

    const isThreatToPlayer =
      army.owner !== state.playerNationId &&
      to.owner === state.playerNationId &&
      getDiplomaticStatus(state, army.owner, state.playerNationId) !== 'alliance';

    const lineColor = isThreatToPlayer
      ? '#ef4444'
      : army.owner === state.playerNationId
      ? '#fbbf24'
      : NATION_TEMPLATES[army.owner].color;

    ctx.save();
    if (army.isNaval) ctx.setLineDash([6, 4]);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = isThreatToPlayer ? 3.5 : 2.8;
    ctx.beginPath();
    ctx.moveTo(from.center[0], from.center[1]);
    ctx.lineTo(to.center[0], to.center[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pointe de flèche juste avant la cible
    const tipX = to.center[0] - Math.cos(angle) * 16;
    const tipY = to.center[1] - Math.sin(angle) * 16;
    drawArrowhead(ctx, tipX, tipY, angle, 11, lineColor);

    // Halo rouge d'alerte si menace directe sur le joueur
    if (isThreatToPlayer) {
      const pulse = (nowMs % 900) / 900;
      ctx.strokeStyle = `rgba(239, 68, 68, ${(1 - pulse).toFixed(2)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(ax, ay, 12 + pulse * 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = isThreatToPlayer
      ? '#fee2e2'
      : army.owner === state.playerNationId
      ? '#fef3c7'
      : '#e7e5e4';
    ctx.strokeStyle = isThreatToPlayer ? '#b91c1c' : NATION_TEMPLATES[army.owner].borderColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(ax, ay, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1c1917';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(totalUnits(army.units)), ax, ay);

    // ETA affiché sous le jeton quand on zoome ou pour les armées du joueur
    if (army.owner === state.playerNationId || camera.zoom >= 0.72) {
      const rem = Math.max(0, Math.ceil(army.arrivalAt - state.elapsedSeconds));
      const etaLabel = `${rem}s`;
      ctx.font = 'bold 9px sans-serif';
      const w = ctx.measureText(etaLabel).width + 8;
      ctx.fillStyle = 'rgba(20, 14, 10, 0.85)';
      ctx.beginPath();
      ctx.roundRect(ax - w / 2, ay + 12, w, 12, 3);
      ctx.fill();
      ctx.fillStyle = isThreatToPlayer ? '#fca5a5' : '#fde68a';
      ctx.fillText(etaLabel, ax, ay + 18);
    }

    ctx.restore();
  }

  // 8. Pastilles de garnisons (avec brouillard de guerre), infrastructures et noms
  for (const p of provinces) {
    const [cx, cy] = p.center;
    const intel = hasIntelOnProvince(state, p.id);
    const count = totalUnits(p.garrison);

    // Anneau crénelé de fortification (visible si renseignement disponible)
    if (intel && p.buildings.fort > 0) {
      ctx.save();
      ctx.setLineDash([4, 2.5]);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Pastille d'effectif ou point d'interrogation (brouillard de guerre)
    if (intel && count > 0) {
      ctx.fillStyle = p.owner === state.playerNationId ? '#1e3a5f' : '#292524';
      ctx.strokeStyle = p.isCapital ? '#facc15' : '#e7dcc5';
      ctx.lineWidth = p.isCapital ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fefce8';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), cx, cy - 5.5);
    } else if (!intel) {
      ctx.fillStyle = 'rgba(28, 25, 23, 0.72)';
      ctx.strokeStyle = p.isCapital ? 'rgba(250, 204, 21, 0.7)' : 'rgba(214, 211, 209, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(231, 229, 228, 0.75)';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy - 5.5);
    }

    // Petits repères d'Usine (ambre) et Voies ferrées (bleu ciel) pour tes provinces ou au zoom
    if (intel && (p.owner === state.playerNationId || camera.zoom >= 0.85)) {
      if (p.buildings.factory > 0) {
        ctx.fillStyle = '#d97706';
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx + 12, cy - 16, 11, 9, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fefce8';
        ctx.font = 'bold 7.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p.buildings.factory), cx + 17.5, cy - 11.5);
      }

      if (p.buildings.railway > 0) {
        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx + 17.5, cy - 2, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Nom de la province
    if (p.isCapital || camera.zoom >= 0.72) {
      ctx.font = p.isCapital ? 'bold 12px Georgia, serif' : '600 10px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(20, 16, 12, 0.88)';
      ctx.fillText(p.isCapital ? `★ ${p.name}` : p.name, cx + 1, cy + 9);
      ctx.fillStyle = p.isCapital ? '#fef08a' : '#f5ebd6';
      ctx.fillText(p.isCapital ? `★ ${p.name}` : p.name, cx, cy + 8);
    }
  }

  // 9. Marqueurs animés des batailles et bombardements en cours
  for (const battle of state.battles) {
    const prov = state.provinces[battle.provinceId];
    if (prov && hasIntelOnProvince(state, prov.id)) {
      drawBattleMarker(ctx, prov, battle, nowMs);
    }
  }

  ctx.restore();

  // 10. Vignettage subtil façon table d'état-major éclairée
  const grad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.38,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(12, 10, 8, 0.42)');
  ctx.fillStyle = grad;
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