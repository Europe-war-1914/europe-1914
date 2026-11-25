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
} from './types';

export function totalStack(stack: UnitStack): number {
  let sum = 0;
  for (const t of UNIT_ORDER) sum += stack[t] ?? 0;
  return sum;
}

export function addStacks(target: UnitStack, addition: UnitStack): void {
  for (const t of UNIT_ORDER) {
    target[t] = (target[t] ?? 0) + (addition[t] ?? 0);
  }
}

export function cloneStack(stack: UnitStack): UnitStack {
  return {
    light_tank: stack.light_tank ?? 0,
    heavy_tank: stack.heavy_tank ?? 0,
    scout: stack.scout ?? 0,
    soldier: stack.soldier ?? 0,
    bomber: stack.bomber ?? 0,
    fighter: stack.fighter ?? 0,
    submarine: stack.submarine ?? 0,
    frigate: stack.frigate ?? 0,
  };
}

export function isCoastalProvince(prov: Province): boolean {
  return prov.terrain === 'coastal' || prov.seaNeighbors.length > 0;
}

function isPureAviation(stack: UnitStack): boolean {
  const air = stack.bomber + stack.fighter;
  return air > 0 && air === totalStack(stack);
}

function isPureNaval(stack: UnitStack): boolean {
  const nav = stack.submarine + stack.frigate;
  return nav > 0 && nav === totalStack(stack);
}

function distBetween(a: Province, b: Province): number {
  return Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
}

/** Calcul de trajectoire longue distance (provinces possédées ou traversée maritime) */
export function findArmyRoute(
  state: GameState,
  owner: NationId,
  fromId: string,
  targetId: string,
  units: UnitStack
): { route: string[]; isAir: boolean; isSubmarineMission: boolean } | null {
  const from = state.provinces[fromId];
  const target = state.provinces[targetId];
  if (!from || !target || fromId === targetId) return null;

  // 1. Escadrille aérienne : trajet direct vers n'importe quelle province
  if (isPureAviation(units)) {
    return { route: [fromId, targetId], isAir: true, isSubmarineMission: false };
  }

  // 2. Sous-marin : peut aller n'importe où sur les côtes (débarquement furtif 10 s)
  if (units.submarine > 0 && isCoastalProvince(from) && isCoastalProvince(target)) {
    return { route: [fromId, targetId], isAir: false, isSubmarineMission: true };
  }

  // 3. Dijkstra sur le graphe (provinces alliées/possédées + liaisons maritimes)
  const navalOnly = isPureNaval(units);
  const allCoastalIds = Object.values(state.provinces)
    .filter((p) => isCoastalProvince(p))
    .map((p) => p.id);

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

    // On ne traverse pas une province hostile intermédiaire sans s'y arrêter
    if (currentId !== fromId && curr.owner !== owner) continue;

    const candidates: { id: string; weight: number }[] = [];

    if (!navalOnly) {
      for (const nId of curr.neighbors) {
        const nb = state.provinces[nId];
        if (!nb) continue;
        if (nId !== targetId && nb.owner !== owner) continue;
        candidates.push({ id: nId, weight: distBetween(curr, nb) });
      }
    }

    // Traversées maritimes directes (voisins maritimes + accès mer à n'importe quelle côte)
    if (isCoastalProvince(curr)) {
      const seaSet = new Set(curr.seaNeighbors);
      for (const nId of curr.seaNeighbors) {
        const nb = state.provinces[nId];
        if (!nb) continue;
        if (nId !== targetId && nb.owner !== owner) continue;
        candidates.push({ id: nId, weight: distBetween(curr, nb) * 1.25 });
      }
      // Traversée libre entre côtes (armée de terre ou frégates)
      for (const coastId of allCoastalIds) {
        if (coastId === currentId || seaSet.has(coastId)) continue;
        const nb = state.provinces[coastId];
        if (!nb) continue;
        if (coastId !== targetId && nb.owner !== owner) continue;
        candidates.push({ id: coastId, weight: distBetween(curr, nb) * 1.45 });
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

  return { route, isAir: false, isSubmarineMission: false };
}

export function getLegDurationSeconds(
  from: Province,
  to: Province,
  units: UnitStack,
  isNaval: boolean,
  isAir: boolean
): number {
  let slowest = 0;
  for (const type of UNIT_ORDER) {
    if (units[type] <= 0) continue;
    if (UNIT_SPECS[type].travelSeconds > slowest) {
      slowest = UNIT_SPECS[type].travelSeconds;
    }
  }
  if (slowest === 0) slowest = UNIT_SPECS.soldier.travelSeconds;

  // Ajuste la durée à la distance géographique réelle sur la carte (~140 px = 1 étape standard)
  const distFactor = Math.max(0.65, distBetween(from, to) / 145);
  const modeMult = isAir ? 0.55 : isNaval ? 1.15 : 1.0;

  return Math.max(8, Math.round(slowest * distFactor * modeMult));
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

  // Impossible d'envoyer volontairement une armée se donner à un allié
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

  // Si on envoie des navires sur un trajet purement terrestre non côtier
  if (
    (send.frigate > 0 || send.submarine > 0) &&
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
    return { ok: false, reason: 'Aucune trajectoire terrestre ou maritime disponible.' };
  }

  // Déduit de la garnison de départ
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
    detectedBy: [],
    isReturning: false,
  });

  if (owner === state.playerNationId && state.tutorialStep > 0) {
    state.tutorialStep = 0;
  }

  return { ok: true };
}

/** Permet de faire demi-tour à une armée déjà envoyée (depuis sa position actuelle) */
export function orderTurnAround(
  state: GameState,
  owner: NationId,
  armyId: string
): { ok: boolean; reason?: string } {
  const army = state.movingArmies.find((a) => a.id === armyId);
  if (!army || army.owner !== owner) {
    return { ok: false, reason: 'Armée en mouvement introuvable.' };
  }

  const now = state.elapsedSeconds;
  const totalLeg = Math.max(1, army.legArrivalAt - army.legStartedAt);
  const progress = Math.min(1, Math.max(0.05, (now - army.legStartedAt) / totalLeg));

  // Annule un débarquement 10 s si en cours
  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;

  const oldFrom = army.fromProvinceId;
  const oldTo = army.toProvinceId;

  // Chemin de retour vers la province d'origine (ou la province précédente si l'origine est tombée)
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
  const returnRoute =
    reversePrefix[reversePrefix.length - 1] === returnDestination
      ? [oldTo, ...reversePrefix]
      : [oldTo, returnDestination];

  army.fromProvinceId = oldTo;
  army.toProvinceId = returnRoute[1];
  army.targetProvinceId = returnDestination;
  army.route = returnRoute;
  army.currentLegIndex = 0;
  army.isReturning = true;
  army.legStartedAt = now;
  army.legArrivalAt = now + Math.max(4, Math.round(totalLeg * progress));

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
  const dur = Math.max(8, Math.round(getLegDurationSeconds(prov, fallback, battle.attackerUnits, isNaval, isAir) * 0.7));

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
    pushTelegram(state, `Retraite ordonnée depuis ${prov.name} vers ${fallback.name}.`, 'warning', fallback.id);
  }

  return { ok: true };
}

/** Niveau effectif d'une défense en tenant compte des affaiblissements temporaires (2 min) */
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
  // Affaiblissement temporaire : réduit fortement la défense pendant 2 minutes (-2 niveaux)
  return weakened ? Math.max(0, base - 2) : base;
}

/** Applique un affaiblissement temporaire de 2 minutes sur une défense */
function applyDefenseWeakness(
  province: Province,
  defense: DefenseType,
  now: number
): boolean {
  if (province.defenses[defense] <= 0) return false;
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
  isDefender: boolean
): number {
  const nation = state.nations[owner];
  const terrain = TERRAIN_MODIFIERS[province.terrain];
  const enemyAirCount = enemyStack.bomber + enemyStack.fighter;
  let power = 0;

  for (const type of UNIT_ORDER) {
    const qty = stack[type];
    if (qty <= 0) continue;

    const spec = UNIT_SPECS[type];
    let unitPower = isDefender ? spec.defense : spec.attack;

    // Bonus technologique de la branche Armée (+20 % par niveau)
    const techLvl = nation ? nation.techLevels[spec.armyTechAxis] ?? 0 : 0;
    unitPower *= 1 + techLvl * 0.2;

    // Bonus de terrain pour les blindés
    if (!isDefender && spec.category === 'armor') {
      unitPower *= terrain.tankAttackMult;
    }

    // Chasseurs : spécialisés dans les combats aériens
    if (type === 'fighter' && enemyAirCount > 0) {
      unitPower *= 2.1;
    }

    // Contres défensifs (50 % / 75 % / 100 % avec minimum symbolique au niveau 3)
    if (!isDefender) {
      const defLvl = getEffectiveDefenseLevel(province, spec.counteredBy, state.elapsedSeconds);
      const reduction = DEFENSE_COUNTER_REDUCTION[defLvl] ?? 0;
      unitPower *= 1 - reduction;
    }

    power += qty * unitPower;
  }

  if (isDefender) {
    power *= terrain.defenseBonus;
  }

  return power;
}

function applyDamageToStack(stack: UnitStack, damage: number): void {
  let remaining = damage;
  for (const type of UNIT_ORDER) {
    if (remaining <= 0) break;
    const qty = stack[type];
    if (qty <= 0) continue;
    const unitHp = UNIT_SPECS[type].hp;
    const kills = Math.min(qty, Math.floor(remaining / unitHp));
    if (kills > 0) {
      stack[type] -= kills;
      remaining -= kills * unitHp;
    } else if (remaining >= unitHp * 0.4 && Math.random() < remaining / unitHp) {
      stack[type] -= 1;
      remaining = 0;
    }
  }
}

/**
 * Élimination totale d'une nation à la chute de sa capitale :
 * - Annexion automatique de toutes ses provinces par le conquérant
 * - Disparition de toutes ses troupes
 * - Usines d'extraction remises au niveau 1
 * - Laboratoire de la capitale détruit
 * - Points Technologiques accordés UNIQUEMENT au conquérant de la capitale
 */
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

  // 1. Disparition de toutes les troupes, chantiers, recrutements, batailles et offres du perdant
  state.movingArmies = state.movingArmies.filter((a) => a.owner !== loserId);
  state.constructions = state.constructions.filter((c) => c.owner !== loserId);
  state.recruitments = state.recruitments.filter((r) => r.owner !== loserId);
  state.battles = state.battles.filter((b) => b.attacker !== loserId && b.defender !== loserId);
  state.pendingOffers = state.pendingOffers.filter((o) => o.from !== loserId && o.to !== loserId);

  // 2. Bonus de Points Technologiques UNIQUEMENT pour le conquérant de la capitale
  let gainedTp = 0;
  if (conquerorId && conquerorId !== 'neutral' && state.nations[conquerorId]) {
    gainedTp =
      GAME_CONFIG.capitalCaptureTechBonus +
      Math.round(loser.techPoints * GAME_CONFIG.capitalCaptureTechStealRatio);
    state.nations[conquerorId].techPoints += gainedTp;
  }
  loser.techPoints = 0;

  // 3. Annexion de tout le territoire par le conquérant, usines -> niv. 1, labo détruit, troupes effacées
  const newOwner: NationId = conquerorId && conquerorId !== 'neutral' ? conquerorId : 'neutral';
  for (const prov of Object.values(state.provinces)) {
    if (prov.owner !== loserId) continue;

    prov.owner = newOwner;
    prov.isCapital = false;
    prov.hasLaboratory = false;
    prov.laboratoryLevel = 0;
    prov.garrison = createEmptyStack();

    // Toutes les usines d'extraction construites reviennent au niveau 1
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
  // Si c'était une capitale, le laboratoire est détruit
  if (wasCapital) {
    prov.hasLaboratory = false;
    prov.laboratoryLevel = 0;
  }
  prov.garrison = cloneStack(survivors);

  // Les usines de la capitale/province conquise reviennent au niveau 1 si > 1
  if (wasCapital) {
    (['gas', 'steel', 'gold'] as ExtractionResource[]).forEach((res) => {
      if (prov.extractionFactories[res] > 1) {
        prov.extractionFactories[res] = 1;
      }
    });
  }

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

/** Retourne la position interpolée actuelle d'une armée en mouvement */
export function getMovingArmyWorldPos(state: GameState, army: MovingArmy): [number, number] {
  const from = state.provinces[army.fromProvinceId];
  const to = state.provinces[army.toProvinceId];
  if (!from || !to) return [0, 0];
  if (army.landingStartedAt !== undefined) {
    return [to.center[0], to.center[1]];
  }
  const dur = Math.max(1, army.legArrivalAt - army.legStartedAt);
  const t = Math.min(1, Math.max(0, (state.elapsedSeconds - army.legStartedAt) / dur));
  return [
    from.center[0] + (to.center[0] - from.center[0]) * t,
    from.center[1] + (to.center[1] - from.center[1]) * t,
  ];
}

/** Intercepte sous-marins et troupes terrestres en mer face aux frégates ennemies */
function tickNavalInterceptions(state: GameState): void {
  const navalArmies = state.movingArmies.filter(
    (a) => (a.isNaval || a.isSubmarineMission) && !a.isAir
  );

  // Frégates en mouvement
  const movingFrigates = navalArmies.filter((a) => a.units.frigate > 0);

  for (const army of navalArmies) {
    if (totalStack(army.units) <= 0) continue;
    const pos = getMovingArmyWorldPos(state, army);
    const targetProv = state.provinces[army.toProvinceId];

    // 1. Détection d'un sous-marin par défenses marines sur la côte ciblée
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

    // 2. Interception par frégates ennemies sur le chemin (en mer)
    for (const frigArmy of movingFrigates) {
      if (frigArmy.owner === army.owner) continue;
      if (getDiplomaticStatus(state, army.owner, frigArmy.owner) === 'alliance') continue;
      const fPos = getMovingArmyWorldPos(state, frigArmy);
      if (Math.hypot(pos[0] - fPos[0], pos[1] - fPos[1]) > 75) continue;

      if (army.isSubmarineMission) {
        if (!army.detectedBy) army.detectedBy = [];
        if (!army.detectedBy.includes(frigArmy.owner)) army.detectedBy.push(frigArmy.owner);
        // La frégate détruit les sous-marins sur son chemin
        const dmg = frigArmy.units.frigate * 38;
        applyDamageToStack(army.units, dmg);
        if (army.owner === state.playerNationId || frigArmy.owner === state.playerNationId) {
          pushTelegram(
            state,
            `Interception navale : frégates de ${NATION_TEMPLATES[frigArmy.owner].shortName} contre sous-marins de ${NATION_TEMPLATES[army.owner].shortName} !`,
            'warning'
          );
        }
      } else if (army.units.frigate === 0) {
        // Armée de terre en mer sans escorte = très vulnérable face aux frégates
        const dmg = frigArmy.units.frigate * 45;
        applyDamageToStack(army.units, dmg);
      }
    }

    // 3. Interception par frégates ennemies stationnées sur la côte cible
    if (
      targetProv &&
      targetProv.owner !== army.owner &&
      getDiplomaticStatus(state, army.owner, targetProv.owner) !== 'alliance' &&
      targetProv.garrison.frigate > 0 &&
      Math.hypot(pos[0] - targetProv.center[0], pos[1] - targetProv.center[1]) < 65
    ) {
      if (army.isSubmarineMission) {
        if (!army.detectedBy) army.detectedBy = [];
        if (!army.detectedBy.includes(targetProv.owner)) army.detectedBy.push(targetProv.owner);
        applyDamageToStack(army.units, targetProv.garrison.frigate * 28);
      } else if (army.units.frigate === 0) {
        applyDamageToStack(army.units, targetProv.garrison.frigate * 34);
      }
    }
  }

  state.movingArmies = state.movingArmies.filter((a) => totalStack(a.units) > 0);
}

/** Retourne l'armée automatiquement vers son origine (anti-don d'armée aux alliés) */
function autoReturnArmyFromAlly(state: GameState, army: MovingArmy, allyProv: Province): void {
  const destId =
    state.provinces[army.originProvinceId]?.owner === army.owner
      ? army.originProvinceId
      : Object.values(state.provinces).find((p) => p.owner === army.owner)?.id;

  if (!destId) return;

  const destProv = state.provinces[destId];
  const isNaval = !army.isAir && !allyProv.neighbors.includes(destId);
  const dur = getLegDurationSeconds(allyProv, destProv, army.units, isNaval, army.isAir);

  army.fromProvinceId = allyProv.id;
  army.toProvinceId = destId;
  army.targetProvinceId = destId;
  army.route = [allyProv.id, destId];
  army.currentLegIndex = 0;
  army.isNaval = isNaval;
  army.isSubmarineMission = false;
  army.landingStartedAt = undefined;
  army.landingEndsAt = undefined;
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

export function tickMovementsAndCombat(state: GameState): void {
  // Interceptions maritimes (toutes les ~3 s via le rythme de combat)
  if (Math.floor(state.elapsedSeconds) % 3 === 0) {
    tickNavalInterceptions(state);
  }

  const stillMoving: MovingArmy[] = [];

  for (const army of state.movingArmies) {
    if (totalStack(army.units) <= 0) continue;

    // Gestion du débarquement sous-marin de 10 secondes (avec alerte au défenseur)
    if (army.landingStartedAt !== undefined && army.landingEndsAt !== undefined) {
      if (state.elapsedSeconds < army.landingEndsAt) {
        stillMoving.push(army);
        continue;
      }
      // Débarquement terminé -> suite du traitement d'arrivée
      army.landingStartedAt = undefined;
      army.landingEndsAt = undefined;
    } else if (state.elapsedSeconds < army.legArrivalAt) {
      stillMoving.push(army);
      continue;
    }

    const arrivedProv = state.provinces[army.toProvinceId];
    if (!arrivedProv) continue;

    // Si ce n'est pas encore la destination finale, passer au tronçon suivant
    const hasMoreLegs = army.currentLegIndex + 1 < army.route.length - 1;
    if (hasMoreLegs && arrivedProv.owner === army.owner) {
      army.currentLegIndex += 1;
      army.fromProvinceId = army.route[army.currentLegIndex];
      army.toProvinceId = army.route[army.currentLegIndex + 1];
      const nextProv = state.provinces[army.toProvinceId];
      if (!nextProv) continue;
      army.isNaval = !army.isAir && !arrivedProv.neighbors.includes(army.toProvinceId);
      const dur = getLegDurationSeconds(arrivedProv, nextProv, army.units, army.isNaval, army.isAir);
      army.legStartedAt = state.elapsedSeconds;
      army.legArrivalAt = state.elapsedSeconds + dur;
      stillMoving.push(army);
      continue;
    }

    // Arrivée sur sa propre province -> renfort normal
    if (arrivedProv.owner === army.owner) {
      addStacks(arrivedProv.garrison, army.units);
      continue;
    }

    // Arrivée sur une province d'un ALLIÉ -> PLUS DE DON D'ARMÉE : retour automatique !
    const status = getDiplomaticStatus(state, army.owner, arrivedProv.owner);
    if (status === 'alliance') {
      autoReturnArmyFromAlly(state, army, arrivedProv);
      stillMoving.push(army);
      continue;
    }

    // Déclenche le débarquement de 10 s si c'est un sous-marin qui arrive sur une côte hostile
    if (army.isSubmarineMission && army.landingStartedAt === undefined) {
      army.landingStartedAt = state.elapsedSeconds;
      army.landingEndsAt = state.elapsedSeconds + GAME_CONFIG.submarineLandingSeconds;
      if (!army.detectedBy) army.detectedBy = [];
      if (!army.detectedBy.includes(arrivedProv.owner)) {
        army.detectedBy.push(arrivedProv.owner);
      }

      if (
        arrivedProv.owner === state.playerNationId ||
        army.owner === state.playerNationId
      ) {
        pushTelegram(
          state,
          `ALERTE DÉBARQUEMENT (10 s) : sous-marins de ${NATION_TEMPLATES[army.owner].shortName} sur les côtes de ${arrivedProv.name} !`,
          arrivedProv.owner === state.playerNationId ? 'danger' : 'warning',
          arrivedProv.id
        );
      }
      stillMoving.push(army);
      continue;
    }

    // Passage en guerre
    setDiplomaticStatus(state, army.owner, arrivedProv.owner, 'war');

    // Si garnison vide -> capture (sauf si escadrille purement aérienne qui ne peut pas occuper au sol)
    if (totalStack(arrivedProv.garrison) <= 0) {
      if (army.isAir) {
        // Les bombardiers frappent les infrastructures puis rentrent à leur base
        applySpecialStrikeEffects(state, army.units, arrivedProv, army.owner);
        autoReturnArmyFromAlly(state, army, arrivedProv);
        stillMoving.push(army);
      } else {
        captureProvince(state, arrivedProv, army.owner, army.units);
      }
      continue;
    }

    // Sinon engage ou renforce la bataille
    const existing = state.battles.find(
      (b) => b.provinceId === arrivedProv.id && b.attacker === army.owner
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
        startedAt: state.elapsedSeconds,
        lastTickAt: state.elapsedSeconds,
        isAirStrike: army.isAir,
        isNavalStrike: army.isNaval,
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

  // Résolution des batailles toutes les 3 secondes
  const ongoingBattles: ActiveBattle[] = [];
  for (const battle of state.battles) {
    const prov = state.provinces[battle.provinceId];
    if (!prov) continue;

    battle.defenderUnits = prov.garrison;
    if (prov.owner === battle.attacker) continue;

    if (state.elapsedSeconds - battle.lastTickAt < GAME_CONFIG.combatTickSeconds) {
      ongoingBattles.push(battle);
      continue;
    }

    battle.lastTickAt = state.elapsedSeconds;

    // Effets spéciaux Bombardiers (usines + défenses sauf DCA) et Frégates (défenses sauf anti-marines)
    applySpecialStrikeEffects(state, battle.attackerUnits, prov, battle.attacker);

    const attPower = computeStackPower(
      state,
      battle.attacker,
      battle.attackerUnits,
      prov.garrison,
      prov,
      false
    );
    const defPower = computeStackPower(
      state,
      battle.defender,
      prov.garrison,
      battle.attackerUnits,
      prov,
      true
    );

    applyDamageToStack(prov.garrison, attPower * (0.85 + Math.random() * 0.3));
    applyDamageToStack(battle.attackerUnits, defPower * (0.85 + Math.random() * 0.3));

    const attAlive = totalStack(battle.attackerUnits) > 0;
    const defAlive = totalStack(prov.garrison) > 0;

    if (attAlive && !defAlive) {
      if (isPureAviation(battle.attackerUnits)) {
        // Les avions rentrent après avoir détruit la garnison
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

/**
 * Effets spéciaux :
 * - Bombardier : détruit les usines et affaiblit les défenses (2 min), SAUF aa_defense
 * - Frégate : affaiblit les défenses côtières (2 min), SAUF naval_defense
 */
function applySpecialStrikeEffects(
  state: GameState,
  attackerUnits: UnitStack,
  targetProv: Province,
  attackerId: NationId
): void {
  const now = state.elapsedSeconds;

  if (attackerUnits.bomber > 0) {
    // 1. Destruction d'usines d'extraction
    const factoryChance = Math.min(0.45, attackerUnits.bomber * 0.14);
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

    // 2. Affaiblissement temporaire (2 min) de toutes les défenses SAUF aa_defense
    const allowedDefs: DefenseType[] = ['trenches', 'bunkers', 'naval_defense'];
    for (const def of allowedDefs) {
      if (targetProv.defenses[def] > 0 && Math.random() < 0.45) {
        applyDefenseWeakness(targetProv, def, now);
      }
    }
  }

  if (attackerUnits.frigate > 0 && isCoastalProvince(targetProv)) {
    // Affaiblissement temporaire (2 min) des défenses côtières SAUF naval_defense
    const allowedDefs: DefenseType[] = ['trenches', 'bunkers', 'aa_defense'];
    for (const def of allowedDefs) {
      if (targetProv.defenses[def] > 0 && Math.random() < 0.45) {
        applyDefenseWeakness(targetProv, def, now);
      }
    }
  }
}