export type MapThemeId = 'vintage' | 'night' | 'tactical';

export interface MapThemeConfig {
  id: MapThemeId;
  name: string;
  description: string;
  premium: boolean;
  /** Classe de fond autour du canvas */
  bgClass: string;
  /** Filtre CSS appliqué sur le canvas de carte */
  canvasFilter: string;
  /** Couleur d'aperçu dans la boutique */
  previewGradient: string;
}

export const MAP_THEMES: Record<MapThemeId, MapThemeConfig> = {
  vintage: {
    id: 'vintage',
    name: 'Parchemin 1914',
    description: 'Style cartographique historique d’origine.',
    premium: false,
    bgClass: 'bg-stone-950',
    canvasFilter: 'none',
    previewGradient: 'from-amber-900/80 via-stone-800 to-stone-950',
  },
  night: {
    id: 'night',
    name: 'État-Major Nocturne',
    description: 'Mode nuit sombre inspiré des salles d’opérations radar.',
    premium: true,
    bgClass: 'bg-slate-950',
    canvasFilter: 'invert(0.88) hue-rotate(185deg) saturate(1.15) contrast(1.08)',
    previewGradient: 'from-slate-900 via-cyan-950 to-slate-950',
  },
  tactical: {
    id: 'tactical',
    name: 'Carte Tactique Moderne',
    description: 'Contraste net et teintes froides pour une lecture ultra-rapide.',
    premium: true,
    bgClass: 'bg-zinc-950',
    canvasFilter: 'contrast(1.18) saturate(0.65) brightness(0.94)',
    previewGradient: 'from-zinc-700 via-zinc-900 to-black',
  },
};

export const MAP_THEME_LIST: MapThemeConfig[] = [
  MAP_THEMES.vintage,
  MAP_THEMES.night,
  MAP_THEMES.tactical,
];