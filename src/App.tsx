import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Crown, LogIn, LogOut, Trophy, User, Users, X } from 'lucide-react';
import { soundEngine } from './audio/soundEngine';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from './data/nations';
import { respondToDiplomaticOffer } from './engine/ai';
import {
  orderArtilleryBombardment,
  orderMoveArmy,
  retreatFromBattle,
  setDiplomaticStatus,
} from './engine/combat';
import { pushTelegram, startConstruction, startRecruitment } from './engine/economy';
import {
  cloneGameState,
  createNewGame,
  getVictoryStandings,
  stepGameState,
} from './engine/gameLoop';
import type {
  BuildingType,
  DiplomaticStatus,
  GamePhase,
  GameState,
  PlayableNationId,
  UnitStack,
  UnitType,
} from './engine/types';
import { isSupabaseConfigured, supabase, type PlayerProfile } from './lib/supabase';
import type {
  ActionResponse,
  ChatMessage,
  ClientAction,
  RoomSummary,
} from './network/protocol';
import { MapCanvas } from './renderer/MapCanvas';
import { AuthModal } from './ui/AuthModal';
import { CommandTabs } from './ui/CommandTabs';
import { OnlineLobby } from './ui/OnlineLobby';
import { ProvinceDrawer } from './ui/ProvinceDrawer';
import { TopBar } from './ui/TopBar';

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3001';

const TUTORIAL_STEPS: Record<number, { title: string; text: string }> = {
  1: {
    title: 'Étape 1/4 — Prendre le commandement',
    text: 'Cliquez sur l’une de vos provinces colorées (ex. votre capitale ★) pour ouvrir son panneau.',
  },
  2: {
    title: 'Étape 2/4 — Bâtir votre économie',
    text: 'Ouvrez l’onglet « Construire » de votre province et lancez une Usine, un Fort ou des Voies ferrées.',
  },
  3: {
    title: 'Étape 3/4 — Mobiliser vos divisions',
    text: 'Ouvrez l’onglet « Recruter » et formez au moins une division d’Infanterie ou de Blindés.',
  },
  4: {
    title: 'Étape 4/4 — Déployer vos armées',
    text: 'Dans l’onglet « Ordres », déplacez une troupe vers votre frontière avant la fin de la mobilisation !',
  },
};

export default function App() {
  const [lobbyTab, setLobbyTab] = useState<'solo' | 'online'>('solo');
  const [state, setState] = useState<GameState | null>(null);
  const [isOnlineMatch, setIsOnlineMatch] = useState(false);
  const [chosenNation, setChosenNation] = useState<PlayableNationId>('france');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());

  // Compte joueur Supabase
  const [authUser, setAuthUser] = useState<{ id: string; username: string } | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // État réseau multijoueur + chat diplomatique
  const socketRef = useRef<Socket | null>(null);
  const [socketNonce, setSocketNonce] = useState(0);
  const [connected, setConnected] = useState(false);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  const prevPhaseRef = useRef<GamePhase | null>(null);
  const prevTopTelegramIdRef = useRef<string | null>(null);
  const prevPlayerBattlesRef = useRef<number>(0);
  const hasCenteredOnlineRef = useRef<boolean>(false);

  const isSoloActive = state !== null && !isOnlineMatch;
  const shouldConnectSocket = lobbyTab === 'online' || isOnlineMatch;

  // 1. Suivi de la session Supabase
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    const syncUser = (
      user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null
    ) => {
      if (!user) {
        setAuthUser(null);
        setProfile(null);
        return;
      }
      const fallbackName =
        (typeof user.user_metadata?.username === 'string' && user.user_metadata.username) ||
        user.email?.split('@')[0] ||
        'Commandant';
      setAuthUser({ id: user.id, username: fallbackName });
    };

    void client.auth.getSession().then(({ data }) => {
      syncUser(data.session?.user ?? null);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      syncUser(session?.user ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // 2. Chargement du profil (séparé de onAuthStateChange pour éviter le blocage)
  useEffect(() => {
    if (!supabase || !authUser) return;
    const client = supabase;
    let cancelled = false;

    const loadProfile = async () => {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('Erreur lecture profil Supabase:', error);
      }

      if (data) {
        setProfile(data as PlayerProfile);
      } else {
        setProfile({
          id: authUser.id,
          username: authUser.username,
          elo: 1000,
          wins: 0,
          games_played: 0,
          is_commander: false,
          unlocked_themes: ['vintage'],
        });
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setProfile(null);
    soundEngine.playSelect();
  };

  // Boucle de simulation locale UNIQUEMENT en mode Solo
  useEffect(() => {
    if (!isSoloActive) return;
    const timer = window.setInterval(() => {
      setState((prev) => (prev ? stepGameState(prev, 0.25) : null));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isSoloActive]);

  // Connexion Socket.io stable et tolérante au réveil du serveur (Render Free)
  useEffect(() => {
    if (!shouldConnectSocket) return;

    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setMySocketId(socket.id ?? null);
      setOnlineError(null);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setMySocketId(null);
    });

    socket.on('room:update', (summary: RoomSummary) => {
      setRoom(summary);
      setOnlineError(null);
    });

    socket.on('chat:history', (history: ChatMessage[]) => {
      setChatMessages(history);
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-99), msg]);
      if (msg.fromSocketId !== socket.id) {
        soundEngine.playTelegram();
      }
    });

    socket.on('game:state', (incoming: GameState) => {
      setIsOnlineMatch(true);
      setState(incoming);

      if (!hasCenteredOnlineRef.current) {
        hasCenteredOnlineRef.current = true;
        const capital = Object.values(incoming.provinces).find(
          (p) => p.owner === incoming.playerNationId && p.isCapital
        );
        setSelectedId(capital?.id ?? null);
        setFocusTarget(capital ? [capital.center[0], capital.center[1]] : null);
        soundEngine.playMarch();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setMySocketId(null);
    };
  }, [shouldConnectSocket, socketNonce]);

  // Effacement automatique des alertes d'action
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Déclenchement automatique des sons sur les événements de partie
  useEffect(() => {
    if (!state) {
      prevPhaseRef.current = null;
      prevTopTelegramIdRef.current = null;
      prevPlayerBattlesRef.current = 0;
      return;
    }

    const prevPhase = prevPhaseRef.current;
    if (prevPhase === 'MOBILIZATION' && state.phase === 'WAR') {
      soundEngine.playBugleWar();
    } else if (prevPhase !== null && prevPhase !== 'ENDED' && state.phase === 'ENDED') {
      soundEngine.playVictory();
    }
    prevPhaseRef.current = state.phase;

    const playerBattles = state.battles.filter(
      (b) => b.attacker === state.playerNationId || b.defender === state.playerNationId
    ).length;
    if (playerBattles > prevPlayerBattlesRef.current) {
      soundEngine.playCannon();
    }
    prevPlayerBattlesRef.current = playerBattles;

    const topTg = state.telegrams[0] ?? null;
    if (
      topTg &&
      prevTopTelegramIdRef.current !== null &&
      topTg.id !== prevTopTelegramIdRef.current
    ) {
      if (topTg.level === 'diplomacy' || topTg.level === 'info' || topTg.level === 'warning') {
        soundEngine.playTelegram();
      }
    }
    prevTopTelegramIdRef.current = topTg ? topTg.id : null;
  }, [state]);

  const startSoloMatch = (nationId: PlayableNationId) => {
    const fresh = createNewGame(nationId);
    const capital = Object.values(fresh.provinces).find(
      (p) => p.owner === nationId && p.isCapital
    );
    prevPhaseRef.current = fresh.phase;
    prevTopTelegramIdRef.current = fresh.telegrams[0]?.id ?? null;
    prevPlayerBattlesRef.current = 0;

    setIsOnlineMatch(false);
    setChatMessages([]);
    setState(fresh);
    setSelectedId(capital?.id ?? null);
    setFocusTarget(capital ? [capital.center[0], capital.center[1]] : null);
    soundEngine.playMarch();
  };

  const handleReturnToLobby = () => {
    if (isOnlineMatch && socketRef.current) {
      socketRef.current.emit('room:leave');
    }
    hasCenteredOnlineRef.current = false;
    setIsOnlineMatch(false);
    setRoom(null);
    setChatMessages([]);
    setState(null);
    setSelectedId(null);
  };

  const handleSendChat = (
    channel: 'global' | 'private',
    text: string,
    toNationId?: PlayableNationId
  ) => {
    const socket = socketRef.current;
    if (!socket) {
      setToast('Connexion au serveur perdue.');
      soundEngine.playError();
      return;
    }

    socket.emit(
      'chat:send',
      { channel, toNationId, text },
      (res?: ActionResponse) => {
        if (res && !res.ok) {
          if (res.reason) setToast(res.reason);
          soundEngine.playError();
        }
      }
    );
  };

  const applyLocalMutation = (
    fn: (draft: GameState) => { ok: boolean; reason?: string } | void,
    onSuccess?: () => void
  ) => {
    setState((prev) => {
      if (!prev) return prev;
      const draft = cloneGameState(prev);
      const res = fn(draft);
      if (res && !res.ok) {
        if (res.reason) setToast(res.reason);
        soundEngine.playError();
        return prev;
      }
      onSuccess?.();
      return draft;
    });
  };

  const dispatchGameAction = (
    action: ClientAction,
    soloMutation: (draft: GameState) => { ok: boolean; reason?: string } | void,
    onSuccess?: () => void
  ) => {
    if (isOnlineMatch) {
      const socket = socketRef.current;
      if (!socket) {
        setToast('Connexion au serveur perdue.');
        soundEngine.playError();
        return;
      }
      socket.emit('game:action', action, (res?: ActionResponse) => {
        if (res && !res.ok) {
          if (res.reason) setToast(res.reason);
          soundEngine.playError();
        } else {
          onSuccess?.();
        }
      });
      return;
    }

    applyLocalMutation(soloMutation, onSuccess);
  };

  const handleSelectProvince = (id: string | null) => {
    setSelectedId(id);
    if (id) {
      soundEngine.playSelect();
    }
    if (
      !isOnlineMatch &&
      id &&
      state &&
      state.tutorialStep === 1 &&
      state.provinces[id]?.owner === state.playerNationId
    ) {
      applyLocalMutation((draft) => {
        draft.tutorialStep = 2;
      });
    }
  };

  const handleFocusProvince = (provinceId: string) => {
    if (!state) return;
    const prov = state.provinces[provinceId];
    if (!prov) return;
    setSelectedId(provinceId);
    setFocusTarget([prov.center[0], prov.center[1]]);
    soundEngine.playSelect();
  };

  // --- ÉCRAN D'ACCUEIL : SOLO OU MULTIJOUEUR ---
  if (!state) {
    return (
      <div className="flex min-h-dvh w-full flex-col items-center justify-start sm:justify-center bg-stone-950 p-3 pb-12 sm:p-4 text-amber-50 font-sans overflow-y-auto touch-pan-y">
        <div className="w-full max-w-4xl rounded-xl border border-amber-200/30 bg-stone-900/95 p-4 sm:p-6 shadow-2xl">
          {/* Barre de compte joueur (Supabase) */}
          {isSupabaseConfigured && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-800 bg-stone-950/80 px-3 py-2 text-xs">
              {profile ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 font-semibold text-amber-100">
                      <User className="h-3.5 w-3.5 text-amber-400" />
                      {profile.username}
                    </span>
                    <span className="rounded border border-stone-700 bg-stone-900 px-2 py-0.5 font-mono text-[11px] text-amber-300">
                      {profile.elo} ELO
                    </span>
                    {profile.is_commander && (
                      <span className="flex items-center gap-1 rounded border border-amber-400/50 bg-amber-950/70 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                        <Crown className="h-3 w-3" />
                        Commandant
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-1 rounded border border-stone-700 bg-stone-900 px-2.5 py-1 text-stone-300 hover:bg-stone-800 hover:text-white"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Déconnexion
                  </button>
                </>
              ) : (
                <>
                  <span className="text-stone-400">
                    Mode Invité — connectez-vous pour sauvegarder votre ELO et vos packs.
                  </span>
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1 font-bold text-stone-950 hover:bg-amber-500"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Connexion / Inscription
                  </button>
                </>
              )}
            </div>
          )}

          <div className="text-center">
            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-[0.25em] text-amber-400">
              Stratégie Compétitive • Sans Pay-to-Win
            </p>
            <h1 className="mt-1 font-serif text-2xl sm:text-4xl font-bold text-amber-100">
              1914 : L’EUROPE EN FLAMMES
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-stone-300">
              Mode Blitz (30 min max • Mobilisation 2m30 • 65 régions)
            </p>
          </div>

          {/* Sélecteur Solo / Multijoueur */}
          <div className="mx-auto mt-3.5 sm:mt-5 grid max-w-md grid-cols-2 rounded-lg border border-stone-700 bg-stone-950 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setLobbyTab('solo');
                setRoom(null);
                setChatMessages([]);
                soundEngine.playSelect();
              }}
              className={`rounded-md py-2 transition ${
                lobbyTab === 'solo'
                  ? 'bg-amber-600 text-stone-950'
                  : 'text-stone-400 hover:text-amber-100'
              }`}
            >
              Solo (vs 7 IA)
            </button>
            <button
              type="button"
              onClick={() => {
                setLobbyTab('online');
                soundEngine.playSelect();
              }}
              className={`flex items-center justify-center gap-1.5 rounded-md py-2 transition ${
                lobbyTab === 'online'
                  ? 'bg-amber-600 text-stone-950'
                  : 'text-stone-400 hover:text-amber-100'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Multijoueur en ligne
            </button>
          </div>

          {lobbyTab === 'solo' ? (
            <>
              <div className="mt-4 sm:mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3">
                {PLAYABLE_NATIONS.map((id) => {
                  const tpl = NATION_TEMPLATES[id];
                  const selected = chosenNation === id;
                  return (
                    <button
                      type="button"
                      key={id}
                      onClick={() => {
                        setChosenNation(id);
                        soundEngine.playSelect();
                      }}
                      className={`flex flex-col rounded-lg border p-3 text-left transition ${
                        selected
                          ? 'border-amber-400 bg-stone-800 shadow-lg ring-1 ring-amber-400/60'
                          : 'border-stone-700/80 bg-stone-950/70 hover:border-stone-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-white/50"
                          style={{ backgroundColor: tpl.color }}
                        />
                        <span className="font-serif text-sm font-bold text-amber-100">
                          {tpl.shortName}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
                        {tpl.lore}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 sm:mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => startSoloMatch(chosenNation)}
                  className="w-full sm:w-auto rounded-lg bg-amber-600 px-8 py-3 font-serif text-sm sm:text-base font-bold text-stone-950 shadow-lg transition hover:bg-amber-500"
                >
                  Prendre le commandement ({NATION_TEMPLATES[chosenNation].shortName})
                </button>
              </div>
            </>
          ) : (
            <OnlineLobby
              connected={connected}
              serverUrl={SERVER_URL}
              mySocketId={mySocketId}
              room={room}
              chatMessages={chatMessages}
              error={onlineError}
              onRetryConnection={() => {
                setOnlineError(null);
                setSocketNonce((n) => n + 1);
              }}
              onCreateRoom={(playerName, preferredNation) => {
                setOnlineError(null);
                setChatMessages([]);
                socketRef.current?.emit(
                  'room:create',
                  { playerName: profile?.username ?? playerName, preferredNation },
                  (res: { ok: boolean; reason?: string }) => {
                    if (!res.ok) setOnlineError(res.reason ?? 'Impossible de créer le salon.');
                    else soundEngine.playSelect();
                  }
                );
              }}
              onJoinRoom={(code, playerName) => {
                setOnlineError(null);
                setChatMessages([]);
                socketRef.current?.emit(
                  'room:join',
                  { code, playerName: profile?.username ?? playerName },
                  (res: { ok: boolean; reason?: string }) => {
                    if (!res.ok) setOnlineError(res.reason ?? 'Impossible de rejoindre.');
                    else soundEngine.playSelect();
                  }
                );
              }}
              onSelectNation={(nationId) => {
                setOnlineError(null);
                socketRef.current?.emit(
                  'room:selectNation',
                  { nationId },
                  (res: ActionResponse) => {
                    if (!res.ok) setOnlineError(res.reason ?? 'Puissance indisponible.');
                    else soundEngine.playSelect();
                  }
                );
              }}
              onSendChat={handleSendChat}
              onStartRoom={() => {
                setOnlineError(null);
                socketRef.current?.emit('room:start', (res: ActionResponse) => {
                  if (!res.ok) setOnlineError(res.reason ?? 'Erreur au lancement.');
                });
              }}
              onLeaveRoom={() => {
                socketRef.current?.emit('room:leave');
                setRoom(null);
                setChatMessages([]);
              }}
            />
          )}
        </div>

        {authModalOpen && (
          <AuthModal
            onClose={() => setAuthModalOpen(false)}
            onSuccess={() => soundEngine.playSelect()}
          />
        )}
      </div>
    );
  }

  const selectedProvince = selectedId ? state.provinces[selectedId] ?? null : null;
  const tutorial =
    !isOnlineMatch && state.tutorialStep > 0 ? TUTORIAL_STEPS[state.tutorialStep] : null;
  const finalStandings = state.phase === 'ENDED' ? getVictoryStandings(state).standings : null;

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-stone-950 text-amber-50">
      <TopBar
        state={state}
        muted={muted}
        roomCode={isOnlineMatch ? room?.code ?? 'EN LIGNE' : null}
        onToggleMute={() => setMuted(soundEngine.toggleMute())}
        onReturnToLobby={handleReturnToLobby}
      />

      {tutorial && (
        <div className="absolute left-1/2 top-16 z-20 flex w-[92vw] max-w-md -translate-x-1/2 items-start justify-between gap-3 rounded-lg border border-amber-400/50 bg-stone-900/95 px-3.5 py-2.5 text-xs shadow-xl font-sans">
          <div>
            <p className="font-bold text-amber-300">{tutorial.title}</p>
            <p className="mt-0.5 text-stone-200">{tutorial.text}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              applyLocalMutation((draft) => {
                draft.tutorialStep = 0;
              })
            }
            className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-white"
            title="Masquer le tutoriel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {toast && (
        <div className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-md border border-red-400/60 bg-red-950/95 px-4 py-2 text-xs font-semibold text-red-100 shadow-xl font-sans">
          {toast}
        </div>
      )}

      <MapCanvas
        state={state}
        selectedProvinceId={selectedId}
        onSelectProvince={handleSelectProvince}
        focusTarget={focusTarget}
      />

      {selectedProvince && (
        <ProvinceDrawer
          key={selectedProvince.id}
          state={state}
          province={selectedProvince}
          onClose={() => setSelectedId(null)}
          onBuild={(provinceId: string, building: BuildingType) =>
            dispatchGameAction(
              { type: 'build', provinceId, building },
              (draft) => startConstruction(draft, draft.playerNationId, provinceId, building),
              () => soundEngine.playBuild()
            )
          }
          onRecruit={(provinceId: string, unit: UnitType) =>
            dispatchGameAction(
              { type: 'recruit', provinceId, unit },
              (draft) => startRecruitment(draft, draft.playerNationId, provinceId, unit, 1),
              () => soundEngine.playRecruit()
            )
          }
          onMoveArmy={(fromId: string, toId: string, units: UnitStack) =>
            dispatchGameAction(
              { type: 'move', fromId, toId, units },
              (draft) => orderMoveArmy(draft, draft.playerNationId, fromId, toId, units),
              () => soundEngine.playMarch()
            )
          }
          onBombard={(fromId: string, targetId: string) =>
            dispatchGameAction(
              { type: 'bombard', fromId, targetId },
              (draft) => orderArtilleryBombardment(draft, draft.playerNationId, fromId, targetId),
              () => soundEngine.playCannon()
            )
          }
        />
      )}

      <CommandTabs
        state={state}
        isOnline={isOnlineMatch}
        roomPlayers={room?.players ?? []}
        chatMessages={chatMessages}
        onSendChat={handleSendChat}
        onFocusProvince={handleFocusProvince}
        onRetreat={(battleId: string) =>
          dispatchGameAction(
            { type: 'retreat', battleId },
            (draft) => retreatFromBattle(draft, battleId, draft.playerNationId),
            () => soundEngine.playMarch()
          )
        }
        onSetDiplomacy={(target: PlayableNationId, status: DiplomaticStatus) =>
          dispatchGameAction(
            { type: 'diplomacy', target, status },
            (draft) => {
              setDiplomaticStatus(draft, draft.playerNationId, target, status);
              pushTelegram(
                draft,
                `Statut diplomatique avec ${NATION_TEMPLATES[target].shortName} modifié : ${status.toUpperCase()}.`,
                'diplomacy'
              );
            },
            () => soundEngine.playTelegram()
          )
        }
        onRespondOffer={(offerId: string, accept: boolean) =>
          dispatchGameAction(
            { type: 'respondOffer', offerId, accept },
            (draft) => respondToDiplomaticOffer(draft, offerId, accept),
            () => soundEngine.playTelegram()
          )
        }
      />

      {state.phase === 'ENDED' && state.winnerId && finalStandings && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md rounded-xl border border-amber-400/50 bg-stone-900 p-6 text-center shadow-2xl">
            <Trophy className="mx-auto h-10 w-10 text-amber-400" />
            <h2 className="mt-2 font-serif text-2xl font-bold text-amber-100">
              {state.winnerId === state.playerNationId
                ? 'Victoire Totale !'
                : `Victoire : ${NATION_TEMPLATES[state.winnerId].name}`}
            </h2>

            <div className="mt-4 space-y-1.5 text-left text-xs">
              {finalStandings.slice(0, 5).map((row, idx) => (
                <div
                  key={row.nationId}
                  className="flex items-center justify-between rounded bg-stone-950/80 px-3 py-1.5"
                >
                  <span>
                    #{idx + 1} {NATION_TEMPLATES[row.nationId].shortName}
                  </span>
                  <span className="font-bold text-amber-300">{row.victoryPoints} PV</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleReturnToLobby}
              className="mt-5 w-full rounded-lg bg-amber-600 py-2.5 font-serif text-sm font-bold text-stone-950 hover:bg-amber-500"
            >
              Retourner au Lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}