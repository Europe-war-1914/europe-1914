import { BUILDING_SPECS, getBuildingCost, UNIT_SPECS } from '../data/balance';
import type {
  BuildingType,
  GameState,
  NationId,
  ResourcePool,
  UnitType,
} from './types';

let nextOrderId = 1;
export function createId(prefix: string): string {
  nextOrderId += 1;
  return `${prefix}_${Date.now().toString(36)}_${nextOrderId}`;
}

export function canAfford(pool: ResourcePool, cost: ResourcePool): boolean {
  return pool.gold >= cost.gold && pool.steel >= cost.steel && pool.oil >= cost.oil;
}

export function spendResources(pool: ResourcePool, cost: ResourcePool): void {
  pool.gold = Math.max(0, pool.gold - cost.gold);
  pool.steel = Math.max(0, pool.steel - cost.steel);
  pool.oil = Math.max(0, pool.oil - cost.oil);
}

export function pushTelegram(
  state: GameState,
  text: string,
  level: 'info' | 'warning' | 'danger' | 'diplomacy',
  provinceId?: string
): void {
  state.telegrams.unshift({
    id: createId('tg'),
    time: state.elapsedSeconds,
    text,
    level,
    provinceId,
  });
  if (state.telegrams.length > 30) {
    state.telegrams.length = 30;
  }
}

export function getNationIncomePerMinute(state: GameState, nationId: NationId): ResourcePool {
  const total: ResourcePool = { gold: 0, steel: 0, oil: 0 };
  for (const prov of Object.values(state.provinces)) {
    if (prov.owner !== nationId) continue;
    const moraleFactor = 0.5 + (prov.morale / 100) * 0.5;
    const railFactor = 1 + prov.buildings.railway * 0.15;
    const mult = moraleFactor * railFactor;
    total.gold += prov.baseIncome.gold * mult;
    total.steel += prov.baseIncome.steel * mult;
    total.oil += prov.baseIncome.oil * mult;
  }
  return {
    gold: Math.round(total.gold),
    steel: Math.round(total.steel),
    oil: Math.round(total.oil),
  };
}

export function startConstruction(
  state: GameState,
  nationId: NationId,
  provinceId: string,
  building: BuildingType
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  const spec = BUILDING_SPECS[building];
  const pendingCount = state.constructions.filter(
    (c) => c.provinceId === provinceId && c.building === building
  ).length;
  const effectiveLevel = prov.buildings[building] + pendingCount;

  if (effectiveLevel >= spec.maxLevel) {
    return { ok: false, reason: 'Niveau maximum déjà atteint.' };
  }

  const alreadyBuildingHere = state.constructions.some((c) => c.provinceId === provinceId);
  if (alreadyBuildingHere) {
    return { ok: false, reason: 'Un chantier est déjà en cours dans cette province.' };
  }

  const cost = getBuildingCost(building, effectiveLevel);
  if (!canAfford(nation.resources, cost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, cost);
  state.constructions.push({
    id: createId('bld'),
    owner: nationId,
    provinceId,
    building,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + spec.buildSeconds,
  });

  if (nationId === state.playerNationId && state.tutorialStep === 2) {
    state.tutorialStep = 3;
  }

  return { ok: true };
}

export function startRecruitment(
  state: GameState,
  nationId: NationId,
  provinceId: string,
  unit: UnitType,
  count = 1
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  const spec = UNIT_SPECS[unit];
  if (prov.buildings.factory < spec.requiresFactoryLevel) {
    return { ok: false, reason: `Usine niv. ${spec.requiresFactoryLevel} requise.` };
  }
  if (spec.requiresCoastal && prov.terrain !== 'coastal' && prov.seaNeighbors.length === 0) {
    return { ok: false, reason: 'Port ou province côtière requis.' };
  }

  const totalCost: ResourcePool = {
    gold: spec.cost.gold * count,
    steel: spec.cost.steel * count,
    oil: spec.cost.oil * count,
  };
  if (!canAfford(nation.resources, totalCost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, totalCost);

  const factorySpeedFactor = Math.max(0.45, 1 - prov.buildings.factory * 0.18);
  const duration = Math.max(6, Math.round(spec.trainSeconds * factorySpeedFactor * count));

  state.recruitments.push({
    id: createId('rec'),
    owner: nationId,
    provinceId,
    unit,
    count,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + duration,
  });

  if (nationId === state.playerNationId && state.tutorialStep === 3) {
    state.tutorialStep = 4;
  }

  return { ok: true };
}

export function tickEconomy(state: GameState, dtSeconds: number): void {
  // 1. Génération des ressources par province (proportionnelle à la seconde)
  const minuteFraction = dtSeconds / 60;
  for (const prov of Object.values(state.provinces)) {
    const nation = state.nations[prov.owner];
    if (!nation || prov.owner === 'neutral') continue;

    const moraleFactor = 0.5 + (prov.morale / 100) * 0.5;
    const railFactor = 1 + prov.buildings.railway * 0.15;
    const mult = moraleFactor * railFactor * minuteFraction;

    nation.resources.gold += prov.baseIncome.gold * mult;
    nation.resources.steel += prov.baseIncome.steel * mult;
    nation.resources.oil += prov.baseIncome.oil * mult;

    // Remontée progressive du moral hors combat (vers 90 %)
    const underAttack = state.battles.some((b) => b.provinceId === prov.id);
    if (!underAttack && prov.morale < 90) {
      prov.morale = Math.min(90, prov.morale + 0.12 * dtSeconds);
    }
  }

  // 2. Finalisation des constructions
  const remainingConstructions = [];
  for (const order of state.constructions) {
    const prov = state.provinces[order.provinceId];
    if (!prov || prov.owner !== order.owner) continue;

    if (state.elapsedSeconds >= order.endsAt) {
      const spec = BUILDING_SPECS[order.building];
      prov.buildings[order.building] = Math.min(spec.maxLevel, prov.buildings[order.building] + 1);
      if (order.owner === state.playerNationId) {
        pushTelegram(
          state,
          `${spec.label} (niv. ${prov.buildings[order.building]}) achevée à ${prov.name}.`,
          'info',
          prov.id
        );
      }
    } else {
      remainingConstructions.push(order);
    }
  }
  state.constructions = remainingConstructions;

  // 3. Finalisation des recrutements
  const remainingRecruitments = [];
  for (const order of state.recruitments) {
    const prov = state.provinces[order.provinceId];
    if (!prov || prov.owner !== order.owner) continue;

    if (state.elapsedSeconds >= order.endsAt) {
      prov.garrison[order.unit] += order.count;
      if (order.owner === state.playerNationId) {
        pushTelegram(
          state,
          `+${order.count} ${UNIT_SPECS[order.unit].label} déployé(s) à ${prov.name}.`,
          'info',
          prov.id
        );
      }
    } else {
      remainingRecruitments.push(order);
    }
  }
  state.recruitments = remainingRecruitments;
}