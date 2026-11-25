import { GAME_CONFIG } from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import { createId, pushTelegram } from './economy';
import type { DiplomaticStatus, GameState, NationId, PlayableNationId } from './types';

export function diplomacyKey(a: NationId, b: NationId): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function getDiplomaticStatus(
  state: GameState,
  a: NationId,
  b: NationId
): DiplomaticStatus {
  if (a === b) return 'alliance';
  if (a === 'neutral' || b === 'neutral') return 'neutral';
  return state.diplomacy[diplomacyKey(a, b)] ?? 'neutral';
}

export function setDiplomaticStatus(
  state: GameState,
  a: NationId,
  b: NationId,
  status: DiplomaticStatus
): void {
  if (a === b || a === 'neutral' || b === 'neutral') return;
  const prev = getDiplomaticStatus(state, a, b);
  state.diplomacy[diplomacyKey(a, b)] = status;

  const nationA = state.nations[a];
  const nationB = state.nations[b];
  if (!nationA || !nationB) return;

  if (status === 'alliance') {
    nationA.activeAllianceWith = b as PlayableNationId;
    nationB.activeAllianceWith = a as PlayableNationId;
  } else if (prev === 'alliance') {
    if (nationA.activeAllianceWith === b) nationA.activeAllianceWith = null;
    if (nationB.activeAllianceWith === a) nationB.activeAllianceWith = null;
  }
}

export function clearNationAlliances(state: GameState, nationId: PlayableNationId): void {
  const nation = state.nations[nationId];
  if (!nation?.activeAllianceWith) return;
  const allyId = nation.activeAllianceWith;
  setDiplomaticStatus(state, nationId, allyId, 'neutral');
}

/** Action diplomatique (Guerre, Trahison payante, Paix ou Proposition d'Alliance payante) */
export function requestDiplomaticAction(
  state: GameState,
  actorId: PlayableNationId,
  targetId: PlayableNationId,
  desiredStatus: DiplomaticStatus
): { ok: boolean; reason?: string } {
  if (actorId === targetId) return { ok: false, reason: 'Cible diplomatique invalide.' };

  const actor = state.nations[actorId];
  const target = state.nations[targetId];
  if (!actor || !target || actor.isEliminated || target.isEliminated) {
    return { ok: false, reason: 'Nation éliminée.' };
  }

  const current = getDiplomaticStatus(state, actorId, targetId);
  if (current === desiredStatus) {
    return { ok: false, reason: 'Ce statut diplomatique est déjà en vigueur.' };
  }

  const actorName = NATION_TEMPLATES[actorId].shortName;
  const targetName = NATION_TEMPLATES[targetId].shortName;

  // 1. Déclaration de guerre ou rupture d'alliance (Trahison = coût fixe en or)
  if (desiredStatus === 'war') {
    if (current === 'alliance') {
      if (actor.resources.gold < GAME_CONFIG.betrayalCostGold) {
        return {
          ok: false,
          reason: `Trahir une alliance coûte ${GAME_CONFIG.betrayalCostGold} Or.`,
        };
      }
      actor.resources.gold -= GAME_CONFIG.betrayalCostGold;
      setDiplomaticStatus(state, actorId, targetId, 'war');
      pushTelegram(
        state,
        `Trahison ! ${actorName} rompt son alliance avec ${targetName} (-${GAME_CONFIG.betrayalCostGold} Or) et déclare la guerre !`,
        'danger'
      );
      return { ok: true };
    }

    setDiplomaticStatus(state, actorId, targetId, 'war');
    pushTelegram(state, `Guerre déclarée entre ${actorName} et ${targetName} !`, 'danger');
    return { ok: true };
  }

  // 2. Rompre une alliance pour redevenir neutre (coût fixe de trahison en or)
  if (desiredStatus === 'neutral' && current === 'alliance') {
    if (actor.resources.gold < GAME_CONFIG.betrayalCostGold) {
      return {
        ok: false,
        reason: `Rompre une alliance coûte ${GAME_CONFIG.betrayalCostGold} Or.`,
      };
    }
    actor.resources.gold -= GAME_CONFIG.betrayalCostGold;
    setDiplomaticStatus(state, actorId, targetId, 'neutral');
    pushTelegram(
      state,
      `${actorName} rompt son alliance avec ${targetName} (-${GAME_CONFIG.betrayalCostGold} Or).`,
      'diplomacy'
    );
    return { ok: true };
  }

  // 3. Proposition de Paix (si en guerre) ou d'Alliance (max 1 alliance + coût fixe en or)
  const offerType: 'alliance' | 'peace' = desiredStatus === 'alliance' ? 'alliance' : 'peace';

  const duplicate = state.pendingOffers.some(
    (o) => o.from === actorId && o.to === targetId && o.type === offerType
  );
  if (duplicate) {
    return { ok: false, reason: 'Une proposition est déjà en cours d’examen.' };
  }

  let goldEscrow = 0;
  if (offerType === 'alliance') {
    if (actor.activeAllianceWith !== null) {
      return {
        ok: false,
        reason: `Limite atteinte : vous êtes déjà allié avec ${NATION_TEMPLATES[actor.activeAllianceWith].shortName} (1 alliance max).`,
      };
    }
    if (target.activeAllianceWith !== null) {
      return {
        ok: false,
        reason: `${targetName} possède déjà une alliance active.`,
      };
    }
    if (actor.resources.gold < GAME_CONFIG.allianceCostGold) {
      return {
        ok: false,
        reason: `Former une alliance coûte ${GAME_CONFIG.allianceCostGold} Or.`,
      };
    }
    actor.resources.gold -= GAME_CONFIG.allianceCostGold;
    goldEscrow = GAME_CONFIG.allianceCostGold;
  }

  // Si la cible est une IA, elle prend du temps avant d'accepter ou refuser
  const aiThinkDelay = !target.isPlayer
    ? GAME_CONFIG.aiDiplomacyMinThinkSeconds +
      Math.random() *
        (GAME_CONFIG.aiDiplomacyMaxThinkSeconds - GAME_CONFIG.aiDiplomacyMinThinkSeconds)
    : undefined;

  state.pendingOffers.push({
    id: createId('dip'),
    from: actorId,
    to: targetId,
    type: offerType,
    goldEscrow,
    createdAt: state.elapsedSeconds,
    expiresAt: state.elapsedSeconds + 60,
    aiDecisionAt: aiThinkDelay !== undefined ? state.elapsedSeconds + aiThinkDelay : undefined,
  });

  const label = offerType === 'alliance' ? 'une Alliance' : 'un Traité de paix';
  pushTelegram(
    state,
    `Diplomatie : ${actorName} propose ${label} à ${targetName}${
      aiThinkDelay !== undefined ? ' (réflexion en cours...)' : ''
    }.`,
    'diplomacy'
  );

  return { ok: true };
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

  const fromNation = state.nations[offer.from];
  const toNation = state.nations[offer.to];
  if (!fromNation || !toNation || fromNation.isEliminated || toNation.isEliminated) {
    return { ok: false, reason: 'Nation éliminée.' };
  }

  const fromName = NATION_TEMPLATES[offer.from].shortName;
  const toName = NATION_TEMPLATES[offer.to].shortName;

  if (!accept) {
    if (offer.goldEscrow) {
      fromNation.resources.gold += offer.goldEscrow;
    }
    pushTelegram(state, `Diplomatie : ${toName} a décliné l’offre de ${fromName}.`, 'diplomacy');
    return { ok: true };
  }

  if (offer.type === 'alliance') {
    if (fromNation.activeAllianceWith !== null || toNation.activeAllianceWith !== null) {
      if (offer.goldEscrow) fromNation.resources.gold += offer.goldEscrow;
      return { ok: false, reason: 'L’une des deux nations a déjà une alliance active.' };
    }
    // Si l'offre venait d'une IA vers un joueur sans escrow préalable, le joueur paie le coût fixe
    if (!offer.goldEscrow) {
      if (toNation.resources.gold < GAME_CONFIG.allianceCostGold) {
        return {
          ok: false,
          reason: `Il faut ${GAME_CONFIG.allianceCostGold} Or pour signer cette alliance.`,
        };
      }
      toNation.resources.gold -= GAME_CONFIG.allianceCostGold;
    }
    setDiplomaticStatus(state, offer.from, offer.to, 'alliance');
  } else {
    setDiplomaticStatus(state, offer.from, offer.to, 'neutral');
  }

  // Stoppe immédiatement les combats entre les deux signataires
  state.battles = state.battles.filter(
    (b) =>
      !(
        (b.attacker === offer.from && b.defender === offer.to) ||
        (b.attacker === offer.to && b.defender === offer.from)
      )
  );

  const label =
    offer.type === 'alliance'
      ? `Alliance scellée entre ${fromName} et ${toName} !`
      : `Traité de paix signé entre ${fromName} et ${toName}.`;
  pushTelegram(state, label, 'diplomacy');

  return { ok: true };
}

/** Traite les offres expirées et les réponses différées des IA */
export function tickPendingDiplomacy(state: GameState): void {
  const stillPending = [];

  for (const offer of state.pendingOffers) {
    if (offer.expiresAt <= state.elapsedSeconds) {
      const fromNation = state.nations[offer.from];
      if (fromNation && offer.goldEscrow) {
        fromNation.resources.gold += offer.goldEscrow;
      }
      continue;
    }
    stillPending.push(offer);
  }
  state.pendingOffers = stillPending;

  // Résolution des offres adressées à des IA après leur temps de réflexion
  const readyAiOffers = state.pendingOffers.filter(
    (o) => o.aiDecisionAt !== undefined && state.elapsedSeconds >= o.aiDecisionAt
  );

  for (const offer of readyAiOffers) {
    const aiNation = state.nations[offer.to];
    if (!aiNation || aiNation.isPlayer || aiNation.isEliminated) continue;

    let shouldAccept = false;
    if (offer.type === 'peace') {
      const aiProvCount = Object.values(state.provinces).filter((p) => p.owner === offer.to).length;
      const fromProvCount = Object.values(state.provinces).filter(
        (p) => p.owner === offer.from
      ).length;
      shouldAccept = aiProvCount <= fromProvCount + 2 || Math.random() < 0.55;
    } else if (offer.type === 'alliance') {
      if (aiNation.activeAllianceWith === null) {
        const baseChance =
          aiNation.personality === 'diplomat'
            ? 0.78
            : aiNation.personality === 'fortress'
            ? 0.65
            : 0.45;
        shouldAccept = Math.random() < baseChance;
      }
    }

    respondToDiplomaticOffer(state, offer.id, shouldAccept);
  }
}