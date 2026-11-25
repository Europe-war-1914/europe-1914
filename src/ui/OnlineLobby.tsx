import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Clock,
  Copy,
  Crown,
  Globe,
  LogOut,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from '../data/nations';
import type { PlayableNationId } from '../engine/types';
import type { ChatMessage, RoomSummary } from '../network/protocol';

interface OnlineLobbyProps {
  connected: boolean;
  serverUrl: string;
  mySocketId: string | null;
  defaultPlayerName?: string;
  room: RoomSummary | null;
  chatMessages: ChatMessage[];
  error: string | null;
  onRetryConnection: () => void;
  onQuickPlay: (playerName: string, preferredNation?: PlayableNationId) => void;
  onCreateRoom: (playerName: string, preferredNation: PlayableNationId) => void;
  onJoinRoom: (code: string, playerName: string) => void;
  onSelectNation: (nationId: PlayableNationId) => void;
  onSendChat: (channel: 'global' | 'private', text: string, toNationId?: PlayableNationId) => void;
  onStartRoom: () => void;
  onLeaveRoom: () => void;
}

export function OnlineLobby({
  connected,
  serverUrl,
  mySocketId,
  defaultPlayerName,
  room,
  chatMessages,
  error,
  onRetryConnection,
  onQuickPlay,
  onCreateRoom,
  onJoinRoom,
  onSelectNation,
  onSendChat,
  onStartRoom,
  onLeaveRoom,
}: OnlineLobbyProps) {
  const [playerName, setPlayerName] = useState(defaultPlayerName || 'Commandant');
  const [preferredNation, setPreferredNation] = useState<PlayableNationId | 'random'>('random');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (defaultPlayerName) {
      setPlayerName(defaultPlayerName);
    }
  }, [defaultPlayerName]);

  useEffect(() => {
    if (!room?.autoStartAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [room?.autoStartAt]);

  const handleCopyCode = () => {
    if (!room) return;
    void navigator.clipboard.writeText(room.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = chatDraft.trim();
    if (!trimmed) return;
    onSendChat('global', trimmed);
    setChatDraft('');
  };

  if (!room) {
    const resolvedPref =
      preferredNation === 'random' ? undefined : preferredNation;

    return (
      <div className="mt-4 space-y-3.5 sm:mt-6 sm:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-800 bg-stone-950/70 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {connected ? (
              <>
                <Wifi className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="font-semibold text-emerald-300">
                  Connecté au serveur multijoueur
                </span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 shrink-0 text-red-400" />
                <span className="text-red-300">
                  Connexion en cours / serveur hors ligne ({serverUrl})
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!connected && (
              <button
                type="button"
                onClick={onRetryConnection}
                className="flex items-center gap-1 rounded border border-amber-400/40 bg-stone-800 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-stone-700"
              >
                <RefreshCw className="h-3 w-3" />
                Réessayer
              </button>
            )}
            <span className="text-[11px] text-stone-400">2 à 8 joueurs + IA</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-amber-200">
              Votre nom de commandant
            </label>
            <input
              type="text"
              maxLength={18}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Ex. Maréchal Foch"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-amber-50 focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-amber-200">
              Puissance souhaitée (Partie Rapide)
            </label>
            <select
              value={preferredNation}
              onChange={(e) =>
                setPreferredNation(e.target.value as PlayableNationId | 'random')
              }
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-amber-50 focus:border-amber-400 focus:outline-none"
            >
              <option value="random">Aléatoire (première disponible)</option>
              {PLAYABLE_NATIONS.map((id) => (
                <option key={id} value={id}>
                  {NATION_TEMPLATES[id].shortName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* CARTE PRINCIPALE : MATCHMAKING PUBLIC (PARTIE RAPIDE) */}
        <div className="rounded-xl border border-amber-400/50 bg-gradient-to-br from-amber-950/50 via-stone-950 to-stone-900 p-4 shadow-lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-400">
                <Globe className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Matchmaking Public • Lancement en 30 s
                </span>
              </div>
              <h3 className="mt-0.5 font-serif text-base sm:text-lg font-bold text-amber-100">
                Partie Rapide en ligne
              </h3>
              <p className="mt-0.5 text-xs text-stone-300">
                Affrontez les commandants connectés en Europe. Les places restantes sont automatiquement complétées par l’IA.
              </p>
            </div>

            <button
              type="button"
              disabled={!connected}
              onClick={() => onQuickPlay(playerName, resolvedPref)}
              className="shrink-0 rounded-lg bg-amber-500 px-6 py-3 font-serif text-sm sm:text-base font-bold text-stone-950 shadow-lg transition hover:bg-amber-400 disabled:bg-stone-800 disabled:text-stone-500"
            >
              Rejoindre une partie
            </button>
          </div>
        </div>

        {/* SALONS PRIVÉS ENTRE AMIS */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <div className="flex flex-col justify-between rounded-lg border border-stone-700/80 bg-stone-950/70 p-3.5 sm:p-4">
            <div>
              <h3 className="font-serif text-sm sm:text-base font-bold text-amber-100">
                Créer un salon privé
              </h3>
              <p className="mt-1 text-xs text-stone-400">
                Générez un code de partie à partager à vos amis.
              </p>
            </div>
            <button
              type="button"
              disabled={!connected}
              onClick={() => onCreateRoom(playerName, resolvedPref ?? 'france')}
              className="mt-3 w-full rounded-lg border border-amber-400/50 bg-stone-800 py-2.5 font-serif text-sm font-bold text-amber-100 hover:bg-stone-700 disabled:opacity-40"
            >
              Créer un salon privé
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-stone-700/80 bg-stone-950/70 p-3.5 sm:p-4">
            <div>
              <h3 className="font-serif text-sm sm:text-base font-bold text-amber-100">
                Rejoindre avec un code
              </h3>
              <p className="mt-1 text-xs text-stone-400">
                Saisissez le code partagé par l’hôte (ex.{' '}
                <span className="font-mono text-amber-200">1914-AB42</span>).
              </p>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="1914-XXXX"
                className="mt-2.5 w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-sm uppercase tracking-wider text-amber-100 focus:border-amber-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={!connected || joinCode.trim().length < 4}
              onClick={() => onJoinRoom(joinCode, playerName)}
              className="mt-3 w-full rounded-lg border border-amber-400/50 bg-stone-800 py-2.5 font-serif text-sm font-bold text-amber-100 hover:bg-stone-700 disabled:opacity-40"
            >
              Rejoindre le salon
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded border border-red-500/40 bg-red-950/60 px-3 py-2 text-center text-xs text-red-200">
            {error}
          </p>
        )}
      </div>
    );
  }

  const isHost = room.hostSocketId === mySocketId;
  const aiCount = Math.max(0, PLAYABLE_NATIONS.length - room.players.length);
  const secondsLeft = room.autoStartAt
    ? Math.max(0, Math.ceil((room.autoStartAt - nowMs) / 1000))
    : null;

  return (
    <div className="mt-4 space-y-3.5 sm:mt-6 sm:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/40 bg-stone-950/80 p-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-stone-400">
            {room.isPublic ? 'Matchmaking public' : 'Code du salon privé'}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-lg sm:text-xl font-bold tracking-widest text-amber-300">
              {room.code}
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="flex items-center gap-1 rounded bg-stone-800 px-2 py-1 text-xs text-amber-100 hover:bg-stone-700"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? 'Copié' : 'Copier'}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 rounded bg-stone-900 px-2.5 py-1.5 text-amber-100 border border-stone-700">
            <Users className="h-3.5 w-3.5 text-amber-400" />
            {room.players.length} joueur(s) • {aiCount} IA
          </span>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="flex items-center gap-1 rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-stone-300 hover:bg-stone-800 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Quitter
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4 sm:gap-2.5">
        {PLAYABLE_NATIONS.map((nationId) => {
          const tpl = NATION_TEMPLATES[nationId];
          const occupant = room.players.find((p) => p.nationId === nationId);
          const isMine = occupant?.socketId === mySocketId;
          const isTakenByOther = Boolean(occupant && !isMine);

          return (
            <button
              type="button"
              key={nationId}
              disabled={isTakenByOther}
              onClick={() => onSelectNation(nationId)}
              className={`flex flex-col rounded-lg border p-2.5 sm:p-3 text-left transition ${
                isMine
                  ? 'border-amber-400 bg-stone-800 ring-1 ring-amber-400/60'
                  : isTakenByOther
                  ? 'border-stone-800 bg-stone-950/40 opacity-75 cursor-not-allowed'
                  : 'border-stone-700/80 bg-stone-950/70 hover:border-stone-500'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-white/50"
                    style={{ backgroundColor: tpl.color }}
                  />
                  <span className="font-serif text-xs sm:text-sm font-bold text-amber-100">
                    {tpl.shortName}
                  </span>
                </div>
                {occupant?.isHost && !room.isPublic && (
                  <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                )}
              </div>

              <div className="mt-1.5 text-[11px]">
                {occupant ? (
                  <span className={isMine ? 'font-bold text-amber-300' : 'text-sky-300'}>
                    {occupant.name} {isMine ? '(Vous)' : ''}
                  </span>
                ) : (
                  <span className="text-stone-500">Libre (IA)</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-stone-800 bg-stone-950/80 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-200/80">
          <MessageSquare className="h-3.5 w-3.5 text-amber-400" />
          Salon diplomatique
        </div>
        <div className="max-h-24 space-y-1.5 overflow-y-auto pr-1 text-xs">
          {chatMessages.length === 0 ? (
            <p className="text-stone-500">
              Discutez ici pour répartir les puissances avant le début de la guerre...
            </p>
          ) : (
            chatMessages.map((m) => (
              <div key={m.id} className="leading-snug text-stone-200">
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: NATION_TEMPLATES[m.fromNationId].color }}
                />
                <span className="font-semibold text-amber-200">{m.fromName}</span>
                <span className="text-stone-400">
                  {' '}
                  ({NATION_TEMPLATES[m.fromNationId].shortName}) :
                </span>{' '}
                <span>{m.text}</span>
              </div>
            ))
          )}
        </div>
        <form onSubmit={handleChatSubmit} className="mt-2 flex gap-2">
          <input
            type="text"
            maxLength={240}
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder="Envoyer un message au salon..."
            className="flex-1 rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-xs text-amber-50 focus:border-amber-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!chatDraft.trim()}
            className="flex items-center gap-1 rounded bg-amber-600 px-3 py-1.5 text-xs font-bold text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
          >
            <Send className="h-3.5 w-3.5" />
            Envoyer
          </button>
        </form>
      </div>

      {error && (
        <p className="rounded border border-red-500/40 bg-red-950/60 px-3 py-2 text-center text-xs text-red-200">
          {error}
        </p>
      )}

      <div className="flex justify-center">
        {room.isPublic ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-stone-950/90 px-6 py-3 text-xs sm:text-sm font-semibold text-amber-200">
            <Clock className="h-4 w-4 animate-pulse text-amber-400" />
            <span>
              {secondsLeft !== null && secondsLeft > 0
                ? `Lancement automatique de la bataille dans ${secondsLeft} s...`
                : 'Initialisation du champ de bataille...'}
            </span>
          </div>
        ) : isHost ? (
          <button
            type="button"
            onClick={onStartRoom}
            className="flex items-center justify-center gap-2 w-full sm:w-auto rounded-lg bg-amber-600 px-8 py-3 font-serif text-sm sm:text-base font-bold text-stone-950 shadow-lg hover:bg-amber-500"
          >
            <Play className="h-4 w-4" />
            Lancer la partie ({room.players.length} humain(s) + {aiCount} IA)
          </button>
        ) : (
          <p className="rounded-lg border border-stone-800 bg-stone-950/70 px-5 py-2.5 text-center text-xs text-stone-300">
            En attente du lancement de la partie par l’hôte...
          </p>
        )}
      </div>
    </div>
  );
}