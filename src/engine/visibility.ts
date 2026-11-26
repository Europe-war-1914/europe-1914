import { getDiplomaticStatus } from './diplomacy';
import type { GameState, MovingArmy, NationId } from './types';

export function hasIntelOnProvince(
  state: GameState,
  provinceId: string,
  viewerId: NationId = state.playerNationId
): boolean {
  if (state.devMode || !state.fogOfWar) return true;

  const prov = state.provinces[provinceId];
  if (!prov) return false;

  if (
    prov.owner === viewerId ||
    getDiplomaticStatus(state, viewerId, prov.owner) === 'alliance'
  ) {
    return true;
  }

  const adjacentIds = [...prov.neighbors, ...prov.seaNeighbors];
  for (const adjId of adjacentIds) {
    const adj = state.provinces[adjId];
    if (!adj) continue;
    if (
      adj.owner === viewerId ||
      getDiplomaticStatus(state, viewerId, adj.owner) === 'alliance'
    ) {
      return true;
    }
  }

  const hasFriendlyBattle = state.battles.some(
    (b) =>
      b.provinceId === provinceId &&
      (b.attacker === viewerId ||
        b.defender === viewerId ||
        getDiplomaticStatus(state, viewerId, b.attacker) === 'alliance')
  );
  if (hasFriendlyBattle) return true;

  return state.movingArmies.some(
    (a) =>
      (a.owner === viewerId || getDiplomaticStatus(state, viewerId, a.owner) === 'alliance') &&
      (a.toProvinceId === provinceId || a.fromProvinceId === provinceId)
  );
}

export function isMovingArmyVisibleTo(
  state: GameState,
  army: MovingArmy,
  viewerId: NationId = state.playerNationId
): boolean {
  if (state.devMode) return true;

  if (
    army.owner === viewerId ||
    getDiplomaticStatus(state, viewerId, army.owner) === 'alliance'
  ) {
    return true;
  }

  if (army.isSubmarineMission) {
    if (army.landingStartedAt !== undefined) return true;
    return Boolean(army.detectedBy?.includes(viewerId));
  }

  if (!state.fogOfWar) return true;

  return (
    hasIntelOnProvince(state, army.fromProvinceId, viewerId) ||
    hasIntelOnProvince(state, army.toProvinceId, viewerId)
  );
}