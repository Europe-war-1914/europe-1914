import { BLITZ_CONFIG } from '../data/balance';
import { createInitialNations, PLAYABLE_NATIONS } from '../data/nations';
import { createInitialProvinces } from '../data/provinces';
import { tickAI } from './ai';
import { cloneStack, eliminateNation, tickMovementsAndCombat } from './combat';
import { pushTelegram, tickEconomy } from './economy';
import type { GameState, NationId, PlayableNationId, Province } from './types';

export interface NationStanding {
  nationId: PlayableNationId;
  victoryPoints: number;
  provincesCount: number;
  isEliminated: boolean;
}

export function createNewGame(playerNationId: PlayableNationId): GameState {
  const nations = createInitialNations(playerNationId);
  const provinces = createInitialProvinces();

  for (const prov of Object.values(provinces)) {
    if (prov.isCapital && prov.owner !== 'neutral') {
      nations[prov.owner].capitalProvinceId = prov.id;
    }
  }

  const state: GameState = {
    mode: 'blitz',
    phase: 'MOBILIZATION',
    elapsedSeconds: 0,
    maxDurationSeconds: BLITZ_CONFIG.maxDurationSeconds,
    mobilizationDurationSeconds: BLITZ_CONFIG.mobilizationDurationSeconds,
    lastAiTickAt: 0,
    playerNationId,
    nations,
    provinces,
    movingArmies: [],
    battles: [],
    constructions: [],
    recruitments: [],
    diplomacy: {},
    pendingOffers: [],
    telegrams: [],
    tutorialStep: 1,
    eliminationOrder: [],
    winnerId: null,
  };

  pushTelegram(
    state,
    'Mobilisation générale (2m30) : protégez votre capitale et préparez vos offensives pour conquérir les capitales ennemies.',
    'info'
  );

  return state;
}

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
    eliminationOrder: state.eliminationOrder ? [...state.eliminationOrder] : [],
  };
}

export function getVictoryStandings(state: GameState): {
  standings: NationStanding[];
  totalVictoryPoints: number;
  targetVictoryPoints: number;
  aliveCount: number;
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

  const elimOrder = state.eliminationOrder ?? [];
  const standings: NationStanding[] = PLAYABLE_NATIONS.map((nationId) => ({
    nationId,
    victoryPoints: vpMap[nationId],
    provincesCount: countMap[nationId],
    isEliminated: Boolean(state.nations[nationId]?.isEliminated),
  })).sort((a, b) => {
    if (a.isEliminated !== b.isEliminated) {
      return a.isEliminated ? 1 : -1;
    }
    if (a.isEliminated && b.isEliminated) {
      return elimOrder.indexOf(b.nationId) - elimOrder.indexOf(a.nationId);
    }
    return b.victoryPoints - a.victoryPoints || b.provincesCount - a.provincesCount;
  });

  const aliveCount = standings.filter((s) => !s.isEliminated).length;

  return {
    standings,
    totalVictoryPoints,
    targetVictoryPoints: Math.ceil(totalVictoryPoints * BLITZ_CONFIG.victoryShareThreshold),
    aliveCount,
  };
}

export function stepGameState(prevState: GameState, dtRealSeconds: number): GameState {
  if (prevState.phase === 'LOBBY' || prevState.phase === 'ENDED') {
    return prevState;
  }

  const state = cloneGameState(prevState);
  state.elapsedSeconds += dtRealSeconds;

  if (
    state.phase === 'MOBILIZATION' &&
    state.elapsedSeconds >= state.mobilizationDurationSeconds
  ) {
    state.phase = 'WAR';
    pushTelegram(
      state,
      'Fin de la mobilisation ! Les frontières s’ouvrent : prenez les capitales ennemies !',
      'danger'
    );
  }

  tickEconomy(state, dtRealSeconds);
  tickMovementsAndCombat(state);
  tickAI(state);

  // Vérifie si une capitale a été perdue
  for (const nationId of PLAYABLE_NATIONS) {
    const nation = state.nations[nationId];
    if (!nation || nation.isEliminated) continue;
    const capId = nation.capitalProvinceId;
    if (capId && state.provinces[capId]?.owner !== nationId) {
      eliminateNation(state, nationId);
    }
  }

  const { standings } = getVictoryStandings(state);
  const alive = standings.filter((s) => !s.isEliminated);

  // Victoire dès qu'il ne reste plus qu'une seule capitale debout, ou au temps limite
  if (alive.length <= 1) {
    state.phase = 'ENDED';
    state.winnerId = alive[0]?.nationId ?? standings[0].nationId;
  } else if (state.elapsedSeconds >= state.maxDurationSeconds) {
    state.phase = 'ENDED';
    state.winnerId = alive[0].nationId;
  }

  return state;
}