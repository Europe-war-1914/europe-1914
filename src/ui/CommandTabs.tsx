import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Hammer,
  Handshake,
  MessageSquare,
  Radio,
  RotateCcw,
  Send,
  ShieldAlert,
  Swords,
} from 'lucide-react';
import {
  DEFENSE_LABELS,
  EXTRACTION_LABELS,
  GAME_CONFIG,
  UNIT_ORDER,
  UNIT_SPECS,
} from '../data/balance';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from '../data/nations';
import { totalStack } from '../engine/combat';
import { getDiplomaticStatus } from '../engine/diplomacy';
import type {
  ConstructionOrder,
  DefenseType,
  DiplomaticStatus,
  ExtractionResource,
  GameState,
  PlayableNationId,
} from '../engine/types';
import type { ChatMessage, RoomPlayer } from '../network/protocol';

type TabKey = 'armies' | 'ops' | 'diplomacy' | 'telegrams' | 'chat';

interface CommandTabsProps {
  state: GameState;
  isOnline?: boolean;
  roomPlayers?: RoomPlayer[];
  chatMessages?: ChatMessage[];
  onSendChat?: (
    channel: 'global' | 'private',
    text: string,
    toNationId?: PlayableNationId
  ) => void;
  onFocusProvince: (provinceId: string) => void;
  onTurnAround: (armyId: string) => void;
  onRetreat: (battleId: string) => void;
  onSetDiplomacy: (target: PlayableNationId, status: DiplomaticStatus) => void;
  onRespondOffer: (offerId: string, accept: boolean) => void;
}

const STATUS_BADGE: Record<DiplomaticStatus, { label: string; cls: string }> = {
  war: { label: 'Guerre', cls: 'border-red-500/40 bg-red-950/70 text-red-200' },
  neutral: { label: 'Neutre', cls: 'border-stone-600/50 bg-stone-800/80 text-stone-300' },
  nap: { label: 'Pacte (NAP)', cls: 'border-amber-500/40 bg-amber-950/70 text-amber-200' },
  alliance: { label: 'Allié', cls: 'border-sky-500/40 bg-sky-950/70 text-sky-200' },
};

function formatConstructionLabel(c: ConstructionOrder): string {
  if (c.kind === 'barracks') return `Caserne (niv. ${c.targetLevel})`;
  if (c.kind === 'laboratory') return `Laboratoire (niv. ${c.targetLevel})`;
  if (c.kind === 'extraction') {
    const key = (c.resource ?? c.targetKey) as ExtractionResource;
    return `${EXTRACTION_LABELS[key]} (niv. ${c.targetLevel})`;
  }
  const defKey = (c.defense ?? c.targetKey) as DefenseType;
  return `${DEFENSE_LABELS[defKey]} (niv. ${c.targetLevel})`;
}

export function CommandTabs({
  state,
  isOnline = false,
  roomPlayers = [],
  chatMessages = [],
  onSendChat,
  onFocusProvince,
  onTurnAround,
  onRetreat,
  onSetDiplomacy,
  onRespondOffer,
}: CommandTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey | null>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 640 ? 'armies' : null
  );
  const [chatChannel, setChatChannel] = useState<'global' | 'private'>('global');
  const [chatTargetNation, setChatTargetNation] = useState<PlayableNationId>('germany');
  const [chatInput, setChatInput] = useState('');

  const myArmies = state.movingArmies.filter((a) => a.owner === state.playerNationId);
  const myBattles = state.battles.filter(
    (b) => b.attacker === state.playerNationId || b.defender === state.playerNationId
  );
  const myConstructions = state.constructions.filter((c) => c.owner === state.playerNationId);
  const myRecruitments = state.recruitments.filter((r) => r.owner === state.playerNationId);
  const incomingOffers = state.pendingOffers.filter((o) => o.to === state.playerNationId);

  const playerNation = state.nations[state.playerNationId];

  useEffect(() => {
    const otherNations = PLAYABLE_NATIONS.filter((id) => id !== state.playerNationId);
    if (otherNations.length > 0 && !otherNations.includes(chatTargetNation)) {
      setChatTargetNation(otherNations[0]);
    }
  }, [state.playerNationId, chatTargetNation]);

  const handleTabClick = (key: TabKey) => {
    setActiveTab((prev) => (prev === key ? null : key));
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || !onSendChat) return;
    onSendChat(
      chatChannel,
      trimmed,
      chatChannel === 'private' ? chatTargetNation : undefined
    );
    setChatInput('');
  };

  const tabs: {
    key: TabKey;
    label: string;
    icon: typeof Swords;
    badge?: number;
    onlineOnly?: boolean;
  }[] = [
    {
      key: 'armies',
      label: 'Armées',
      icon: Swords,
      badge: myArmies.length + myBattles.length || undefined,
    },
    {
      key: 'ops',
      label: 'Chantiers',
      icon: Hammer,
      badge: myConstructions.length + myRecruitments.length || undefined,
    },
    {
      key: 'diplomacy',
      label: 'Diplomatie',
      icon: Handshake,
      badge: incomingOffers.length || undefined,
    },
    {
      key: 'telegrams',
      label: 'Dépêches',
      icon: Radio,
    },
    {
      key: 'chat',
      label: 'Chat',
      icon: MessageSquare,
      badge: isOnline ? chatMessages.length || undefined : undefined,
      onlineOnly: true,
    },
  ];

  const visibleTabs = tabs.filter((t) => !t.onlineOnly || isOnline);

  return (
    <aside className="fixed bottom-24 left-2 z-20 flex items-start gap-1.5 sm:bottom-auto sm:left-3 sm:top-16 font-sans">
      <div className="flex flex-col gap-1 rounded-lg border border-stone-700/90 bg-stone-950/92 p-1 shadow-xl backdrop-blur-sm">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const isOpen = activeTab === t.key;
          return (
            <button
              type="button"
              key={t.key}
              onClick={() => handleTabClick(t.key)}
              title={t.label}
              className={`relative flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-md transition ${
                isOpen
                  ? 'bg-amber-600 text-stone-950 shadow'
                  : 'text-stone-300 hover:bg-stone-800 hover:text-amber-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t.badge !== undefined && (
                <span
                  className={`absolute -right-1 -top-1 flex h-3.5 min-w-3.5 sm:h-4 sm:min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                    isOpen ? 'bg-stone-950 text-amber-300' : 'bg-red-600 text-white'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}

        {activeTab && (
          <button
            type="button"
            onClick={() => setActiveTab(null)}
            title="Replier le panneau"
            className="flex h-6 w-7 sm:h-7 sm:w-9 items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {activeTab && (
        <div className="max-h-[30vh] sm:max-h-[48vh] w-56 sm:w-80 overflow-y-auto rounded-lg border border-stone-700/90 bg-stone-950/95 p-2.5 sm:p-3 text-xs text-stone-100 shadow-2xl backdrop-blur-sm">
          {activeTab === 'armies' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-stone-800 pb-1.5">
                <span className="font-serif text-xs sm:text-sm font-bold text-amber-100">
                  Forces & Combats
                </span>
                <span className="text-[10px] text-stone-400">
                  {myArmies.length} mvt • {myBattles.length} front
                </span>
              </div>

              {myBattles.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                    Batailles en cours
                  </p>
                  {myBattles.map((b) => {
                    const prov = state.provinces[b.provinceId];
                    const isAttacker = b.attacker === state.playerNationId;
                    return (
                      <div
                        key={b.id}
                        className="rounded border border-red-500/30 bg-red-950/25 p-2"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => onFocusProvince(b.provinceId)}
                            className="font-bold text-amber-100 hover:underline text-left"
                          >
                            {prov?.name}
                          </button>
                          <span className="text-[10px] font-semibold text-red-300">
                            {isAttacker ? 'Attaque' : 'Défense'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-stone-300">
                          {NATION_TEMPLATES[b.attacker].shortName} ({totalStack(b.attackerUnits)}) vs{' '}
                          {NATION_TEMPLATES[b.defender].shortName} ({totalStack(b.defenderUnits)})
                        </p>
                        {isAttacker && (
                          <button
                            type="button"
                            onClick={() => onRetreat(b.id)}
                            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-amber-500/40 bg-stone-900 py-1 text-[10px] font-semibold text-amber-200 hover:bg-stone-800"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Ordonner la retraite
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Colonnes en mouvement
                </p>
                {myArmies.length === 0 ? (
                  <p className="rounded bg-stone-900/70 p-2 text-[11px] text-stone-400">
                    Aucune colonne en transit. Sélectionnez une province puis cliquez sur «
                    Déplacer ».
                  </p>
                ) : (
                  myArmies.map((a) => {
                    const dest = state.provinces[a.targetProvinceId];
                    const rem = Math.max(
                      0,
                      Math.ceil((a.landingEndsAt ?? a.legArrivalAt) - state.elapsedSeconds)
                    );
                    const unitSummary = UNIT_ORDER.filter((u) => a.units[u] > 0)
                      .map((u) => `${a.units[u]} ${UNIT_SPECS[u].shortLabel}`)
                      .join(', ');
                    return (
                      <div
                        key={a.id}
                        className="rounded border border-stone-800 bg-stone-900/80 p-2"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => onFocusProvince(a.targetProvinceId)}
                            className="font-semibold text-amber-100 hover:underline text-left"
                          >
                            → {dest?.name}
                          </button>
                          <span className="font-mono text-[10px] text-amber-300">{rem}s</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-stone-400">{unitSummary}</p>
                        <button
                          type="button"
                          onClick={() => onTurnAround(a.id)}
                          className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 bg-stone-800 py-1 text-[10px] font-semibold text-stone-200 hover:bg-stone-700"
                        >
                          <ChevronRight className="h-3 w-3 rotate-180" />
                          Demi-tour
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'ops' && (
            <div className="space-y-3">
              <div className="border-b border-stone-800 pb-1.5 font-serif text-xs sm:text-sm font-bold text-amber-100">
                Chantiers & Recrutements
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Constructions ({myConstructions.length})
                </p>
                {myConstructions.length === 0 ? (
                  <p className="text-[11px] text-stone-500">Aucun chantier actif.</p>
                ) : (
                  myConstructions.map((c) => {
                    const prov = state.provinces[c.provinceId];
                    const left = Math.max(0, Math.ceil(c.endsAt - state.elapsedSeconds));
                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded bg-stone-900 px-2 py-1.5"
                      >
                        <div>
                          <p className="font-semibold text-amber-100">
                            {formatConstructionLabel(c)}
                          </p>
                          <p className="text-[10px] text-stone-400">{prov?.name}</p>
                        </div>
                        <span className="font-mono text-[10px] text-amber-300">{left}s</span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Recrutements ({myRecruitments.length})
                </p>
                {myRecruitments.length === 0 ? (
                  <p className="text-[11px] text-stone-500">Aucune levée en cours.</p>
                ) : (
                  myRecruitments.map((r) => {
                    const prov = state.provinces[r.provinceId];
                    const left = Math.max(0, Math.ceil(r.endsAt - state.elapsedSeconds));
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded bg-stone-900 px-2 py-1.5"
                      >
                        <div>
                          <p className="font-semibold text-amber-100">
                            +{r.count} {UNIT_SPECS[r.unit].label}
                          </p>
                          <p className="text-[10px] text-stone-400">{prov?.name}</p>
                        </div>
                        <span className="font-mono text-[10px] text-emerald-300">{left}s</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'diplomacy' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-stone-800 pb-1.5">
                <span className="font-serif text-xs sm:text-sm font-bold text-amber-100">
                   Chancelleries
                </span>
                <span className="text-[10px] text-amber-300">
                  Allié :{' '}
                  {playerNation?.activeAllianceWith
                    ? NATION_TEMPLATES[playerNation.activeAllianceWith].shortName
                    : 'Aucun (max 1)'}
                </span>
              </div>

              {incomingOffers.length > 0 && (
                <div className="space-y-1.5 rounded border border-amber-500/40 bg-amber-950/25 p-2">
                  <p className="text-[10px] font-bold uppercase text-amber-300">
                    Propositions reçues
                  </p>
                  {incomingOffers.map((o) => {
                    const offerLabel =
                      o.type === 'alliance'
                        ? 'Alliance'
                        : o.type === 'nap'
                        ? 'Pacte (NAP)'
                        : 'Paix';
                    return (
                      <div key={o.id} className="space-y-1 border-t border-amber-500/20 pt-1.5">
                        <p className="text-[11px] text-amber-100">
                          <strong>{NATION_TEMPLATES[o.from].shortName}</strong> propose{' '}
                          <span className="text-amber-300">{offerLabel}</span>
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => onRespondOffer(o.id, true)}
                            className="flex-1 rounded bg-emerald-700 py-1 text-[10px] font-bold text-white hover:bg-emerald-600"
                          >
                            Accepter
                          </button>
                          <button
                            type="button"
                            onClick={() => onRespondOffer(o.id, false)}
                            className="flex-1 rounded bg-stone-800 py-1 text-[10px] font-bold text-stone-300 hover:bg-stone-700"
                          >
                            Refuser
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                {PLAYABLE_NATIONS.filter((id) => id !== state.playerNationId).map((otherId) => {
                  const otherNation = state.nations[otherId];
                  if (!otherNation || otherNation.isEliminated) return null;
                  const status = getDiplomaticStatus(state, state.playerNationId, otherId);
                  const badge = STATUS_BADGE[status];

                  return (
                    <div
                      key={otherId}
                      className="rounded border border-stone-800 bg-stone-900/80 p-2"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: NATION_TEMPLATES[otherId].color }}
                          />
                          <span className="font-semibold text-amber-100">
                            {NATION_TEMPLATES[otherId].shortName}
                          </span>
                        </div>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {status !== 'war' && (
                          <button
                            type="button"
                            onClick={() => onSetDiplomacy(otherId, 'war')}
                            className="flex items-center gap-1 rounded border border-red-500/40 bg-red-950/50 px-2 py-0.5 text-[10px] font-semibold text-red-200 hover:bg-red-900/60"
                          >
                            <ShieldAlert className="h-2.5 w-2.5" />
                            Guerre
                          </button>
                        )}
                        {status === 'war' && (
                          <button
                            type="button"
                            onClick={() => onSetDiplomacy(otherId, 'neutral')}
                            className="rounded border border-stone-700 bg-stone-800 px-2 py-0.5 text-[10px] font-semibold text-stone-200 hover:bg-stone-700"
                          >
                            Paix
                          </button>
                        )}
                        {status === 'neutral' && (
                          <button
                            type="button"
                            onClick={() => onSetDiplomacy(otherId, 'nap')}
                            className="rounded border border-amber-500/40 bg-amber-950/50 px-2 py-0.5 text-[10px] font-semibold text-amber-200 hover:bg-amber-900/60"
                          >
                            Pacte
                          </button>
                        )}
                        {status !== 'alliance' &&
                          playerNation?.activeAllianceWith === null &&
                          otherNation.activeAllianceWith === null && (
                            <button
                              type="button"
                              onClick={() => onSetDiplomacy(otherId, 'alliance')}
                              className="flex items-center gap-1 rounded border border-sky-500/40 bg-sky-950/50 px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:bg-sky-900/60"
                            >
                              <Flag className="h-2.5 w-2.5" />
                              Allier ({GAME_CONFIG.allianceCostGold} 💰)
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'telegrams' && (
            <div className="space-y-2">
              <div className="border-b border-stone-800 pb-1.5 font-serif text-xs sm:text-sm font-bold text-amber-100">
                Dépêches du Front
              </div>
              {state.telegrams.length === 0 ? (
                <p className="text-[11px] text-stone-500">Aucune dépêche pour l’instant.</p>
              ) : (
                <div className="space-y-1.5">
                  {state.telegrams.slice(0, 18).map((tg) => (
                    <div
                      key={tg.id}
                      onClick={() => tg.provinceId && onFocusProvince(tg.provinceId)}
                      className={`rounded border p-1.5 text-[11px] ${
                        tg.provinceId ? 'cursor-pointer hover:brightness-110' : ''
                      } ${
                        tg.level === 'danger'
                          ? 'border-red-500/40 bg-red-950/35 text-red-200'
                          : tg.level === 'warning'
                          ? 'border-amber-500/40 bg-amber-950/30 text-amber-200'
                          : tg.level === 'diplomacy'
                          ? 'border-sky-500/40 bg-sky-950/30 text-sky-200'
                          : 'border-stone-800 bg-stone-900/80 text-stone-300'
                      }`}
                    >
                      {tg.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'chat' && isOnline && (
            <div className="flex flex-col gap-2">
              <div className="border-b border-stone-800 pb-1.5 font-serif text-xs sm:text-sm font-bold text-amber-100">
                État-Major ({roomPlayers.length} joueurs)
              </div>

              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setChatChannel('global')}
                  className={`flex-1 rounded py-1 text-[10px] font-bold ${
                    chatChannel === 'global'
                      ? 'bg-amber-600 text-stone-950'
                      : 'bg-stone-900 text-stone-300'
                  }`}
                >
                  Global
                </button>
                <button
                  type="button"
                  onClick={() => setChatChannel('private')}
                  className={`flex-1 rounded py-1 text-[10px] font-bold ${
                    chatChannel === 'private'
                      ? 'bg-amber-600 text-stone-950'
                      : 'bg-stone-900 text-stone-300'
                  }`}
                >
                  Privé
                </button>
              </div>

              {chatChannel === 'private' && (
                <select
                  value={chatTargetNation}
                  onChange={(e) => setChatTargetNation(e.target.value as PlayableNationId)}
                  className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] text-amber-100"
                >
                  {PLAYABLE_NATIONS.filter((id) => id !== state.playerNationId).map((id) => (
                    <option key={id} value={id}>
                      {NATION_TEMPLATES[id].shortName}
                    </option>
                  ))}
                </select>
              )}

              <div className="max-h-28 space-y-1 overflow-y-auto rounded bg-stone-900/70 p-1.5">
                {chatMessages.length === 0 ? (
                  <p className="text-[10px] text-stone-500">Aucun message.</p>
                ) : (
                  chatMessages.map((m) => (
                    <div key={m.id} className="text-[11px] leading-snug">
                      <span className="font-bold text-amber-300">{m.fromName}: </span>
                      <span className="text-stone-200">{m.text}</span>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleChatSubmit} className="flex gap-1">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Message..."
                  className="min-w-0 flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] text-white"
                />
                <button
                  type="submit"
                  className="rounded bg-amber-600 px-2 py-1 text-stone-950 hover:bg-amber-500"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}