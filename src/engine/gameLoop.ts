import { BLITZ_CONFIG } from '../data/balance';
import { createInitialNations, PLAYABLE_NATIONS } from '../data/nations';
import { createInitialProvinces } from '../data/provinces';
import { tickAI } from './ai';
import { cloneStack, tickMovementsAndCombat } from './combat';
import { pushTelegram, tickEconomy } from './economy';
import type { GameState, NationId, PlayableNationId, Province } from './types';

export interface NationStanding {
  nationId: PlayableNationId;
  victoryPoints: number;
  provincesCount: number;
}

export function createNewGame(playerNationId: PlayableNationId): GameState {
  const state: GameState = {
    mode: 'blitz',
    phase: 'MOBILIZATION',
    elapsedSeconds: 0,
    lastAiTickAt: 0,
    maxDurationSeconds: BLITZ_CONFIG.maxDurationSeconds,
    mobilizationDurationSeconds: BLITZ_CONFIG.mobilizationDurationSeconds,
    playerNationId,
    nations: createInitialNations(playerNationId),
    provinces: createInitialProvinces(),
    movingArmies: [],
    battles: [],
    constructions: [],
    recruitments: [],
    diplomacy: {},
    pendingOffers: [],
    telegrams: [],
    tutorialStep: 1,
    winnerId: null,
  };

  pushTelegram(
    state,
    'Mobilisation générale (2m30) : construisez vos usines, formez votre armée et placez vos divisions aux frontières.',
    'info'
  );

  return state;
}

// Copie rapide de l'état mutable tout en partageant la géométrie fixe des polygones
export function cloneGameState(state: GameState): GameState {
  const nations = {} as GameState['nations'];
  for (const key of Object.keys(state.nations) as NationId[]) {
    const n = state.nations[key];
    nations[key] = { ...n, resources: { ...n.resources } };
  }

  const provinces: Record<string, Province> = {};
  for (const [id, p] of Object.entries(state.provinces)) {
    provinces[id] = {
      ...p,
      buildings: { ...p.buildings },
      garrison: cloneStack(p.garrison),
    };
  }

  return {
    ...state,
    nations,
    provinces,
    movingArmies: state.movingArmies.map((a) => ({ ...a, units: cloneStack(a.units) })),
    battles: state.battles.map((b) => ({
      ...b,
      attackerUnits: cloneStack(b.attackerUnits),
      defenderUnits: cloneStack(b.defenderUnits),
    })),
    constructions: state.constructions.map((c) => ({ ...c })),
    recruitments: state.recruitments.map((r) => ({ ...r })),
    diplomacy: { ...state.diplomacy },
    pendingOffers: state.pendingOffers.map((o) => ({ ...o })),
    telegrams: state.telegrams.map((t) => ({ ...t })),
  };
}

export function getVictoryStandings(state: GameState): {
  standings: NationStanding[];
  totalVictoryPoints: number;
  targetVictoryPoints: number;
} {
  let totalVictoryPoints = 0;
  const vpMap: Record<PlayableNationId, number> = {
    france: 0,
    germany: 0,
    uk: 0,
    italy: 0,
    austria: 0,
    russia: 0,
    spain: 0,
    ottoman: 0,
  };
  const countMap: Record<PlayableNationId, number> = { ...vpMap };

  for (const prov of Object.values(state.provinces)) {
    totalVictoryPoints += prov.victoryPoints;
    if (prov.owner !== 'neutral') {
      vpMap[prov.owner] += prov.victoryPoints;
      countMap[prov.owner] += 1;
    }
  }

  const standings: NationStanding[] = PLAYABLE_NATIONS.map((nationId) => ({
    nationId,
    victoryPoints: vpMap[nationId],
    provincesCount: countMap[nationId],
  })).sort((a, b) => b.victoryPoints - a.victoryPoints || b.provincesCount - a.provincesCount);

  return {
    standings,
    totalVictoryPoints,
    targetVictoryPoints: Math.ceil(totalVictoryPoints * BLITZ_CONFIG.victoryShareThreshold),
  };
}

export function stepGameState(prevState: GameState, dtRealSeconds: number): GameState {
  if (prevState.phase === 'LOBBY' || prevState.phase === 'ENDED') {
    return prevState;
  }

  const state = cloneGameState(prevState);
  const dt = dtRealSeconds;
  state.elapsedSeconds += dt;

  // Fin de la phase de mobilisation -> Ouverture officielle des hostilités
  if (
    state.phase === 'MOBILIZATION' &&
    state.elapsedSeconds >= state.mobilizationDurationSeconds
  ) {
    state.phase = 'WAR';
    pushTelegram(
      state,
      'Fin de la mobilisation ! Les frontières s’ouvrent : les offensives sont désormais autorisées.',
      'danger'
    );
  }

  tickEconomy(state, dt);
  tickMovementsAndCombat(state);
  tickAI(state);

  // Mise à jour des nations éliminées et vérification de la victoire
  const { standings, targetVictoryPoints } = getVictoryStandings(state);
  for (const row of standings) {
    state.nations[row.nationId].isEliminated = row.provincesCount === 0;
  }

  const leader = standings[0];
  if (leader && leader.victoryPoints >= targetVictoryPoints) {
    state.phase = 'ENDED';
    state.winnerId = leader.nationId;
  } else if (state.elapsedSeconds >= state.maxDurationSeconds && leader) {
    state.phase = 'ENDED';
    state.winnerId = leader.nationId;
  }

  return state;
}