import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Crown, Eye, LogIn, LogOut, Skull, Trophy, User, Users } from 'lucide-react';
import { soundEngine } from './audio/soundEngine';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from './data/nations';
import {
  orderMoveArmy,
  orderRedirectArmy,
  orderTurnAround,
  retreatFromBattle,
} from './engine/combat';
import { requestDiplomaticAction, respondToDiplomaticOffer } from './engine/diplomacy';
import {
  startRecruitment,
  unlockTechnology,
  upgradeBarracks,
  upgradeDefense,
  upgradeExtractionFactory,
  upgradeLaboratory,
} from './engine/economy';
import {
  cloneGameState,
  createNewGame,
  getVictoryStandings,
  stepGameState,
} from './engine/gameLoop';
import type {
  DefenseType,
  DiplomaticStatus,
  ExtractionResource,
  GamePhase,
  GameState,
  PlayableNationId,
  TechAxis,
  UnitStack,
  UnitType,
} from './engine/types';
import { isSupabaseConfigured, supabase, type PlayerProfile } from './lib/supabase';
import type { ActionResponse, ChatMessage, ClientAction, RoomSummary } from './network/protocol';
import { MapCanvas } from './renderer/MapCanvas';
import { MAP_THEMES, type MapThemeId } from './renderer/mapThemes';
import { AuthModal } from './ui/AuthModal';
import { CommandTabs } from './ui/CommandTabs';
import { LeaderboardModal } from './ui/LeaderboardModal';
import { OnlineLobby } from './ui/OnlineLobby';
import { ProvinceDrawer } from './ui/ProvinceDrawer';
import { ShopModal } from './ui/ShopModal';
import { TechTreeModal } from './ui/TechTreeModal';
import { TopBar } from './ui/TopBar';

interface MatchEloDelta {
  oldElo: number;
  newElo: number;
  delta: number;
  rank: number;
  isWinner: boolean;
  botsAlive: number;
  humansAlive: number;
  botsEliminated: number;
  humansEliminated: number;
}

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3001';
const ACTIVE_ROOM_KEY = 'europe1914_active_room';
const CLIENT_TOKEN_KEY = 'europe1914_client_token';

function getClientToken(): string {
  let token = window.sessionStorage.getItem(CLIENT_TOKEN_KEY);
  if (!token) {
    token = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    window.sessionStorage.setItem(CLIENT_TOKEN_KEY, token);
  }
  return token;
}

export default function App() {
  const [lobbyTab, setLobbyTab] = useState<'solo' | 'online'>(() =>
    window.sessionStorage.getItem(ACTIVE_ROOM_KEY) ? 'online' : 'solo'
  );
  const [state, setState] = useState<GameState | null>(null);
  const [isOnlineMatch, setIsOnlineMatch] = useState(false);
  const [chosenNation, setChosenNation] = useState<PlayableNationId>('france');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [observerDismissed, setObserverDismissed] = useState(false);
  const [techTreeOpen, setTechTreeOpen] = useState(false);

  const [moveOrder, setMoveOrder] = useState<{ fromId: string; units: UnitStack } | null>(null);

  const [authUser, setAuthUser] = useState<{
    id: string;
    username: string;
    email?: string;
  } | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileNonce, setProfileNonce] = useState(0);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [eloResults, setEloResults] = useState<Record<string, MatchEloDelta>>({});
  const [mapTheme, setMapTheme] = useState<MapThemeId>(() => {
    const saved = window.localStorage.getItem('europe1914_theme');
    return saved === 'night' || saved === 'tactical' ? saved : 'vintage';
  });

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
  const shouldConnectSocket =
    lobbyTab === 'online' || isOnlineMatch || Boolean(window.sessionStorage.getItem(ACTIVE_ROOM_KEY));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (!payment) return;

    if (payment === 'success') {
      setToast('Paiement réussi ! Activation de votre Pack Commandant...');
      setProfileNonce((n) => n + 1);
      const t = window.setTimeout(() => setProfileNonce((n) => n + 1), 2500);
      window.history.replaceState({}, '', window.location.pathname);
      return () => window.clearTimeout(t);
    }

    if (payment === 'cancelled') {
      setToast('Paiement annulé.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
      setAuthUser({ id: user.id, username: fallbackName, email: user.email });
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
      if (error) console.error('Erreur lecture profil Supabase:', error);

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
  }, [authUser, profileNonce]);

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setProfile(null);
    soundEngine.playSelect();
  };

  const handleBuyCommander = async () => {
    if (!authUser) {
      setShopModalOpen(false);
      setAuthModalOpen(true);
      return;
    }

    setToast('Connexion au paiement sécurisé Stripe...');
    try {
      const response = await fetch(`${SERVER_URL}/api/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: authUser.id, email: authUser.email }),
      });

      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setToast(data.error ?? 'Impossible de démarrer le paiement Stripe.');
        soundEngine.playError();
        return;
      }
      window.location.href = data.url;
    } catch {
      setToast('Le serveur est en cours de réveil, réessayez dans quelques secondes.');
      soundEngine.playError();
    }
  };

  useEffect(() => {
    if (!isSoloActive) return;
    const timer = window.setInterval(() => {
      setState((prev) => (prev ? stepGameState(prev, 0.25) : null));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isSoloActive]);

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

      const savedRoom = window.sessionStorage.getItem(ACTIVE_ROOM_KEY);
      if (savedRoom) {
        socket.emit(
          'room:rejoin',
          { code: savedRoom, clientToken: getClientToken() },
          (res: { ok: boolean; room?: RoomSummary }) => {
            if (res.ok && res.room) {
              setLobbyTab('online');
              setRoom(res.room);
            } else {
              window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
            }
          }
        );
      }
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

    socket.on('game:elo', (results: Record<string, MatchEloDelta>) => {
      setEloResults(results);
      setProfileNonce((n) => n + 1);
    });

    socket.on('game:state', (incoming: GameState) => {
      setIsOnlineMatch(true);
      setState(incoming);

      if (incoming.phase === 'ENDED') {
        window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
      }

      if (!hasCenteredOnlineRef.current) {
        hasCenteredOnlineRef.current = true;
        setObserverDismissed(false);
        setEloResults({});
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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!state) {
      prevPhaseRef.current = null;
      prevTopTelegramIdRef.current = null;
      prevPlayerBattlesRef.current = 0;
      return;
    }

    const prevPhase = prevPhaseRef.current;
    if (prevPhase !== null && prevPhase !== 'ENDED' && state.phase === 'ENDED') {
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

    window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    setObserverDismissed(false);
    setEloResults({});
    setIsOnlineMatch(false);
    setChatMessages([]);
    setMoveOrder(null);
    setTechTreeOpen(false);
    setState(fresh);
    setSelectedId(capital?.id ?? null);
    setFocusTarget(capital ? [capital.center[0], capital.center[1]] : null);
    soundEngine.playMarch();
  };

  const handleCreateRoom = (playerName: string, preferredNation: PlayableNationId) => {
    const socket = socketRef.current;
    if (!socket) return;
    setOnlineError(null);
    setChatMessages([]);
    socket.emit(
      'room:create',
      {
        playerName: profile?.username ?? playerName,
        preferredNation,
        clientToken: getClientToken(),
        userId: profile?.id,
      },
      (res: { ok: boolean; room?: RoomSummary; reason?: string }) => {
        if (!res.ok) {
          setOnlineError(res.reason ?? 'Impossible de créer le salon.');
          soundEngine.playError();
        } else if (res.room) {
          setRoom(res.room);
          window.sessionStorage.setItem(ACTIVE_ROOM_KEY, res.room.code);
          soundEngine.playSelect();
        }
      }
    );
  };

  const handleJoinRoom = (code: string, playerName: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    setOnlineError(null);
    setChatMessages([]);
    socket.emit(
      'room:join',
      {
        code,
        playerName: profile?.username ?? playerName,
        clientToken: getClientToken(),
        userId: profile?.id,
      },
      (res: { ok: boolean; room?: RoomSummary; reason?: string }) => {
        if (!res.ok) {
          setOnlineError(res.reason ?? 'Impossible de rejoindre le salon.');
          soundEngine.playError();
        } else if (res.room) {
          setRoom(res.room);
          window.sessionStorage.setItem(ACTIVE_ROOM_KEY, res.room.code);
          soundEngine.playSelect();
        }
      }
    );
  };

  const handleQuickPlay = (playerName: string, preferredNation?: PlayableNationId) => {
    const socket = socketRef.current;
    if (!socket) return;
    setOnlineError(null);
    setChatMessages([]);
    socket.emit(
      'room:quickplay',
      {
        playerName: profile?.username ?? playerName,
        preferredNation,
        clientToken: getClientToken(),
        userId: profile?.id,
      },
      (res: { ok: boolean; room?: RoomSummary; reason?: string }) => {
        if (!res.ok) {
          setOnlineError(res.reason ?? 'Impossible de rejoindre le matchmaking.');
          soundEngine.playError();
        } else if (res.room) {
          setRoom(res.room);
          window.sessionStorage.setItem(ACTIVE_ROOM_KEY, res.room.code);
          soundEngine.playSelect();
        }
      }
    );
  };

  const handleSelectOnlineNation = (nationId: PlayableNationId) => {
    socketRef.current?.emit('room:selectNation', { nationId }, (res: ActionResponse) => {
      if (!res.ok && res.reason) {
        setOnlineError(res.reason);
        soundEngine.playError();
      } else {
        soundEngine.playSelect();
      }
    });
  };

  const handleStartRoom = () => {
    socketRef.current?.emit('room:start', (res: ActionResponse) => {
      if (!res.ok && res.reason) {
        setOnlineError(res.reason);
        soundEngine.playError();
      }
    });
  };

  const handleLeaveRoom = () => {
    socketRef.current?.emit('room:leave');
    window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    setRoom(null);
    setChatMessages([]);
    setOnlineError(null);
  };

  const handleReturnToLobby = () => {
    if (isOnlineMatch && socketRef.current) {
      socketRef.current.emit('room:leave');
    }
    window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    hasCenteredOnlineRef.current = false;
    setObserverDismissed(false);
    setEloResults({});
    setIsOnlineMatch(false);
    setRoom(null);
    setChatMessages([]);
    setMoveOrder(null);
    setTechTreeOpen(false);
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

    socket.emit('chat:send', { channel, toNationId, text }, (res?: ActionResponse) => {
      if (res && !res.ok) {
        if (res.reason) setToast(res.reason);
        soundEngine.playError();
      }
    });
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
    if (id) soundEngine.playSelect();
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
      <div className="h-dvh w-full overflow-y-auto overscroll-y-contain touch-pan-y bg-stone-950 px-3 py-4 pb-20 sm:p-6 text-amber-50 font-sans">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-start sm:justify-center">
          <div className="w-full rounded-xl border border-stone-700 bg-stone-900/95 p-4 sm:p-6 shadow-2xl">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLeaderboardOpen(true)}
                        className="flex items-center gap-1.5 rounded border border-stone-700 bg-stone-900 px-2.5 py-1 font-semibold text-amber-100 hover:bg-stone-800"
                      >
                        <Trophy className="h-3.5 w-3.5 text-amber-400" />
                        Classement
                      </button>
                      <button
                        type="button"
                        onClick={() => setShopModalOpen(true)}
                        className="flex items-center gap-1.5 rounded border border-amber-400/50 bg-amber-950/70 px-2.5 py-1 font-semibold text-amber-200 hover:bg-amber-900/70"
                      >
                        <Crown className="h-3.5 w-3.5 text-amber-400" />
                        Boutique
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex items-center gap-1 rounded border border-stone-700 bg-stone-900 px-2.5 py-1 text-stone-300 hover:bg-stone-800 hover:text-white"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Déconnexion
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-stone-400">
                      Mode Invité — connectez-vous pour sauvegarder votre ELO et vos packs.
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLeaderboardOpen(true)}
                        className="flex items-center gap-1.5 rounded border border-stone-700 bg-stone-900 px-2.5 py-1 font-semibold text-amber-100 hover:bg-stone-800"
                      >
                        <Trophy className="h-3.5 w-3.5 text-amber-400" />
                        Classement
                      </button>
                      <button
                        type="button"
                        onClick={() => setShopModalOpen(true)}
                        className="flex items-center gap-1.5 rounded border border-amber-400/50 bg-amber-950/70 px-2.5 py-1 font-semibold text-amber-200 hover:bg-amber-900/70"
                      >
                        <Crown className="h-3.5 w-3.5 text-amber-400" />
                        Boutique
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthModalOpen(true)}
                        className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1 font-bold text-stone-950 hover:bg-amber-500"
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        Connexion / Inscription
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-400/85">
                Grande Stratégie • Guerre Totale • 65 Provinces
              </p>
              <h1 className="mt-1 font-serif text-2xl sm:text-4xl font-bold text-amber-100">
                1914 : L’Europe en Flammes
              </h1>
              <p className="mt-1.5 text-xs sm:text-sm text-stone-400">
                Arbre technologique instantané • 8 unités & contres tactiques • Annexion à la chute
                d’une capitale
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-stone-800 bg-stone-950/70 p-1">
              <button
                type="button"
                onClick={() => setLobbyTab('solo')}
                className={`rounded-md py-2 text-xs sm:text-sm font-bold transition ${
                  lobbyTab === 'solo'
                    ? 'bg-amber-600 text-stone-950'
                    : 'text-stone-300 hover:text-amber-100'
                }`}
              >
                Campagne Solo (vs 7 IA)
              </button>
              <button
                type="button"
                onClick={() => setLobbyTab('online')}
                className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs sm:text-sm font-bold transition ${
                  lobbyTab === 'online'
                    ? 'bg-amber-600 text-stone-950'
                    : 'text-stone-300 hover:text-amber-100'
                }`}
              >
                <Users className="h-4 w-4" />
                Multijoueur en ligne
              </button>
            </div>

            {lobbyTab === 'solo' ? (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
                  {PLAYABLE_NATIONS.map((id) => {
                    const tpl = NATION_TEMPLATES[id];
                    const active = chosenNation === id;
                    return (
                      <button
                        type="button"
                        key={id}
                        onClick={() => setChosenNation(id)}
                        className={`rounded-lg border p-3 text-left transition ${
                          active
                            ? 'border-amber-400 bg-stone-800 ring-1 ring-amber-400/60'
                            : 'border-stone-800 bg-stone-950/70 hover:border-stone-600'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-white/40"
                            style={{ backgroundColor: tpl.color }}
                          />
                          <span className="font-serif text-xs sm:text-sm font-bold text-amber-100">
                            {tpl.shortName}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-snug text-stone-400">{tpl.lore}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => startSoloMatch(chosenNation)}
                    className="w-full sm:w-auto rounded-lg bg-amber-600 px-10 py-3 font-serif text-base font-bold text-stone-950 shadow-lg transition hover:bg-amber-500"
                  >
                    Entrer en guerre — {NATION_TEMPLATES[chosenNation].shortName}
                  </button>
                </div>
              </div>
            ) : (
              <OnlineLobby
                connected={connected}
                serverUrl={SERVER_URL}
                mySocketId={mySocketId}
                room={room}
                chatMessages={chatMessages}
                error={onlineError}
                defaultPlayerName={profile?.username}
                onRetryConnection={() => setSocketNonce((n) => n + 1)}
                onQuickPlay={handleQuickPlay}
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
                onSelectNation={handleSelectOnlineNation}
                onSendChat={handleSendChat}
                onStartRoom={handleStartRoom}
                onLeaveRoom={handleLeaveRoom}
              />
            )}
          </div>
        </div>

        {authModalOpen && (
          <AuthModal
            onClose={() => setAuthModalOpen(false)}
            onSuccess={() => {
              setAuthModalOpen(false);
              setProfileNonce((n) => n + 1);
            }}
          />
        )}

        {shopModalOpen && (
          <ShopModal
            profile={profile}
            activeTheme={mapTheme}
            onSelectTheme={(theme) => {
              setMapTheme(theme);
              window.localStorage.setItem('europe1914_theme', theme);
              soundEngine.playSelect();
            }}
            onOpenAuth={() => setAuthModalOpen(true)}
            onBuyCommander={handleBuyCommander}
            onClose={() => setShopModalOpen(false)}
          />
        )}

        {leaderboardOpen && (
          <LeaderboardModal
            currentUserId={profile?.id}
            onClose={() => setLeaderboardOpen(false)}
          />
        )}

        {toast && (
          <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-amber-400/50 bg-stone-900 px-4 py-2 text-xs font-semibold text-amber-100 shadow-xl">
            {toast}
          </div>
        )}
      </div>
    );
  }

  // --- PARTIE EN COURS ---
  const selectedProvince = selectedId ? state.provinces[selectedId] ?? null : null;
  const finalStandings = state.phase === 'ENDED' ? getVictoryStandings(state).standings : null;
  const myEloDelta = eloResults[state.playerNationId] ?? null;
  const isPlayerEliminated =
    Boolean(state.nations[state.playerNationId]?.isEliminated) && state.phase !== 'ENDED';

  return (
    <div
      className={`relative h-dvh w-screen overflow-hidden ${MAP_THEMES[mapTheme].bgClass} text-stone-100`}
    >
      <TopBar
        state={state}
        muted={muted}
        roomCode={isOnlineMatch ? room?.code ?? 'EN LIGNE' : null}
        onOpenTechTree={() => setTechTreeOpen(true)}
        onToggleMute={() => setMuted(soundEngine.toggleMute())}
        onReturnToLobby={handleReturnToLobby}
      />

      {toast && (
        <div className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-md border border-red-400/60 bg-red-950/95 px-4 py-2 text-xs font-semibold text-red-100 shadow-xl font-sans">
          {toast}
        </div>
      )}

      <div className="h-full w-full" style={{ filter: MAP_THEMES[mapTheme].canvasFilter }}>
        <MapCanvas
          state={state}
          selectedProvinceId={selectedId}
          onSelectProvince={handleSelectProvince}
          focusTarget={focusTarget}
          moveOrderFromId={moveOrder?.fromId ?? null}
          moveOrderUnits={moveOrder?.units ?? null}
          onConfirmMove={(fromId, targetId, units) => {
            setMoveOrder(null);
            dispatchGameAction(
              { type: 'move', fromId, targetId, units },
              (draft) => orderMoveArmy(draft, draft.playerNationId, fromId, targetId, units),
              () => soundEngine.playMarch()
            );
          }}
          onCancelMove={() => setMoveOrder(null)}
          onTurnAroundArmy={(armyId) =>
            dispatchGameAction(
              { type: 'turnAround', armyId },
              (draft) => orderTurnAround(draft, draft.playerNationId, armyId),
              () => soundEngine.playMarch()
            )
          }
          onRedirectArmy={(armyId, newTargetId) =>
            dispatchGameAction(
              { type: 'redirectArmy', armyId, targetId: newTargetId },
              (draft) => orderRedirectArmy(draft, draft.playerNationId, armyId, newTargetId),
              () => soundEngine.playMarch()
            )
          }
        />
      </div>

      {selectedProvince && (
        <ProvinceDrawer
          key={selectedProvince.id}
          state={state}
          province={selectedProvince}
          isTargetingFromHere={moveOrder?.fromId === selectedProvince.id}
          onClose={() => {
            setSelectedId(null);
            setMoveOrder(null);
          }}
          onUpgradeBarracks={(provinceId) =>
            dispatchGameAction(
              { type: 'upgradeBarracks', provinceId },
              (draft) => upgradeBarracks(draft, draft.playerNationId, provinceId),
              () => soundEngine.playBuild()
            )
          }
          onUpgradeLaboratory={(provinceId) =>
            dispatchGameAction(
              { type: 'upgradeLaboratory', provinceId },
              (draft) => upgradeLaboratory(draft, draft.playerNationId, provinceId),
              () => soundEngine.playBuild()
            )
          }
          onUpgradeExtraction={(provinceId, resource: ExtractionResource) =>
            dispatchGameAction(
              { type: 'upgradeExtraction', provinceId, resource },
              (draft) => upgradeExtractionFactory(draft, draft.playerNationId, provinceId, resource),
              () => soundEngine.playBuild()
            )
          }
          onUpgradeDefense={(provinceId, defense: DefenseType) =>
            dispatchGameAction(
              { type: 'upgradeDefense', provinceId, defense },
              (draft) => upgradeDefense(draft, draft.playerNationId, provinceId, defense),
              () => soundEngine.playBuild()
            )
          }
          onRecruit={(provinceId, unit: UnitType, count: number) =>
            dispatchGameAction(
              { type: 'recruit', provinceId, unit, count },
              (draft) => startRecruitment(draft, draft.playerNationId, provinceId, unit, count),
              () => soundEngine.playRecruit()
            )
          }
          onArmMoveOrder={(fromId, units) => {
            setMoveOrder({ fromId, units });
            soundEngine.playSelect();
          }}
          onCancelMoveOrder={() => setMoveOrder(null)}
          onOpenTechTree={() => setTechTreeOpen(true)}
        />
      )}

      <CommandTabs
        state={state}
        isOnline={isOnlineMatch}
        roomPlayers={room?.players ?? []}
        chatMessages={chatMessages}
        onSendChat={handleSendChat}
        onFocusProvince={handleFocusProvince}
        onTurnAround={(armyId) =>
          dispatchGameAction(
            { type: 'turnAround', armyId },
            (draft) => orderTurnAround(draft, draft.playerNationId, armyId),
            () => soundEngine.playMarch()
          )
        }
        onRetreat={(battleId) =>
          dispatchGameAction(
            { type: 'retreat', battleId },
            (draft) => retreatFromBattle(draft, battleId, draft.playerNationId),
            () => soundEngine.playMarch()
          )
        }
        onSetDiplomacy={(target: PlayableNationId, status: DiplomaticStatus) =>
          dispatchGameAction(
            { type: 'diplomacy', target, status },
            (draft) => requestDiplomaticAction(draft, draft.playerNationId, target, status),
            () => soundEngine.playTelegram()
          )
        }
        onRespondOffer={(offerId, accept) =>
          dispatchGameAction(
            { type: 'respondOffer', offerId, accept },
            (draft) => respondToDiplomaticOffer(draft, offerId, accept),
            () => soundEngine.playTelegram()
          )
        }
      />

      {techTreeOpen && (
        <TechTreeModal
          state={state}
          onUnlockTech={(axis: TechAxis) =>
            dispatchGameAction(
              { type: 'unlockTech', axis },
              (draft) => unlockTechnology(draft, draft.playerNationId, axis),
              () => soundEngine.playBuild()
            )
          }
          onClose={() => setTechTreeOpen(false)}
        />
      )}

      {isPlayerEliminated && !observerDismissed && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md rounded-xl border border-red-500/50 bg-stone-900 p-6 text-center shadow-2xl">
            <Skull className="mx-auto h-10 w-10 text-red-400" />
            <h2 className="mt-2 font-serif text-2xl font-bold text-red-200">
              Votre capitale est tombée !
            </h2>
            <p className="mt-1 text-xs text-stone-300">
              {NATION_TEMPLATES[state.playerNationId].name} est éliminée et ses territoires ont été
              annexés.
            </p>

            {isOnlineMatch && myEloDelta && (
              <div className="mt-4 rounded-lg border border-stone-800 bg-stone-950/90 p-3 text-xs">
                <div className="flex items-center justify-center gap-2 font-mono text-sm">
                  <span className="text-stone-400">ELO :</span>
                  <span className="text-amber-100">{myEloDelta.oldElo}</span>
                  <span className="text-stone-500">→</span>
                  <span className="font-bold text-amber-300">{myEloDelta.newElo}</span>
                  <span
                    className={
                      myEloDelta.delta >= 0
                        ? 'font-bold text-emerald-400'
                        : 'font-bold text-red-400'
                    }
                  >
                    ({myEloDelta.delta >= 0 ? `+${myEloDelta.delta}` : myEloDelta.delta})
                  </span>
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setObserverDismissed(true)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-stone-700 bg-stone-800 py-2.5 text-xs font-bold text-amber-100 hover:bg-stone-700"
              >
                <Eye className="h-3.5 w-3.5" />
                Observer la fin
              </button>
              <button
                type="button"
                onClick={handleReturnToLobby}
                className="rounded-lg bg-amber-600 py-2.5 font-serif text-xs font-bold text-stone-950 hover:bg-amber-500"
              >
                Retourner au Lobby
              </button>
            </div>
          </div>
        </div>
      )}

      {state.phase === 'ENDED' && state.winnerId && finalStandings && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md rounded-xl border border-amber-400/50 bg-stone-900 p-6 text-center shadow-2xl">
            <Trophy className="mx-auto h-10 w-10 text-amber-400" />
            <h2 className="mt-2 font-serif text-2xl font-bold text-amber-100">
              {state.winnerId === state.playerNationId
                ? 'Victoire Totale !'
                : `Victoire : ${NATION_TEMPLATES[state.winnerId].name}`}
            </h2>

            {isOnlineMatch && myEloDelta && (
              <div className="mt-3 rounded-lg border border-amber-400/30 bg-stone-950/90 p-3 text-xs">
                <div className="flex items-center justify-center gap-2 font-mono text-sm">
                  <span className="text-stone-400">ELO :</span>
                  <span className="text-amber-100">{myEloDelta.oldElo}</span>
                  <span className="text-stone-500">→</span>
                  <span className="font-bold text-amber-300">{myEloDelta.newElo}</span>
                  <span
                    className={
                      myEloDelta.delta >= 0
                        ? 'font-bold text-emerald-400'
                        : 'font-bold text-red-400'
                    }
                  >
                    ({myEloDelta.delta >= 0 ? `+${myEloDelta.delta}` : myEloDelta.delta})
                  </span>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-1.5 text-left text-xs">
              {finalStandings.slice(0, 6).map((row, idx) => (
                <div
                  key={row.nationId}
                  className="flex items-center justify-between rounded bg-stone-950/80 px-3 py-1.5"
                >
                  <span>
                    #{idx + 1} {NATION_TEMPLATES[row.nationId].shortName}{' '}
                    {row.isEliminated ? '(Éliminé)' : ''}
                  </span>
                  <span className="font-mono font-bold text-amber-300">
                    {row.provincesCount} prov.
                  </span>
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