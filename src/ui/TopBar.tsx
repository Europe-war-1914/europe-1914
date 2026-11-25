import {
  Clock,
  Coins,
  Flame,
  FlaskConical,
  Radio,
  RotateCcw,
  Shield,
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
  onOpenTechTree: () => void;
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
  onOpenTechTree,
  onToggleMute,
  onReturnToLobby,
}: TopBarProps) {
  const player = state.nations[state.playerNationId];
  const tpl = NATION_TEMPLATES[state.playerNationId];
  const income = getNationIncomePerMinute(state, state.playerNationId);
  const { aliveCount } = getVictoryStandings(state);

  return (
    <header className="absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-stone-700/80 bg-stone-950/95 px-2.5 py-1.5 sm:px-3 sm:py-2 text-stone-100 shadow-xl backdrop-blur-sm font-sans">
      {/* Nation + Ressources (Or, Acier, Gaz, PT) */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
        <div className="flex items-center gap-2 rounded border border-stone-700 bg-stone-900 px-2 py-1">
          <span
            className="h-2.5 w-2.5 rounded-full border border-white/50"
            style={{ backgroundColor: tpl.color }}
          />
          <span className="font-serif text-xs sm:text-sm font-bold text-amber-100">
            {tpl.shortName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-mono">
          <div
            className="flex items-center gap-1 rounded border border-stone-800 bg-stone-900/90 px-2 py-1"
            title="Or (trésorerie et diplomatie)"
          >
            <Coins className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-bold text-amber-200">{Math.floor(player.resources.gold)}</span>
            <span className="hidden sm:inline text-[10px] text-emerald-400">+{income.gold}/m</span>
          </div>

          <div
            className="flex items-center gap-1 rounded border border-stone-800 bg-stone-900/90 px-2 py-1"
            title="Acier (blindés, marine et défenses)"
          >
            <Wrench className="h-3.5 w-3.5 text-slate-300" />
            <span className="font-bold text-slate-100">{Math.floor(player.resources.steel)}</span>
            <span className="hidden sm:inline text-[10px] text-emerald-400">+{income.steel}/m</span>
          </div>

          <div
            className="flex items-center gap-1 rounded border border-stone-800 bg-stone-900/90 px-2 py-1"
            title="Gaz (aviation, blindés et marine)"
          >
            <Flame className="h-3.5 w-3.5 text-orange-400" />
            <span className="font-bold text-orange-200">{Math.floor(player.resources.gas)}</span>
            <span className="hidden sm:inline text-[10px] text-emerald-400">+{income.gas}/m</span>
          </div>

          <button
            type="button"
            onClick={onOpenTechTree}
            className="flex items-center gap-1.5 rounded border border-sky-500/50 bg-sky-950/80 px-2.5 py-1 text-sky-200 hover:bg-sky-900/80 transition"
            title="Ouvrir l’arbre technologique (déblocage instantané)"
          >
            <FlaskConical className="h-3.5 w-3.5 text-sky-300" />
            <span className="font-bold text-sky-100">{Math.floor(player.techPoints)} PT</span>
            <span className="hidden md:inline text-[10px] text-sky-300">
              (+{income.techPoints}/m)
            </span>
            <span className="font-sans text-[11px] font-semibold text-sky-100">• Tech</span>
          </button>
        </div>
      </div>

      {/* Statut Guerre Totale + Chrono + Audio + Retour Lobby */}
      <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
        <div
          className="hidden md:flex items-center gap-1.5 rounded border border-stone-700 bg-stone-900 px-2.5 py-1 text-stone-200"
          title="Condition de victoire : dernier empire survivant"
        >
          <Shield className="h-3.5 w-3.5 text-amber-400" />
          <span>{aliveCount}/8 Empires</span>
        </div>

        <div
          className="flex items-center gap-1.5 rounded border border-stone-700 bg-stone-900 px-2 py-1 font-mono text-stone-200"
          title="Temps de guerre écoulé (aucune limite de temps fixe)"
        >
          <Clock className="h-3.5 w-3.5 text-amber-400" />
          <span>{formatClock(state.elapsedSeconds)}</span>
        </div>

        <div className="hidden sm:flex items-center gap-1 rounded border border-stone-800 bg-stone-900/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-300">
          <Radio className="h-3 w-3 text-emerald-400" />
          <span>{roomCode ? `SALON ${roomCode}` : 'GUERRE TOTALE'}</span>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          className="flex h-7 w-7 items-center justify-center rounded border border-stone-700 bg-stone-900 text-stone-300 hover:bg-stone-800 hover:text-white"
          title={muted ? 'Activer le son' : 'Couper le son'}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={onReturnToLobby}
          className="flex items-center gap-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-stone-300 hover:bg-stone-800 hover:text-white"
          title="Retourner au menu principal"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Lobby</span>
        </button>
      </div>
    </header>
  );
}