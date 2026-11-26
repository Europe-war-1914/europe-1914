import { UNIT_ORDER } from '../data/balance';
import { isPointOnLand } from '../data/geo';
import type { GameState, Province, UnitStack } from './types';

export type VirtualZone = 'TERRE' | 'MER';

export interface ZoneRoutePlan {
  route: string[];
  isAir: boolean;
  isSubmarineMission: boolean;
  requiresSeaZone: boolean;
  landWithoutEscort: boolean;
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

/** Détermine la zone virtuelle courante d'une position ou d'une unité */
export function getPositionVirtualZone(x: number, y: number): VirtualZone {
  return isPointOnLand(x, y) ? 'TERRE' : 'MER';
}

export function getUnitVirtualZone(
  units: UnitStack,
  isNaval = false,
  isSubmarineMission = false,
  worldPos?: [number, number]
): VirtualZone {
  if (isSubmarineMission || isNaval || isPureNaval(units)) {
    return 'MER';
  }
  if (worldPos && !isPointOnLand(worldPos[0], worldPos[1])) {
    return 'MER';
  }
  return 'TERRE';
}

/** Point situé sur la côte de la province cible (interface entre zone MER et zone TERRE) */
export function getCoastalLandingPos(
  prov: Province,
  originPos?: [number, number]
): [number, number] {
  const [cx, cy] = prov.center;

  if (prov.polygon && prov.polygon.length >= 3) {
    let bestPt: [number, number] | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < prov.polygon.length; i++) {
      const a = prov.polygon[i];
      const b = prov.polygon[(i + 1) % prov.polygon.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;

      const distFromCenter = Math.hypot(mx - cx, my - cy);
      let score = distFromCenter;
      if (originPos) {
        const distFromOrigin = Math.hypot(mx - originPos[0], my - originPos[1]);
        score = distFromCenter * 0.7 - distFromOrigin * 0.35;
      }

      if (score > bestScore) {
        bestScore = score;
        bestPt = [mx, my];
      }
    }

    if (bestPt) {
      return [cx + (bestPt[0] - cx) * 0.9, cy + (bestPt[1] - cy) * 0.9];
    }
  }

  if (originPos) {
    const dx = originPos[0] - cx;
    const dy = originPos[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [cx + (dx / len) * 36, cy + (dy / len) * 36];
  }

  return [cx - 32, cy + 16];
}

function distBetween(a: Province, b: Province): number {
  return Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
}

/** Calcule l'itinéraire selon les règles de la zone TERRE et de la zone MER */
export function computeZoneRoutePlan(
  state: GameState,
  owner: string,
  fromId: string,
  targetId: string,
  units: UnitStack
): ZoneRoutePlan | null {
  const from = state.provinces[fromId];
  const target = state.provinces[targetId];
  if (!from || !target || fromId === targetId) return null;

  if (isPureAviation(units)) {
    return {
      route: [fromId, targetId],
      isAir: true,
      isSubmarineMission: false,
      requiresSeaZone: false,
      landWithoutEscort: false,
    };
  }

  const navalOnly = isPureNaval(units);
  const escortNaval = hasNavalEscort(units);
  const landWithoutEscort = hasLandUnits(units) && !escortNaval;
  const requiresSeaZone = navalOnly || escortNaval;

  const allCoastalIds = Object.values(state.provinces)
    .filter((p) => isCoastalProvince(p))
    .map((p) => p.id);

  const runDijkstra = (avoidEnemyIntermediate: boolean): string[] | null => {
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    const queue: string[] = [fromId];
    dist.set(fromId, 0);

    while (queue.length > 0) {
      queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      if (currentId === targetId) break;

      const curr = state.provinces[currentId];
      if (!curr) continue;

      const candidates: { id: string; weight: number }[] = [];

      // Zone TERRE : interdite aux navires seuls et aux troupes escortées qui naviguent en MER
      if (!requiresSeaZone) {
        for (const nId of curr.neighbors) {
          const nb = state.provinces[nId];
          if (!nb) continue;
          if (nId !== targetId && avoidEnemyIntermediate && nb.owner !== owner) continue;
          const enemyPenalty = nb.owner !== owner && nId !== targetId ? 140 : 0;
          candidates.push({ id: nId, weight: distBetween(curr, nb) + enemyPenalty });
        }
      }

      // Zone MER : interdite aux unités terrestres sans escorte navale
      if (!landWithoutEscort && isCoastalProvince(curr)) {
        const seaSet = new Set(curr.seaNeighbors);
        for (const nId of curr.seaNeighbors) {
          const nb = state.provinces[nId];
          if (!nb || !isCoastalProvince(nb)) continue;
          if (nId !== targetId && avoidEnemyIntermediate && nb.owner !== owner) continue;
          const enemyPenalty = nb.owner !== owner && nId !== targetId ? 140 : 0;
          candidates.push({ id: nId, weight: distBetween(curr, nb) * 1.05 + enemyPenalty });
        }
        for (const coastId of allCoastalIds) {
          if (coastId === currentId || seaSet.has(coastId)) continue;
          const nb = state.provinces[coastId];
          if (!nb) continue;
          if (coastId !== targetId && avoidEnemyIntermediate && nb.owner !== owner) continue;
          const d = distBetween(curr, nb);
          if (d <= 440) {
            const enemyPenalty = nb.owner !== owner && coastId !== targetId ? 140 : 0;
            candidates.push({ id: coastId, weight: d * 1.15 + enemyPenalty });
          }
        }
      }

      const baseDist = dist.get(currentId) ?? 0;
      for (const c of candidates) {
        const nd = baseDist + c.weight;
        if (nd < (dist.get(c.id) ?? Infinity)) {
          dist.set(c.id, nd);
          prev.set(c.id, currentId);
          queue.push(c.id);
        }
      }
    }

    if (!dist.has(targetId)) return null;

    const route: string[] = [];
    let step: string | undefined = targetId;
    while (step) {
      route.unshift(step);
      step = prev.get(step);
    }
    return route;
  };

  const route = runDijkstra(true) ?? runDijkstra(false);
  if (!route || route.length < 2) return null;

  const isSubmarineMission =
    (units.submarine ?? 0) > 0 &&
    isCoastalProvince(from) &&
    isCoastalProvince(target) &&
    !from.neighbors.includes(route[1]);

  return {
    route,
    isAir: false,
    isSubmarineMission,
    requiresSeaZone,
    landWithoutEscort,
  };
}