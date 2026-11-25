import { BLITZ_CONFIG, TERRAIN_MODIFIERS, UNIT_SPECS } from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import { createId, pushTelegram } from './economy';
import type {
  ActiveBattle,
  DiplomaticStatus,
  GameState,
  NationId,
  Province,
  UnitStack,
  UnitType,
} from './types';

const UNIT_ORDER: UnitType[] = ['infantry', 'tank', 'artillery', 'battleship'];

export function diplomacyKey(a: NationId, b: NationId): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function getDiplomaticStatus(
  state: GameState,
  a: NationId,
  b: NationId
): DiplomaticStatus {
  if (a === b) return 'alliance';
  if (a === 'neutral' || b === 'neutral') return 'neutral';
  return state.diplomacy[diplomacyKey(a, b)] ?? 'neutral';
}

export function setDiplomaticStatus(
  state: GameState,
  a: NationId,
  b: NationId,
  status: DiplomaticStatus
): void {
  if (a === b || a === 'neutral' || b === 'neutral') return;
  state.diplomacy[diplomacyKey(a, b)] = status;
}

export function totalStack(stack: UnitStack): number {
  return stack.infantry + stack.tank + stack.artillery + stack.battleship;
}

export function addStacks(target: UnitStack, addition: UnitStack): void {
  target.infantry += addition.infantry;
  target.tank += addition.tank;
  target.artillery += addition.artillery;
  target.battleship += addition.battleship;
}

export function cloneStack(stack: UnitStack): UnitStack {
  return {
    infantry: stack.infantry,
    tank: stack.tank,
    artillery: stack.artillery,
    battleship: stack.battleship,
  };
}

export function getTravelDurationSeconds(
  state: GameState,
  owner: NationId,
  from: Province,
  units: UnitStack,
  isNaval: boolean,
  to?: Province
): number {
  const nation = state.nations[owner];
  const lowOil = nation ? nation.resources.oil < 5 : false;

  let slowest = 0;
  for (const type of UNIT_ORDER) {
    if (units[type] <= 0) continue;
    let base = UNIT_SPECS[type].travelSeconds;
    // Sans pétrole, les chars et cuirassés perdent leur avantage de vitesse
    if (lowOil && UNIT_SPECS[type].usesOil) {
      base = Math.max(base, UNIT_SPECS.infantry.travelSeconds);
    }
    if (base > slowest) slowest = base;
  }

  if (slowest === 0) slowest = UNIT_SPECS.infantry.travelSeconds;

  // Bonus des voies ferrées / port au départ (+30 % / niv.) et à l'arrivée (+15 % / niv. si allié)
  const destRailBonus =
    to && (to.owner === owner || getDiplomaticStatus(state, owner, to.owner) === 'alliance')
      ? to.buildings.railway * 0.15
      : 0;
  const railMultiplier = 1 / (1 + from.buildings.railway * 0.3 + destRailBonus);

  // Traversée maritime légèrement plus longue sans escorte de cuirassé
  const navalMultiplier = isNaval ? (units.battleship > 0 ? 1.05 : 1.3) : 1.0;

  return Math.max(12, Math.round(slowest * railMultiplier * navalMultiplier));
}

export function orderMoveArmy(
  state: GameState,
  owner: NationId,
  fromId: string,
  toId: string,
  requestedUnits: UnitStack
): { ok: boolean; reason?: string } {
  const from = state.provinces[fromId];
  const to = state.provinces[toId];
  if (!from || !to || from.owner !== owner) {
    return { ok: false, reason: 'Province de départ invalide.' };
  }

  const isLandNeighbor = from.neighbors.includes(toId);
  const isSeaNeighbor = from.seaNeighbors.includes(toId);
  if (!isLandNeighbor && !isSeaNeighbor) {
    return { ok: false, reason: 'La cible n’est pas reliée à cette province.' };
  }

  const isHostileTarget =
    to.owner !== owner && getDiplomaticStatus(state, owner, to.owner) !== 'alliance';

  if (state.phase === 'MOBILIZATION' && isHostileTarget) {
    return {
      ok: false,
      reason: 'Phase de mobilisation en cours : redéployez vos troupes chez vous avant la guerre.',
    };
  }

  if (getDiplomaticStatus(state, owner, to.owner) === 'nap') {
    return { ok: false, reason: 'Un pacte de non-agression bloque cette attaque.' };
  }

  const send: UnitStack = {
    infantry: Math.min(from.garrison.infantry, Math.max(0, Math.floor(requestedUnits.infantry))),
    tank: Math.min(from.garrison.tank, Math.max(0, Math.floor(requestedUnits.tank))),
    artillery: Math.min(from.garrison.artillery, Math.max(0, Math.floor(requestedUnits.artillery))),
    battleship: Math.min(
      from.garrison.battleship,
      Math.max(0, Math.floor(requestedUnits.battleship))
    ),
  };

  if (totalStack(send) <= 0) {
    return { ok: false, reason: 'Aucune troupe sélectionnée.' };
  }

  // Les cuirassés ne peuvent se déplacer que par liaison maritime
  const isNaval = !isLandNeighbor && isSeaNeighbor;
  if (!isNaval && send.battleship > 0) {
    send.battleship = 0;
    if (totalStack(send) <= 0) {
      return { ok: false, reason: 'Les cuirassés ne peuvent emprunter que les routes maritimes.' };
    }
  }

  // Consommation légère de pétrole au départ des blindés / navires
  const nation = state.nations[owner];
  if (nation) {
    const oilCost = send.tank * 3 + send.battleship * 5;
    nation.resources.oil = Math.max(0, nation.resources.oil - oilCost);
  }

  from.garrison.infantry -= send.infantry;
  from.garrison.tank -= send.tank;
  from.garrison.artillery -= send.artillery;
  from.garrison.battleship -= send.battleship;

  const duration = getTravelDurationSeconds(state, owner, from, send, isNaval, to);
  state.movingArmies.push({
    id: createId('mov'),
    owner,
    fromProvinceId: fromId,
    toProvinceId: toId,
    units: send,
    startedAt: state.elapsedSeconds,
    arrivalAt: state.elapsedSeconds + duration,
    isNaval,
  });

  if (owner === state.playerNationId && state.tutorialStep === 4) {
    state.tutorialStep = 0;
  }

  return { ok: true };
}

export function orderArtilleryBombardment(
  state: GameState,
  owner: NationId,
  fromId: string,
  targetId: string
): { ok: boolean; reason?: string } {
  if (state.phase === 'MOBILIZATION') {
    return { ok: false, reason: 'Bombardement interdit pendant la phase de mobilisation.' };
  }
  const from = state.provinces[fromId];
  const target = state.provinces[targetId];
  if (!from || !target || from.owner !== owner) {
    return { ok: false, reason: 'Province source invalide.' };
  }
  if (from.garrison.artillery <= 0) {
    return { ok: false, reason: 'Aucune artillerie disponible dans cette province.' };
  }
  const isAdjacent = from.neighbors.includes(targetId) || from.seaNeighbors.includes(targetId);
  if (!isAdjacent) {
    return { ok: false, reason: 'La cible doit être adjacente.' };
  }
  if (target.owner === owner || getDiplomaticStatus(state, owner, target.owner) === 'alliance') {
    return { ok: false, reason: 'Impossible de bombarder un allié.' };
  }

  const existing = state.battles.find(
    (b) => b.provinceId === targetId && b.attacker === owner && b.isBombardment
  );
  if (existing) {
    return { ok: false, reason: 'Cette province est déjà sous votre pilonnage.' };
  }

  setDiplomaticStatus(state, owner, target.owner, 'war');

  state.battles.push({
    id: createId('bmb'),
    provinceId: targetId,
    attacker: owner,
    defender: target.owner,
    attackerUnits: {
      infantry: 0,
      tank: 0,
      artillery: from.garrison.artillery,
      battleship: 0,
    },
    defenderUnits: cloneStack(target.garrison),
    startedAt: state.elapsedSeconds,
    lastTickAt: state.elapsedSeconds,
    isBombardment: true,
  });

  if (owner === state.playerNationId || target.owner === state.playerNationId) {
    pushTelegram(
      state,
      `Pilonnage d'artillerie sur ${target.name} (${NATION_TEMPLATES[owner].shortName}).`,
      target.owner === state.playerNationId ? 'danger' : 'warning',
      target.id
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

  if (battle.isBombardment) {
    state.battles.splice(idx, 1);
    return { ok: true };
  }

  const prov = state.provinces[battle.provinceId];
  const fallbackId = [...prov.neighbors, ...prov.seaNeighbors].find(
    (nId) => state.provinces[nId]?.owner === nationId
  );
  if (!fallbackId) {
    return { ok: false, reason: 'Aucune province alliée adjacente pour la retraite.' };
  }

  const fallback = state.provinces[fallbackId];
  state.movingArmies.push({
    id: createId('ret'),
    owner: nationId,
    fromProvinceId: prov.id,
    toProvinceId: fallback.id,
    units: cloneStack(battle.attackerUnits),
    startedAt: state.elapsedSeconds,
    arrivalAt: state.elapsedSeconds + 22,
    isNaval: !prov.neighbors.includes(fallbackId),
  });

  state.battles.splice(idx, 1);

  if (nationId === state.playerNationId) {
    pushTelegram(state, `Retraite ordonnée depuis ${prov.name} vers ${fallback.name}.`, 'warning', fallback.id);
  }

  return { ok: true };
}

function computeStackPower(
  stack: UnitStack,
  province: Province,
  isDefender: boolean
): number {
  const terrain = TERRAIN_MODIFIERS[province.terrain];
  let power = 0;

  for (const type of UNIT_ORDER) {
    const qty = stack[type];
    if (qty <= 0) continue;
    const spec = UNIT_SPECS[type];
    let unitPower = isDefender ? spec.defense : spec.attack;

    if (!isDefender && type === 'tank') {
      unitPower *= terrain.tankAttackMult;
    }
    power += qty * unitPower;
  }

  if (isDefender) {
    // Fortification : +35 % de puissance défensive par niveau
    const fortBonus = 1 + province.buildings.fort * 0.35;
    const moraleBonus = 0.75 + (province.morale / 100) * 0.25;
    power *= terrain.defenseBonus * fortBonus * moraleBonus;
  }

  return power;
}

function applyDamageToStack(stack: UnitStack, damage: number): void {
  let remaining = damage;
  // L'infanterie encaisse en premier, puis chars, puis artillerie/cuirassés
  for (const type of UNIT_ORDER) {
    if (remaining <= 0) break;
    const qty = stack[type];
    if (qty <= 0) continue;
    const unitHp = UNIT_SPECS[type].hp;
    const kills = Math.min(qty, Math.floor(remaining / unitHp));
    if (kills > 0) {
      stack[type] -= kills;
      remaining -= kills * unitHp;
    } else if (remaining >= unitHp * 0.45 && Math.random() < remaining / unitHp) {
      stack[type] -= 1;
      remaining = 0;
    }
  }
}

function captureProvince(state: GameState, prov: Province, conqueror: NationId, survivors: UnitStack): void {
  const previousOwner = prov.owner;
  prov.owner = conqueror;
  prov.garrison = cloneStack(survivors);
  prov.morale = 55;
  prov.buildings.fort = Math.max(0, prov.buildings.fort - 1);

  // Annule les chantiers en cours de l'ancien propriétaire dans cette région
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
}

export function tickMovementsAndCombat(state: GameState): void {
  // 1. Résolution des armées arrivées à destination
  const stillMoving = [];
  for (const army of state.movingArmies) {
    if (state.elapsedSeconds < army.arrivalAt) {
      stillMoving.push(army);
      continue;
    }

    const target = state.provinces[army.toProvinceId];
    if (!target) continue;

    const status = getDiplomaticStatus(state, army.owner, target.owner);
    if (target.owner === army.owner || status === 'alliance') {
      addStacks(target.garrison, army.units);
      continue;
    }

    // Déclenche la guerre si attaque d'une autre grande puissance
    setDiplomaticStatus(state, army.owner, target.owner, 'war');

    // Si aucun défenseur présent, capture immédiate
    if (totalStack(target.garrison) <= 0) {
      captureProvince(state, target, army.owner, army.units);
      continue;
    }

    // Rejoint un combat en cours ou en ouvre un nouveau
    const existing = state.battles.find(
      (b) => b.provinceId === target.id && b.attacker === army.owner && !b.isBombardment
    );
    if (existing) {
      addStacks(existing.attackerUnits, army.units);
    } else {
      const battle: ActiveBattle = {
        id: createId('bat'),
        provinceId: target.id,
        attacker: army.owner,
        defender: target.owner,
        attackerUnits: cloneStack(army.units),
        defenderUnits: cloneStack(target.garrison),
        startedAt: state.elapsedSeconds,
        lastTickAt: state.elapsedSeconds,
        isBombardment: false,
      };
      state.battles.push(battle);

      if (army.owner === state.playerNationId || target.owner === state.playerNationId) {
        pushTelegram(
          state,
          `Bataille engagée à ${target.name} (${NATION_TEMPLATES[army.owner].shortName} vs ${NATION_TEMPLATES[target.owner].shortName}) !`,
          target.owner === state.playerNationId ? 'danger' : 'warning',
          target.id
        );
      }
    }
  }
  state.movingArmies = stillMoving;

  // 2. Résolution des combats en cours (1 tick toutes les 3 secondes)
  const ongoingBattles: ActiveBattle[] = [];
  for (const battle of state.battles) {
    const prov = state.provinces[battle.provinceId];
    if (!prov) continue;

    // Synchronise les défenseurs avec d'éventuels renforts arrivés dans la province
    battle.defenderUnits = prov.garrison;

    if (prov.owner === battle.attacker) continue;

    if (state.elapsedSeconds - battle.lastTickAt < BLITZ_CONFIG.combatTickSeconds) {
      ongoingBattles.push(battle);
      continue;
    }

    battle.lastTickAt = state.elapsedSeconds;

    // Casemates & tranchées réduisent de 15 % par niveau les pertes encaissées
    const fortProtection = Math.max(0.45, 1 - prov.buildings.fort * 0.15);

    if (battle.isBombardment) {
      const attPower = computeStackPower(battle.attackerUnits, prov, false) * 0.7 * fortProtection;
      applyDamageToStack(prov.garrison, attPower);
      prov.morale = Math.max(25, prov.morale - 3);
      if (prov.buildings.fort > 0 && Math.random() < 0.25) {
        prov.buildings.fort -= 1;
      }

      // Un pilonnage dure 15 s (5 salves) ou s'arrête si la garnison est rasée
      const elapsed = state.elapsedSeconds - battle.startedAt;
      if (totalStack(prov.garrison) > 0 && elapsed < 15) {
        ongoingBattles.push(battle);
      }
      continue;
    }

    const attPower = computeStackPower(battle.attackerUnits, prov, false) * fortProtection;
    const defPower = computeStackPower(prov.garrison, prov, true);

    applyDamageToStack(prov.garrison, attPower * (0.85 + Math.random() * 0.3));
    applyDamageToStack(battle.attackerUnits, defPower * (0.85 + Math.random() * 0.3));
    prov.morale = Math.max(20, prov.morale - 2);

    const attAlive = totalStack(battle.attackerUnits) > 0;
    const defAlive = totalStack(prov.garrison) > 0;

    if (attAlive && !defAlive) {
      captureProvince(state, prov, battle.attacker, battle.attackerUnits);
    } else if (!attAlive) {
      if (battle.attacker === state.playerNationId) {
        pushTelegram(state, `Notre assaut sur ${prov.name} a été repoussé.`, 'danger', prov.id);
      } else if (battle.defender === state.playerNationId) {
        pushTelegram(state, `Défense héroïque : l'ennemi a été repoussé à ${prov.name} !`, 'info', prov.id);
      }
    } else {
      ongoingBattles.push(battle);
    }
  }
  state.battles = ongoingBattles;
}