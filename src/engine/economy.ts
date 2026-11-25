import {
  DEFENSE_LABELS,
  EXTRACTION_LABELS,
  EXTRACTION_TECH_MAP,
  GAME_CONFIG,
  getBarracksCost,
  getDefenseCost,
  getExtractionCost,
  getLaboratoryCost,
  LAB_TP_PER_MINUTE,
  TECH_AXES_SPECS,
  TECH_COSTS_TP,
  UNIT_SPECS,
} from '../data/balance';
import type {
  DefenseType,
  ExtractionResource,
  GameState,
  NationId,
  ResourcePool,
  TechAxis,
  UnitType,
} from './types';

let nextOrderId = 1;
export function createId(prefix: string): string {
  nextOrderId += 1;
  return `${prefix}_${Date.now().toString(36)}_${nextOrderId}`;
}

export function canAfford(pool: ResourcePool, cost: ResourcePool): boolean {
  return pool.gold >= cost.gold && pool.steel >= cost.steel && pool.gas >= cost.gas;
}

export function spendResources(pool: ResourcePool, cost: ResourcePool): void {
  pool.gold = Math.max(0, pool.gold - cost.gold);
  pool.steel = Math.max(0, pool.steel - cost.steel);
  pool.gas = Math.max(0, pool.gas - cost.gas);
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
  if (state.telegrams.length > 35) {
    state.telegrams.length = 35;
  }
}

export function getWorkerSpeedFactor(workerTechLevel: number): number {
  if (workerTechLevel >= 3) return 0.5;
  if (workerTechLevel === 2) return 0.65;
  if (workerTechLevel === 1) return 0.8;
  return 1.0;
}

export function getNationIncomePerMinute(
  state: GameState,
  nationId: NationId
): ResourcePool & { techPoints: number } {
  const nation = state.nations[nationId];
  const total = { gold: 0, steel: 0, gas: 0, techPoints: 0 };
  if (!nation || nation.isEliminated || nationId === 'neutral') return total;

  const goldTechBonus = 1 + nation.techLevels.gold_extraction * 0.15;
  const steelTechBonus = 1 + nation.techLevels.steel_extraction * 0.15;
  const gasTechBonus = 1 + nation.techLevels.gas_extraction * 0.15;

  for (const prov of Object.values(state.provinces)) {
    if (prov.owner !== nationId) continue;

    total.gold += prov.baseIncome.gold * (1 + prov.extractionFactories.gold * 0.45) * goldTechBonus;
    total.steel +=
      prov.baseIncome.steel * (1 + prov.extractionFactories.steel * 0.45) * steelTechBonus;
    total.gas += prov.baseIncome.gas * (1 + prov.extractionFactories.gas * 0.45) * gasTechBonus;

    if (prov.hasLaboratory && prov.laboratoryLevel > 0) {
      total.techPoints += LAB_TP_PER_MINUTE[prov.laboratoryLevel] ?? 0;
    }
  }

  return {
    gold: Math.round(total.gold),
    steel: Math.round(total.steel),
    gas: Math.round(total.gas),
    techPoints: Math.round(total.techPoints * 10) / 10,
  };
}

export function unlockTechnology(
  state: GameState,
  nationId: NationId,
  axis: TechAxis
): { ok: boolean; reason?: string } {
  const nation = state.nations[nationId];
  if (!nation || nation.isEliminated || nationId === 'neutral') {
    return { ok: false, reason: 'Nation invalide.' };
  }

  const current = nation.techLevels[axis] ?? 0;
  if (current >= 3) {
    return { ok: false, reason: 'Technologie déjà au niveau maximum (3).' };
  }

  const nextLevel = (current + 1) as 1 | 2 | 3;
  const cost = TECH_COSTS_TP[nextLevel];
  if (nation.techPoints < cost) {
    return { ok: false, reason: `Il faut ${cost} Points Technologiques.` };
  }

  nation.techPoints -= cost;
  nation.techLevels[axis] = nextLevel;

  if (nationId === state.playerNationId) {
    pushTelegram(
      state,
      `Technologie débloquée : ${TECH_AXES_SPECS[axis].label} (niv. ${nextLevel}).`,
      'info'
    );
  }
  return { ok: true };
}

export function upgradeBarracks(
  state: GameState,
  nationId: NationId,
  provinceId: string
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId || nation.isEliminated) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  const alreadyBuilding = state.constructions.some((c) => c.provinceId === provinceId);
  if (alreadyBuilding) {
    return { ok: false, reason: 'Un chantier est déjà en cours dans cette province.' };
  }

  if (prov.barracksLevel >= 3) {
    return { ok: false, reason: 'Caserne déjà au niveau maximum (3).' };
  }

  const { cost, buildSeconds } = getBarracksCost(prov.barracksLevel);
  if (!canAfford(nation.resources, cost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, cost);
  const duration = Math.max(
    5,
    Math.round(buildSeconds * getWorkerSpeedFactor(nation.techLevels.worker_speed))
  );

  state.constructions.push({
    id: createId('bld'),
    owner: nationId,
    provinceId,
    kind: 'barracks',
    targetKey: 'barracks',
    targetLevel: prov.barracksLevel + 1,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + duration,
  });

  return { ok: true };
}

export function upgradeLaboratory(
  state: GameState,
  nationId: NationId,
  provinceId: string
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId || nation.isEliminated) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  if (!prov.hasLaboratory) {
    return { ok: false, reason: 'Seule votre capitale abrite votre laboratoire unique.' };
  }
  if (prov.laboratoryLevel >= 3) {
    return { ok: false, reason: 'Laboratoire déjà au niveau maximum (3).' };
  }

  const alreadyBuilding = state.constructions.some((c) => c.provinceId === provinceId);
  if (alreadyBuilding) {
    return { ok: false, reason: 'Un chantier est déjà en cours dans cette province.' };
  }

  const { cost, buildSeconds } = getLaboratoryCost(prov.laboratoryLevel);
  if (!canAfford(nation.resources, cost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, cost);
  const duration = Math.max(
    8,
    Math.round(buildSeconds * getWorkerSpeedFactor(nation.techLevels.worker_speed))
  );

  state.constructions.push({
    id: createId('bld'),
    owner: nationId,
    provinceId,
    kind: 'laboratory',
    targetKey: 'laboratory',
    targetLevel: prov.laboratoryLevel + 1,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + duration,
  });

  return { ok: true };
}

export function upgradeExtractionFactory(
  state: GameState,
  nationId: NationId,
  provinceId: string,
  resource: ExtractionResource
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId || nation.isEliminated) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  const alreadyBuilding = state.constructions.some((c) => c.provinceId === provinceId);
  if (alreadyBuilding) {
    return { ok: false, reason: 'Un chantier est déjà en cours dans cette province.' };
  }

  const currentLvl = prov.extractionFactories[resource];
  if (currentLvl >= 3) {
    return { ok: false, reason: `${EXTRACTION_LABELS[resource]} déjà au niveau maximum (3).` };
  }

  const nextLvl = currentLvl + 1;
  const requiredTech = EXTRACTION_TECH_MAP[resource];
  if (nation.techLevels[requiredTech] < nextLvl) {
    return {
      ok: false,
      reason: `Technologie « ${TECH_AXES_SPECS[requiredTech].label} » niv. ${nextLvl} requise.`,
    };
  }

  const { cost, buildSeconds } = getExtractionCost(resource, currentLvl);
  if (!canAfford(nation.resources, cost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, cost);
  const duration = Math.max(
    6,
    Math.round(buildSeconds * getWorkerSpeedFactor(nation.techLevels.worker_speed))
  );

  state.constructions.push({
    id: createId('bld'),
    owner: nationId,
    provinceId,
    kind: 'extraction',
    targetKey: resource,
    targetLevel: nextLvl,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + duration,
  });

  return { ok: true };
}

export function upgradeDefense(
  state: GameState,
  nationId: NationId,
  provinceId: string,
  defense: DefenseType
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId || nation.isEliminated) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  if (
    defense === 'naval_defense' &&
    prov.terrain !== 'coastal' &&
    prov.seaNeighbors.length === 0
  ) {
    return { ok: false, reason: 'Les défenses marines nécessitent une province côtière.' };
  }

  const alreadyBuilding = state.constructions.some((c) => c.provinceId === provinceId);
  if (alreadyBuilding) {
    return { ok: false, reason: 'Un chantier est déjà en cours dans cette province.' };
  }

  const currentLvl = prov.defenses[defense];
  if (currentLvl >= 3) {
    return { ok: false, reason: `${DEFENSE_LABELS[defense]} déjà au niveau maximum (3).` };
  }

  const nextLvl = currentLvl + 1;
  if (nation.techLevels[defense] < nextLvl) {
    return {
      ok: false,
      reason: `Technologie « ${DEFENSE_LABELS[defense]} » niv. ${nextLvl} requise.`,
    };
  }

  const { cost, buildSeconds } = getDefenseCost(defense, currentLvl);
  if (!canAfford(nation.resources, cost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, cost);
  const duration = Math.max(
    6,
    Math.round(buildSeconds * getWorkerSpeedFactor(nation.techLevels.worker_speed))
  );

  state.constructions.push({
    id: createId('bld'),
    owner: nationId,
    provinceId,
    kind: 'defense',
    targetKey: defense,
    targetLevel: nextLvl,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + duration,
  });

  return { ok: true };
}

/** Recrutement des 8 unités via la Caserne (nécessite niveau 1 dans la technologie d'armée correspondante) */
export function startRecruitment(
  state: GameState,
  nationId: NationId,
  provinceId: string,
  unit: UnitType,
  count = 1
): { ok: boolean; reason?: string } {
  const prov = state.provinces[provinceId];
  const nation = state.nations[nationId];
  if (!prov || !nation || prov.owner !== nationId || nation.isEliminated) {
    return { ok: false, reason: 'Province non contrôlée.' };
  }

  const qty = Math.max(1, Math.min(20, Math.floor(count)));
  const spec = UNIT_SPECS[unit];

  if ((nation.techLevels[spec.armyTechAxis] ?? 0) < 1) {
    return {
      ok: false,
      reason: `Technologie « ${TECH_AXES_SPECS[spec.armyTechAxis].label} » niv. 1 requise pour former cette unité.`,
    };
  }

  if (spec.requiresCoastal && prov.terrain !== 'coastal' && prov.seaNeighbors.length === 0) {
    return { ok: false, reason: 'Province côtière requise pour les unités navales.' };
  }

  const totalCost: ResourcePool = {
    gold: spec.cost.gold * qty,
    steel: spec.cost.steel * qty,
    gas: spec.cost.gas * qty,
  };
  if (!canAfford(nation.resources, totalCost)) {
    return { ok: false, reason: 'Ressources insuffisantes.' };
  }

  spendResources(nation.resources, totalCost);

  const barracksSpeedFactor = 1 / (1 + Math.max(0, prov.barracksLevel - 1) * 0.35);
  const duration = Math.max(4, Math.round(spec.trainSeconds * barracksSpeedFactor * qty));

  state.recruitments.push({
    id: createId('rec'),
    owner: nationId,
    provinceId,
    unit,
    count: qty,
    startedAt: state.elapsedSeconds,
    endsAt: state.elapsedSeconds + duration,
  });

  return { ok: true };
}

export function tickEconomy(state: GameState, dtSeconds: number): void {
  const minuteFraction = dtSeconds / 60;

  for (const prov of Object.values(state.provinces)) {
    if (prov.activeWeaknesses.length > 0) {
      prov.activeWeaknesses = prov.activeWeaknesses.filter(
        (w) => w.expiresAt > state.elapsedSeconds
      );
    }

    const nation = state.nations[prov.owner];
    if (!nation || nation.isEliminated || prov.owner === 'neutral') continue;

    const goldMult =
      (1 + prov.extractionFactories.gold * 0.45) * (1 + nation.techLevels.gold_extraction * 0.15);
    const steelMult =
      (1 + prov.extractionFactories.steel * 0.45) * (1 + nation.techLevels.steel_extraction * 0.15);
    const gasMult =
      (1 + prov.extractionFactories.gas * 0.45) * (1 + nation.techLevels.gas_extraction * 0.15);

    nation.resources.gold += prov.baseIncome.gold * goldMult * minuteFraction;
    nation.resources.steel += prov.baseIncome.steel * steelMult * minuteFraction;
    nation.resources.gas += prov.baseIncome.gas * gasMult * minuteFraction;

    if (prov.hasLaboratory && prov.laboratoryLevel > 0) {
      nation.techPoints += (LAB_TP_PER_MINUTE[prov.laboratoryLevel] ?? 0) * minuteFraction;
    }
  }

  const remainingConstructions = [];
  for (const order of state.constructions) {
    const prov = state.provinces[order.provinceId];
    if (!prov || prov.owner !== order.owner) continue;

    if (state.elapsedSeconds >= order.endsAt) {
      let label = '';
      if (order.kind === 'barracks') {
        prov.barracksLevel = Math.min(3, order.targetLevel);
        label = `Caserne (niv. ${prov.barracksLevel})`;
      } else if (order.kind === 'laboratory' && prov.hasLaboratory) {
        prov.laboratoryLevel = Math.min(3, order.targetLevel);
        label = `Laboratoire (niv. ${prov.laboratoryLevel})`;
      } else if (order.kind === 'extraction') {
        const resKey = order.targetKey as ExtractionResource;
        prov.extractionFactories[resKey] = Math.min(3, order.targetLevel);
        label = `${EXTRACTION_LABELS[resKey]} (niv. ${prov.extractionFactories[resKey]})`;
      } else if (order.kind === 'defense') {
        const defKey = order.targetKey as DefenseType;
        prov.defenses[defKey] = Math.min(3, order.targetLevel);
        label = `${DEFENSE_LABELS[defKey]} (niv. ${prov.defenses[defKey]})`;
      }

      if (label && order.owner === state.playerNationId) {
        pushTelegram(state, `${label} achevé(e) à ${prov.name}.`, 'info', prov.id);
      }
    } else {
      remainingConstructions.push(order);
    }
  }
  state.constructions = remainingConstructions;

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

  if (
    state.elapsedSeconds - state.lastNeutralGrowthAt >=
    GAME_CONFIG.neutralGrowthIntervalSeconds
  ) {
    state.lastNeutralGrowthAt = state.elapsedSeconds;
    const wave = Math.floor(state.elapsedSeconds / GAME_CONFIG.neutralGrowthIntervalSeconds);

    for (const prov of Object.values(state.provinces)) {
      if (prov.owner !== 'neutral') continue;
      if (state.battles.some((b) => b.provinceId === prov.id)) continue;

      if (prov.garrison.soldier < 14) {
        prov.garrison.soldier += 1;
      }
      if (wave % 2 === 0 && prov.garrison.scout < 6) {
        prov.garrison.scout += 1;
      }

      const maxDef = wave >= 8 ? 2 : 1;
      if (wave % 2 === 1) {
        if (prov.defenses.bunkers < maxDef) {
          prov.defenses.bunkers += 1;
        } else if (prov.defenses.trenches < maxDef) {
          prov.defenses.trenches += 1;
        } else if (
          (prov.terrain === 'coastal' || prov.seaNeighbors.length > 0) &&
          prov.defenses.naval_defense < maxDef
        ) {
          prov.defenses.naval_defense += 1;
        }
      }
    }
  }
}