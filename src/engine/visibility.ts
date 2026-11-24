import { getDiplomaticStatus } from './combat';
import type { GameState, NationId } from './types';

/**
 * Retourne true si le joueur dispose de renseignements précis sur une province :
 * - province possédée ou alliée
 * - province adjacente (terre ou mer) à une province possédée ou alliée
 * - armée du joueur en route vers/depuis cette province, ou combat en cours
 */
export function hasIntelOnProvince(
  state: GameState,
  provinceId: string,
  viewerId: NationId = state.playerNationId
): boolean {
  const prov = state.provinces[provinceId];
  if (!prov) return false;

  if (prov.owner === viewerId) return true;
  if (getDiplomaticStatus(state, viewerId, prov.owner) === 'alliance') return true;

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

  const hasArmyNearby = state.movingArmies.some(
    (a) =>
      a.owner === viewerId &&
      (a.toProvinceId === provinceId || a.fromProvinceId === provinceId)
  );
  if (hasArmyNearby) return true;

  const hasBattleHere = state.battles.some(
    (b) =>
      b.provinceId === provinceId &&
      (b.attacker === viewerId || b.defender === viewerId)
  );
  if (hasBattleHere) return true;

  return false;
}