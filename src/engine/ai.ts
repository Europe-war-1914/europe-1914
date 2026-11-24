import { BUILDING_SPECS, getBuildingCost, UNIT_SPECS } from '../data/balance';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from '../data/nations';
import {
  getDiplomaticStatus,
  orderArtilleryBombardment,
  orderMoveArmy,
  setDiplomaticStatus,
  totalStack,
} from './combat';
import {
  canAfford,
  createId,
  pushTelegram,
  startConstruction,
  startRecruitment,
} from './economy';
import type {
  BuildingType,
  GameState,
  NationId,
  PlayableNationId,
  Province,
  UnitStack,
  UnitType,
} from './types';

const AI_THINK_INTERVAL_SECONDS = 4;
const NAVAL_POWERS: PlayableNationId[] = ['uk', 'italy', 'ottoman', 'spain'];

function isBorderProvince(state: GameState, prov: Province, owner: NationId): boolean {
  const adjacent = [...prov.neighbors, ...prov.seaNeighbors];
  return adjacent.some((id) => {
    const nb = state.provinces[id];
    if (!nb) return false;
    return nb.owner !== owner && getDiplomaticStatus(state, owner, nb.owner) !== 'alliance';
  });
}

function tryAiConstruction(
  state: GameState,
  nationId: PlayableNationId,
  owned: Province[],
  borders: Province[]
): void {
  const activeCount = state.constructions.filter((c) => c.owner === nationId).length;
  if (activeCount >= 2) return;

  const nation = state.nations[nationId];
  const freeProvinces = owned.filter(
    (p) => !state.constructions.some((c) => c.provinceId === p.id)
  );
  if (freeProvinces.length === 0) return;

  const totalFactories = owned.reduce((sum, p) => sum + p.buildings.factory, 0);

  let targetProv: Province | undefined;
  let building: BuildingType = 'factory';

  // 1. Priorité absolue : au moins 2 usines pour débloquer chars & artillerie
  if (totalFactories < 2) {
    building = 'factory';
    targetProv =
      freeProvinces.find((p) => p.buildings.factory === 0 && p.isCapital) ??
      freeProvinces
        .filter((p) => p.buildings.factory < BUILDING_SPECS.factory.maxLevel)
        .sort((a, b) => b.baseIncome.steel - a.baseIncome.steel)[0];
  } else if (
    nation.personality === 'fortress' ||
    (borders.length > 0 && Math.random() < 0.35)
  ) {
    building = 'fort';
    targetProv = borders.find(
      (p) =>
        p.buildings.fort < 2 &&
        !state.constructions.some((c) => c.provinceId === p.id)
    );
  } else if (Math.random() < 0.55) {
    building = 'railway';
    targetProv = freeProvinces
      .filter((p) => p.buildings.railway < 2)
      .sort(
        (a, b) =>
          b.baseIncome.gold +
          b.baseIncome.steel +
          b.baseIncome.oil -
          (a.baseIncome.gold + a.baseIncome.steel + a.baseIncome.oil)
      )[0];
  } else {
    building = 'factory';
    targetProv = freeProvinces.find((p) => p.buildings.factory < 2);
  }

  if (!targetProv) return;

  const cost = getBuildingCost(building, targetProv.buildings[building]);
  if (canAfford(nation.resources, cost)) {
    startConstruction(state, nationId, targetProv.id, building);
  }
}

function tryAiRecruitment(
  state: GameState,
  nationId: PlayableNationId,
  owned: Province[],
  borders: Province[]
): void {
  const activeCount = state.recruitments.filter((r) => r.owner === nationId).length;
  if (activeCount >= 2) return;

  const nation = state.nations[nationId];
  const factoryProvs = owned.filter((p) => p.buildings.factory >= 1);
  const coastalFactory = factoryProvs.find(
    (p) => p.terrain === 'coastal' || p.seaNeighbors.length > 0
  );

  const totalBattleships = owned.reduce((s, p) => s + p.garrison.battleship, 0);

  let unit: UnitType = 'infantry';
  let spawnProv: Province | undefined;

  if (
    NAVAL_POWERS.includes(nationId) &&
    coastalFactory &&
    totalBattleships < 2 &&
    canAfford(nation.resources, UNIT_SPECS.battleship.cost) &&
    Math.random() < 0.2
  ) {
    unit = 'battleship';
    spawnProv = coastalFactory;
  } else if (
    factoryProvs.length > 0 &&
    canAfford(nation.resources, UNIT_SPECS.tank.cost) &&
    Math.random() < (nation.personality === 'expansionist' ? 0.45 : 0.28)
  ) {
    unit = 'tank';
    spawnProv = factoryProvs[Math.floor(Math.random() * factoryProvs.length)];
  } else if (
    factoryProvs.length > 0 &&
    canAfford(nation.resources, UNIT_SPECS.artillery.cost) &&
    Math.random() < 0.28
  ) {
    unit = 'artillery';
    spawnProv = factoryProvs[Math.floor(Math.random() * factoryProvs.length)];
  } else if (canAfford(nation.resources, UNIT_SPECS.infantry.cost)) {
    unit = 'infantry';
    const pool = borders.length > 0 ? borders : owned;
    // Renforce en priorité la province frontalière la moins garnie
    spawnProv = [...pool].sort((a, b) => totalStack(a.garrison) - totalStack(b.garrison))[0];
  }

  if (spawnProv) {
    startRecruitment(state, nationId, spawnProv.id, unit, 1);
  }
}

function tryAiMovements(
  state: GameState,
  nationId: PlayableNationId,
  owned: Province[],
  borders: Province[]
): void {
  const activeMoves = state.movingArmies.filter((a) => a.owner === nationId).length;
  if (activeMoves >= 3) return;

  const nation = state.nations[nationId];
  const borderIds = new Set(borders.map((b) => b.id));

  // 1. Redéploiement de l'arrière vers la frontière (actif en Mobilisation ET en Guerre)
  const interior = owned.filter((p) => !borderIds.has(p.id));
  for (const prov of interior) {
    const keep = prov.isCapital ? 1 : 0;
    const total = totalStack(prov.garrison);
    if (total <= keep + 1) continue;

    const frontNeighbor = [...prov.neighbors, ...prov.seaNeighbors]
      .map((id) => state.provinces[id])
      .find((nb) => nb && nb.owner === nationId && borderIds.has(nb.id));

    if (!frontNeighbor) continue;

    const isNaval = !prov.neighbors.includes(frontNeighbor.id);
    const send: UnitStack = {
      infantry: Math.max(0, prov.garrison.infantry - keep),
      tank: prov.garrison.tank,
      artillery: prov.garrison.artillery,
      battleship: isNaval ? prov.garrison.battleship : 0,
    };

    if (totalStack(send) > 0) {
      orderMoveArmy(state, nationId, prov.id, frontNeighbor.id, send);
      break;
    }
  }

  // 2. Offensives & bombardements (uniquement après la fin de la mobilisation)
  if (state.phase !== 'WAR') return;

  const baseRatio =
    nation.personality === 'expansionist'
      ? 1.15
      : nation.personality === 'opportunist'
      ? 1.28
      : nation.personality === 'diplomat'
      ? 1.42
      : 1.6;

  const sortedBorders = [...borders].sort(
    (a, b) => totalStack(b.garrison) - totalStack(a.garrison)
  );

  for (const prov of sortedBorders) {
    if (totalStack(prov.garrison) < 3) continue;

    const candidateIds = [...prov.neighbors, ...prov.seaNeighbors];
    let bestTarget: Province | null = null;
    let bestScore = -Infinity;

    for (const targetId of candidateIds) {
      const target = state.provinces[targetId];
      if (!target || target.owner === nationId) continue;

      const status = getDiplomaticStatus(state, nationId, target.owner);
      if (status === 'alliance' || status === 'nap') continue;

      const isSeaOnly = !prov.neighbors.includes(targetId);
      const attStrength =
        prov.garrison.infantry +
        prov.garrison.tank * 2.4 +
        prov.garrison.artillery * 1.4 +
        (isSeaOnly ? prov.garrison.battleship * 2.5 : 0);

      const defStrength =
        Math.max(1, totalStack(target.garrison)) *
        (1 + target.buildings.fort * 0.25) *
        (target.terrain === 'mountain' ? 1.25 : 1.0);

      let requiredRatio = baseRatio;
      if (status === 'war') requiredRatio -= 0.15;
      if (target.owner === 'neutral') requiredRatio -= 0.12;

      if (attStrength < defStrength * requiredRatio) continue;

      const score =
        attStrength / defStrength +
        target.victoryPoints * 0.45 +
        (target.owner === 'neutral' ? 0.4 : 0) +
        (status === 'war' ? 0.5 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    }

    if (!bestTarget) continue;

    // Pilonnage d'artillerie préalable si la cible est fortifiée ou bien défendue
    if (
      prov.garrison.artillery > 0 &&
      (bestTarget.buildings.fort > 0 || totalStack(bestTarget.garrison) >= 3) &&
      Math.random() < 0.45
    ) {
      const res = orderArtilleryBombardment(state, nationId, prov.id, bestTarget.id);
      if (res.ok) return;
    }

    const isSeaOnly = !prov.neighbors.includes(bestTarget.id);
    const leaveInf = prov.isCapital || totalStack(prov.garrison) >= 4 ? 1 : 0;
    const send: UnitStack = {
      infantry: Math.max(0, prov.garrison.infantry - leaveInf),
      tank: prov.garrison.tank,
      artillery: prov.garrison.artillery,
      battleship: isSeaOnly ? prov.garrison.battleship : 0,
    };

    if (totalStack(send) > 0) {
      orderMoveArmy(state, nationId, prov.id, bestTarget.id, send);
      return;
    }
  }
}

function tryAiDiplomacy(
  state: GameState,
  nationId: PlayableNationId,
  ownedCount: number
): void {
  if (state.elapsedSeconds < 40) return;
  if (state.pendingOffers.length >= 2) return;
  if (state.pendingOffers.some((o) => o.from === nationId)) return;

  const nation = state.nations[nationId];
  const playerId = state.playerNationId;
  const status = getDiplomaticStatus(state, nationId, playerId);

  const playerCount = Object.values(state.provinces).filter(
    (p) => p.owner === playerId
  ).length;

  let offerType: 'nap' | 'alliance' | 'peace' | null = null;

  if (status === 'war' && ownedCount < playerCount && Math.random() < 0.06) {
    offerType = 'peace';
  } else if (status === 'neutral') {
    const chance =
      nation.personality === 'diplomat'
        ? 0.045
        : nation.personality === 'fortress'
        ? 0.025
        : 0.012;
    if (Math.random() < chance) {
      offerType =
        state.elapsedSeconds > 200 && nation.personality === 'diplomat'
          ? 'alliance'
          : 'nap';
    }
  } else if (status === 'nap' && state.elapsedSeconds > 180 && Math.random() < 0.02) {
    offerType = 'alliance';
  }

  if (!offerType) return;

  state.pendingOffers.push({
    id: createId('dip'),
    from: nationId,
    to: playerId,
    type: offerType,
    createdAt: state.elapsedSeconds,
    expiresAt: state.elapsedSeconds + 60,
  });

  const label =
    offerType === 'alliance'
      ? 'une Alliance militaire'
      : offerType === 'nap'
      ? 'un Pacte de non-agression'
      : 'un Traité de paix';

  pushTelegram(
    state,
    `Diplomatie : ${NATION_TEMPLATES[nationId].shortName} vous propose ${label} (onglet Diplomatie).`,
    'diplomacy'
  );
}

export function respondToDiplomaticOffer(
  state: GameState,
  offerId: string,
  accept: boolean
): { ok: boolean; reason?: string } {
  const idx = state.pendingOffers.findIndex((o) => o.id === offerId);
  if (idx === -1) return { ok: false, reason: 'Offre expirée ou introuvable.' };

  const offer = state.pendingOffers[idx];
  state.pendingOffers.splice(idx, 1);

  const senderName = NATION_TEMPLATES[offer.from].shortName;

  if (!accept) {
    pushTelegram(state, `Proposition de ${senderName} déclinée.`, 'diplomacy');
    return { ok: true };
  }

  const nextStatus = offer.type === 'peace' ? 'neutral' : offer.type;
  setDiplomaticStatus(state, offer.from, offer.to, nextStatus);

  // Stoppe immédiatement les combats entre les deux puissances signataires
  state.battles = state.battles.filter(
    (b) =>
      !(
        (b.attacker === offer.from && b.defender === offer.to) ||
        (b.attacker === offer.to && b.defender === offer.from)
      )
  );

  const text =
    offer.type === 'alliance'
      ? `Alliance officielle scellée avec ${senderName} !`
      : offer.type === 'nap'
      ? `Pacte de non-agression signé avec ${senderName}.`
      : `Traité de paix signé avec ${senderName}.`;

  pushTelegram(state, text, 'diplomacy');
  return { ok: true };
}

export function tickAI(state: GameState): void {
  // Nettoie les offres diplomatiques expirées
  state.pendingOffers = state.pendingOffers.filter(
    (o) => o.expiresAt > state.elapsedSeconds
  );

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

    tryAiConstruction(state, nationId, owned, borders);
    tryAiRecruitment(state, nationId, owned, borders);
    tryAiMovements(state, nationId, owned, borders);
    tryAiDiplomacy(state, nationId, owned.length);
  }
}