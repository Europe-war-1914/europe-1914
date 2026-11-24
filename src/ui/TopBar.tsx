import {
  Clock,
  Coins,
  Droplets,
  Flame,
  Radio,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { NATION_TEMPLATES } from '../data/nations';
import { getNationIncomePerMinute } from '../engine/economy';
import { getVictoryStandings } from '../engine/gameLoop';
import type { GameState } from '../engine/types';

interface TopBarProps {
  state: GameState;
  muted: boolean;
  roomCode?: string | null;
  onToggleMute: () => void;
  onReturnToLobby: () => void;
}

export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function TopBar({
  state,
  muted,
  roomCode,
  onToggleMute,
  onReturnToLobby,
}: TopBarProps) {
  const player = state.nations[state.playerNationId];
  const tpl = NATION_TEMPLATES[state.playerNationId];
  const income = getNationIncomePerMinute(state, state.playerNationId);
  const { standings, targetVictoryPoints } = getVictoryStandings(state);
  const playerStanding = standings.find((s) => s.nationId === state.playerNationId);
  const playerVp = playerStanding?.victoryPoints ?? 0;

  const isMob = state.phase === 'MOBILIZATION';
  const timeLeft = isMob
    ? state.mobilizationDurationSeconds - state.elapsedSeconds
    : state.maxDurationSeconds - state.elapsedSeconds;

  return (
    <header className="absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/25 bg-stone-950/92 px-3 py-2 text-amber-50 shadow-lg backdrop-blur-sm font-sans">
      {/* Nation + Ressources */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded border border-amber-200/25 bg-stone-900 px-2.5 py-1">
          <span
            className="h-3 w-3 rounded-full border border-white/50"
            style={{ backgroundColor: tpl.color }}
          />
          <span className="font-serif text-sm font-bold text-amber-100">{tpl.shortName}</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 rounded bg-stone-900/90 px-2 py-1 border border-stone-700/80">
            <Coins className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-bold text-amber-100">{Math.floor(player.resources.gold)}</span>
            <span className="text-emerald-400">+{income.gold}/m</span>
          </div>

          <div className="flex items-center gap-1.5 rounded bg-stone-900/90 px-2 py-1 border border-stone-700/80">
            <Wrench className="h-3.5 w-3.5 text-slate-300" />
            <span className="font-bold text-slate-100">{Math.floor(player.resources.steel)}</span>
            <span className="text-emerald-400">+{income.steel}/m</span>
          </div>

          <div className="flex items-center gap-1.5 rounded bg-stone-900/90 px-2 py-1 border border-stone-700/80">
            <Droplets className="h-3.5 w-3.5 text-sky-400" />
            <span className="font-bold text-sky-100">{Math.floor(player.resources.oil)}</span>
            <span className="text-emerald-400">+{income.oil}/m</span>
          </div>
        </div>
      </div>

      {/* Phase & Chrono temps réel / Code salon */}
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center gap-2 rounded px-3 py-1 text-xs font-bold border ${
            isMob
              ? 'border-amber-400/50 bg-amber-950/80 text-amber-200'
              : 'border-red-500/50 bg-red-950/80 text-red-200'
          }`}
        >
          {isMob ? <Clock className="h-3.5 w-3.5" /> : <Flame className="h-3.5 w-3.5" />}
          <span>{isMob ? 'MOBILISATION' : 'GUERRE'}</span>
          <span className="font-mono text-sm">{formatClock(timeLeft)}</span>
        </div>

        <div
          className="hidden sm:flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-950/50 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
          title="Partie synchronisée en temps réel (format en ligne)"
        >
          <Radio className="h-3 w-3 animate-pulse" />
          <span>{roomCode ? `SALON ${roomCode}` : 'TEMPS RÉEL'}</span>
        </div>
      </div>

      {/* Points de victoire + Audio + Menu */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded border border-amber-300/30 bg-stone-900 px-2.5 py-1 text-xs">
          <Trophy className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-bold text-amber-100">
            {playerVp} / {targetVictoryPoints} PV
          </span>
        </div>

        <button
          onClick={onToggleMute}
          className={`flex items-center justify-center rounded border p-1.5 transition ${
            muted
              ? 'border-stone-700 bg-stone-900 text-stone-500 hover:text-stone-300'
              : 'border-amber-300/30 bg-stone-900 text-amber-200 hover:bg-stone-800'
          }`}
          title={muted ? 'Activer les effets sonores' : 'Couper les effets sonores'}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>

        <button
          onClick={onReturnToLobby}
          className="flex items-center gap-1 rounded border border-stone-700 bg-stone-900 px-2.5 py-1 text-xs text-stone-300 hover:bg-stone-800 hover:text-white"
          title="Changer de nation / Nouvelle partie"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Menu</span>
        </button>
      </div>
    </header>
  );
}