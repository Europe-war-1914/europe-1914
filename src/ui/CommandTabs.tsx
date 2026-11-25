import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Hammer,
  Handshake,
  Lock,
  MessageSquare,
  RotateCcw,
  Send,
  Swords,
  Users,
  X,
} from 'lucide-react';
import {
  DEFENSE_LABELS,
  EXTRACTION_LABELS,
  GAME_CONFIG,
  UNIT_SPECS,
} from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import { totalStack } from '../engine/combat';
import { getDiplomaticStatus } from '../engine/diplomacy';
import { getVictoryStandings } from '../engine/gameLoop';
import type {
  ConstructionOrder,
  DefenseType,
  DiplomaticStatus,
  ExtractionResource,
  GameState,
  PlayableNationId,
} from '../engine/types';
import type { ChatMessage, RoomPlayer } from '../network/protocol';
import { formatClock } from './TopBar';

type TabId = 'constructions' | 'units' | 'battles' | 'diplomacy' | 'chat';

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
  war: { label: 'Guerre', cls: 'bg-red-950/90 text-red-200 border-red-600/40' },
  neutral: { label: 'Neutre', cls: 'bg-stone-800 text-stone-300 border-stone-600/40' },
  alliance: { label: 'Alliance', cls: 'bg-emerald-950/90 text-emerald-200 border-emerald-600/40' },
};

const OFFER_LABEL: Record<'alliance' | 'peace', string> = {
  alliance: 'Alliance militaire',
  peace: 'Traité de paix',
};

function formatConstructionLabel(c: ConstructionOrder): string {
  if (c.kind === 'barracks') return `Caserne (niv. ${c.targetLevel})`;
  if (c.kind === 'laboratory') return `Laboratoire (niv. ${c.targetLevel})`;
  if (c.kind === 'extraction') {
    return `${EXTRACTION_LABELS[c.targetKey as ExtractionResource]} (niv. ${c.targetLevel})`;
  }
  return `${DEFENSE_LABELS[c.targetKey as DefenseType]} (niv. ${c.targetLevel})`;
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
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('constructions');
  const [seenChatCount, setSeenChatCount] = useState(chatMessages.length);
  const [chatChannel, setChatChannel] = useState<'global' | 'private'>('global');
  const [privateTarget, setPrivateTarget] = useState<PlayableNationId | ''>('');
  const [chatDraft, setChatDraft] = useState('');
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const playerNation = state.nations[state.playerNationId];
  const myConstructions = state.constructions.filter((c) => c.owner === state.playerNationId);
  const myRecruitments = state.recruitments.filter((r) => r.owner === state.playerNationId);
  const myArmies = state.movingArmies.filter((a) => a.owner === state.playerNationId);
  const myBattles = state.battles.filter(
    (b) => b.attacker === state.playerNationId || b.defender === state.playerNationId
  );

  const incomingOffers = state.pendingOffers.filter((o) => o.to === state.playerNationId);
  const outgoingOffers = state.pendingOffers.filter((o) => o.from === state.playerNationId);

  const otherHumanPlayers = roomPlayers.filter((p) => p.nationId !== state.playerNationId);

  const resolvedPrivateTarget: PlayableNationId | '' = otherHumanPlayers.some(
    (p) => p.nationId === privateTarget
  )
    ? privateTarget
    : otherHumanPlayers[0]?.nationId ?? '';

  const isChatVisible = open && activeTab === 'chat';
  const unreadChat = isChatVisible ? 0 : Math.max(0, chatMessages.length - seenChatCount);

  useEffect(() => {
    if (isChatVisible) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isChatVisible, chatMessages.length]);

  const { standings } = getVictoryStandings(state);

  const tabs: { id: TabId; label: string; icon: typeof Hammer; count: number }[] = [
    { id: 'constructions', label: 'Chantiers', icon: Hammer, count: myConstructions.length },
    {
      id: 'units',
      label: 'Unités & Marches',
      icon: Users,
      count: myRecruitments.length + myArmies.length,
    },
    { id: 'battles', label: 'Combats', icon: Swords, count: myBattles.length },
    {
      id: 'diplomacy',
      label: 'Diplomatie',
      icon: Handshake,
      count: incomingOffers.length,
    },
    ...(isOnline
      ? [
          {
            id: 'chat' as TabId,
            label: 'Dépêches (Chat)',
            icon: MessageSquare,
            count: unreadChat,
          },
        ]
      : []),
  ];

  const handleToggleOpen = () => {
    if (activeTab === 'chat') {
      setSeenChatCount(chatMessages.length);
    }
    setOpen((v) => !v);
  };

  const handleTabClick = (id: TabId) => {
    if (activeTab === 'chat' || id === 'chat') {
      setSeenChatCount(chatMessages.length);
    }
    if (!open) setOpen(true);
    setActiveTab(id);
  };

  const handleSendChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!onSendChat) return;
    const trimmed = chatDraft.trim();
    if (!trimmed) return;

    if (chatChannel === 'private') {
      if (!resolvedPrivateTarget) return;
      onSendChat('private', trimmed, resolvedPrivateTarget);
    } else {
      onSendChat('global', trimmed);
    }
    setSeenChatCount(chatMessages.length + 1);
    setChatDraft('');
  };

  return (
    <div className="absolute bottom-3 right-3 top-16 z-20 flex items-start pointer-events-none font-sans">
      {/* Barre verticale d'onglets */}
      <div className="pointer-events-auto flex flex-col gap-1 rounded-l-lg border border-r-0 border-stone-700 bg-stone-950/95 p-1 shadow-xl">
        <button
          type="button"
          onClick={handleToggleOpen}
          className="flex h-8 w-8 items-center justify-center rounded text-amber-200 hover:bg-stone-800"
          title={open ? 'Replier le panneau' : 'Ouvrir l’État-Major'}
        >
          {open ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = open && activeTab === tab.id;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`relative flex h-9 w-8 items-center justify-center rounded transition ${
                active
                  ? 'bg-amber-600 text-stone-950'
                  : 'text-stone-300 hover:bg-stone-800 hover:text-amber-100'
              }`}
              title={tab.label}
            >
              <Icon className="h-4 w-4" />
              {tab.count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panneau déplié */}
      {open && (
        <aside className="pointer-events-auto flex max-h-full w-72 sm:w-80 flex-col overflow-hidden rounded-r-lg rounded-bl-lg border border-stone-700 bg-stone-950/95 text-stone-100 shadow-2xl backdrop-blur-sm">
          <div className="border-b border-stone-800 bg-stone-900/90 px-3 py-2 font-serif text-sm font-bold text-amber-100">
            {tabs.find((t) => t.id === activeTab)?.label}
          </div>

          <div className="max-h-[48vh] overflow-y-auto p-2.5 space-y-2 text-xs">
            {/* ONGLET 1 : CHANTIERS */}
            {activeTab === 'constructions' && (
              <>
                {myConstructions.length === 0 ? (
                  <p className="text-stone-400">
                    Aucun chantier actif. Sélectionnez une province pour améliorer sa Caserne, ses
                    Usines d’extraction ou ses Défenses.
                  </p>
                ) : (
                  myConstructions.map((c) => {
                    const prov = state.provinces[c.provinceId];
                    const rem = Math.max(0, Math.ceil(c.endsAt - state.elapsedSeconds));
                    const pct = Math.min(
                      100,
                      Math.round(
                        ((state.elapsedSeconds - c.startedAt) /
                          Math.max(1, c.endsAt - c.startedAt)) *
                          100
                      )
                    );
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => onFocusProvince(c.provinceId)}
                        className="w-full rounded border border-stone-800 bg-stone-900/80 p-2 text-left hover:border-amber-500/50"
                      >
                        <div className="flex justify-between font-semibold text-amber-100">
                          <span>{prov?.name}</span>
                          <span className="font-mono text-amber-300">{rem} s</span>
                        </div>
                        <p className="text-[11px] text-stone-400">{formatConstructionLabel(c)}</p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-stone-800">
                          <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    );
                  })
                )}
              </>
            )}

            {/* ONGLET 2 : UNITÉS EN FORMATION & ARMÉES EN MARCHE (AVEC DEMI-TOUR) */}
            {activeTab === 'units' && (
              <>
                <p className="font-semibold text-amber-200">
                  En formation ({myRecruitments.length})
                </p>
                {myRecruitments.length === 0 ? (
                  <p className="text-stone-400">Aucune unité en formation.</p>
                ) : (
                  myRecruitments.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => onFocusProvince(r.provinceId)}
                      className="flex w-full items-center justify-between rounded border border-stone-800 bg-stone-900/80 px-2.5 py-1.5 text-left hover:border-amber-500/50"
                    >
                      <span>
                        +{r.count} {UNIT_SPECS[r.unit].label} ({state.provinces[r.provinceId]?.name})
                      </span>
                      <span className="font-mono text-amber-300">
                        {Math.max(0, Math.ceil(r.endsAt - state.elapsedSeconds))} s
                      </span>
                    </button>
                  ))
                )}

                <p className="pt-2 font-semibold text-amber-200">
                  Armées en mouvement ({myArmies.length})
                </p>
                {myArmies.length === 0 ? (
                  <p className="text-stone-400">Aucune colonne en déplacement.</p>
                ) : (
                  myArmies.map((a) => {
                    const rem =
                      a.landingEndsAt !== undefined
                        ? Math.max(0, Math.ceil(a.landingEndsAt - state.elapsedSeconds))
                        : Math.max(0, Math.ceil(a.legArrivalAt - state.elapsedSeconds));

                    return (
                      <div
                        key={a.id}
                        className="rounded border border-stone-800 bg-stone-900/80 p-2 space-y-1.5"
                      >
                        <button
                          type="button"
                          onClick={() => onFocusProvince(a.targetProvinceId)}
                          className="flex w-full justify-between text-left font-semibold text-amber-100 hover:underline"
                        >
                          <span>
                            {state.provinces[a.fromProvinceId]?.name} →{' '}
                            {state.provinces[a.targetProvinceId]?.name}
                          </span>
                          <span className="font-mono text-amber-300">{rem} s</span>
                        </button>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400">
                          <span>
                            {totalStack(a.units)} unité(s)
                            {a.landingEndsAt !== undefined
                              ? ' • Débarquement !'
                              : a.isSubmarineMission
                              ? ' • Sous-marin'
                              : a.isAir
                              ? ' • Aviation'
                              : a.isNaval
                              ? ' • Mer'
                              : ''}
                            {a.isReturning ? ' • Retour' : ''}
                          </span>

                          {!a.isReturning && (
                            <button
                              type="button"
                              onClick={() => onTurnAround(a.id)}
                              className="flex items-center gap-1 rounded border border-amber-500/40 bg-stone-800 px-2 py-0.5 text-[10px] font-bold text-amber-200 hover:bg-stone-700"
                              title="Faire demi-tour vers la province de départ"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Demi-tour
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* ONGLET 3 : COMBATS */}
            {activeTab === 'battles' && (
              <>
                {myBattles.length === 0 ? (
                  <p className="text-stone-400">Aucun engagement militaire en cours.</p>
                ) : (
                  myBattles.map((b) => {
                    const prov = state.provinces[b.provinceId];
                    const isAttacker = b.attacker === state.playerNationId;
                    return (
                      <div
                        key={b.id}
                        className="rounded border border-red-800/50 bg-red-950/30 p-2 space-y-1.5"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <button
                            type="button"
                            onClick={() => onFocusProvince(b.provinceId)}
                            className="text-amber-100 hover:underline"
                          >
                            Bataille : {prov?.name}
                          </button>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-red-300">
                            {NATION_TEMPLATES[b.attacker].shortName} : {totalStack(b.attackerUnits)}
                          </span>
                          <span className="text-sky-300">
                            {NATION_TEMPLATES[b.defender].shortName} : {totalStack(b.defenderUnits)}
                          </span>
                        </div>
                        {isAttacker && (
                          <button
                            type="button"
                            onClick={() => onRetreat(b.id)}
                            className="w-full rounded bg-stone-800 py-1 text-[11px] font-semibold text-amber-200 hover:bg-stone-700"
                          >
                            Ordonner la retraite
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* ONGLET 4 : DIPLOMATIE (SANS PNA, 1 ALLIANCE MAX, COÛTS EN OR, DÉLAI IA) */}
            {activeTab === 'diplomacy' && (
              <div className="space-y-2">
                <div className="rounded border border-stone-800 bg-stone-900/70 px-2.5 py-1.5 text-[11px] text-stone-300">
                  <div>
                    Alliance active :{' '}
                    <strong className="text-emerald-300">
                      {playerNation.activeAllianceWith
                        ? NATION_TEMPLATES[playerNation.activeAllianceWith].shortName
                        : 'Aucune (1 max)'}
                    </strong>
                  </div>
                  <div className="mt-0.5 text-[10px] text-stone-400">
                    Alliance : {GAME_CONFIG.allianceCostGold} Or • Trahison/Rupture :{' '}
                    {GAME_CONFIG.betrayalCostGold} Or
                  </div>
                </div>

                {/* Propositions reçues */}
                {incomingOffers.length > 0 && (
                  <div className="space-y-1.5 rounded border border-amber-500/40 bg-amber-950/35 p-2">
                    <p className="text-[11px] font-bold text-amber-200">
                      Propositions reçues ({incomingOffers.length})
                    </p>
                    {incomingOffers.map((offer) => {
                      const sender = NATION_TEMPLATES[offer.from];
                      const rem = Math.max(0, Math.ceil(offer.expiresAt - state.elapsedSeconds));
                      return (
                        <div
                          key={offer.id}
                          className="rounded border border-stone-800 bg-stone-950/85 p-2 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-amber-100">{sender.shortName}</span>
                            <span className="font-mono text-[10px] text-stone-400">{rem} s</span>
                          </div>
                          <p className="text-[11px] text-stone-300">
                            Propose :{' '}
                            <strong className="text-amber-200">{OFFER_LABEL[offer.type]}</strong>
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => onRespondOffer(offer.id, true)}
                              className="flex items-center justify-center gap-1 rounded bg-emerald-700 py-1 text-[11px] font-bold text-white hover:bg-emerald-600"
                            >
                              <Check className="h-3 w-3" />
                              Accepter
                            </button>
                            <button
                              type="button"
                              onClick={() => onRespondOffer(offer.id, false)}
                              className="flex items-center justify-center gap-1 rounded bg-stone-800 py-1 text-[11px] font-semibold text-stone-300 hover:bg-stone-700"
                            >
                              <X className="h-3 w-3" />
                              Refuser
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Propositions envoyées (délai de réflexion IA / joueur) */}
                {outgoingOffers.length > 0 && (
                  <div className="space-y-1 rounded border border-sky-800/50 bg-sky-950/25 p-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                      En cours d’examen
                    </p>
                    {outgoingOffers.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between text-[11px] text-stone-300"
                      >
                        <span>
                          {OFFER_LABEL[o.type]} → {NATION_TEMPLATES[o.to].shortName}
                        </span>
                        <span className="font-mono text-[10px] text-sky-300">Réflexion...</span>
                      </div>
                    ))}
                  </div>
                )}

                {standings.map((row, idx) => {
                  const tpl = NATION_TEMPLATES[row.nationId];
                  const targetNation = state.nations[row.nationId];
                  const isSelf = row.nationId === state.playerNationId;
                  const humanPlayer = roomPlayers.find((p) => p.nationId === row.nationId);
                  const status = getDiplomaticStatus(state, state.playerNationId, row.nationId);
                  const badge = STATUS_BADGE[status];
                  const canProposeAlliance =
                    status !== 'alliance' &&
                    playerNation.activeAllianceWith === null &&
                    targetNation.activeAllianceWith === null;

                  return (
                    <div
                      key={row.nationId}
                      className={`rounded border border-stone-800 bg-stone-900/80 p-2 space-y-1.5 ${
                        row.isEliminated ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-stone-500">#{idx + 1}</span>
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: tpl.color }}
                          />
                          <span className="font-semibold text-amber-100">
                            {tpl.shortName}{' '}
                            {isSelf ? (
                              '(Vous)'
                            ) : isOnline && humanPlayer ? (
                              <span className="text-[10px] font-normal text-sky-300">
                                ({humanPlayer.name})
                              </span>
                            ) : isOnline ? (
                              <span className="text-[10px] font-normal text-stone-500">(IA)</span>
                            ) : null}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] font-bold text-amber-300">
                          {row.isEliminated ? 'Éliminé' : `${row.provincesCount} prov.`}
                        </span>
                      </div>

                      {!isSelf && !row.isEliminated && !playerNation.isEliminated && (
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {isOnline && humanPlayer && (
                              <button
                                type="button"
                                onClick={() => {
                                  setChatChannel('private');
                                  setPrivateTarget(row.nationId);
                                  setActiveTab('chat');
                                  setSeenChatCount(chatMessages.length);
                                }}
                                className="rounded bg-purple-900/70 px-1.5 py-0.5 text-[10px] text-purple-100 hover:bg-purple-800"
                              >
                                Privé
                              </button>
                            )}
                            {status === 'alliance' ? (
                              <button
                                type="button"
                                onClick={() => onSetDiplomacy(row.nationId, 'war')}
                                className="rounded bg-red-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-red-100 hover:bg-red-800"
                                title={`Trahir l’alliance (${GAME_CONFIG.betrayalCostGold} Or)`}
                              >
                                Trahir ({GAME_CONFIG.betrayalCostGold} Or)
                              </button>
                            ) : (
                              <>
                                {status !== 'war' && (
                                  <button
                                    type="button"
                                    onClick={() => onSetDiplomacy(row.nationId, 'war')}
                                    className="rounded bg-red-900/70 px-1.5 py-0.5 text-[10px] text-red-100 hover:bg-red-800"
                                  >
                                    Guerre
                                  </button>
                                )}
                                {canProposeAlliance && (
                                  <button
                                    type="button"
                                    onClick={() => onSetDiplomacy(row.nationId, 'alliance')}
                                    className="rounded bg-emerald-900/80 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-800"
                                    title={`Proposer une alliance (${GAME_CONFIG.allianceCostGold} Or)`}
                                  >
                                    Alliance ({GAME_CONFIG.allianceCostGold} Or)
                                  </button>
                                )}
                                {status === 'war' && (
                                  <button
                                    type="button"
                                    onClick={() => onSetDiplomacy(row.nationId, 'neutral')}
                                    className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-200 hover:bg-stone-700"
                                  >
                                    Paix
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ONGLET 5 : CHAT DIPLOMATIQUE EN DIRECT (MULTIJOUEUR) */}
            {activeTab === 'chat' && isOnline && (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-1 rounded border border-stone-800 bg-stone-900 p-1 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setChatChannel('global')}
                    className={`flex items-center justify-center gap-1 rounded py-1 transition ${
                      chatChannel === 'global'
                        ? 'bg-amber-600 text-stone-950'
                        : 'text-stone-400 hover:text-amber-100'
                    }`}
                  >
                    <Globe className="h-3 w-3" />
                    Journal d’Europe
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatChannel('private')}
                    disabled={otherHumanPlayers.length === 0}
                    className={`flex items-center justify-center gap-1 rounded py-1 transition ${
                      chatChannel === 'private'
                        ? 'bg-purple-600 text-white'
                        : 'text-stone-400 hover:text-purple-200 disabled:opacity-40'
                    }`}
                  >
                    <Lock className="h-3 w-3" />
                    Dépêche secrète
                  </button>
                </div>

                {chatChannel === 'private' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-purple-300">À :</span>
                    {otherHumanPlayers.length === 0 ? (
                      <span className="text-[11px] text-stone-500">
                        Aucun autre joueur humain connecté.
                      </span>
                    ) : (
                      <select
                        value={resolvedPrivateTarget}
                        onChange={(e) => setPrivateTarget(e.target.value as PlayableNationId)}
                        className="flex-1 rounded border border-purple-500/40 bg-stone-900 px-2 py-1 text-[11px] text-purple-100 focus:border-purple-400 focus:outline-none"
                      >
                        {otherHumanPlayers.map((p) => (
                          <option key={p.socketId} value={p.nationId}>
                            {NATION_TEMPLATES[p.nationId].shortName} — {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="max-h-48 min-h-28 space-y-1.5 overflow-y-auto rounded border border-stone-800 bg-stone-900/60 p-2">
                  {chatMessages.length === 0 ? (
                    <p className="text-[11px] text-stone-500">
                      Aucune dépêche reçue. Envoyez un message public ou secret pour négocier !
                    </p>
                  ) : (
                    chatMessages.map((msg) => {
                      const isPrivate = msg.channel === 'private';
                      const isMine = msg.fromNationId === state.playerNationId;
                      return (
                        <div
                          key={msg.id}
                          className={`rounded px-2 py-1.5 text-[11px] leading-snug ${
                            isPrivate
                              ? 'border border-purple-500/40 bg-purple-950/50 text-purple-100'
                              : isMine
                              ? 'bg-stone-800/90 text-amber-50'
                              : 'bg-stone-950/80 text-stone-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 text-[10px]">
                            <span className="flex items-center gap-1 font-bold">
                              {isPrivate && <Lock className="h-2.5 w-2.5 text-purple-300" />}
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: NATION_TEMPLATES[msg.fromNationId].color,
                                }}
                              />
                              <span className={isPrivate ? 'text-purple-200' : 'text-amber-200'}>
                                {msg.fromName} ({NATION_TEMPLATES[msg.fromNationId].shortName})
                              </span>
                              {isPrivate && msg.toNationId && (
                                <span className="font-normal text-purple-300">
                                  → {NATION_TEMPLATES[msg.toNationId].shortName}
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-stone-500">
                              {formatClock(msg.time)}
                            </span>
                          </div>
                          <p className="mt-0.5 break-words">{msg.text}</p>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                <form onSubmit={handleSendChatSubmit} className="flex gap-1.5">
                  <input
                    type="text"
                    maxLength={240}
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder={
                      chatChannel === 'private'
                        ? 'Dépêche chiffrée...'
                        : 'Message à toute l’Europe...'
                    }
                    className={`flex-1 rounded border bg-stone-900 px-2 py-1.5 text-xs text-amber-50 focus:outline-none ${
                      chatChannel === 'private'
                        ? 'border-purple-500/50 focus:border-purple-400'
                        : 'border-stone-700 focus:border-amber-400'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={
                      !chatDraft.trim() || (chatChannel === 'private' && !resolvedPrivateTarget)
                    }
                    className={`flex items-center justify-center rounded px-2.5 py-1.5 text-xs font-bold transition disabled:bg-stone-800 disabled:text-stone-500 ${
                      chatChannel === 'private'
                        ? 'bg-purple-600 text-white hover:bg-purple-500'
                        : 'bg-amber-600 text-stone-950 hover:bg-amber-500'
                    }`}
                    title="Envoyer"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Fil des télégrammes */}
          <div className="border-t border-stone-800 bg-stone-900/90 p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              Télégrammes récents
            </div>
            <div className="max-h-24 space-y-1 overflow-y-auto text-[11px]">
              {state.telegrams.slice(0, 5).map((tg) => (
                <button
                  type="button"
                  key={tg.id}
                  onClick={() => tg.provinceId && onFocusProvince(tg.provinceId)}
                  className={`block w-full rounded px-1.5 py-1 text-left transition ${
                    tg.level === 'danger'
                      ? 'bg-red-950/60 text-red-200 hover:bg-red-900/60'
                      : tg.level === 'warning'
                      ? 'bg-amber-950/60 text-amber-200 hover:bg-amber-900/60'
                      : 'bg-stone-800/60 text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  <span className="mr-1.5 font-mono text-[10px] text-stone-400">
                    [{formatClock(tg.time)}]
                  </span>
                  {tg.text}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}