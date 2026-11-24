import type { AiPersonality, Nation, NationId, PlayableNationId } from '../engine/types';
import { BLITZ_CONFIG } from './balance';

export interface NationTemplate {
  id: NationId;
  name: string;
  shortName: string;
  color: string;
  borderColor: string;
  defaultPersonality: AiPersonality;
  lore: string;
}

export const NATION_TEMPLATES: Record<NationId, NationTemplate> = {
  france: {
    id: 'france',
    name: 'République Française',
    shortName: 'France',
    color: '#3b6ea5',
    borderColor: '#1e3a5f',
    defaultPersonality: 'fortress',
    lore: 'Économie solide et frontière fortifiée face à l’Empire allemand.',
  },
  germany: {
    id: 'germany',
    name: 'Empire Allemand',
    shortName: 'Allemagne',
    color: '#6b7280',
    borderColor: '#374151',
    defaultPersonality: 'expansionist',
    lore: 'Industrie d’acier puissante au cœur de l’Europe, mais encerclée sur deux fronts.',
  },
  uk: {
    id: 'uk',
    name: 'Royaume-Uni',
    shortName: 'Royaume-Uni',
    color: '#b94a48',
    borderColor: '#7f1d1d',
    defaultPersonality: 'diplomat',
    lore: 'Protégé par la Manche, idéal pour dominer les mers et frapper sur les côtes.',
  },
  italy: {
    id: 'italy',
    name: 'Royaume d’Italie',
    shortName: 'Italie',
    color: '#4f8a5b',
    borderColor: '#254e2e',
    defaultPersonality: 'opportunist',
    lore: 'Position clé en Méditerranée et montagnes alpines faciles à défendre.',
  },
  austria: {
    id: 'austria',
    name: 'Autriche-Hongrie',
    shortName: 'Autriche-Hongrie',
    color: '#c29b40',
    borderColor: '#785a18',
    defaultPersonality: 'fortress',
    lore: 'Vaste empire danubien riche en acier, exposé à l’Est comme aux Balkans.',
  },
  russia: {
    id: 'russia',
    name: 'Empire Russe',
    shortName: 'Russie',
    color: '#2e6f5e',
    borderColor: '#164237',
    defaultPersonality: 'expansionist',
    lore: 'Immense profondeur stratégique et réserves humaines considérables.',
  },
  spain: {
    id: 'spain',
    name: 'Royaume d’Espagne',
    shortName: 'Espagne',
    color: '#c87d32',
    borderColor: '#7c4714',
    defaultPersonality: 'diplomat',
    lore: 'Abritée derrière les Pyrénées, parfaite pour bâtir son industrie tranquillement.',
  },
  ottoman: {
    id: 'ottoman',
    name: 'Empire Ottoman',
    shortName: 'Ottomans',
    color: '#9a4f63',
    borderColor: '#5c2635',
    defaultPersonality: 'opportunist',
    lore: 'Contrôle le Bosphore et l’accès au pétrole de la mer Noire.',
  },
  neutral: {
    id: 'neutral',
    name: 'Nations Neutres',
    shortName: 'Neutre',
    color: '#bfb39b',
    borderColor: '#7d725e',
    defaultPersonality: 'fortress',
    lore: 'États tampons stratégiques (Belgique, Suisse, Pays-Bas, Balkans, Scandinavie).',
  },
};

export const PLAYABLE_NATIONS: PlayableNationId[] = [
  'france',
  'germany',
  'uk',
  'italy',
  'austria',
  'russia',
  'spain',
  'ottoman',
];

export function createInitialNations(playerNationId: PlayableNationId): Record<NationId, Nation> {
  const personalities: AiPersonality[] = ['expansionist', 'fortress', 'opportunist', 'diplomat'];
  const result = {} as Record<NationId, Nation>;

  (Object.keys(NATION_TEMPLATES) as NationId[]).forEach((id, idx) => {
    const tpl = NATION_TEMPLATES[id];
    const isPlayer = id === playerNationId;
    result[id] = {
      id,
      name: tpl.name,
      shortName: tpl.shortName,
      color: tpl.color,
      borderColor: tpl.borderColor,
      isPlayer,
      personality: isPlayer
        ? 'diplomat'
        : id === 'neutral'
        ? 'fortress'
        : personalities[(idx + Math.floor(Math.random() * 2)) % personalities.length],
      resources:
        id === 'neutral'
          ? { gold: 100, steel: 50, oil: 0 }
          : { ...BLITZ_CONFIG.startingResources },
      isEliminated: false,
    };
  });

  return result;
}