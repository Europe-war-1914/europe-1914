import type { AiPersonality, Nation, NationId, PlayableNationId } from '../engine/types';
import { createInitialTechLevels, GAME_CONFIG } from './balance';

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
    color: '#36587a', // Bleu horizon militaire
    borderColor: '#1a2f45',
    defaultPersonality: 'fortress',
    lore: 'Défense solide et industrie équilibrée face à l’Empire allemand.',
  },
  germany: {
    id: 'germany',
    name: 'Empire Allemand',
    shortName: 'Allemagne',
    color: '#575e66', // Feldgrau acier
    borderColor: '#292e33',
    defaultPersonality: 'expansionist',
    lore: 'Puissance d’acier au centre de l’Europe, exposée sur deux fronts.',
  },
  uk: {
    id: 'uk',
    name: 'Royaume-Uni',
    shortName: 'Royaume-Uni',
    color: '#8f3b3b', // Rouge brique impérial
    borderColor: '#4f1b1b',
    defaultPersonality: 'diplomat',
    lore: 'Protégé par la mer, redoutable avec ses frégates et sous-marins.',
  },
  italy: {
    id: 'italy',
    name: 'Royaume d’Italie',
    shortName: 'Italie',
    color: '#466b4c', // Vert olive alpin
    borderColor: '#223826',
    defaultPersonality: 'opportunist',
    lore: 'Carrefour méditerranéen adossé aux reliefs alpins.',
  },
  austria: {
    id: 'austria',
    name: 'Autriche-Hongrie',
    shortName: 'Autriche-Hongrie',
    color: '#9c7c38', // Ocre impérial patiné
    borderColor: '#544016',
    defaultPersonality: 'fortress',
    lore: 'Vaste empire danubien au cœur des Balkans et de l’Europe centrale.',
  },
  russia: {
    id: 'russia',
    name: 'Empire Russe',
    shortName: 'Russie',
    color: '#2c594c', // Vert sapin militaire
    borderColor: '#153028',
    defaultPersonality: 'fortress',
    lore: 'Immense profondeur territoriale et réserves d’infanterie considérables.',
  },
  spain: {
    id: 'spain',
    name: 'Royaume d’Espagne',
    shortName: 'Espagne',
    color: '#9c6230', // Terre de Sienne
    borderColor: '#543214',
    defaultPersonality: 'diplomat',
    lore: 'Abritée derrière les Pyrénées pour développer recherche et industrie.',
  },
  ottoman: {
    id: 'ottoman',
    name: 'Empire Ottoman',
    shortName: 'Ottomans',
    color: '#783c4c', // Bordeaux patiné
    borderColor: '#401c26',
    defaultPersonality: 'opportunist',
    lore: 'Contrôle les détroits et les réserves énergétiques orientales.',
  },
  neutral: {
    id: 'neutral',
    name: 'Puissances Neutres',
    shortName: 'Neutre',
    color: '#8f8672', // Parchemin militaire neutre
    borderColor: '#524c3e',
    defaultPersonality: 'fortress',
    lore: 'États tampons qui renforcent leurs garnisons et défenses au fil de la guerre.',
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
  const result = {} as Record<NationId, Nation>;

  (Object.keys(NATION_TEMPLATES) as NationId[]).forEach((id) => {
    const tpl = NATION_TEMPLATES[id];
    const isPlayer = id === playerNationId;
    result[id] = {
      id,
      name: tpl.name,
      shortName: tpl.shortName,
      color: tpl.color,
      borderColor: tpl.borderColor,
      isPlayer,
      personality: isPlayer ? 'diplomat' : tpl.defaultPersonality,
      resources:
        id === 'neutral'
          ? { gold: 200, steel: 100, gas: 50 }
          : { ...GAME_CONFIG.startingResources },
      techPoints: id === 'neutral' ? 0 : GAME_CONFIG.startingTechPoints,
      techLevels: createInitialTechLevels(),
      activeAllianceWith: null,
      isEliminated: false,
      lastAttackAt: 0,
    };
  });

  return result;
}