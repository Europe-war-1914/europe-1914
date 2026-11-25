import { getDiplomaticStatus } from './diplomacy';
import type { GameState, MovingArmy, NationId } from './types';

export function hasIntelOnProvince(state: GameState, provinceId: string): boolean {
  if (state.fogOfWar === false) return true;

  const prov = state.provinces[provinceId];
  if (!prov) return false;

  const player = state.playerNationId;

  if (prov.owner === player || getDiplomaticStatus(state, player, prov.owner) === 'alliance') {
    return true;
  }

  if (
    state.battles.some(
      (b) => b.provinceId === provinceId && (b.attacker === player || b.defender === player)
    )
  ) {
    return true;
  }

  if (
    state.movingArmies.some(
      (m) =>
        m.owner === player &&
        (m.fromProvinceId === provinceId ||
          m.toProvinceId === provinceId ||
          m.targetProvinceId === provinceId)
    )
  ) {
    return true;
  }

  const adjacentIds = [...prov.neighbors, ...prov.seaNeighbors];
  return adjacentIds.some((adjId) => {
    const adj = state.provinces[adjId];
    if (!adj) return false;
    return adj.owner === player || getDiplomaticStatus(state, player, adj.owner) === 'alliance';
  });
}

/** Détermine si une armée en mouvement (notamment un sous-marin furtif) est visible pour un observateur */
export function isMovingArmyVisibleTo(
  state: GameState,
  army: MovingArmy,
  viewer: NationId
): boolean {
  if (army.owner === viewer) return true;
  if (getDiplomaticStatus(state, army.owner, viewer) === 'alliance') return true;

  // Sous-marin : invisible sauf débarquement annoncé (10 s) ou détection par Défense marine / Frégate
  if (army.isSubmarineMission) {
    if (army.landingStartedAt !== undefined && state.provinces[army.toProvinceId]?.owner === viewer) {
      return true;
    }
    return Boolean(army.detectedBy?.includes(viewer));
  }

  if (state.fogOfWar === false) return true;

  return (
    hasIntelOnProvince(state, army.fromProvinceId) ||
    hasIntelOnProvince(state, army.toProvinceId)
  );
}