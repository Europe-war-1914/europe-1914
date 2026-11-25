import { createClient } from '@supabase/supabase-js';
import { PLAYABLE_NATIONS } from '../src/data/nations';
import { getVictoryStandings } from '../src/engine/gameLoop';
import type { GameState, PlayableNationId } from '../src/engine/types';

export interface EloResult {
  userId?: string;
  username: string;
  nationId: PlayableNationId;
  rank: number;
  oldElo: number;
  newElo: number;
  delta: number;
  isWinner: boolean;
  botsAlive: number;
  humansAlive: number;
  botsEliminated: number;
  humansEliminated: number;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

/**
 * Calcule le delta ELO exact :
 * - Éliminés : -4 ELO / bot en vie, -3 ELO / joueur en vie, +2 ELO / bot éliminé, +3 ELO / joueur éliminé
 * - Vainqueur : +2 ELO / bot éliminé, +3 ELO / joueur éliminé + bonus de 5 points
 */
export function computeNationEloDelta(
  state: GameState,
  targetNationId: PlayableNationId,
  participants: Map<PlayableNationId, { userId?: string; name: string }>,
  isWinner: boolean
): {
  delta: number;
  botsAlive: number;
  humansAlive: number;
  botsEliminated: number;
  humansEliminated: number;
} {
  let botsAlive = 0;
  let humansAlive = 0;
  let botsEliminated = 0;
  let humansEliminated = 0;

  if (isWinner) {
    for (const oppId of PLAYABLE_NATIONS) {
      if (oppId === targetNationId) continue;
      if (participants.has(oppId)) humansEliminated += 1;
      else botsEliminated += 1;
    }
    const delta = botsEliminated * 2 + humansEliminated * 3 + 5;
    return { delta, botsAlive, humansAlive, botsEliminated, humansEliminated };
  }

  const { standings } = getVictoryStandings(state);
  const rankMap = new Map<PlayableNationId, number>();
  standings.forEach((row, idx) => rankMap.set(row.nationId, idx + 1));
  const myRank = rankMap.get(targetNationId) ?? 8;

  for (const oppId of PLAYABLE_NATIONS) {
    if (oppId === targetNationId) continue;
    const isHuman = participants.has(oppId);
    const oppEliminated = Boolean(state.nations[oppId]?.isEliminated);
    const oppRank = rankMap.get(oppId) ?? 8;
    const eliminatedBeforeMe = oppEliminated && oppRank > myRank;

    if (eliminatedBeforeMe) {
      if (isHuman) humansEliminated += 1;
      else botsEliminated += 1;
    } else {
      if (isHuman) humansAlive += 1;
      else botsAlive += 1;
    }
  }

  const delta =
    -4 * botsAlive -
    3 * humansAlive +
    2 * botsEliminated +
    3 * humansEliminated;

  return { delta, botsAlive, humansAlive, botsEliminated, humansEliminated };
}

export async function syncEliminatedAndFinalElo(
  state: GameState,
  participants: Map<PlayableNationId, { userId?: string; name: string }>,
  alreadyProcessed: Set<PlayableNationId>
): Promise<Record<string, EloResult>> {
  const newResults: Record<string, EloResult> = {};
  const { standings } = getVictoryStandings(state);
  const rankByNation = new Map<PlayableNationId, number>();
  standings.forEach((row, idx) => rankByNation.set(row.nationId, idx + 1));

  const toProcess: [PlayableNationId, { userId?: string; name: string }][] = [];
  for (const [nationId, info] of participants.entries()) {
    if (alreadyProcessed.has(nationId)) continue;
    const isEliminated = Boolean(state.nations[nationId]?.isEliminated);
    if (isEliminated || state.phase === 'ENDED') {
      toProcess.push([nationId, info]);
    }
  }

  if (toProcess.length === 0) return newResults;

  const userIds = toProcess
    .map(([, p]) => p.userId)
    .filter((id): id is string => Boolean(id));

  const profileById = new Map<
    string,
    { id: string; username: string; elo: number; wins: number; games_played: number }
  >();

  if (supabaseAdmin && userIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, elo, wins, games_played')
      .in('id', userIds);

    if (error) {
      console.error('[ELO] Erreur lecture profils Supabase :', error);
    } else if (data) {
      for (const row of data) {
        profileById.set(row.id as string, {
          id: row.id as string,
          username: (row.username as string) || 'Commandant',
          elo: typeof row.elo === 'number' ? row.elo : 1000,
          wins: typeof row.wins === 'number' ? row.wins : 0,
          games_played: typeof row.games_played === 'number' ? row.games_played : 0,
        });
      }
    }
  }

  for (const [nationId, participant] of toProcess) {
    alreadyProcessed.add(nationId);
    const isWinner = state.phase === 'ENDED' && state.winnerId === nationId;
    const breakdown = computeNationEloDelta(state, nationId, participants, isWinner);
    const prof = participant.userId ? profileById.get(participant.userId) : undefined;

    const oldElo = prof ? prof.elo : 1000;
    const newElo = Math.max(100, oldElo + breakdown.delta);
    const appliedDelta = newElo - oldElo;

    if (supabaseAdmin && participant.userId && prof) {
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          elo: newElo,
          wins: prof.wins + (isWinner ? 1 : 0),
          games_played: prof.games_played + 1,
        })
        .eq('id', participant.userId);

      if (updateError) {
        console.error(`[ELO] Erreur mise à jour Supabase pour ${participant.userId} :`, updateError);
      }
    }

    newResults[nationId] = {
      userId: participant.userId,
      username: prof?.username || participant.name,
      nationId,
      rank: rankByNation.get(nationId) ?? 8,
      oldElo,
      newElo,
      delta: appliedDelta,
      isWinner,
      botsAlive: breakdown.botsAlive,
      humansAlive: breakdown.humansAlive,
      botsEliminated: breakdown.botsEliminated,
      humansEliminated: breakdown.humansEliminated,
    };
  }

  return newResults;
}