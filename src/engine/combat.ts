import {
  createEmptyStack,
  DEFENSE_COUNTER_REDUCTION,
  GAME_CONFIG,
  TERRAIN_MODIFIERS,
  UNIT_ORDER,
  UNIT_SPECS,
} from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import { clearNationAlliances, getDiplomaticStatus, setDiplomaticStatus } from './diplomacy';
import { createId, pushTelegram } from './economy';
import {
  computeLandWalkToCenter,
  computeZoneRoutePlan,
  getCoastalLandingPos,
  getPointAlongPath,
  getStackTotal,
  getTotalPathLength,
  getUnitVirtualZone,
  hasLandUnits,
  hasNavalEscort,
  isCoastalProvince,
  isFrigateOnlyStack,
  isPureAviation,
  type ZoneRoutePlan,
} from './zones';
import type {
  ActiveBattle,
  DefenseType,
  ExtractionResource,
  GameState,
  MovingArmy,
  NationId,
  PlayableNationId,
  Province,
  UnitStack,
  UnitType,
} from './types';

export { getCoastalLandingPos, isCoastalProvince };

const FRIGATE_BOMBARD_SECONDS = 9;

export function totalStack(stack: UnitStack): number {
  return getStackTotal(stack);
}

export function addStacks(target: UnitStack, addition: UnitStack): void {
  for (const t of UNIT_ORDER) {
    target[t] = Math.max(0, (target[t] ?? 0) + (addition[t] ?? 0));
  }
}

export function cloneStack(stack: UnitStack): UnitStack {
  return {
    light_tank: Math.max(0, stack.light_tank ?? 0),
    heavy_tank: Math.max(0, stack.heavy_tank ?? 0),
    scout: Math.max(0, stack.scout ?? 0),
    soldier: Math.max(0, stack.soldier ?? 0),
    bomber: Math.max(0, stack.bomber ?? 0),
    fighter: Math.max(0, stack.fighter ?? 0),
    submarine: Math.max(0, stack.submarine ?? 0),
    frigate: Math.max(0, stack.frigate ?? 0),
  };
}

/** Vitesse réelle en pixels / seconde selon le type d'unités et la zone virtuelle */
export function computeSpeedPxPerSec(
  units: UnitStack,
  isNaval: boolean,
  isAir: boolean
): number {
  let slowest = 0;

  if (isNaval && hasNavalEscort(units)) {
    // En mer, un convoi escorté avance à la vitesse du navire transporteur/escorteur
    if ((units.frigate ?? 0) > 0) slowest = Math.max(slowest, UNIT_SPECS.frigate.travelSeconds);
    if ((units.submarine ?? 0) > 0) slowest = Math.max(slowest, UNIT_SPECS.submarine.travelSeconds);
  } else {
    for (const type of UNIT_ORDER) {
      if ((units[type] ?? 0) <= 0) continue;
      if (UNIT_SPECS[type].travelSeconds > slowest) {
        slowest = UNIT_SPECS[type].travelSeconds;
      }
    }
  }

  if (slowest <= 0) slowest = UNIT_SPECS.soldier.travelSeconds;
  const modeMult = isAir ? 0.45 : isNaval ? 0.72 : 1.0;
  return 145 / (slowest * modeMult);
}

export function getLegDurationSeconds(
  from: Province,
  to: Province,
  units: UnitStack,
  isNaval: boolean,
  isAir: boolean
): number {
  const dist = Math.hypot(to.center[0] - from.center[0], to.center[1] - from.center[1]);
  const speed = computeSpeedPxPerSec(units, isNaval, isAir);
  return Math.max(4, Math.round(dist / speed));
}

export function findArmyRoute(
  state: GameState,
  owner: NationId,
  fromId: string,
  targetId: string,
  units: UnitStack
): ZoneRoutePlan | null {
  return computeZoneRoutePlan(state, owner, fromId, targetId, units);
}

export function findRedirectPreview(
  state: GameState,
  army: MovingArmy,
  newTargetId: string
): ZoneRoutePlan | null {
  const curPos = getMovingArmyWorldPos(state, army);
  return computeZoneRoutePlan(
    state,
    army.owner,
    army.fromProvinceId,
    newTargetId,
    army.units,
    curPos
  );
}

function getArmyPath(state: GameState, army: MovingArmy): [number, number][] {
  if (army.path && army.path.length >= 2) return army.path;
  const from = state.provinces[army.fromProvinceId];
  const to = state.provinces[army.toProvinceId];
  const start: [number, number] = army.startPos
    ? [army.startPos[0], army.startPos[1]]
    : from
    ? [from.center[0], from.center[1]]
    : [0, 0];
  const end: [number, number] = to ? [to.center[0], to.center[1]] : start;
  return [start, end];
}

export function getMovingArmyWorldPos(state: GameState, army: MovingArmy): [number, number] {
  if (army.clashPos) {
    return [army.clashPos[0], army.clashPos[1]];
  }

  const path = getArmyPath(state, army);

  if (army.landingStartedAt !== undefined && army.landingEndsAt !== undefined) {
    const end = path[path.length - 1];
    return [end[0], end[1]];
  }

  if (army.traveledPx !== undefined) {
    return getPointAlongPath(path, army.traveledPx);
  }

  const dur = Math.max(1, army.legArrivalAt - army.legStartedAt);
  const t = Math.min(1, Math.max(0, (state.elapsedSeconds - army.legStartedAt) / dur));
  return getPointAlongPath(path, getTotalPathLength(path) * t);
}

function isArmyLockedInFieldBattle(state: GameState, armyId: string): boolean {
  return state.battles.some(
    (b) =>
      b.isFieldClash &&
      (b.attackerArmyId === armyId || b.defenderArmyId === armyId)
  );
}

export function orderMoveArmy(
  state: GameState,
  owner: NationId,
  fromId: string,
  targetId: string,
  requestedUnits: UnitStack
): { ok: boolean; reason?: string } {
  if (state.nations[owner]?.isEliminated) {
    return { ok: false, reason: 'Votre nation a été éliminée.' };
  }

  const from = state.provinces[fromId];
  const target = state.provinces[targetId];
  if (!from || !target || from.owner !== owner) {
    return { ok: false, reason: 'Province de départ invalide.' };
  }
  if (fromId === targetId) {
    return { ok: false, reason: 'Destination identique au départ.' };
  }

  if (target.owner !== owner && getDiplomaticStatus(state, owner, target.owner) === 'alliance') {
    return {
      ok: false,
      reason: 'Cette province appartient à votre allié (aucun don d’armée autorisé).',
    };
  }

  const send = createEmptyStack();
  for (const type of UNIT_ORDER) {
    send[type] = Math.min(from.garrison[type], Math.max(0, Math.floor(requestedUnits[type] ?? 0)));
  }

  if (totalStack(send) <= 0) {
    return { ok: false, reason: 'Aucune troupe sélectionnée.' };
  }

  if (
    ((send.frigate ?? 0) > 0 || (send.submarine ?? 0) > 0) &&
    (!isCoastalProvince(from) || !isCoastalProvince(target))
  ) {
    send.frigate = 0;
    send.submarine = 0;
    if (totalStack(send) <= 0) {
      return {
        ok: false,
        reason: 'Les unités navales (Frégates & Sous-marins) nécessitent un départ et une arrivée côtiers.',
      };
    }
  }

  const plan = computeZoneRoutePlan(state, owner, fromId, targetId, send);
  if (!plan || plan.path.length < 2) {
    return {
      ok: false,
      reason:
        hasLandUnits(send) && !hasNavalEscort(send)
          ? 'Trajet terrestre impossible (mer infranchissable) : ajoutez un Sous-marin (furtif) ou une Frégate (brise-défense).'
          : 'Aucune trajectoire maritime ou terrestre disponible vers cette destination.',
    };
  }

  for (const type of UNIT_ORDER) {
    from.garrison[type] -= send[type];
  }

  const totalPx = getTotalPathLength(plan.path);
  const speed = computeSpeedPxPerSec(send, plan.isNaval, plan.isAir);
  const duration = Math.max(2, Math.round(totalPx / speed));

  state.movingArmies.push({
    id: createId('mov'),
    owner,
    originProvinceId: fromId,
    fromProvinceId: fromId,
    toProvinceId: targetId,
    targetProvinceId: targetId,
    route: [fromId, targetId],
    currentLegIndex: 0,
    units: send,
    startedAt: state.elapsedSeconds,
    legStartedAt: state.elapsedSeconds,
    legArrivalAt: state.elapsedSeconds + duration,
    path: plan.path,
    traveledPx: 0,
    speedPxPerSec: speed,
    virtualZone: plan.virtualZone,
    coastBeachPos: plan.coastBeachPos,
    startPos: [plan.path[0][0], plan.path[0][1]],
    isNaval: plan.isNaval,
    isAir: plan.isAir,
    isSubmarineMission: plan.isSubmarineMission,
    isLandingPhase: false,
    isOccupationPhase: false,
    isBombardingPhase: false,
    landingCompleted: false,
    detectedBy: [],
    isReturning: false,
  });

  if (owner === state.playerNationId && state.tutorialStep > 0) {
    state.tutorialStep = 0;
  }

  return { ok: true };
}

function sendArmyBackToBase(
  state: GameState,
  army: MovingArmy,
  startPos: [number, number],
  fromProvinceId: string,
  reasonMessage?: string
): boolean {
  const destId =
    state.provinces[army.originProvinceId]?.owner === army.owner &&
    (!army.isNaval || isCoastalProvince(state.provinces[army.originProvinceId]))
      ? army.originProvinceId
      : Object.values(state.provinces).find(
          (p) => p.owner === army.owner && (!army.isNaval || isCoastalProvince(p))
        )?.id ?? Object.values(state.provinces).find((p) => p.owner === army.owner)?.id;

  if (!destId) return false;

  const plan = computeZoneRoutePlan(state, army.owner, fromProvinceId, destId, army.units, startPos);
  const destProv = state.provinces[destId];
  const fallbackPath: [number, number][] = [startPos, [destProv.center[0], destProv.center[1]]];
  const finalPath = plan?.path && plan.path.length >= 2 ? plan.path : fallbackPath;
  const totalPx = getTotalPathLength(finalPath);
  const isNaval = plan ? plan.isNaval : army.isNaval;
  const isAir = plan ? plan.isAir : army.isAir;
  const speed = computeSpeedPxPerSec(army.units, isNaval, isAir);
  const duration = Math.max(2, Math.round(totalPx / speed));

  army.clashPos = undefined;
  army.inFieldBattleId = undefined;
  army.fromProvinceId = fromProvinceId;
  army.toProvinceId = destId;
  army.targetProvinceId = destId;
  army.route = [fromProvinceId, destId];
  army.currentLegIndex = 0;
  army.path = finalPath;
  army.traveledPx = 0;
  army.speedPxPerSec = speed;
  army.startPos = [finalPath[0][0], finalPath[0][1]];
  army.virtualZone = plan?.virtualZone ?? (isAir ? 'AIR' : isNaval ? 'MER' : 'TERRE');
  army.coastBeachPos = plan?.coastBeachPos;
  army.isNaval = isNaval;
  army.isAir = isAir;
  army.isSubmarineMission = false;
  army.isLandingPhase = false;
  army.isOccupationPhase = false;
  army.isBombardingPhase = false;
  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;
  army.landingCompleted = false;
  army.isReturning = true;
  army.legStartedAt = state.elapsedSeconds;
  army.legArrivalAt = state.elapsedSeconds + duration;

  if (reasonMessage && army.owner === state.playerNationId) {
    pushTelegram(state, reasonMessage, 'info', destId);
  }

  return true;
}

export function orderTurnAround(
  state: GameState,
  owner: NationId,
  armyId: string
): { ok: boolean; reason?: string } {
  const army = state.movingArmies.find((a) => a.id === armyId);
  if (!army || army.owner !== owner) {
    return { ok: false, reason: 'Armée en mouvement introuvable.' };
  }

  const curPos = getMovingArmyWorldPos(state, army);

  // Libère une éventuelle bataille de croisement avant de faire demi-tour
  state.battles = state.battles.filter((b) => {
    if (b.isFieldClash && (b.attackerArmyId === armyId || b.defenderArmyId === armyId)) {
      const otherId = b.attackerArmyId === armyId ? b.defenderArmyId : b.attackerArmyId;
      const other = state.movingArmies.find((m) => m.id === otherId);
      if (other) {
        other.clashPos = undefined;
        other.inFieldBattleId = undefined;
      }
      return false;
    }
    return true;
  });

  const ok = sendArmyBackToBase(
    state,
    army,
    curPos,
    army.toProvinceId,
    `Demi-tour ordonné : votre colonne revient vers sa base.`
  );

  return ok ? { ok: true } : { ok: false, reason: 'Aucune province de repli disponible.' };
}

export function orderRedirectArmy(
  state: GameState,
  owner: NationId,
  armyId: string,
  newTargetId: string
): { ok: boolean; reason?: string } {
  const army = state.movingArmies.find((a) => a.id === armyId);
  if (!army || army.owner !== owner) {
    return { ok: false, reason: 'Armée en mouvement introuvable.' };
  }

  const target = state.provinces[newTargetId];
  if (!target) {
    return { ok: false, reason: 'Destination invalide.' };
  }

  if (target.owner !== owner && getDiplomaticStatus(state, owner, target.owner) === 'alliance') {
    return {
      ok: false,
      reason: 'Cette province appartient à votre allié (aucun don d’armée autorisé).',
    };
  }

  const curPos = getMovingArmyWorldPos(state, army);

  const plan = computeZoneRoutePlan(state, owner, army.fromProvinceId, newTargetId, army.units, curPos);
  if (!plan || plan.path.length < 2) {
    return {
      ok: false,
      reason:
        hasLandUnits(army.units) && !hasNavalEscort(army.units)
          ? 'Redirection terrestre impossible (mer infranchissable).'
          : 'Aucune trajectoire disponible vers cette nouvelle destination.',
    };
  }

  // Libère une éventuelle bataille de croisement
  state.battles = state.battles.filter((b) => {
    if (b.isFieldClash && (b.attackerArmyId === armyId || b.defenderArmyId === armyId)) {
      const otherId = b.attackerArmyId === armyId ? b.defenderArmyId : b.attackerArmyId;
      const other = state.movingArmies.find((m) => m.id === otherId);
      if (other) {
        other.clashPos = undefined;
        other.inFieldBattleId = undefined;
      }
      return false;
    }
    return true;
  });

  const totalPx = getTotalPathLength(plan.path);
  const speed = computeSpeedPxPerSec(army.units, plan.isNaval, plan.isAir);
  const duration = Math.max(2, Math.round(totalPx / speed));

  army.clashPos = undefined;
  army.inFieldBattleId = undefined;
  army.toProvinceId = newTargetId;
  army.targetProvinceId = newTargetId;
  army.route = [army.fromProvinceId, newTargetId];
  army.currentLegIndex = 0;
  army.path = plan.path;
  army.traveledPx = 0;
  army.speedPxPerSec = speed;
  army.startPos = [plan.path[0][0], plan.path[0][1]];
  army.virtualZone = plan.virtualZone;
  army.coastBeachPos = plan.coastBeachPos;
  army.isNaval = plan.isNaval;
  army.isAir = plan.isAir;
  army.isSubmarineMission = plan.isSubmarineMission;
  army.isLandingPhase = false;
  army.isOccupationPhase = false;
  army.isBombardingPhase = false;
  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;
  army.landingCompleted = false;
  army.isReturning = target.owner === owner;
  army.legStartedAt = state.elapsedSeconds;
  army.legArrivalAt = state.elapsedSeconds + duration;

  if (owner === state.playerNationId) {
    pushTelegram(state, `Colonne redirigée vers ${target.name}.`, 'info', newTargetId);
  }

  return { ok: true };
}

export function retreatFromBattle(
  state: GameState,
  battleId: string,
  nationId: NationId
): { ok: boolean; reason?: string } {
  const idx = state.battles.findIndex((b) => b.id === battleId);
  if (idx === -1) return { ok: false, reason: 'Combat introuvable.' };

  const battle = state.battles[idx];
  if (battle.attacker !== nationId) {
    return { ok: false, reason: 'Seul l’attaquant peut rompre cet engagement.' };
  }

  if (battle.isFieldClash) {
    const army = state.movingArmies.find((a) => a.id === battle.attackerArmyId);
    if (army) {
      return orderTurnAround(state, nationId, army.id);
    }
    state.battles.splice(idx, 1);
    return { ok: true };
  }

  const prov = state.provinces[battle.provinceId];
  const fallback =
    [...prov.neighbors, ...prov.seaNeighbors]
      .map((id) => state.provinces[id])
      .find((p) => p && p.owner === nationId) ??
    Object.values(state.provinces).find((p) => p.owner === nationId);

  if (!fallback) {
    return { ok: false, reason: 'Aucune province de repli disponible.' };
  }

  const survivors = cloneStack(battle.attackerUnits);
  const plan = computeZoneRoutePlan(state, nationId, prov.id, fallback.id, survivors, prov.center);
  const path = plan?.path ?? [prov.center, fallback.center];
  const isAir = plan?.isAir ?? isPureAviation(survivors);
  const isNaval = plan?.isNaval ?? false;
  const speed = computeSpeedPxPerSec(survivors, isNaval, isAir) * 1.25;
  const duration = Math.max(3, Math.round(getTotalPathLength(path) / speed));

  state.movingArmies.push({
    id: createId('ret'),
    owner: nationId,
    originProvinceId: fallback.id,
    fromProvinceId: prov.id,
    toProvinceId: fallback.id,
    targetProvinceId: fallback.id,
    route: [prov.id, fallback.id],
    currentLegIndex: 0,
    units: survivors,
    startedAt: state.elapsedSeconds,
    legStartedAt: state.elapsedSeconds,
    legArrivalAt: state.elapsedSeconds + duration,
    path,
    traveledPx: 0,
    speedPxPerSec: speed,
    virtualZone: plan?.virtualZone ?? (isAir ? 'AIR' : isNaval ? 'MER' : 'TERRE'),
    startPos: [path[0][0], path[0][1]],
    isNaval,
    isAir,
    isSubmarineMission: false,
    isReturning: true,
  });

  state.battles.splice(idx, 1);

  if (nationId === state.playerNationId) {
    pushTelegram(
      state,
      `Retraite ordonnée depuis ${prov.name} vers ${fallback.name}.`,
      'warning',
      fallback.id
    );
  }

  return { ok: true };
}

export function getEffectiveDefenseLevel(
  province: Province,
  defense: DefenseType,
  now: number
): number {
  const base = province.defenses[defense] ?? 0;
  if (base <= 0) return 0;
  const weakened = province.activeWeaknesses.some(
    (w) => w.defense === defense && w.expiresAt > now
  );
  return weakened ? Math.max(0, base - 2) : base;
}

function applyDefenseWeakness(province: Province, defense: DefenseType, now: number): boolean {
  if ((province.defenses[defense] ?? 0) <= 0) return false;
  const expiresAt = now + GAME_CONFIG.defenseWeaknessDurationSeconds;
  const existing = province.activeWeaknesses.find((w) => w.defense === defense);
  if (existing) {
    existing.expiresAt = expiresAt;
  } else {
    province.activeWeaknesses.push({ defense, expiresAt });
  }
  return true;
}

function computeStackPower(
  state: GameState,
  owner: NationId,
  stack: UnitStack,
  enemyStack: UnitStack,
  province: Province,
  isDefender: boolean,
  isNavalLanding = false
): number {
  const nation = state.nations[owner];
  const terrain = TERRAIN_MODIFIERS[province.terrain];
  const enemyAirCount = (enemyStack.bomber ?? 0) + (enemyStack.fighter ?? 0);
  const navalDefLvl = getEffectiveDefenseLevel(province, 'naval_defense', state.elapsedSeconds);
  let power = 0;

  for (const type of UNIT_ORDER) {
    const qty = stack[type] ?? 0;
    if (qty <= 0) continue;

    const spec = UNIT_SPECS[type];
    let unitPower = isDefender ? spec.defense : spec.attack;

    const techLvl = nation ? nation.techLevels[spec.armyTechAxis] ?? 0 : 0;
    unitPower *= 1 + techLvl * 0.2;

    if (!isDefender && spec.category === 'armor') {
      unitPower *= terrain.tankAttackMult;
    }

    if (type === 'fighter' && enemyAirCount > 0) {
      unitPower *= 2.1;
    }

    if (!isDefender) {
      const defLvl = getEffectiveDefenseLevel(province, spec.counteredBy, state.elapsedSeconds);
      const reduction = DEFENSE_COUNTER_REDUCTION[defLvl] ?? 0;
      unitPower *= 1 - reduction;

      if (
        isNavalLanding &&
        spec.category !== 'naval' &&
        spec.category !== 'aviation' &&
        navalDefLvl > 0
      ) {
        const landingPenalty = Math.min(0.75, navalDefLvl * 0.3);
        unitPower *= 1 - landingPenalty;
      }
    }

    power += qty * unitPower;
  }

  if (isDefender) {
    power *= terrain.defenseBonus;
  }

  return power;
}

function computeFieldClashPower(
  state: GameState,
  owner: NationId,
  stack: UnitStack,
  enemyStack: UnitStack
): number {
  const nation = state.nations[owner];
  const enemyAirCount = (enemyStack.bomber ?? 0) + (enemyStack.fighter ?? 0);
  let power = 0;

  for (const type of UNIT_ORDER) {
    const qty = stack[type] ?? 0;
    if (qty <= 0) continue;

    const spec = UNIT_SPECS[type];
    let unitPower = (spec.attack + spec.defense) * 0.55;
    const techLvl = nation ? nation.techLevels[spec.armyTechAxis] ?? 0 : 0;
    unitPower *= 1 + techLvl * 0.2;

    if (type === 'fighter' && enemyAirCount > 0) {
      unitPower *= 2.0;
    }

    power += qty * unitPower;
  }

  return power;
}

/** Applique les dégâts avec accumulateur résiduel : aucun dégât perdu, aucun combat bloqué */
function applyDamageWithResidual(
  stack: UnitStack,
  rawDamage: number,
  residualIn = 0
): number {
  let pool = Math.max(0, rawDamage) + Math.max(0, residualIn);
  if (pool <= 0 || totalStack(stack) <= 0) return 0;

  for (const type of UNIT_ORDER) {
    const qty = stack[type] ?? 0;
    if (qty <= 0) continue;
    const unitHp = UNIT_SPECS[type].hp;
    if (pool < unitHp) break;
    const kills = Math.min(qty, Math.floor(pool / unitHp));
    if (kills > 0) {
      stack[type] = qty - kills;
      pool -= kills * unitHp;
    }
  }

  return totalStack(stack) > 0 ? pool : 0;
}

function applyDamageToTargetedUnits(
  stack: UnitStack,
  damage: number,
  targetTypes: UnitType[]
): void {
  if (damage <= 0) return;
  let remaining = damage;
  for (const type of targetTypes) {
    if (remaining <= 0) break;
    const qty = stack[type] ?? 0;
    if (qty <= 0) continue;
    const unitHp = UNIT_SPECS[type].hp;
    const kills = Math.min(qty, Math.floor(remaining / unitHp));
    if (kills > 0) {
      stack[type] = qty - kills;
      remaining -= kills * unitHp;
    } else if (remaining >= unitHp * 0.45 && Math.random() < remaining / unitHp) {
      stack[type] = qty - 1;
      remaining = 0;
    }
  }
}

function applyDefenseRetaliationDamage(
  state: GameState,
  prov: Province,
  enemyStack: UnitStack,
  isNavalContext = false
): void {
  if (totalStack(enemyStack) <= 0) return;
  const now = state.elapsedSeconds;

  const trenchesLvl = getEffectiveDefenseLevel(prov, 'trenches', now);
  if (trenchesLvl > 0) {
    applyDamageToTargetedUnits(enemyStack, trenchesLvl * 14, ['light_tank', 'heavy_tank']);
  }

  const bunkersLvl = getEffectiveDefenseLevel(prov, 'bunkers', now);
  if (bunkersLvl > 0) {
    applyDamageToTargetedUnits(enemyStack, bunkersLvl * 13, ['scout', 'soldier']);
  }

  const aaLvl = getEffectiveDefenseLevel(prov, 'aa_defense', now);
  if (aaLvl > 0) {
    applyDamageToTargetedUnits(enemyStack, aaLvl * 18, ['bomber', 'fighter']);
  }

  const navalLvl = getEffectiveDefenseLevel(prov, 'naval_defense', now);
  if (
    navalLvl > 0 &&
    (isNavalContext || (enemyStack.frigate ?? 0) > 0 || (enemyStack.submarine ?? 0) > 0)
  ) {
    applyDamageToTargetedUnits(enemyStack, navalLvl * 20, ['frigate', 'submarine']);
  }
}

export function eliminateNation(
  state: GameState,
  loserId: PlayableNationId,
  conquerorId?: NationId
): void {
  const loser = state.nations[loserId];
  if (!loser || loser.isEliminated) return;

  loser.isEliminated = true;
  clearNationAlliances(state, loserId);

  if (!state.eliminationOrder.includes(loserId)) {
    state.eliminationOrder.push(loserId);
  }

  // Libère les armées survivantes engagées en combat de croisement contre la nation éliminée
  for (const b of state.battles) {
    if (b.isFieldClash && (b.attacker === loserId || b.defender === loserId)) {
      const survivingId = b.attacker === loserId ? b.defenderArmyId : b.attackerArmyId;
      const survivor = state.movingArmies.find((a) => a.id === survivingId);
      if (survivor) {
        survivor.clashPos = undefined;
        survivor.inFieldBattleId = undefined;
      }
    }
  }

  state.movingArmies = state.movingArmies.filter((a) => a.owner !== loserId);
  state.constructions = state.constructions.filter((c) => c.owner !== loserId);
  state.recruitments = state.recruitments.filter((r) => r.owner !== loserId);
  state.battles = state.battles.filter((b) => b.attacker !== loserId && b.defender !== loserId);
  state.pendingOffers = state.pendingOffers.filter((o) => o.from !== loserId && o.to !== loserId);

  let gainedTp = 0;
  if (conquerorId && conquerorId !== 'neutral' && state.nations[conquerorId]) {
    gainedTp =
      GAME_CONFIG.capitalCaptureTechBonus +
      Math.round(loser.techPoints * GAME_CONFIG.capitalCaptureTechStealRatio);
    state.nations[conquerorId].techPoints += gainedTp;
  }
  loser.techPoints = 0;

  const newOwner: NationId = conquerorId && conquerorId !== 'neutral' ? conquerorId : 'neutral';
  for (const prov of Object.values(state.provinces)) {
    if (prov.owner !== loserId) continue;

    prov.owner = newOwner;
    prov.isCapital = false;
    prov.hasLaboratory = false;
    prov.laboratoryLevel = 0;
    prov.garrison = createEmptyStack();

    (['gas', 'steel', 'gold'] as ExtractionResource[]).forEach((res) => {
      if (prov.extractionFactories[res] > 1) {
        prov.extractionFactories[res] = 1;
      }
    });
  }

  const byText =
    conquerorId && conquerorId !== 'neutral'
      ? ` par ${NATION_TEMPLATES[conquerorId].shortName} (+${gainedTp} PT et annexion totale)`
      : '';

  pushTelegram(
    state,
    `CAPITALE TOMBÉE ! ${NATION_TEMPLATES[loserId].name} est éliminée${byText} !`,
    'danger'
  );
}

function captureProvince(
  state: GameState,
  prov: Province,
  conqueror: NationId,
  survivors: UnitStack
): void {
  const previousOwner = prov.owner;
  const wasCapital = prov.isCapital;

  prov.owner = conqueror;
  prov.isCapital = false;
  if (wasCapital) {
    prov.hasLaboratory = false;
    prov.laboratoryLevel = 0;
    (['gas', 'steel', 'gold'] as ExtractionResource[]).forEach((res) => {
      if (prov.extractionFactories[res] > 1) {
        prov.extractionFactories[res] = 1;
      }
    });
  }
  prov.garrison = cloneStack(survivors);

  state.constructions = state.constructions.filter((c) => c.provinceId !== prov.id);
  state.recruitments = state.recruitments.filter((r) => r.provinceId !== prov.id);

  if (conqueror === state.playerNationId) {
    pushTelegram(state, `Victoire ! ${prov.name} passe sous votre contrôle.`, 'info', prov.id);
  } else if (previousOwner === state.playerNationId) {
    pushTelegram(
      state,
      `Alerte : ${prov.name} est tombée aux mains de ${NATION_TEMPLATES[conqueror].shortName} !`,
      'danger',
      prov.id
    );
  }

  if (wasCapital && previousOwner !== 'neutral') {
    eliminateNation(state, previousOwner, conqueror);
  }
}

/** Détecte les croisements entre deux armées ennemies dans la même zone (TERRE, MER ou AIR) */
function checkFieldArmyEncounters(state: GameState): void {
  for (let i = 0; i < state.movingArmies.length; i++) {
    const a = state.movingArmies[i];
    if (!a || totalStack(a.units) <= 0) continue;
    if (isArmyLockedInFieldBattle(state, a.id)) continue;
    if (a.isLandingPhase || a.isOccupationPhase || a.isBombardingPhase) continue;

    const posA = getMovingArmyWorldPos(state, a);
    const zoneA = a.virtualZone ?? getUnitVirtualZone(a.units, a.isNaval, a.isSubmarineMission, a.isAir);

    for (let j = i + 1; j < state.movingArmies.length; j++) {
      const b = state.movingArmies[j];
      if (!b || totalStack(b.units) <= 0) continue;
      if (a.owner === b.owner) continue;
      if (getDiplomaticStatus(state, a.owner, b.owner) === 'alliance') continue;
      if (isArmyLockedInFieldBattle(state, b.id)) continue;
      if (b.isLandingPhase || b.isOccupationPhase || b.isBombardingPhase) continue;

      const zoneB = b.virtualZone ?? getUnitVirtualZone(b.units, b.isNaval, b.isSubmarineMission, b.isAir);
      if (zoneA !== zoneB) continue;

      const posB = getMovingArmyWorldPos(state, b);
      if (Math.hypot(posA[0] - posB[0], posA[1] - posB[1]) > 36) continue;

      setDiplomaticStatus(state, a.owner, b.owner, 'war');

      const clashPoint: [number, number] = [
        (posA[0] + posB[0]) / 2,
        (posA[1] + posB[1]) / 2,
      ];
      const battleId = createId('clash');
      a.clashPos = [...clashPoint];
      b.clashPos = [...clashPoint];
      a.inFieldBattleId = battleId;
      b.inFieldBattleId = battleId;

      state.battles.push({
        id: battleId,
        provinceId: a.targetProvinceId,
        attacker: a.owner,
        defender: b.owner,
        attackerUnits: cloneStack(a.units),
        defenderUnits: cloneStack(b.units),
        attackerArmyId: a.id,
        defenderArmyId: b.id,
        clashPos: clashPoint,
        isFieldClash: true,
        attackerResidualDmg: 0,
        defenderResidualDmg: 0,
        startedAt: state.elapsedSeconds,
        lastTickAt: state.elapsedSeconds,
        isAirStrike: a.isAir,
        isNavalStrike: zoneA === 'MER',
      });

      if (a.owner === state.playerNationId || b.owner === state.playerNationId) {
        const other = a.owner === state.playerNationId ? b.owner : a.owner;
        pushTelegram(
          state,
          `Contact en route : vos troupes s’arrêtent pour affronter ${NATION_TEMPLATES[other].shortName} !`,
          'warning',
          a.targetProvinceId
        );
      }
      break;
    }
  }
}

function tickNavalHazards(state: GameState): void {
  const navalArmies = state.movingArmies.filter(
    (a) =>
      (a.virtualZone === 'MER' || a.isNaval || a.isSubmarineMission) &&
      !a.isAir &&
      !isArmyLockedInFieldBattle(state, a.id) &&
      totalStack(a.units) > 0
  );
  const movingFrigates = navalArmies.filter((a) => (a.units.frigate ?? 0) > 0);

  for (const army of navalArmies) {
    if (totalStack(army.units) <= 0) continue;
    const pos = getMovingArmyWorldPos(state, army);
    const targetProv = state.provinces[army.targetProvinceId];

    // Détection des sous-marins par défenses anti-marines ennemies proches
    if (
      army.isSubmarineMission &&
      targetProv &&
      targetProv.owner !== army.owner &&
      getDiplomaticStatus(state, army.owner, targetProv.owner) !== 'alliance' &&
      targetProv.defenses.naval_defense > 0 &&
      Math.hypot(pos[0] - targetProv.center[0], pos[1] - targetProv.center[1]) < 120
    ) {
      if (!army.detectedBy) army.detectedBy = [];
      if (!army.detectedBy.includes(targetProv.owner)) {
        army.detectedBy.push(targetProv.owner);
      }
    }

    // Détection et interception par frégates ennemies en mer
    for (const frigArmy of movingFrigates) {
      if (frigArmy.owner === army.owner) continue;
      if (getDiplomaticStatus(state, army.owner, frigArmy.owner) === 'alliance') continue;
      const fPos = getMovingArmyWorldPos(state, frigArmy);
      if (Math.hypot(pos[0] - fPos[0], pos[1] - fPos[1]) > 75) continue;

      if (army.isSubmarineMission) {
        if (!army.detectedBy) army.detectedBy = [];
        if (!army.detectedBy.includes(frigArmy.owner)) army.detectedBy.push(frigArmy.owner);
        applyDamageWithResidual(army.units, (frigArmy.units.frigate ?? 0) * 28, 0);
      }
    }
  }

  state.movingArmies = state.movingArmies.filter((a) => totalStack(a.units) > 0);
}

/**
 * Fin d'un débarquement côtier (5 s) :
 * - Les troupes débarquées partent de la plage (coastBeachPos) vers targetProv.center en zone TERRE (zéro téléportation)
 * - Les sous-marins et frégates restent en zone MER et rentrent immédiatement à leur base
 */
function finishNavalLanding(
  state: GameState,
  army: MovingArmy,
  targetProv: Province,
  stillMoving: MovingArmy[]
): void {
  const path = getArmyPath(state, army);
  const seaCoastPos = path[path.length - 1];
  const beachPos: [number, number] = army.coastBeachPos
    ? [army.coastBeachPos[0], army.coastBeachPos[1]]
    : [seaCoastPos[0], seaCoastPos[1]];

  const navalEscortStack = createEmptyStack();
  navalEscortStack.submarine = Math.max(0, army.units.submarine ?? 0);
  navalEscortStack.frigate = Math.max(0, army.units.frigate ?? 0);

  const landedUnits = createEmptyStack();
  for (const t of UNIT_ORDER) {
    if (t !== 'submarine' && t !== 'frigate') {
      landedUnits[t] = Math.max(0, army.units[t] ?? 0);
    }
  }

  // 1. Les troupes terrestres débarquent sur la plage et marchent progressivement jusqu'au centre
  if (totalStack(landedUnits) > 0) {
    const walkPath = computeLandWalkToCenter(state, army.owner, beachPos, targetProv);
    const walkDist = getTotalPathLength(walkPath);
    const walkSpeed = computeSpeedPxPerSec(landedUnits, false, false);
    const walkDur = Math.max(3, Math.round(walkDist / walkSpeed));

    stillMoving.push({
      id: createId('lnd'),
      owner: army.owner,
      originProvinceId: army.originProvinceId,
      fromProvinceId: targetProv.id,
      toProvinceId: targetProv.id,
      targetProvinceId: targetProv.id,
      route: [targetProv.id],
      currentLegIndex: 0,
      units: landedUnits,
      startedAt: state.elapsedSeconds,
      legStartedAt: state.elapsedSeconds,
      legArrivalAt: state.elapsedSeconds + walkDur,
      path: walkPath,
      traveledPx: 0,
      speedPxPerSec: walkSpeed,
      virtualZone: 'TERRE',
      startPos: [walkPath[0][0], walkPath[0][1]],
      isNaval: false,
      isAir: false,
      isSubmarineMission: false,
      isLandingPhase: false,
      isOccupationPhase: false,
      isBombardingPhase: false,
      landingCompleted: true,
      isReturning: false,
    });
  }

  // 2. Les navires (sous-marins / frégates) restent en MER et rentrent à leur base
  if (totalStack(navalEscortStack) > 0) {
    const returnShip: MovingArmy = {
      id: createId('nav_ret'),
      owner: army.owner,
      originProvinceId: army.originProvinceId,
      fromProvinceId: targetProv.id,
      toProvinceId: army.originProvinceId,
      targetProvinceId: army.originProvinceId,
      route: [targetProv.id, army.originProvinceId],
      currentLegIndex: 0,
      units: navalEscortStack,
      startedAt: state.elapsedSeconds,
      legStartedAt: state.elapsedSeconds,
      legArrivalAt: state.elapsedSeconds + 10,
      isNaval: true,
      isAir: false,
      isSubmarineMission: false,
      virtualZone: 'MER',
      isReturning: true,
    };

    if (sendArmyBackToBase(state, returnShip, seaCoastPos, targetProv.id)) {
      stillMoving.push(returnShip);
    }
  }
}

export function tickMovementsAndCombat(state: GameState, dtSeconds?: number): void {
  const dt =
    dtSeconds !== undefined
      ? Math.max(0.01, Math.min(2, dtSeconds))
      : Math.max(
          0.05,
          Math.min(2, state.elapsedSeconds - (state.lastMovementTickAt ?? state.elapsedSeconds - 0.25))
        );
  state.lastMovementTickAt = state.elapsedSeconds;

  // 1. Détection de croisements en route
  checkFieldArmyEncounters(state);

  if (Math.floor(state.elapsedSeconds) % 3 === 0 && Math.floor((state.elapsedSeconds - dt)) % 3 !== 0) {
    tickNavalHazards(state);
  }

  // 2. Avancement réel sur polyligne (traveledPx) & gestion des phases (Débarquement / Tirs côtiers / Annexion)
  const stillMoving: MovingArmy[] = [];

  for (const army of state.movingArmies) {
    if (totalStack(army.units) <= 0) continue;

    // Armée figée sur place pendant une bataille de croisement
    if (isArmyLockedInFieldBattle(state, army.id)) {
      stillMoving.push(army);
      continue;
    }

    // Nettoyage sécurité si l'armée était marquée clashPos sans bataille active
    if (army.clashPos) {
      army.clashPos = undefined;
      army.inFieldBattleId = undefined;
    }

    const path = getArmyPath(state, army);
    const totalLen = getTotalPathLength(path);

    // Phase minutée en cours (DÉBARQ. 5s, TIRS 9s de frégate, ou ANNEXION 10s)
    if (army.landingStartedAt !== undefined && army.landingEndsAt !== undefined) {
      const targetProv = state.provinces[army.targetProvinceId];

      // Si une frégate est ancrée à la côte en phase de tirs de missiles
      if (army.isBombardingPhase && targetProv) {
        const lastShot = army.bombardLastTickAt ?? army.landingStartedAt;
        if (state.elapsedSeconds - lastShot >= GAME_CONFIG.combatTickSeconds) {
          army.bombardLastTickAt = state.elapsedSeconds;
          applySpecialStrikeEffects(state, army.units, targetProv, army.owner);
          if (totalStack(targetProv.garrison) > 0) {
            const volley = (army.units.frigate ?? 0) * UNIT_SPECS.frigate.attack * 0.7;
            applyDamageWithResidual(targetProv.garrison, volley, 0);
          }
          applyDefenseRetaliationDamage(state, targetProv, army.units, true);
        }

        if (totalStack(army.units) <= 0) {
          continue;
        }

        if (state.elapsedSeconds < army.landingEndsAt && targetProv.owner !== army.owner) {
          stillMoving.push(army);
          continue;
        }

        // Fin du pilonnage côtier : la frégate rentre à sa base par MER sans jamais toucher la terre
        army.landingStartedAt = undefined;
        army.landingEndsAt = undefined;
        army.isBombardingPhase = false;
        const anchorPos = path[path.length - 1];
        if (sendArmyBackToBase(state, army, anchorPos, targetProv.id)) {
          stillMoving.push(army);
        }
        continue;
      }

      // Attente de fin de timer (DÉBARQ. ou ANNEXION)
      if (state.elapsedSeconds < army.landingEndsAt) {
        // Si une garnison ennemie apparaît pendant une annexion, on passe en combat !
        if (army.isOccupationPhase && targetProv && totalStack(targetProv.garrison) > 0 && targetProv.owner !== army.owner) {
          army.landingStartedAt = undefined;
          army.landingEndsAt = undefined;
          army.isOccupationPhase = false;
          // Laisse tomber dans la logique d'engagement ci-dessous
        } else {
          stillMoving.push(army);
          continue;
        }
      } else {
        const wasLanding = Boolean(army.isLandingPhase);
        const wasOccupation = Boolean(army.isOccupationPhase);

        army.landingStartedAt = undefined;
        army.landingEndsAt = undefined;
        army.isLandingPhase = false;
        army.isOccupationPhase = false;

        if (wasLanding && targetProv) {
          army.landingCompleted = true;
          finishNavalLanding(state, army, targetProv, stillMoving);
          continue;
        }

        if (wasOccupation && targetProv) {
          if (targetProv.owner === army.owner) {
            addStacks(targetProv.garrison, army.units);
            continue;
          }
          if (totalStack(targetProv.garrison) <= 0) {
            captureProvince(state, targetProv, army.owner, army.units);
            continue;
          }
        }
      }
    } else {
      // Avancement fluide sur la polyligne exacte
      const speed =
        army.speedPxPerSec ?? computeSpeedPxPerSec(army.units, army.isNaval, army.isAir);
      army.speedPxPerSec = speed;
      army.traveledPx = (army.traveledPx ?? 0) + speed * dt;

      const remainingPx = Math.max(0, totalLen - army.traveledPx);
      army.legArrivalAt = state.elapsedSeconds + remainingPx / Math.max(0.1, speed);

      if (army.traveledPx < totalLen) {
        stillMoving.push(army);
        continue;
      }
    }

    // L'armée vient d'atteindre l'extrémité exacte de sa trajectoire (targetProvinceId)
    const arrivedProv = state.provinces[army.targetProvinceId];
    if (!arrivedProv) continue;

    // 1. Province amie → renfort dans la garnison
    if (arrivedProv.owner === army.owner) {
      addStacks(arrivedProv.garrison, army.units);
      continue;
    }

    // 2. Province alliée → demi-tour automatique
    const status = getDiplomaticStatus(state, army.owner, arrivedProv.owner);
    if (status === 'alliance') {
      const endPos = path[path.length - 1];
      if (
        sendArmyBackToBase(
          state,
          army,
          endPos,
          arrivedProv.id,
          `${arrivedProv.name} est déjà contrôlée par votre allié : retour vers la base.`
        )
      ) {
        stillMoving.push(army);
      }
      continue;
    }

    setDiplomaticStatus(state, army.owner, arrivedProv.owner, 'war');

    // 3. Frégate seule (sans troupes terrestres) : tirs de missiles depuis la côte (JAMAIS sur terre)
    if (isFrigateOnlyStack(army.units)) {
      army.isBombardingPhase = true;
      army.isLandingPhase = false;
      army.isOccupationPhase = false;
      army.landingStartedAt = state.elapsedSeconds;
      army.landingEndsAt = state.elapsedSeconds + FRIGATE_BOMBARD_SECONDS;
      army.bombardLastTickAt = state.elapsedSeconds - GAME_CONFIG.combatTickSeconds; // 1re salve immédiate

      if (arrivedProv.owner === state.playerNationId || army.owner === state.playerNationId) {
        pushTelegram(
          state,
          `Tirs côtiers de frégates sur ${arrivedProv.name} depuis la mer !`,
          arrivedProv.owner === state.playerNationId ? 'danger' : 'warning',
          arrivedProv.id
        );
      }
      stillMoving.push(army);
      continue;
    }

    // 4. Convoi maritime avec troupes terrestres (Sous-marin ou Frégate d'escorte) → DÉBARQUEMENT 5 s sur la côte
    if (army.isNaval && hasLandUnits(army.units) && !army.landingCompleted) {
      army.isLandingPhase = true;
      army.isOccupationPhase = false;
      army.isBombardingPhase = false;
      army.landingStartedAt = state.elapsedSeconds;
      army.landingEndsAt = state.elapsedSeconds + GAME_CONFIG.submarineLandingSeconds;

      // Si une frégate escorte le débarquement, elle brise les défenses côtières dès l'approche
      if ((army.units.frigate ?? 0) > 0) {
        applySpecialStrikeEffects(state, army.units, arrivedProv, army.owner);
      }
      if (army.isSubmarineMission) {
        if (!army.detectedBy) army.detectedBy = [];
        if (!army.detectedBy.includes(arrivedProv.owner)) {
          army.detectedBy.push(arrivedProv.owner);
        }
      }

      if (arrivedProv.owner === state.playerNationId || army.owner === state.playerNationId) {
        pushTelegram(
          state,
          `DÉBARQUEMENT (${GAME_CONFIG.submarineLandingSeconds} s) sur la côte de ${arrivedProv.name} !`,
          arrivedProv.owner === state.playerNationId ? 'danger' : 'warning',
          arrivedProv.id
        );
      }
      stillMoving.push(army);
      continue;
    }

    // 5. Sous-marin seul arrivé sur une côte ennemie : raid portuaire puis retour à la base
    if (army.isNaval && !hasLandUnits(army.units)) {
      if ((arrivedProv.garrison.frigate ?? 0) > 0 || (arrivedProv.garrison.submarine ?? 0) > 0) {
        applyDamageToTargetedUnits(arrivedProv.garrison, (army.units.submarine ?? 0) * 26, [
          'frigate',
          'submarine',
        ]);
      }
      applyDefenseRetaliationDamage(state, arrivedProv, army.units, true);
      if (totalStack(army.units) > 0) {
        const endPos = path[path.length - 1];
        if (sendArmyBackToBase(state, army, endPos, arrivedProv.id)) {
          stillMoving.push(army);
        }
      }
      continue;
    }

    // 6. Aviation seule sur province ennemie vide ou défendue
    if (army.isAir && totalStack(arrivedProv.garrison) <= 0) {
      applySpecialStrikeEffects(state, army.units, arrivedProv, army.owner);
      applyDefenseRetaliationDamage(state, arrivedProv, army.units, false);
      if (totalStack(army.units) > 0) {
        const endPos = path[path.length - 1];
        if (sendArmyBackToBase(state, army, endPos, arrivedProv.id)) {
          stillMoving.push(army);
        }
      }
      continue;
    }

    // 7. Province ennemie sans garnison → ANNEXION 10 s (jamais le mot débarquement)
    if (totalStack(arrivedProv.garrison) <= 0) {
      army.isLandingPhase = false;
      army.isOccupationPhase = true;
      army.isBombardingPhase = false;
      army.landingStartedAt = state.elapsedSeconds;
      army.landingEndsAt = state.elapsedSeconds + GAME_CONFIG.occupationDurationSeconds;

      if (arrivedProv.owner === state.playerNationId || army.owner === state.playerNationId) {
        pushTelegram(
          state,
          `Annexion de ${arrivedProv.name} en cours (${GAME_CONFIG.occupationDurationSeconds} s)...`,
          arrivedProv.owner === state.playerNationId ? 'warning' : 'info',
          arrivedProv.id
        );
      }
      stillMoving.push(army);
      continue;
    }

    // 8. Province ennemie avec garnison → Combat de province
    const existing = state.battles.find(
      (b) => !b.isFieldClash && b.provinceId === arrivedProv.id && b.attacker === army.owner
    );
    if (existing) {
      addStacks(existing.attackerUnits, army.units);
    } else {
      state.battles.push({
        id: createId('bat'),
        provinceId: arrivedProv.id,
        attacker: army.owner,
        defender: arrivedProv.owner,
        attackerUnits: cloneStack(army.units),
        defenderUnits: cloneStack(arrivedProv.garrison),
        attackerResidualDmg: 0,
        defenderResidualDmg: 0,
        startedAt: state.elapsedSeconds,
        lastTickAt: state.elapsedSeconds,
        isAirStrike: army.isAir,
        isNavalStrike: false,
      });

      if (army.owner === state.playerNationId || arrivedProv.owner === state.playerNationId) {
        pushTelegram(
          state,
          `Combat engagé à ${arrivedProv.name} (${NATION_TEMPLATES[army.owner].shortName} vs ${NATION_TEMPLATES[arrivedProv.owner].shortName}) !`,
          arrivedProv.owner === state.playerNationId ? 'danger' : 'warning',
          arrivedProv.id
        );
      }
    }
  }

  state.movingArmies = stillMoving;

  // 3. Résolution déterministe des batailles (nettoyage immédiat si 0 unité + accumulateur de dégâts résiduels)
  const ongoingBattles: ActiveBattle[] = [];
  for (const battle of state.battles) {
    if (!Number.isFinite(battle.lastTickAt)) {
      battle.lastTickAt = state.elapsedSeconds;
    }

    // --- Cas A : Bataille de croisement en route ---
    if (battle.isFieldClash) {
      const attArmy = state.movingArmies.find((a) => a.id === battle.attackerArmyId);
      const defArmy = state.movingArmies.find((a) => a.id === battle.defenderArmyId);

      const aAliveBefore = Boolean(attArmy && totalStack(attArmy.units) > 0);
      const bAliveBefore = Boolean(defArmy && totalStack(defArmy.units) > 0);

      if (!aAliveBefore || !bAliveBefore) {
        if (aAliveBefore && attArmy) {
          attArmy.clashPos = undefined;
          attArmy.inFieldBattleId = undefined;
        }
        if (bAliveBefore && defArmy) {
          defArmy.clashPos = undefined;
          defArmy.inFieldBattleId = undefined;
        }
        continue;
      }

      if (state.elapsedSeconds - battle.lastTickAt < GAME_CONFIG.combatTickSeconds) {
        battle.attackerUnits = cloneStack(attArmy!.units);
        battle.defenderUnits = cloneStack(defArmy!.units);
        ongoingBattles.push(battle);
        continue;
      }

      battle.lastTickAt = state.elapsedSeconds;

      const powerA = Math.max(
        10,
        computeFieldClashPower(state, attArmy!.owner, attArmy!.units, defArmy!.units)
      );
      const powerB = Math.max(
        10,
        computeFieldClashPower(state, defArmy!.owner, defArmy!.units, attArmy!.units)
      );

      battle.defenderResidualDmg = applyDamageWithResidual(
        defArmy!.units,
        powerA * (0.9 + Math.random() * 0.2),
        battle.defenderResidualDmg ?? 0
      );
      battle.attackerResidualDmg = applyDamageWithResidual(
        attArmy!.units,
        powerB * (0.9 + Math.random() * 0.2),
        battle.attackerResidualDmg ?? 0
      );

      battle.attackerUnits = cloneStack(attArmy!.units);
      battle.defenderUnits = cloneStack(defArmy!.units);

      const aAlive = totalStack(attArmy!.units) > 0;
      const bAlive = totalStack(defArmy!.units) > 0;

      if (aAlive && bAlive) {
        ongoingBattles.push(battle);
      } else {
        if (aAlive && attArmy) {
          attArmy.clashPos = undefined;
          attArmy.inFieldBattleId = undefined;
        }
        if (bAlive && defArmy) {
          defArmy.clashPos = undefined;
          defArmy.inFieldBattleId = undefined;
        }

        if (attArmy!.owner === state.playerNationId || defArmy!.owner === state.playerNationId) {
          const playerWon =
            (attArmy!.owner === state.playerNationId && aAlive) ||
            (defArmy!.owner === state.playerNationId && bAlive);
          pushTelegram(
            state,
            playerWon
              ? `Escarmouche remportée : votre colonne reprend sa marche !`
              : `Escarmouche perdue en route.`,
            playerWon ? 'info' : 'danger',
            battle.provinceId
          );
        }
      }
      continue;
    }

    // --- Cas B : Bataille de province ---
    const prov = state.provinces[battle.provinceId];
    if (!prov) continue;

    battle.defenderUnits = cloneStack(prov.garrison);
    if (prov.owner === battle.attacker) continue;

    // Résolution immédiate si un camp est déjà à 0 (plus jamais de "4 vs 0" bloqué)
    const attAliveNow = totalStack(battle.attackerUnits) > 0;
    const defAliveNow = totalStack(prov.garrison) > 0;

    if (!attAliveNow) continue;
    if (!defAliveNow) {
      if (isPureAviation(battle.attackerUnits)) {
        const home = Object.values(state.provinces).find((p) => p.owner === battle.attacker);
        if (home) addStacks(home.garrison, battle.attackerUnits);
      } else {
        captureProvince(state, prov, battle.attacker, battle.attackerUnits);
      }
      continue;
    }

    if (state.elapsedSeconds - battle.lastTickAt < GAME_CONFIG.combatTickSeconds) {
      ongoingBattles.push(battle);
      continue;
    }

    battle.lastTickAt = state.elapsedSeconds;

    applySpecialStrikeEffects(state, battle.attackerUnits, prov, battle.attacker);

    const attPower = Math.max(
      10,
      computeStackPower(
        state,
        battle.attacker,
        battle.attackerUnits,
        prov.garrison,
        prov,
        false,
        Boolean(battle.isNavalStrike)
      )
    );
    const defPower = Math.max(
      10,
      computeStackPower(
        state,
        battle.defender,
        prov.garrison,
        battle.attackerUnits,
        prov,
        true,
        false
      )
    );

    battle.defenderResidualDmg = applyDamageWithResidual(
      prov.garrison,
      attPower * (0.9 + Math.random() * 0.2),
      battle.defenderResidualDmg ?? 0
    );
    battle.attackerResidualDmg = applyDamageWithResidual(
      battle.attackerUnits,
      defPower * (0.9 + Math.random() * 0.2),
      battle.attackerResidualDmg ?? 0
    );
    applyDefenseRetaliationDamage(
      state,
      prov,
      battle.attackerUnits,
      Boolean(battle.isNavalStrike)
    );

    battle.defenderUnits = cloneStack(prov.garrison);

    const attAlive = totalStack(battle.attackerUnits) > 0;
    const defAlive = totalStack(prov.garrison) > 0;

    if (attAlive && !defAlive) {
      if (isPureAviation(battle.attackerUnits)) {
        const home = Object.values(state.provinces).find((p) => p.owner === battle.attacker);
        if (home) addStacks(home.garrison, battle.attackerUnits);
      } else {
        captureProvince(state, prov, battle.attacker, battle.attackerUnits);
      }
    } else if (!attAlive) {
      if (battle.attacker === state.playerNationId) {
        pushTelegram(state, `Notre assaut sur ${prov.name} a été repoussé.`, 'danger', prov.id);
      } else if (battle.defender === state.playerNationId) {
        pushTelegram(state, `Défense réussie à ${prov.name} !`, 'info', prov.id);
      }
    } else {
      ongoingBattles.push(battle);
    }
  }

  state.battles = ongoingBattles;
  state.movingArmies = state.movingArmies.filter((a) => totalStack(a.units) > 0);
}

function applySpecialStrikeEffects(
  state: GameState,
  attackerUnits: UnitStack,
  targetProv: Province,
  attackerId: NationId
): void {
  const now = state.elapsedSeconds;

  if ((attackerUnits.bomber ?? 0) > 0) {
    const factoryChance = Math.min(0.45, (attackerUnits.bomber ?? 0) * 0.14);
    if (Math.random() < factoryChance) {
      const activeFactories = (['gas', 'steel', 'gold'] as ExtractionResource[]).filter(
        (r) => targetProv.extractionFactories[r] > 0
      );
      if (activeFactories.length > 0) {
        const pick = activeFactories[Math.floor(Math.random() * activeFactories.length)];
        targetProv.extractionFactories[pick] -= 1;
        if (attackerId === state.playerNationId || targetProv.owner === state.playerNationId) {
          pushTelegram(
            state,
            `Bombardement : une usine d’extraction a été endommagée à ${targetProv.name} !`,
            targetProv.owner === state.playerNationId ? 'danger' : 'info',
            targetProv.id
          );
        }
      }
    }

    // Les bombardiers n'affaiblissent jamais les défenses anti-aériennes
    const allowedDefs: DefenseType[] = ['trenches', 'bunkers', 'naval_defense'];
    for (const def of allowedDefs) {
      if (targetProv.defenses[def] > 0 && Math.random() < 0.45) {
        applyDefenseWeakness(targetProv, def, now);
      }
    }
  }

  // Les frégates n'affaiblissent jamais les défenses anti-marines
  if ((attackerUnits.frigate ?? 0) > 0 && isCoastalProvince(targetProv)) {
    const allowedDefs: DefenseType[] = ['trenches', 'bunkers', 'aa_defense'];
    for (const def of allowedDefs) {
      if (targetProv.defenses[def] > 0 && Math.random() < 0.45) {
        applyDefenseWeakness(targetProv, def, now);
      }
    }
  }
}