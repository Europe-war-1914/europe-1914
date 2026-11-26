import { UNIT_ORDER } from '../data/balance';
import { isPointOnLand, MAP_HEIGHT, MAP_WIDTH, projectGeo } from '../data/geo';
import type { GameState, NationId, Province, UnitStack, VirtualZone } from './types';

export interface ZoneRoutePlan {
  route: string[];
  path: [number, number][];
  isAir: boolean;
  isNaval: boolean;
  isSubmarineMission: boolean;
  virtualZone: VirtualZone;
  coastBeachPos?: [number, number];
}

const CELL = 14;
const COLS = Math.ceil(MAP_WIDTH / CELL);
const ROWS = Math.ceil(MAP_HEIGHT / CELL);
const TOTAL_CELLS = COLS * ROWS;

// Détroits maritimes réels (GPS lon/lat) ouverts dans le masque MER sans altérer TERRE
const SEA_STRAIT_CORRIDORS: [number, number][][] = [
  // Détroit de Gibraltar
  [
    [-6.2, 35.92],
    [-5.6, 35.95],
    [-5.1, 36.02],
    [-4.7, 36.1],
  ],
  // Pas de Calais / Manche
  [
    [1.0, 50.85],
    [1.45, 51.02],
    [1.9, 51.25],
  ],
  // Détroits danois (Skagerrak / Kattegat / Øresund)
  [
    [10.5, 57.6],
    [11.6, 56.8],
    [12.55, 56.05],
    [12.7, 55.45],
    [13.2, 55.0],
  ],
  // Dardanelles / Mer de Marmara / Bosphore
  [
    [25.8, 39.95],
    [26.35, 40.15],
    [26.9, 40.5],
    [28.1, 40.8],
    [29.05, 41.05],
    [29.15, 41.35],
  ],
  // Détroit de Messine
  [
    [15.5, 37.9],
    [15.63, 38.22],
    [15.7, 38.45],
  ],
  // Canal d'Otrante
  [
    [18.6, 40.1],
    [19.0, 40.5],
  ],
];

interface NavGrid {
  landMask: Uint8Array;
  seaMask: Uint8Array;
  seaClearance: Uint8Array;
  cellProvinceIdx: Int16Array;
  provinceIds: string[];
  provinceIdxById: Map<string, number>;
  coastSeaCells: Map<string, number[]>;
  coastLandCells: Map<string, number[]>;
}

let cachedGrid: NavGrid | null = null;

function cellCenter(idx: number): [number, number] {
  const cx = idx % COLS;
  const cy = (idx - cx) / COLS;
  return [cx * CELL + CELL * 0.5, cy * CELL + CELL * 0.5];
}

function posToCell(x: number, y: number): number {
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
  return cy * COLS + cx;
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

function ensureNavGrid(provinces: Record<string, Province>): NavGrid {
  if (cachedGrid) return cachedGrid;

  const landMask = new Uint8Array(TOTAL_CELLS);
  const seaMask = new Uint8Array(TOTAL_CELLS);
  const seaClearance = new Uint8Array(TOTAL_CELLS);
  const cellProvinceIdx = new Int16Array(TOTAL_CELLS).fill(-1);

  const provList = Object.values(provinces);
  const provinceIds = provList.map((p) => p.id);
  const provinceIdxById = new Map<string, number>();
  const provBoxes = provList.map((p, idx) => {
    provinceIdxById.set(p.id, idx);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [px, py] of p.polygon) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return { prov: p, idx, minX, maxX, minY, maxY };
  });

  // 1. Masques TERRE / MER + appartenance province
  for (let cy = 0; cy < ROWS; cy++) {
    const wy = cy * CELL + CELL * 0.5;
    for (let cx = 0; cx < COLS; cx++) {
      const wx = cx * CELL + CELL * 0.5;
      const idx = cy * COLS + cx;
      const onLand = isPointOnLand(wx, wy);

      if (onLand) {
        landMask[idx] = 1;
        seaMask[idx] = 0;
        for (let p = 0; p < provBoxes.length; p++) {
          const b = provBoxes[p];
          if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) continue;
          if (pointInPolygon(wx, wy, b.prov.polygon)) {
            cellProvinceIdx[idx] = b.idx;
            break;
          }
        }
      } else {
        landMask[idx] = 0;
        seaMask[idx] = 1;
      }
    }
  }

  // 2. Ouverture garantie des détroits maritimes étroits dans seaMask uniquement
  for (const corridor of SEA_STRAIT_CORRIDORS) {
    for (let i = 0; i < corridor.length - 1; i++) {
      const [ax, ay] = projectGeo(corridor[i][0], corridor[i][1]);
      const [bx, by] = projectGeo(corridor[i + 1][0], corridor[i + 1][1]);
      const dist = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(4, Math.ceil(dist / 5));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const idx = posToCell(px, py);
        seaMask[idx] = 1;
      }
    }
  }

  // 3. Champ de distance aux côtes (BFS multi-source depuis TERRE)
  const queue = new Int32Array(TOTAL_CELLS);
  let head = 0;
  let tail = 0;
  seaClearance.fill(255);

  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (seaMask[i] === 0) {
      seaClearance[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const curr = queue[head++];
    const curD = seaClearance[curr];
    if (curD >= 8) continue;
    const cx = curr % COLS;
    const cy = (curr - cx) / COLS;

    const tryPush = (nx: number, ny: number) => {
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
      const nIdx = ny * COLS + nx;
      if (seaClearance[nIdx] > curD + 1) {
        seaClearance[nIdx] = curD + 1;
        queue[tail++] = nIdx;
      }
    };
    tryPush(cx - 1, cy);
    tryPush(cx + 1, cy);
    tryPush(cx, cy - 1);
    tryPush(cx, cy + 1);
  }

  // 4. Cellules côtières réelles (plages TERRE & mouillages MER) par province
  const coastSeaSets = new Map<string, Set<number>>();
  const coastLandSets = new Map<string, Set<number>>();

  for (let cy = 1; cy < ROWS - 1; cy++) {
    for (let cx = 1; cx < COLS - 1; cx++) {
      const idx = cy * COLS + cx;
      if (landMask[idx] !== 1) continue;
      const pIdx = cellProvinceIdx[idx];
      if (pIdx < 0) continue;
      const pId = provinceIds[pIdx];

      const nbs = [idx - 1, idx + 1, idx - COLS, idx + COLS];
      for (const nb of nbs) {
        if (seaMask[nb] === 1 && landMask[nb] === 0) {
          let sSet = coastSeaSets.get(pId);
          if (!sSet) {
            sSet = new Set<number>();
            coastSeaSets.set(pId, sSet);
          }
          sSet.add(nb);

          let lSet = coastLandSets.get(pId);
          if (!lSet) {
            lSet = new Set<number>();
            coastLandSets.set(pId, lSet);
          }
          lSet.add(idx);
        }
      }
    }
  }

  const coastSeaCells = new Map<string, number[]>();
  const coastLandCells = new Map<string, number[]>();

  for (const prov of provList) {
    const sList = Array.from(coastSeaSets.get(prov.id) ?? []);
    const lList = Array.from(coastLandSets.get(prov.id) ?? []);

    // Fallback si une province marquée côtière n'a aucune cellule frontalière directe
    if (sList.length === 0 && (prov.terrain === 'coastal' || prov.seaNeighbors.length > 0)) {
      let bestSea = -1;
      let bestDist = Infinity;
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (seaMask[i] !== 1 || landMask[i] === 1) continue;
        const [wx, wy] = cellCenter(i);
        const d = Math.hypot(wx - prov.center[0], wy - prov.center[1]);
        if (d < bestDist) {
          bestDist = d;
          bestSea = i;
        }
      }
      if (bestSea >= 0) sList.push(bestSea);
    }

    if (lList.length === 0) {
      const cIdx = posToCell(prov.center[0], prov.center[1]);
      if (landMask[cIdx] === 1) lList.push(cIdx);
    }

    coastSeaCells.set(prov.id, sList);
    coastLandCells.set(prov.id, lList);
  }

  cachedGrid = {
    landMask,
    seaMask,
    seaClearance,
    cellProvinceIdx,
    provinceIds,
    provinceIdxById,
    coastSeaCells,
    coastLandCells,
  };
  return cachedGrid;
}

/** Tas binaire rapide pour A* sur grille */
class MinHeap {
  private nodes: number[] = [];
  private scores: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, score: number): void {
    this.nodes.push(node);
    this.scores.push(score);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[p] <= this.scores[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.scores[0] = lastScore;
      let i = 0;
      const n = this.nodes.length;
      while (true) {
        const l = (i << 1) + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && this.scores[l] < this.scores[smallest]) smallest = l;
        if (r < n && this.scores[r] < this.scores[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tn = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = tn;
    const ts = this.scores[a];
    this.scores[a] = this.scores[b];
    this.scores[b] = ts;
  }
}

export function isCoastalProvince(prov: Province): boolean {
  return prov.terrain === 'coastal' || prov.seaNeighbors.length > 0;
}

export function getStackTotal(stack: UnitStack): number {
  let sum = 0;
  for (const t of UNIT_ORDER) sum += Math.max(0, stack[t] ?? 0);
  return sum;
}

export function isPureAviation(stack: UnitStack): boolean {
  const air = (stack.bomber ?? 0) + (stack.fighter ?? 0);
  return air > 0 && air === getStackTotal(stack);
}

export function isPureNaval(stack: UnitStack): boolean {
  const nav = (stack.submarine ?? 0) + (stack.frigate ?? 0);
  return nav > 0 && nav === getStackTotal(stack);
}

export function hasLandUnits(stack: UnitStack): boolean {
  return (
    (stack.soldier ?? 0) > 0 ||
    (stack.scout ?? 0) > 0 ||
    (stack.light_tank ?? 0) > 0 ||
    (stack.heavy_tank ?? 0) > 0
  );
}

export function hasNavalEscort(stack: UnitStack): boolean {
  return (stack.submarine ?? 0) > 0 || (stack.frigate ?? 0) > 0;
}

export function isFrigateOnlyStack(stack: UnitStack): boolean {
  return (
    (stack.frigate ?? 0) > 0 &&
    !hasLandUnits(stack) &&
    (stack.submarine ?? 0) === 0
  );
}

export function getUnitVirtualZone(
  units: UnitStack,
  isNaval = false,
  isSubmarineMission = false,
  isAir = false
): VirtualZone {
  if (isAir || isPureAviation(units)) return 'AIR';
  if (isSubmarineMission || isNaval || isPureNaval(units) || hasNavalEscort(units)) return 'MER';
  return 'TERRE';
}

export function getTotalPathLength(path: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  }
  return total;
}

export function getPointAlongPath(
  path: [number, number][],
  traveledPx: number
): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1 || traveledPx <= 0) return [path[0][0], path[0][1]];

  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][0];
    const ay = path[i][1];
    const bx = path[i + 1][0];
    const by = path[i + 1][1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen <= 0.0001) continue;
    if (acc + segLen >= traveledPx) {
      const t = (traveledPx - acc) / segLen;
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    acc += segLen;
  }

  const last = path[path.length - 1];
  return [last[0], last[1]];
}

export function getRemainingPath(
  path: [number, number][],
  traveledPx: number
): [number, number][] {
  if (path.length <= 1) return path;
  if (traveledPx <= 0) return path;

  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][0];
    const ay = path[i][1];
    const bx = path[i + 1][0];
    const by = path[i + 1][1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen <= 0.0001) continue;
    if (acc + segLen >= traveledPx) {
      const t = (traveledPx - acc) / segLen;
      const cur: [number, number] = [ax + (bx - ax) * t, ay + (by - ay) * t];
      return [cur, ...path.slice(i + 1)];
    }
    acc += segLen;
  }

  return [path[path.length - 1]];
}

function snapToValidCell(
  grid: NavGrid,
  pos: [number, number],
  mask: Uint8Array,
  preferredProvIdx = -1,
  maxRadius = 10
): number {
  const startCell = posToCell(pos[0], pos[1]);
  if (mask[startCell] === 1 && (preferredProvIdx < 0 || grid.cellProvinceIdx[startCell] === preferredProvIdx)) {
    return startCell;
  }

  const scx = startCell % COLS;
  const scy = (startCell - scx) / COLS;

  let fallback = -1;
  let fallbackDist = Infinity;

  for (let r = 1; r <= maxRadius; r++) {
    let bestPreferred = -1;
    let bestPrefDist = Infinity;

    for (let dy = -r; dy <= r; dy++) {
      const ny = scy + dy;
      if (ny < 0 || ny >= ROWS) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = scx + dx;
        if (nx < 0 || nx >= COLS) continue;
        const idx = ny * COLS + nx;
        if (mask[idx] !== 1) continue;

        const [wx, wy] = cellCenter(idx);
        const d = Math.hypot(wx - pos[0], wy - pos[1]);
        if (preferredProvIdx >= 0 && grid.cellProvinceIdx[idx] === preferredProvIdx) {
          if (d < bestPrefDist) {
            bestPrefDist = d;
            bestPreferred = idx;
          }
        }
        if (d < fallbackDist) {
          fallbackDist = d;
          fallback = idx;
        }
      }
    }

    if (bestPreferred >= 0) return bestPreferred;
    if (preferredProvIdx < 0 && fallback >= 0) return fallback;
  }

  return fallback;
}

/** Retourne un point côtier réel (sur l'eau au bord de la plage) pour une province côtière */
export function getCoastalLandingPos(
  prov: Province,
  originPos?: [number, number],
  provinces?: Record<string, Province>
): [number, number] {
  if (provinces) {
    const grid = ensureNavGrid(provinces);
    const seaCells = grid.coastSeaCells.get(prov.id) ?? [];
    if (seaCells.length > 0) {
      let best = seaCells[0];
      let bestScore = Infinity;
      const ref = originPos ?? prov.center;
      for (const idx of seaCells) {
        const [wx, wy] = cellCenter(idx);
        const d = Math.hypot(wx - ref[0], wy - ref[1]);
        if (d < bestScore) {
          bestScore = d;
          best = idx;
        }
      }
      return cellCenter(best);
    }
  }

  const [cx, cy] = prov.center;
  if (originPos) {
    const dx = originPos[0] - cx;
    const dy = originPos[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [cx + (dx / len) * 28, cy + (dy / len) * 28];
  }
  return [cx - 24, cy + 12];
}

function findNearestBeachLandPos(
  grid: NavGrid,
  prov: Province,
  seaArrivalPos: [number, number]
): [number, number] {
  const landCells = grid.coastLandCells.get(prov.id) ?? [];
  if (landCells.length > 0) {
    let best = landCells[0];
    let bestDist = Infinity;
    for (const idx of landCells) {
      const [wx, wy] = cellCenter(idx);
      const d = Math.hypot(wx - seaArrivalPos[0], wy - seaArrivalPos[1]);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    }
    return cellCenter(best);
  }
  return [prov.center[0], prov.center[1]];
}

const DIRS_8: [number, number, number][] = [
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, 1, Math.SQRT2],
];

/** Lissage rectiligne (String Pulling) strictement sur la zone autorisée */
function smoothPolyline(
  pts: [number, number][],
  isSegmentAllowed: (a: [number, number], b: [number, number]) => boolean
): [number, number][] {
  if (pts.length <= 2) return pts;
  const out: [number, number][] = [pts[0]];
  let i = 0;

  while (i < pts.length - 1) {
    let farthest = i + 1;
    for (let j = pts.length - 1; j > i + 1; j--) {
      if (isSegmentAllowed(pts[i], pts[j])) {
        farthest = j;
        break;
      }
    }
    out.push(pts[farthest]);
    i = farthest;
  }

  return out;
}

/** A* strictement en zone TERRE (jamais en mer, évite les provinces ennemies si possible) */
function findLandPath(
  state: GameState,
  grid: NavGrid,
  owner: NationId,
  startPos: [number, number],
  targetProv: Province,
  fromProvId?: string
): [number, number][] | null {
  const fromIdx = fromProvId ? (grid.provinceIdxById.get(fromProvId) ?? -1) : -1;
  const targetIdx = grid.provinceIdxById.get(targetProv.id) ?? -1;

  const startCell = snapToValidCell(grid, startPos, grid.landMask, fromIdx, 8);
  const goalCell = snapToValidCell(grid, targetProv.center, grid.landMask, targetIdx, 8);
  if (startCell < 0 || goalCell < 0) return null;

  if (startCell === goalCell) {
    return [startPos, [targetProv.center[0], targetProv.center[1]]];
  }

  const [gx, gy] = [goalCell % COLS, Math.floor(goalCell / COLS)];

  // Pré-calcul des provinces autorisées à coût normal (1.0) vs pénalisées (18.0)
  const isFriendlyProvIdx = new Uint8Array(grid.provinceIds.length);
  for (let i = 0; i < grid.provinceIds.length; i++) {
    const id = grid.provinceIds[i];
    const p = state.provinces[id];
    if (!p || p.owner === owner || id === targetProv.id || id === fromProvId) {
      isFriendlyProvIdx[i] = 1;
    }
  }

  const gScore = new Float32Array(TOTAL_CELLS).fill(Infinity);
  const cameFrom = new Int32Array(TOTAL_CELLS).fill(-1);
  const closed = new Uint8Array(TOTAL_CELLS);
  const heap = new MinHeap();

  gScore[startCell] = 0;
  const sx = startCell % COLS;
  const sy = (startCell - sx) / COLS;
  heap.push(startCell, Math.hypot(gx - sx, gy - sy));

  let found = false;

  while (heap.size > 0) {
    const curr = heap.pop();
    if (closed[curr]) continue;
    closed[curr] = 1;

    if (curr === goalCell) {
      found = true;
      break;
    }

    const cx = curr % COLS;
    const cy = (curr - cx) / COLS;
    const baseG = gScore[curr];

    for (let d = 0; d < 8; d++) {
      const dx = DIRS_8[d][0];
      const dy = DIRS_8[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const nIdx = ny * COLS + nx;
      if (closed[nIdx] || grid.landMask[nIdx] !== 1) continue;

      // Évite de couper un coin de mer en diagonale
      if (dx !== 0 && dy !== 0) {
        if (grid.landMask[cy * COLS + nx] !== 1 || grid.landMask[ny * COLS + cx] !== 1) {
          continue;
        }
      }

      const pIdx = grid.cellProvinceIdx[nIdx];
      const terrainMult = pIdx >= 0 && isFriendlyProvIdx[pIdx] === 0 ? 18.0 : 1.0;
      const ng = baseG + DIRS_8[d][2] * terrainMult;

      if (ng < gScore[nIdx]) {
        gScore[nIdx] = ng;
        cameFrom[nIdx] = curr;
        const h = Math.hypot(gx - nx, gy - ny);
        heap.push(nIdx, ng + h);
      }
    }
  }

  if (!found) return null;

  // Reconstruit la chaîne de cellules et détecte si le chemin A* a réussi à éviter tout territoire ennemi
  const cellChain: number[] = [];
  let cursor = goalCell;
  let avoidedAllHostiles = true;
  while (cursor >= 0) {
    cellChain.push(cursor);
    const pIdx = grid.cellProvinceIdx[cursor];
    if (pIdx >= 0 && isFriendlyProvIdx[pIdx] === 0) {
      avoidedAllHostiles = false;
    }
    if (cursor === startCell) break;
    cursor = cameFrom[cursor];
  }
  cellChain.reverse();

  const rawPts: [number, number][] = [startPos];
  for (let i = 1; i < cellChain.length - 1; i++) {
    rawPts.push(cellCenter(cellChain[i]));
  }
  rawPts.push([targetProv.center[0], targetProv.center[1]]);

  // String Pulling rectiligne : ne traverse jamais la mer et respecte l'évitement ennemi
  return smoothPolyline(rawPts, (a, b) => {
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(4, Math.ceil(dist / 6));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t;
      const cIdx = posToCell(px, py);
      if (grid.landMask[cIdx] !== 1) return false;
      if (avoidedAllHostiles) {
        const pIdx = grid.cellProvinceIdx[cIdx];
        if (pIdx >= 0 && isFriendlyProvIdx[pIdx] === 0) return false;
      }
    }
    return true;
  });
}

/** A* multi-départ / multi-arrivée strictement en zone MER (~28 px des côtes en transit, jusqu'à la plage à l'arrivée) */
function findSeaPath(
  grid: NavGrid,
  fromProv: Province | null,
  targetProv: Province,
  customStartPos?: [number, number]
): { path: [number, number][]; coastBeachPos: [number, number] } | null {
  const goalCells = grid.coastSeaCells.get(targetProv.id) ?? [];
  if (goalCells.length === 0) return null;

  const isGoal = new Uint8Array(TOTAL_CELLS);
  let goalAvgX = 0;
  let goalAvgY = 0;
  for (const gc of goalCells) {
    isGoal[gc] = 1;
    goalAvgX += gc % COLS;
    goalAvgY += Math.floor(gc / COLS);
  }
  goalAvgX /= goalCells.length;
  goalAvgY /= goalCells.length;

  let startCells: number[] = [];
  if (customStartPos) {
    const snapped = snapToValidCell(grid, customStartPos, grid.seaMask, -1, 14);
    if (snapped >= 0) startCells = [snapped];
  } else if (fromProv) {
    startCells = grid.coastSeaCells.get(fromProv.id) ?? [];
  }
  if (startCells.length === 0) return null;

  const gScore = new Float32Array(TOTAL_CELLS).fill(Infinity);
  const cameFrom = new Int32Array(TOTAL_CELLS).fill(-1);
  const closed = new Uint8Array(TOTAL_CELLS);
  const heap = new MinHeap();

  for (const sc of startCells) {
    gScore[sc] = 0;
    const sx = sc % COLS;
    const sy = (sc - sx) / COLS;
    heap.push(sc, Math.hypot(goalAvgX - sx, goalAvgY - sy));
  }

  let reachedGoal = -1;

  while (heap.size > 0) {
    const curr = heap.pop();
    if (closed[curr]) continue;
    closed[curr] = 1;

    if (isGoal[curr] === 1) {
      reachedGoal = curr;
      break;
    }

    const cx = curr % COLS;
    const cy = (curr - cx) / COLS;
    const baseG = gScore[curr];

    for (let d = 0; d < 8; d++) {
      const dx = DIRS_8[d][0];
      const dy = DIRS_8[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const nIdx = ny * COLS + nx;
      if (closed[nIdx] || grid.seaMask[nIdx] !== 1) continue;

      if (dx !== 0 && dy !== 0) {
        if (grid.seaMask[cy * COLS + nx] !== 1 || grid.seaMask[ny * COLS + cx] !== 1) {
          continue;
        }
      }

      // Distance d'un soldat (~28 px = clearance >= 2) privilégiée en mer ; clearance === 1 autorisé pour détroits & plages
      const clr = grid.seaClearance[nIdx];
      const coastPenalty = isGoal[nIdx] === 1 ? 1.0 : clr >= 2 ? 1.0 : 3.4;
      const ng = baseG + DIRS_8[d][2] * coastPenalty;

      if (ng < gScore[nIdx]) {
        gScore[nIdx] = ng;
        cameFrom[nIdx] = curr;
        const h = Math.hypot(goalAvgX - nx, goalAvgY - ny);
        heap.push(nIdx, ng + h);
      }
    }
  }

  if (reachedGoal < 0) return null;

  const cellChain: number[] = [];
  let cursor = reachedGoal;
  while (cursor >= 0) {
    cellChain.push(cursor);
    cursor = cameFrom[cursor];
  }
  cellChain.reverse();

  const rawPts: [number, number][] = cellChain.map((c) => cellCenter(c));
  if (customStartPos && rawPts.length > 0) {
    rawPts[0] = [customStartPos[0], customStartPos[1]];
  }

  // Lissage en mer : garde la distance aux côtes (>= 2) sur le trajet principal, autorise l'approche (= 1) aux extrémités
  const smoothed = smoothPolyline(rawPts, (a, b) => {
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(4, Math.ceil(dist / 6));
    const aClr = grid.seaClearance[posToCell(a[0], a[1])];
    const bClr = grid.seaClearance[posToCell(b[0], b[1])];
    const minReqClr = aClr >= 2 && bClr >= 2 ? 2 : 1;

    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t;
      const cIdx = posToCell(px, py);
      if (grid.seaMask[cIdx] !== 1) return false;
      if (grid.seaClearance[cIdx] < minReqClr) return false;
    }
    return true;
  });

  const seaEnd = smoothed[smoothed.length - 1];
  const coastBeachPos = findNearestBeachLandPos(grid, targetProv, seaEnd);

  return { path: smoothed, coastBeachPos };
}

/** Marche terrestre depuis la plage de débarquement vers le centre de la province cible (zéro téléportation) */
export function computeLandWalkToCenter(
  state: GameState,
  owner: NationId,
  beachPos: [number, number],
  targetProv: Province
): [number, number][] {
  const grid = ensureNavGrid(state.provinces);
  const path = findLandPath(state, grid, owner, beachPos, targetProv, targetProv.id);
  if (path && path.length >= 2) return path;
  return [beachPos, [targetProv.center[0], targetProv.center[1]]];
}

/** Planificateur unifié des zones virtuelles TERRE, MER et AIR */
export function computeZoneRoutePlan(
  state: GameState,
  owner: NationId,
  fromId: string,
  targetId: string,
  units: UnitStack,
  customStartPos?: [number, number]
): ZoneRoutePlan | null {
  const from = state.provinces[fromId] ?? null;
  const target = state.provinces[targetId];
  if (!target) return null;
  if (!customStartPos && (!from || fromId === targetId)) return null;

  // 1. Aviation pure : vol direct en zone AIR
  if (isPureAviation(units)) {
    const startPt: [number, number] = customStartPos ?? [from!.center[0], from!.center[1]];
    return {
      route: [fromId, targetId],
      path: [startPt, [target.center[0], target.center[1]]],
      isAir: true,
      isNaval: false,
      isSubmarineMission: false,
      virtualZone: 'AIR',
    };
  }

  const grid = ensureNavGrid(state.provinces);
  const escortNaval = hasNavalEscort(units);
  const pureNaval = isPureNaval(units);

  // 2. Unités navales ou troupes accompagnées d'un sous-marin / d'une frégate : zone MER stricte
  if (pureNaval || escortNaval) {
    if (!isCoastalProvince(target)) return null;
    if (!customStartPos && from && !isCoastalProvince(from)) return null;

    const sea = findSeaPath(grid, from, target, customStartPos);
    if (!sea) return null;

    return {
      route: [fromId, targetId],
      path: sea.path,
      isAir: false,
      isNaval: true,
      isSubmarineMission: (units.submarine ?? 0) > 0,
      virtualZone: 'MER',
      coastBeachPos: sea.coastBeachPos,
    };
  }

  // 3. Unités terrestres seules : zone TERRE stricte (aucune traversée maritime autorisée)
  const startPt: [number, number] = customStartPos ?? [from!.center[0], from!.center[1]];
  const landPath = findLandPath(state, grid, owner, startPt, target, fromId);
  if (!landPath || landPath.length < 2) return null;

  return {
    route: [fromId, targetId],
    path: landPath,
    isAir: false,
    isNaval: false,
    isSubmarineMission: false,
    virtualZone: 'TERRE',
  };
}