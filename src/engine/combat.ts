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
  computeZoneRoutePlan,
  getCoastalLandingPos,
  getStackTotal,
  hasLandUnits,
  hasNavalEscort,
  isCoastalProvince,
  isFrigateOnlyStack,
  isPureAviation,
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

function distBetween(a: Province, b: Province): number {
  return Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
}

function isArmyLockedInFieldBattle(state: GameState, armyId: string): boolean {
  return state.battles.some(
    (b) =>
      b.isFieldClash &&
      (b.attackerArmyId === armyId || b.defenderArmyId === armyId)
  );
}

function getLegDurationFromPos(
  startPos: [number, number],
  toPos: [number, number],
  units: UnitStack,
  isNaval: boolean,
  isAir: boolean,
  minSeconds = 4
): number {
  let slowest = 0;
  for (const type of UNIT_ORDER) {
    if ((units[type] ?? 0) <= 0) continue;
    if (UNIT_SPECS[type].travelSeconds > slowest) {
      slowest = UNIT_SPECS[type].travelSeconds;
    }
  }
  if (slowest === 0) slowest = UNIT_SPECS.soldier.travelSeconds;

  const dist = Math.hypot(toPos[0] - startPos[0], toPos[1] - startPos[1]);
  const distFactor = Math.max(0.25, dist / 145);
  const modeMult = isAir ? 0.55 : isNaval ? 1.15 : 1.0;

  return Math.max(minSeconds, Math.round(slowest * distFactor * modeMult));
}

export function getLegDurationSeconds(
  from: Province,
  to: Province,
  units: UnitStack,
  isNaval: boolean,
  isAir: boolean
): number {
  return Math.max(8, getLegDurationFromPos(from.center, to.center, units, isNaval, isAir, 8));
}

export function findArmyRoute(
  state: GameState,
  owner: NationId,
  fromId: string,
  targetId: string,
  units: UnitStack
): { route: string[]; isAir: boolean; isSubmarineMission: boolean } | null {
  const plan = computeZoneRoutePlan(state, owner, fromId, targetId, units);
  if (!plan) return null;
  return {
    route: plan.route,
    isAir: plan.isAir,
    isSubmarineMission: plan.isSubmarineMission,
  };
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
      return { ok: false, reason: 'Les unités navales nécessitent un départ et une arrivée côtiers.' };
    }
  }

  const found = findArmyRoute(state, owner, fromId, targetId, send);
  if (!found || found.route.length < 2) {
    return {
      ok: false,
      reason:
        hasLandUnits(send) && !hasNavalEscort(send)
          ? 'Trajet terrestre indisponible : ajoutez un Sous-marin ou une Frégate pour passer par la zone MER.'
          : 'Aucune trajectoire disponible vers cette destination.',
    };
  }

  for (const type of UNIT_ORDER) {
    from.garrison[type] -= send[type];
  }

  const nextId = found.route[1];
  const nextProv = state.provinces[nextId];
  const isNaval = !found.isAir && !from.neighbors.includes(nextId);
  const legDuration = getLegDurationSeconds(from, nextProv, send, isNaval, found.isAir);

  state.movingArmies.push({
    id: createId('mov'),
    owner,
    originProvinceId: fromId,
    fromProvinceId: fromId,
    toProvinceId: nextId,
    targetProvinceId: targetId,
    route: found.route,
    currentLegIndex: 0,
    units: send,
    startedAt: state.elapsedSeconds,
    legStartedAt: state.elapsedSeconds,
    legArrivalAt: state.elapsedSeconds + legDuration,
    isNaval,
    isAir: found.isAir,
    isSubmarineMission: found.isSubmarineMission,
    isLandingPhase: false,
    isOccupationPhase: false,
    landingCompleted: false,
    detectedBy: [],
    isReturning: false,
  });

  if (owner === state.playerNationId && state.tutorialStep > 0) {
    state.tutorialStep = 0;
  }

  return { ok: true };
}

export function getMovingArmyWorldPos(state: GameState, army: MovingArmy): [number, number] {
  if (army.clashPos) {
    return [army.clashPos[0], army.clashPos[1]];
  }

  const from = state.provinces[army.fromProvinceId];
  const to = state.provinces[army.toProvinceId];
  if (!to) return [0, 0];

  const startX = army.startPos ? army.startPos[0] : from?.center[0] ?? to.center[0];
  const startY = army.startPos ? army.startPos[1] : from?.center[1] ?? to.center[1];

  const frigateOnly = isFrigateOnlyStack(army.units);

  if (army.landingStartedAt !== undefined && army.landingEndsAt !== undefined) {
    if (army.isLandingPhase || frigateOnly) {
      return getCoastalLandingPos(to, [startX, startY]);
    }
    return [to.center[0], to.center[1]];
  }

  const dur = Math.max(1, army.legArrivalAt - army.legStartedAt);
  const t = Math.min(1, Math.max(0, (state.elapsedSeconds - army.legStartedAt) / dur));

  const destPos: [number, number] =
    (army.isSubmarineMission && !army.landingCompleted) || frigateOnly
      ? getCoastalLandingPos(to, [startX, startY])
      : [to.center[0], to.center[1]];

  return [startX + (destPos[0] - startX) * t, startY + (destPos[1] - startY) * t];
}

function resumeArmyAfterClash(state: GameState, army: MovingArmy): void {
  const curPos = getMovingArmyWorldPos(state, army);
  const destProv = state.provinces[army.toProvinceId];
  army.clashPos = undefined;
  army.startPos = curPos;
  army.legStartedAt = state.elapsedSeconds;
  const dur = destProv
    ? getLegDurationFromPos(curPos, destProv.center, army.units, army.isNaval, army.isAir, 6)
    : 8;
  army.legArrivalAt = state.elapsedSeconds + dur;
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
  const now = state.elapsedSeconds;

  army.clashPos = undefined;
  state.battles = state.battles.filter(
    (b) => !(b.isFieldClash && (b.attackerArmyId === armyId || b.defenderArmyId === armyId))
  );

  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;
  army.isLandingPhase = false;
  army.isOccupationPhase = false;
  army.landingCompleted = false;

  const oldFrom = army.fromProvinceId;
  const oldTo = army.toProvinceId;

  const returnDestination =
    state.provinces[army.originProvinceId]?.owner === owner
      ? army.originProvinceId
      : state.provinces[oldFrom]?.owner === owner
      ? oldFrom
      : Object.values(state.provinces).find((p) => p.owner === owner)?.id;

  if (!returnDestination) {
    return { ok: false, reason: 'Aucune province de repli disponible.' };
  }

  const reversePrefix = army.route.slice(0, army.currentLegIndex + 1).reverse();
  const returnWaypoints =
    reversePrefix.length > 0 && reversePrefix[reversePrefix.length - 1] === returnDestination
      ? reversePrefix
      : [returnDestination];

  const firstStopId = returnWaypoints[0];
  const firstStopProv = state.provinces[firstStopId];
  const dur = getLegDurationFromPos(
    curPos,
    firstStopProv.center,
    army.units,
    army.isNaval,
    army.isAir,
    4
  );

  army.startPos = curPos;
  army.fromProvinceId = oldTo;
  army.toProvinceId = firstStopId;
  army.targetProvinceId = returnDestination;
  army.route = [oldTo, ...returnWaypoints];
  army.currentLegIndex = 0;
  army.isReturning = true;
  army.legStartedAt = now;
  army.legArrivalAt = now + dur;

  if (owner === state.playerNationId) {
    pushTelegram(
      state,
      `Demi-tour ordonné : votre armée revient vers ${state.provinces[returnDestination]?.name ?? 'la base'}.`,
      'info',
      returnDestination
    );
  }

  return { ok: true };
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
  const now = state.elapsedSeconds;

  army.clashPos = undefined;
  state.battles = state.battles.filter(
    (b) => !(b.isFieldClash && (b.attackerArmyId === armyId || b.defenderArmyId === armyId))
  );

  if (army.isAir || isPureAviation(army.units)) {
    const dur = getLegDurationFromPos(curPos, target.center, army.units, false, true, 4);
    army.startPos = curPos;
    army.route = [army.fromProvinceId, newTargetId];
    army.currentLegIndex = 0;
    army.toProvinceId = newTargetId;
    army.targetProvinceId = newTargetId;
    army.isAir = true;
    army.isNaval = false;
    army.isSubmarineMission = false;
    army.isLandingPhase = false;
    army.isOccupationPhase = false;
    army.isReturning = target.owner === owner;
    army.landingStartedAt = undefined;
    army.landingEndsAt = undefined;
    army.landingCompleted = false;
    army.legStartedAt = now;
    army.legArrivalAt = now + dur;
    return { ok: true };
  }

  const anchors: string[] = [];
  if (state.provinces[army.fromProvinceId]?.owner === owner) anchors.push(army.fromProvinceId);
  if (state.provinces[army.toProvinceId]?.owner === owner) anchors.push(army.toProvinceId);
  if (anchors.length === 0) {
    const nearest = Object.values(state.provinces)
      .filter((p) => p.owner === owner)
      .sort(
        (a, b) =>
          Math.hypot(a.center[0] - curPos[0], a.center[1] - curPos[1]) -
          Math.hypot(b.center[0] - curPos[0], b.center[1] - curPos[1])
      )[0];
    if (nearest) anchors.push(nearest.id);
  }

  let bestFound: { route: string[]; isAir: boolean; isSubmarineMission: boolean } | null = null;
  let bestScore = Infinity;

  for (const anchorId of anchors) {
    const found = findArmyRoute(state, owner, anchorId, newTargetId, army.units);
    if (!found || found.route.length < 2) continue;

    let score = 0;
    for (let i = 0; i < found.route.length - 1; i++) {
      const a = state.provinces[found.route[i]];
      const b = state.provinces[found.route[i + 1]];
      if (a && b) score += distBetween(a, b);
    }

    if (score < bestScore) {
      bestScore = score;
      bestFound = found;
    }
  }

  if (!bestFound || bestFound.route.length < 2) {
    return { ok: false, reason: 'Aucune trajectoire disponible vers cette nouvelle destination.' };
  }

  const waypoints = bestFound.route.slice(1);
  const nextId = waypoints[0];
  const nextProv = state.provinces[nextId];
  const isNaval =
    !bestFound.isAir &&
    !state.provinces[bestFound.route[0]]?.neighbors.includes(nextId);
  const dur = getLegDurationFromPos(curPos, nextProv.center, army.units, isNaval, bestFound.isAir, 4);

  army.startPos = curPos;
  army.route = [bestFound.route[0], ...waypoints];
  army.currentLegIndex = 0;
  army.toProvinceId = nextId;
  army.targetProvinceId = newTargetId;
  army.isNaval = isNaval;
  army.isSubmarineMission = bestFound.isSubmarineMission;
  army.isLandingPhase = false;
  army.isOccupationPhase = false;
  army.isReturning = target.owner === owner;
  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;
  army.landingCompleted = false;
  army.legStartedAt = now;
  army.legArrivalAt = now + dur;

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
      state.battles.splice(idx, 1);
      return orderTurnAround(state, nationId, army.id);
    }
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

  const isAir = isPureAviation(battle.attackerUnits);
  const isNaval = !isAir && !prov.neighbors.includes(fallback.id);
  const dur = Math.max(
    8,
    Math.round(getLegDurationSeconds(prov, fallback, battle.attackerUnits, isNaval, isAir) * 0.7)
  );

  state.movingArmies.push({
    id: createId('ret'),
    owner: nationId,
    originProvinceId: fallback.id,
    fromProvinceId: prov.id,
    toProvinceId: fallback.id,
    targetProvinceId: fallback.id,
    route: [prov.id, fallback.id],
    currentLegIndex: 0,
    units: cloneStack(battle.attackerUnits),
    startedAt: state.elapsedSeconds,
    legStartedAt: state.elapsedSeconds,
    legArrivalAt: state.elapsedSeconds + dur,
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
    let unitPower = (spec.attack + spec.defense) * 0.5;
    const techLvl = nation ? nation.techLevels[spec.armyTechAxis] ?? 0 : 0;
    unitPower *= 1 + techLvl * 0.2;

    if (type === 'fighter' && enemyAirCount > 0) {
      unitPower *= 2.0;
    }

    power += qty * unitPower;
  }

  return power;
}

function applyDamageToStack(stack: UnitStack, damage: number): void {
  let remaining = Math.max(0, damage);
  if (remaining <= 0) return;

  for (const type of UNIT_ORDER) {
    if (remaining <= 0) break;
    const qty = stack[type] ?? 0;
    if (qty <= 0) continue;
    const unitHp = UNIT_SPECS[type].hp;
    const kills = Math.min(qty, Math.floor(remaining / unitHp));
    if (kills > 0) {
      stack[type] = qty - kills;
      remaining -= kills * unitHp;
    }
  }

  if (remaining > 0) {
    for (const type of UNIT_ORDER) {
      const qty = stack[type] ?? 0;
      if (qty <= 0) continue;
      const unitHp = UNIT_SPECS[type].hp;
      if (remaining >= unitHp * 0.35 || Math.random() < remaining / unitHp) {
        stack[type] = qty - 1;
        break;
      }
    }
  }
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

function checkFieldArmyEncounters(state: GameState): void {
  for (let i = 0; i < state.movingArmies.length; i++) {
    const a = state.movingArmies[i];
    if (!a || totalStack(a.units) <= 0) continue;
    if (isArmyLockedInFieldBattle(state, a.id)) continue;

    const posA = getMovingArmyWorldPos(state, a);

    for (let j = i + 1; j < state.movingArmies.length; j++) {
      const b = state.movingArmies[j];
      if (!b || totalStack(b.units) <= 0) continue;
      if (a.owner === b.owner) continue;
      if (getDiplomaticStatus(state, a.owner, b.owner) === 'alliance') continue;
      if (isArmyLockedInFieldBattle(state, b.id)) continue;

      const sameDomain = a.isAir === b.isAir;
      if (!sameDomain) continue;

      const posB = getMovingArmyWorldPos(state, b);
      if (Math.hypot(posA[0] - posB[0], posA[1] - posB[1]) > 42) continue;

      setDiplomaticStatus(state, a.owner, b.owner, 'war');

      const clashPoint: [number, number] = [
        (posA[0] + posB[0]) / 2,
        (posA[1] + posB[1]) / 2,
      ];
      a.clashPos = [...clashPoint];
      b.clashPos = [...clashPoint];
      a.landingStartedAt = undefined;
      a.landingEndsAt = undefined;
      a.isLandingPhase = false;
      a.isOccupationPhase = false;
      b.landingStartedAt = undefined;
      b.landingEndsAt = undefined;
      b.isLandingPhase = false;
      b.isOccupationPhase = false;

      state.battles.push({
        id: createId('clash'),
        provinceId: a.toProvinceId,
        attacker: a.owner,
        defender: b.owner,
        attackerUnits: cloneStack(a.units),
        defenderUnits: cloneStack(b.units),
        attackerArmyId: a.id,
        defenderArmyId: b.id,
        clashPos: clashPoint,
        isFieldClash: true,
        startedAt: state.elapsedSeconds,
        lastTickAt: state.elapsedSeconds,
        isAirStrike: a.isAir,
        isNavalStrike: a.isNaval || b.isNaval,
      });

      if (a.owner === state.playerNationId || b.owner === state.playerNationId) {
        const other = a.owner === state.playerNationId ? b.owner : a.owner;
        pushTelegram(
          state,
          `Contact en route : vos troupes s’arrêtent pour affronter ${NATION_TEMPLATES[other].shortName} !`,
          'warning',
          a.toProvinceId
        );
      }
      break;
    }
  }
}

function tickNavalHazards(state: GameState): void {
  const navalArmies = state.movingArmies.filter(
    (a) =>
      (a.isNaval || a.isSubmarineMission) &&
      !a.isAir &&
      !isArmyLockedInFieldBattle(state, a.id) &&
      totalStack(a.units) > 0
  );
  const movingFrigates = navalArmies.filter((a) => (a.units.frigate ?? 0) > 0);

  for (const army of navalArmies) {
    if (totalStack(army.units) <= 0) continue;
    const pos = getMovingArmyWorldPos(state, army);
    const targetProv = state.provinces[army.toProvinceId];

    if (
      army.isSubmarineMission &&
      targetProv &&
      targetProv.owner !== army.owner &&
      getDiplomaticStatus(state, army.owner, targetProv.owner) !== 'alliance' &&
      targetProv.defenses.naval_defense > 0
    ) {
      if (!army.detectedBy) army.detectedBy = [];
      if (!army.detectedBy.includes(targetProv.owner)) {
        army.detectedBy.push(targetProv.owner);
      }
    }

    if (
      !army.isSubmarineMission &&
      targetProv &&
      targetProv.owner !== army.owner &&
      getDiplomaticStatus(state, army.owner, targetProv.owner) !== 'alliance'
    ) {
      const coastDefLvl = getEffectiveDefenseLevel(targetProv, 'naval_defense', state.elapsedSeconds);
      if (
        coastDefLvl > 0 &&
        Math.hypot(pos[0] - targetProv.center[0], pos[1] - targetProv.center[1]) < 95
      ) {
        if (hasLandUnits(army.units)) {
          applyDamageToStack(army.units, coastDefLvl * 16);
        }
      }
    }

    for (const frigArmy of movingFrigates) {
      if (frigArmy.owner === army.owner) continue;
      if (getDiplomaticStatus(state, army.owner, frigArmy.owner) === 'alliance') continue;
      const fPos = getMovingArmyWorldPos(state, frigArmy);
      if (Math.hypot(pos[0] - fPos[0], pos[1] - fPos[1]) > 75) continue;

      if (army.isSubmarineMission) {
        if (!army.detectedBy) army.detectedBy = [];
        if (!army.detectedBy.includes(frigArmy.owner)) army.detectedBy.push(frigArmy.owner);
        applyDamageToStack(army.units, frigArmy.units.frigate * 28);
      } else if ((army.units.frigate ?? 0) === 0) {
        applyDamageToStack(army.units, frigArmy.units.frigate * 32);
      }
    }

    if (
      targetProv &&
      targetProv.owner !== army.owner &&
      getDiplomaticStatus(state, army.owner, targetProv.owner) !== 'alliance' &&
      (targetProv.garrison.frigate ?? 0) > 0 &&
      Math.hypot(pos[0] - targetProv.center[0], pos[1] - targetProv.center[1]) < 65
    ) {
      if (army.isSubmarineMission) {
        if (!army.detectedBy) army.detectedBy = [];
        if (!army.detectedBy.includes(targetProv.owner)) army.detectedBy.push(targetProv.owner);
        applyDamageToStack(army.units, targetProv.garrison.frigate * 22);
      } else if ((army.units.frigate ?? 0) === 0) {
        applyDamageToStack(army.units, targetProv.garrison.frigate * 26);
      }
    }
  }

  state.movingArmies = state.movingArmies.filter((a) => totalStack(a.units) > 0);
}

function autoReturnArmyFromAlly(state: GameState, army: MovingArmy, allyProv: Province): void {
  const destId =
    state.provinces[army.originProvinceId]?.owner === army.owner
      ? army.originProvinceId
      : Object.values(state.provinces).find((p) => p.owner === army.owner)?.id;

  if (!destId) return;

  const destProv = state.provinces[destId];
  const isNaval = !army.isAir && !allyProv.neighbors.includes(destId);
  const dur = getLegDurationSeconds(allyProv, destProv, army.units, isNaval, army.isAir);

  army.clashPos = undefined;
  army.startPos = undefined;
  army.fromProvinceId = allyProv.id;
  army.toProvinceId = destId;
  army.targetProvinceId = destId;
  army.route = [allyProv.id, destId];
  army.currentLegIndex = 0;
  army.isNaval = isNaval;
  army.isSubmarineMission = false;
  army.isLandingPhase = false;
  army.isOccupationPhase = false;
  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;
  army.landingCompleted = false;
  army.isReturning = true;
  army.legStartedAt = state.elapsedSeconds;
  army.legArrivalAt = state.elapsedSeconds + dur;

  if (army.owner === state.playerNationId) {
    pushTelegram(
      state,
      `${allyProv.name} est déjà contrôlée par votre allié : votre armée fait demi-tour vers ${destProv.name}.`,
      'info',
      destId
    );
  }
}

/** Passage de la zone MER (côte) vers la zone TERRE pour les troupes, et retour en zone MER pour le sous-marin */
function finishSubmarineLanding(
  state: GameState,
  army: MovingArmy,
  targetProv: Province,
  stillMoving: MovingArmy[]
): void {
  const coastPos = getCoastalLandingPos(targetProv, army.startPos);
  const subCount = Math.max(0, army.units.submarine ?? 0);
  const finalDestProv = state.provinces[army.targetProvinceId] ?? targetProv;

  const landedUnits = createEmptyStack();
  for (const t of UNIT_ORDER) {
    if (t !== 'submarine') {
      landedUnits[t] = Math.max(0, army.units[t] ?? 0);
    }
  }

  if (totalStack(landedUnits) > 0) {
    const walkDur = getLegDurationFromPos(
      coastPos,
      finalDestProv.center,
      landedUnits,
      false,
      false,
      7
    );
    stillMoving.push({
      id: createId('lnd'),
      owner: army.owner,
      originProvinceId: army.originProvinceId,
      fromProvinceId: targetProv.id,
      toProvinceId: finalDestProv.id,
      targetProvinceId: finalDestProv.id,
      route: [targetProv.id, finalDestProv.id],
      currentLegIndex: 0,
      units: landedUnits,
      startedAt: state.elapsedSeconds,
      legStartedAt: state.elapsedSeconds,
      legArrivalAt: state.elapsedSeconds + walkDur,
      startPos: coastPos,
      isNaval: false,
      isAir: false,
      isSubmarineMission: false,
      isLandingPhase: false,
      isOccupationPhase: false,
      landingCompleted: true,
      isReturning: false,
    });
  }

  if (subCount > 0) {
    const baseId =
      state.provinces[army.originProvinceId]?.owner === army.owner
        ? army.originProvinceId
        : Object.values(state.provinces).find((p) => p.owner === army.owner)?.id;

    if (baseId) {
      const baseProv = state.provinces[baseId];
      const subStack = createEmptyStack();
      subStack.submarine = subCount;
      const foundSea = findArmyRoute(state, army.owner, targetProv.id, baseId, subStack);
      const seaRoute =
        foundSea?.route && foundSea.route.length >= 2 ? foundSea.route : [targetProv.id, baseId];
      const nextStopId = seaRoute[1];
      const nextStopProv = state.provinces[nextStopId] ?? baseProv;
      const retDur = getLegDurationFromPos(coastPos, nextStopProv.center, subStack, true, false, 7);

      stillMoving.push({
        id: createId('sub_ret'),
        owner: army.owner,
        originProvinceId: baseId,
        fromProvinceId: targetProv.id,
        toProvinceId: nextStopId,
        targetProvinceId: baseId,
        route: seaRoute,
        currentLegIndex: 0,
        units: subStack,
        startedAt: state.elapsedSeconds,
        legStartedAt: state.elapsedSeconds,
        legArrivalAt: state.elapsedSeconds + retDur,
        startPos: coastPos,
        isNaval: true,
        isAir: false,
        isSubmarineMission: false,
        isLandingPhase: false,
        isOccupationPhase: false,
        landingCompleted: false,
        isReturning: true,
      });
    } else {
      const subStack = createEmptyStack();
      subStack.submarine = subCount;
      addStacks(targetProv.garrison, subStack);
    }
  }
}

export function tickMovementsAndCombat(state: GameState): void {
  checkFieldArmyEncounters(state);

  if (Math.floor(state.elapsedSeconds) % 3 === 0) {
    tickNavalHazards(state);
  }

  const stillMoving: MovingArmy[] = [];

  for (const army of state.movingArmies) {
    if (totalStack(army.units) <= 0) continue;

    if (isArmyLockedInFieldBattle(state, army.id)) {
      stillMoving.push(army);
      continue;
    }

    if (army.landingStartedAt !== undefined && army.landingEndsAt !== undefined) {
      if (state.elapsedSeconds < army.landingEndsAt) {
        stillMoving.push(army);
        continue;
      }

      const targetProv = state.provinces[army.toProvinceId];
      const wasLanding = Boolean(army.isLandingPhase);
      const wasOccupation = Boolean(army.isOccupationPhase);

      army.landingStartedAt = undefined;
      army.landingEndsAt = undefined;
      army.isLandingPhase = false;
      army.isOccupationPhase = false;

      if (wasLanding && targetProv) {
        army.landingCompleted = true;
        finishSubmarineLanding(state, army, targetProv, stillMoving);
        continue;
      }

      if (
        wasOccupation &&
        targetProv &&
        targetProv.id === army.targetProvinceId &&
        targetProv.owner !== army.owner &&
        totalStack(targetProv.garrison) <= 0
      ) {
        captureProvince(state, targetProv, army.owner, army.units);
        continue;
      }
    } else if (state.elapsedSeconds < army.legArrivalAt) {
      stillMoving.push(army);
      continue;
    }

    const arrivedProv = state.provinces[army.toProvinceId];
    if (!arrivedProv) continue;

    const isFinalDestination = arrivedProv.id === army.targetProvinceId;
    const hasMoreLegs = !isFinalDestination && army.currentLegIndex + 1 < army.route.length - 1;

    if (hasMoreLegs) {
      army.currentLegIndex += 1;
      army.startPos = undefined;
      army.fromProvinceId = army.route[army.currentLegIndex];
      army.toProvinceId = army.route[army.currentLegIndex + 1];
      const nextProv = state.provinces[army.toProvinceId];
      if (!nextProv) continue;
      army.isNaval = !army.isAir && !arrivedProv.neighbors.includes(army.toProvinceId);
      army.landingCompleted = false;
      const dur = getLegDurationSeconds(arrivedProv, nextProv, army.units, army.isNaval, army.isAir);
      army.legStartedAt = state.elapsedSeconds;
      army.legArrivalAt = state.elapsedSeconds + dur;
      stillMoving.push(army);
      continue;
    }

    if (!isFinalDestination && army.targetProvinceId) {
      const finalProv = state.provinces[army.targetProvinceId];
      if (finalProv) {
        army.startPos = undefined;
        army.fromProvinceId = arrivedProv.id;
        army.toProvinceId = finalProv.id;
        army.route = [arrivedProv.id, finalProv.id];
        army.currentLegIndex = 0;
        const dur = getLegDurationSeconds(
          arrivedProv,
          finalProv,
          army.units,
          army.isNaval,
          army.isAir
        );
        army.legStartedAt = state.elapsedSeconds;
        army.legArrivalAt = state.elapsedSeconds + dur;
        stillMoving.push(army);
        continue;
      }
    }

    if (arrivedProv.owner === army.owner) {
      addStacks(arrivedProv.garrison, army.units);
      continue;
    }

    const status = getDiplomaticStatus(state, army.owner, arrivedProv.owner);
    if (status === 'alliance') {
      autoReturnArmyFromAlly(state, army, arrivedProv);
      stillMoving.push(army);
      continue;
    }

    if (army.isSubmarineMission && !army.landingCompleted) {
      army.isLandingPhase = true;
      army.isOccupationPhase = false;
      army.landingStartedAt = state.elapsedSeconds;
      army.landingEndsAt = state.elapsedSeconds + GAME_CONFIG.submarineLandingSeconds;
      if (!army.detectedBy) army.detectedBy = [];
      if (!army.detectedBy.includes(arrivedProv.owner)) {
        army.detectedBy.push(arrivedProv.owner);
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

    setDiplomaticStatus(state, army.owner, arrivedProv.owner, 'war');

    // Zone MER : les frégates restent en mer / sur la côte et tirent sans aller à l'intérieur des terres
    if (isFrigateOnlyStack(army.units)) {
      applySpecialStrikeEffects(state, army.units, arrivedProv, army.owner);
      applyDefenseRetaliationDamage(state, arrivedProv, army.units, true);
      if (totalStack(army.units) > 0) {
        autoReturnArmyFromAlly(state, army, arrivedProv);
        stillMoving.push(army);
      }
      continue;
    }

    const isNavalLanding = army.isNaval && !army.isSubmarineMission && !army.isAir;

    if (totalStack(arrivedProv.garrison) <= 0) {
      if (army.isAir) {
        applySpecialStrikeEffects(state, army.units, arrivedProv, army.owner);
        applyDefenseRetaliationDamage(state, arrivedProv, army.units, false);
        if (totalStack(army.units) > 0) {
          autoReturnArmyFromAlly(state, army, arrivedProv);
          stillMoving.push(army);
        }
      } else {
        army.isLandingPhase = false;
        army.isOccupationPhase = true;
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
      }
      continue;
    }

    const existing = state.battles.find(
      (b) => !b.isFieldClash && b.provinceId === arrivedProv.id && b.attacker === army.owner
    );
    if (existing) {
      addStacks(existing.attackerUnits, army.units);
      if (isNavalLanding) existing.isNavalStrike = true;
    } else {
      state.battles.push({
        id: createId('bat'),
        provinceId: arrivedProv.id,
        attacker: army.owner,
        defender: arrivedProv.owner,
        attackerUnits: cloneStack(army.units),
        defenderUnits: cloneStack(arrivedProv.garrison),
        startedAt: state.elapsedSeconds,
        lastTickAt: state.elapsedSeconds,
        isAirStrike: army.isAir,
        isNavalStrike: isNavalLanding,
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

  const ongoingBattles: ActiveBattle[] = [];
  for (const battle of state.battles) {
    if (battle.isFieldClash) {
      const attArmy = state.movingArmies.find((a) => a.id === battle.attackerArmyId);
      const defArmy = state.movingArmies.find((a) => a.id === battle.defenderArmyId);

      const aAliveBefore = Boolean(attArmy && totalStack(attArmy.units) > 0);
      const bAliveBefore = Boolean(defArmy && totalStack(defArmy.units) > 0);

      if (!aAliveBefore || !bAliveBefore) {
        if (aAliveBefore && attArmy) resumeArmyAfterClash(state, attArmy);
        if (bAliveBefore && defArmy) resumeArmyAfterClash(state, defArmy);
        state.movingArmies = state.movingArmies.filter((a) => totalStack(a.units) > 0);
        continue;
      }

      if (state.elapsedSeconds - battle.lastTickAt < GAME_CONFIG.combatTickSeconds) {
        battle.attackerUnits = cloneStack(attArmy!.units);
        battle.defenderUnits = cloneStack(defArmy!.units);
        ongoingBattles.push(battle);
        continue;
      }

      battle.lastTickAt = state.elapsedSeconds;

      const powerA = computeFieldClashPower(state, attArmy!.owner, attArmy!.units, defArmy!.units);
      const powerB = computeFieldClashPower(state, defArmy!.owner, defArmy!.units, attArmy!.units);

      applyDamageToStack(defArmy!.units, powerA * (0.9 + Math.random() * 0.25));
      applyDamageToStack(attArmy!.units, powerB * (0.9 + Math.random() * 0.25));

      battle.attackerUnits = cloneStack(attArmy!.units);
      battle.defenderUnits = cloneStack(defArmy!.units);

      const aAlive = totalStack(attArmy!.units) > 0;
      const bAlive = totalStack(defArmy!.units) > 0;

      if (aAlive && bAlive) {
        ongoingBattles.push(battle);
      } else {
        if (aAlive && attArmy) resumeArmyAfterClash(state, attArmy);
        if (bAlive && defArmy) resumeArmyAfterClash(state, defArmy);
        state.movingArmies = state.movingArmies.filter((a) => totalStack(a.units) > 0);

        if (attArmy!.owner === state.playerNationId || defArmy!.owner === state.playerNationId) {
          pushTelegram(
            state,
            aAlive
              ? `Escarmouche remportée : vos troupes reprennent leur marche.`
              : `Escarmouche perdue en route.`,
            aAlive ? 'info' : 'danger',
            battle.provinceId
          );
        }
      }
      continue;
    }

    const prov = state.provinces[battle.provinceId];
    if (!prov) continue;

    battle.defenderUnits = cloneStack(prov.garrison);
    if (prov.owner === battle.attacker) continue;

    if (totalStack(battle.attackerUnits) <= 0 || totalStack(prov.garrison) <= 0) {
      if (totalStack(battle.attackerUnits) > 0 && totalStack(prov.garrison) <= 0) {
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

    const attPower = computeStackPower(
      state,
      battle.attacker,
      battle.attackerUnits,
      prov.garrison,
      prov,
      false,
      Boolean(battle.isNavalStrike)
    );
    const defPower = computeStackPower(
      state,
      battle.defender,
      prov.garrison,
      battle.attackerUnits,
      prov,
      true,
      false
    );

    applyDamageToStack(prov.garrison, attPower * (0.9 + Math.random() * 0.25));
    applyDamageToStack(battle.attackerUnits, defPower * (0.9 + Math.random() * 0.25));
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

    const allowedDefs: DefenseType[] = ['trenches', 'bunkers', 'naval_defense'];
    for (const def of allowedDefs) {
      if (targetProv.defenses[def] > 0 && Math.random() < 0.45) {
        applyDefenseWeakness(targetProv, def, now);
      }
    }
  }

  if ((attackerUnits.frigate ?? 0) > 0 && isCoastalProvince(targetProv)) {
    const allowedDefs: DefenseType[] = ['trenches', 'bunkers', 'aa_defense'];
    for (const def of allowedDefs) {
      if (targetProv.defenses[def] > 0 && Math.random() < 0.45) {
        applyDefenseWeakness(targetProv, def, now);
      }
    }
  }
}