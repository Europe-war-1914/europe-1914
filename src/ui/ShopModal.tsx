import { Check, Crown, Lock, Palette, Sparkles, X } from 'lucide-react';
import type { PlayerProfile } from '../lib/supabase';
import { MAP_THEME_LIST, type MapThemeId } from '../renderer/mapThemes';

interface ShopModalProps {
  profile: PlayerProfile | null;
  activeTheme: MapThemeId;
  onSelectTheme: (theme: MapThemeId) => void;
  onOpenAuth: () => void;
  onBuyCommander: () => void;
  onClose: () => void;
}

export function ShopModal({
  profile,
  activeTheme,
  onSelectTheme,
  onOpenAuth,
  onBuyCommander,
  onClose,
}: ShopModalProps) {
  const isCommander = Boolean(profile?.is_commander);

  const isThemeUnlocked = (themeId: MapThemeId, premium: boolean) => {
    if (!premium) return true;
    if (isCommander) return true;
    return Boolean(profile?.unlocked_themes?.includes(themeId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm font-sans overflow-y-auto">
      <div className="relative my-auto w-full max-w-2xl rounded-xl border border-amber-400/40 bg-stone-900 p-5 sm:p-6 text-amber-50 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white"
          title="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-amber-400">
          <Crown className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-widest">
            Boutique • 100 % Sans Pay-to-Win
          </span>
        </div>

        <h2 className="mt-1 font-serif text-2xl font-bold text-amber-100">
          Pack Commandant & Thèmes de Carte
        </h2>
        <p className="mt-1 text-xs text-stone-400">
          Aucun avantage en combat : uniquement des options visuelles et de confort pour soutenir le jeu.
        </p>

        {/* Encart Pack Commandant */}
        <div className="mt-4 rounded-xl border border-amber-400/50 bg-gradient-to-br from-amber-950/60 via-stone-900 to-stone-950 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h3 className="font-serif text-lg font-bold text-amber-200">
                  Pack Commandant
                </h3>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                  Achat unique
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-stone-300">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Débloque les 2 thèmes de carte exclusifs (Nocturne & Tactique)
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Badge doré 👑 Commandant affiché dans le lobby et en ligne
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Accès prioritaire aux futures cartes & scénarios
                </li>
              </ul>
            </div>

            <div className="flex flex-col items-stretch sm:items-end gap-1.5 shrink-0">
              {isCommander ? (
                <span className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-950/70 px-4 py-2.5 text-xs font-bold text-emerald-300">
                  <Check className="h-4 w-4" />
                  Pack déjà actif
                </span>
              ) : !profile ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                  className="rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-bold text-stone-950 hover:bg-amber-500"
                >
                  Se connecter pour débloquer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onBuyCommander}
                  className="rounded-lg bg-amber-500 px-5 py-2.5 font-serif text-sm font-bold text-stone-950 shadow-lg transition hover:bg-amber-400"
                >
                  Débloquer — 4,99 €
                </button>
              )}
              <span className="text-center sm:text-right text-[10px] text-stone-400">
                Paiement sécurisé par Stripe • Sans abonnement
              </span>
            </div>
          </div>
        </div>

        {/* Sélecteur de thèmes */}
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-300">
            <Palette className="h-3.5 w-3.5 text-amber-400" />
            Thèmes de carte
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {MAP_THEME_LIST.map((theme) => {
              const unlocked = isThemeUnlocked(theme.id, theme.premium);
              const selected = activeTheme === theme.id;

              return (
                <button
                  key={theme.id}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => onSelectTheme(theme.id)}
                  className={`flex flex-col rounded-lg border p-3 text-left transition ${
                    selected
                      ? 'border-amber-400 bg-stone-800 ring-1 ring-amber-400/60'
                      : unlocked
                      ? 'border-stone-700 bg-stone-950/80 hover:border-stone-500'
                      : 'cursor-not-allowed border-stone-800 bg-stone-950/50 opacity-75'
                  }`}
                >
                  <div
                    className={`mb-2.5 flex h-12 w-full items-center justify-center rounded border border-white/10 bg-gradient-to-br ${theme.previewGradient}`}
                  >
                    {!unlocked ? (
                      <Lock className="h-4 w-4 text-amber-300/80" />
                    ) : selected ? (
                      <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-stone-950">
                        ACTIF
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <span className="font-serif text-sm font-bold text-amber-100">
                      {theme.name}
                    </span>
                    {theme.premium && (
                      <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-stone-400">
                    {theme.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}