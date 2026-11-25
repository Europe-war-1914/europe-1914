import {
  createEmptyStack,
  EXTRACTION_TECH_MAP,
  GAME_CONFIG,
  TECH_COSTS_TP,
  UNIT_SPECS,
} from '../data/balance';
import { PLAYABLE_NATIONS } from '../data/nations';
import {
  getEffectiveDefenseLevel,
  isCoastalProvince,
  orderMoveArmy,
  totalStack,
} from './combat';
import { getDiplomaticStatus, requestDiplomaticAction } from './diplomacy';
import {
  canAfford,
  startRecruitment,
  unlockTechnology,
  upgradeBarracks,
  upgradeDefense,
  upgradeExtractionFactory,
  upgradeLaboratory,
} from './economy';
import type {
  DefenseType,
  ExtractionResource,
  GameState,
  NationId,
  PlayableNationId,
  Province,
  TechAxis,
  UnitType,
} from './types';

const AI_THINK_INTERVAL_SECONDS = 5;
// Pause minimale entre deux offensives pour stopper les attaques compulsives
const AI_OFFENSIVE_COOLDOWN_SECONDS = 32;

function isBorderProvince(state: GameState, prov: Province, owner: NationId): boolean {
  const adjacent = [...prov.neighbors, ...prov.seaNeighbors];
  return adjacent.some((id) => {
    const nb = state.provinces[id];
    if (!nb) return false;
    return nb.owner !== owner && getDiplomaticStatus(state, owner, nb.owner) !== 'alliance';
  });
}

/** 1. Déblocage réfléchi des technologies (défenses + ressources + armée) */
function tryAiResearch(state: GameState, nationId: PlayableNationId): void {
  const nation = state.nations[nationId];
  const priorities: TechAxis[] =
    nation.personality === 'fortress'
      ? [
          'bunkers',
          'trenches',
          'gold_extraction',
          'steel_extraction',
          'infantry',
          'aa_defense',
          'naval_defense',
          'worker_speed',
          'tanks',
          'gas_extraction',
          'aviation',
          'naval',
        ]
      : [
          'gold_extraction',
          'steel_extraction',
          'bunkers',
          'infantry',
          'trenches',
          'tanks',
          'gas_extraction',
          'worker_speed',
          'aa_defense',
          'aviation',
          'naval_defense',
          'naval',
        ];

  for (const axis of priorities) {
    const cur = nation.techLevels[axis];
    if (cur >= 3) continue;
    const cost = TECH_COSTS_TP[(cur + 1) as 1 | 2 | 3];
    if (nation.techPoints >= cost) {
      unlockTechnology(state, nationId, axis);
      return;
    }
  }
}

/** 2. Constructions défensives et économiques (Labo, Usines, Défenses sur capitale & frontières) */
function tryAiConstruction(
  state: GameState,
  nationId: PlayableNationId,
  owned: Province[],
  borders: Province[]
): void {
  const activeCount = state.constructions.filter((c) => c.owner === nationId).length;
  if (activeCount >= 2) return;

  const nation = state.nations[nationId];
  const freeProvs = owned.filter(
    (p) => !state.constructions.some((c) => c.provinceId === p.id)
  );
  if (freeProvs.length === 0) return;

  // Priorité A : monter le Laboratoire unique de la capitale
  const capital = freeProvs.find((p) => p.hasLaboratory && p.laboratoryLevel < 3);
  if (capital && Math.random() < 0.35) {
    if (upgradeLaboratory(state, nationId, capital.id).ok) return;
  }

  // Priorité B : fortifier la capitale et les frontières exposées
  const defenseTargets = [
    ...(capital ? [capital] : []),
    ...borders.filter((b) => freeProvs.some((f) => f.id === b.id)),
  ];
  for (const prov of defenseTargets) {
    const defs: DefenseType[] = isCoastalProvince(prov)
      ? ['bunkers', 'trenches', 'naval_defense', 'aa_defense']
      : ['bunkers', 'trenches', 'aa_defense'];

    for (const def of defs) {
      if (prov.defenses[def] < nation.techLevels[def]) {
        if (upgradeDefense(state, nationId, prov.id, def).ok) return;
      }
    }
  }

  // Priorité C : usines d'extraction débloquées
  for (const res of ['gold', 'steel', 'gas'] as ExtractionResource[]) {
    const techLvl = nation.techLevels[EXTRACTION_TECH_MAP[res]];
    if (techLvl <= 0) continue;
    const bestProv = freeProvs
      .filter((p) => p.extractionFactories[res] < techLvl)
      .sort((a, b) => b.baseIncome[res] - a.baseIncome[res])[0];
    if (bestProv && upgradeExtractionFactory(state, nationId, bestProv.id, res).ok) return;
  }

  // Priorité D : Caserne peu chère sur la capitale ou une frontière
  const barrackProv = freeProvs.find((p) => p.barracksLevel < 3);
  if (barrackProv && Math.random() < 0.25) {
    upgradeBarracks(state, nationId, barrackProv.id);
  }
}

/** 3. Recrutement équilibré pour tenir la défense et préparer des forces cohérentes */
function tryAiRecruitment(
  state: GameState,
  nationId: PlayableNationId,
  owned: Province[],
  borders: Province[]
): void {
  const activeCount = state.recruitments.filter((r) => r.owner === nationId).length;
  if (activeCount >= 2) return;

  const nation = state.nations[nationId];
  const capital = owned.find((p) => p.isCapital);

  // Toujours sécuriser une garnison sérieuse dans la capitale
  if (capital && totalStack(capital.garrison) < 8 && canAfford(nation.resources, UNIT_SPECS.soldier.cost)) {
    startRecruitment(state, nationId, capital.id, 'soldier', 1);
    return;
  }

  const coastal = owned.find((p) => isCoastalProvince(p));
  const pool = borders.length > 0 ? borders : owned;
  const weakestBorder = [...pool].sort((a, b) => totalStack(a.garrison) - totalStack(b.garrison))[0];

  const roll = Math.random();
  let unit: UnitType = 'soldier';
  let spawn = weakestBorder;

  if (coastal && roll < 0.14 && canAfford(nation.resources, UNIT_SPECS.frigate.cost)) {
    unit = 'frigate';
    spawn = coastal;
  } else if (roll < 0.28 && canAfford(nation.resources, UNIT_SPECS.light_tank.cost)) {
    unit = 'light_tank';
  } else if (roll < 0.38 && canAfford(nation.resources, UNIT_SPECS.heavy_tank.cost)) {
    unit = 'heavy_tank';
  } else if (roll < 0.46 && canAfford(nation.resources, UNIT_SPECS.fighter.cost)) {
    unit = 'fighter';
  } else if (roll < 0.54 && canAfford(nation.resources, UNIT_SPECS.bomber.cost)) {
    unit = 'bomber';
  } else if (roll < 0.66 && canAfford(nation.resources, UNIT_SPECS.scout.cost)) {
    unit = 'scout';
  } else {
    unit = 'soldier';
  }

  if (spawn && canAfford(nation.resources, UNIT_SPECS[unit].cost)) {
    startRecruitment(state, nationId, spawn.id, unit, 1);
  }
}

/** 4. Réaction défensive prioritaire + offensives calculées (fini les attaques compulsives) */
function tryAiDefenseAndMovements(
  state: GameState,
  nationId: PlayableNationId,
  owned: Province[],
  borders: Province[]
): void {
  const nation = state.nations[nationId];
  const activeMoves = state.movingArmies.filter((a) => a.owner === nationId).length;
  if (activeMoves >= 3) return;

  // A. URGENCE DÉFENSIVE : province attaquée ou débarquement sous-marin (10 s) en cours !
  const threatenedIds = new Set<string>();
  for (const b of state.battles) {
    if (b.defender === nationId) threatenedIds.add(b.provinceId);
  }
  for (const m of state.movingArmies) {
    if (
      m.owner !== nationId &&
      m.landingStartedAt !== undefined &&
      state.provinces[m.toProvinceId]?.owner === nationId
    ) {
      threatenedIds.add(m.toProvinceId);
    }
  }

  for (const threatId of threatenedIds) {
    const donor = owned
      .filter((p) => p.id !== threatId && !threatenedIds.has(p.id))
      .filter((p) => totalStack(p.garrison) >= (p.isCapital ? 9 : 5))
      .sort((a, b) => totalStack(b.garrison) - totalStack(a.garrison))[0];

    if (donor) {
      const send = createEmptyStack();
      const keep = donor.isCapital ? 6 : 3;
      const availableSoldiers = Math.max(0, donor.garrison.soldier - keep);
      send.soldier = Math.ceil(availableSoldiers * 0.7);
      send.light_tank = donor.garrison.light_tank;
      send.heavy_tank = donor.garrison.heavy_tank;
      if (totalStack(send) > 0) {
        orderMoveArmy(state, nationId, donor.id, threatId, send);
        return;
      }
    }
  }

  // B. Consolidation défensive : transférer le surplus de l'arrière vers la frontière la plus faible
  const borderIds = new Set(borders.map((b) => b.id));
  const weakestBorder = [...borders].sort(
    (a, b) => totalStack(a.garrison) - totalStack(b.garrison)
  )[0];

  if (weakestBorder && totalStack(weakestBorder.garrison) < 5) {
    const interiorDonor = owned.find(
      (p) => !borderIds.has(p.id) && totalStack(p.garrison) >= (p.isCapital ? 10 : 4)
    );
    if (interiorDonor) {
      const keep = interiorDonor.isCapital ? 7 : 2;
      const send = createEmptyStack();
      send.soldier = Math.max(0, interiorDonor.garrison.soldier - keep);
      send.scout = interiorDonor.garrison.scout;
      send.light_tank = interiorDonor.garrison.light_tank;
      send.heavy_tank = interiorDonor.garrison.heavy_tank;
      if (totalStack(send) > 0) {
        orderMoveArmy(state, nationId, interiorDonor.id, weakestBorder.id, send);
        return;
      }
    }
  }

  // C. Offensives réfléchies UNIQUEMENT après temporisation et avec nette supériorité
  const cooldown =
    state.aiDifficulty === 'hard'
      ? AI_OFFENSIVE_COOLDOWN_SECONDS * 0.75
      : AI_OFFENSIVE_COOLDOWN_SECONDS;

  if (state.elapsedSeconds - (nation.lastAttackAt ?? 0) < cooldown) {
    return;
  }

  const requiredRatio =
    nation.personality === 'expansionist'
      ? 1.55
      : nation.personality === 'opportunist'
      ? 1.7
      : 1.95;

  const readyBorders = borders
    .filter((p) => totalStack(p.garrison) >= (p.isCapital ? 11 : 7))
    .sort((a, b) => totalStack(b.garrison) - totalStack(a.garrison));

  for (const prov of readyBorders) {
    let bestTarget: Province | null = null;
    let bestScore = -Infinity;

    for (const targetId of [...prov.neighbors, ...prov.seaNeighbors]) {
      const target = state.provinces[targetId];
      if (!target || target.owner === nationId) continue;

      const status = getDiplomaticStatus(state, nationId, target.owner);
      if (status === 'alliance') continue;

      // Évalue les défenses adverses pour éviter les charges suicides
      const bunkerFactor =
        1 + getEffectiveDefenseLevel(target, 'bunkers', state.elapsedSeconds) * 0.55;
      const trenchFactor =
        1 + getEffectiveDefenseLevel(target, 'trenches', state.elapsedSeconds) * 0.45;

      const keepReserve = prov.isCapital ? 6 : 3;
      const usableInf = Math.max(0, prov.garrison.soldier + prov.garrison.scout - keepReserve);
      const usableArmor = prov.garrison.light_tank * 1.8 + prov.garrison.heavy_tank * 2.8;

      const attScore = usableInf / bunkerFactor + usableArmor / trenchFactor;
      const defScore = Math.max(2, totalStack(target.garrison) * 1.25);

      if (attScore < defScore * requiredRatio) continue;

      const score =
        attScore / defScore +
        (target.isCapital ? 2.5 : 0) +
        (status === 'war' ? 0.8 : 0) +
        (target.owner === 'neutral' ? 0.35 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    }

    if (!bestTarget) continue;

    // Garde toujours une vraie garnison en défense sur la province de départ !
    const keepSoldiers = prov.isCapital ? 5 : 2;
    const send = createEmptyStack();
    send.soldier = Math.max(0, prov.garrison.soldier - keepSoldiers);
    send.scout = prov.garrison.scout;
    send.light_tank = prov.garrison.light_tank;
    send.heavy_tank = prov.garrison.heavy_tank;
    send.bomber = prov.garrison.bomber;
    send.fighter = prov.garrison.fighter;

    if (totalStack(send) >= 4) {
      const res = orderMoveArmy(state, nationId, prov.id, bestTarget.id, send);
      if (res.ok) {
        nation.lastAttackAt = state.elapsedSeconds;
        return;
      }
    }
  }
}

/** 5. Initiatives diplomatiques IA (max 1 alliance, pas de PNA) */
function tryAiDiplomacy(state: GameState, nationId: PlayableNationId): void {
  if (state.elapsedSeconds < 90) return;
  const nation = state.nations[nationId];
  if (nation.activeAllianceWith !== null) return;
  if (nation.resources.gold < GAME_CONFIG.allianceCostGold + 150) return;
  if (state.pendingOffers.some((o) => o.from === nationId)) return;

  const playerId = state.playerNationId;
  const player = state.nations[playerId];
  if (!player || player.isEliminated || player.activeAllianceWith !== null) return;

  const status = getDiplomaticStatus(state, nationId, playerId);
  if (status === 'neutral' && nation.personality === 'diplomat' && Math.random() < 0.015) {
    requestDiplomaticAction(state, nationId, playerId, 'alliance');
  }
}

export function tickAI(state: GameState): void {
  if (state.elapsedSeconds - state.lastAiTickAt < AI_THINK_INTERVAL_SECONDS) {
    return;
  }
  state.lastAiTickAt = state.elapsedSeconds;

  const allProvinces = Object.values(state.provinces);

  for (const nationId of PLAYABLE_NATIONS) {
    const nation = state.nations[nationId];
    if (!nation || nation.isPlayer || nation.isEliminated) continue;

    const owned = allProvinces.filter((p) => p.owner === nationId);
    if (owned.length === 0) continue;

    const borders = owned.filter((p) => isBorderProvince(state, p, nationId));

    tryAiResearch(state, nationId);
    tryAiConstruction(state, nationId, owned, borders);
    tryAiRecruitment(state, nationId, owned, borders);
    tryAiDefenseAndMovements(state, nationId, owned, borders);
    tryAiDiplomacy(state, nationId);
  }
}