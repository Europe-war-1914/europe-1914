import { Check, FlaskConical, Pickaxe, Shield, Swords, X } from 'lucide-react';
import { ALL_TECH_AXES, TECH_AXES_SPECS, TECH_COSTS_TP } from '../data/balance';
import type { GameState, TechAxis, TechBranch } from '../engine/types';

interface TechTreeModalProps {
  state: GameState;
  onUnlockTech: (axis: TechAxis) => void;
  onClose: () => void;
}

const BRANCH_META: Record<
  TechBranch,
  { title: string; subtitle: string; icon: typeof Shield; accent: string }
> = {
  defense: {
    title: 'Défense',
    subtitle: 'Contres : -50 % (niv.1), -75 % (niv.2), -100 %* (niv.3)',
    icon: Shield,
    accent: 'text-emerald-300 border-emerald-700/50',
  },
  army: {
    title: 'Armée',
    subtitle: '+20 % attaque & défense par niveau pour chaque corps',
    icon: Swords,
    accent: 'text-red-300 border-red-700/50',
  },
  resources: {
    title: 'Ressources',
    subtitle: 'Usines d’extraction séparées & vitesse des ouvriers',
    icon: Pickaxe,
    accent: 'text-amber-300 border-amber-700/50',
  },
};

const BRANCHES: TechBranch[] = ['defense', 'army', 'resources'];

export function TechTreeModal({ state, onUnlockTech, onClose }: TechTreeModalProps) {
  const nation = state.nations[state.playerNationId];
  const tp = Math.floor(nation.techPoints);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm font-sans overflow-y-auto">
      <div className="relative my-auto w-full max-w-5xl rounded-xl border border-stone-700 bg-stone-950 p-4 sm:p-6 text-stone-100 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white"
          title="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-800 pb-3 pr-8">
          <div>
            <div className="flex items-center gap-2 text-sky-400">
              <FlaskConical className="h-4 w-4" />
              <span className="text-[11px] font-bold uppercase tracking-widest">
                Recherche Instantanée • 1914 : L’Europe en Flammes
              </span>
            </div>
            <h2 className="mt-0.5 font-serif text-xl sm:text-2xl font-bold text-amber-100">
              Arbre Technologique d’État-Major
            </h2>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-950/60 px-3.5 py-2">
            <FlaskConical className="h-4 w-4 text-sky-300" />
            <span className="font-mono text-base font-bold text-sky-100">{tp} PT</span>
            <span className="text-[11px] text-sky-300">disponibles</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {BRANCHES.map((branch) => {
            const meta = BRANCH_META[branch];
            const Icon = meta.icon;
            const axes = ALL_TECH_AXES.filter((a) => TECH_AXES_SPECS[a].branch === branch);

            return (
              <div
                key={branch}
                className="flex flex-col rounded-lg border border-stone-800 bg-stone-900/70 p-3"
              >
                <div className={`mb-2.5 border-b pb-2 ${meta.accent}`}>
                  <div className="flex items-center gap-2 font-serif text-base font-bold">
                    <Icon className="h-4 w-4" />
                    <span>{meta.title}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-stone-400">{meta.subtitle}</p>
                </div>

                <div className="space-y-2.5">
                  {axes.map((axis) => {
                    const spec = TECH_AXES_SPECS[axis];
                    const level = nation.techLevels[axis] ?? 0;
                    const isMax = level >= 3;
                    const nextLevel = (level + 1) as 1 | 2 | 3;
                    const nextCost = isMax ? 0 : TECH_COSTS_TP[nextLevel];
                    const canBuy = !isMax && nation.techPoints >= nextCost && !nation.isEliminated;

                    return (
                      <div
                        key={axis}
                        className="rounded border border-stone-800 bg-stone-950/90 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-amber-100">{spec.label}</span>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3].map((pip) => (
                              <span
                                key={pip}
                                className={`h-2 w-4 rounded-sm ${
                                  level >= pip ? 'bg-sky-400' : 'bg-stone-800'
                                }`}
                              />
                            ))}
                            <span className="ml-1 font-mono text-[10px] text-stone-400">
                              {level}/3
                            </span>
                          </div>
                        </div>

                        <p className="mt-1 text-[11px] leading-snug text-stone-400">
                          {spec.description}
                        </p>

                        <div className="mt-2">
                          {isMax ? (
                            <div className="flex items-center justify-center gap-1 rounded border border-emerald-700/50 bg-emerald-950/40 py-1 text-[11px] font-semibold text-emerald-300">
                              <Check className="h-3.5 w-3.5" />
                              Maîtrisé (Niv. 3)
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!canBuy}
                              onClick={() => onUnlockTech(axis)}
                              className="w-full rounded bg-sky-600 py-1.5 text-[11px] font-bold text-stone-950 transition hover:bg-sky-500 disabled:bg-stone-800 disabled:text-stone-500"
                            >
                              Débloquer Niv. {nextLevel} — {nextCost} PT
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] text-stone-400">
          * Au niveau 3, un minimum symbolique (5 %) est conservé pour éviter tout blocage total.
          Les Points Technologiques sont produits par votre laboratoire unique de capitale et gagnés
          en éliminant une capitale ennemie.
        </p>
      </div>
    </div>
  );
}