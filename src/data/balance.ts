import type {
  DefenseType,
  ExtractionResource,
  GameMode,
  ResourcePool,
  TechAxis,
  TechBranch,
  TerrainType,
  UnitStack,
  UnitType,
} from '../engine/types';

export interface GameModeSpec {
  id: GameMode;
  label: string;
  durationLabel: string;
  description: string;
}

export const GAME_MODES: Record<GameMode, GameModeSpec> = {
  blitz: {
    id: 'blitz',
    label: 'Guerre Totale',
    durationLabel: '20–60 min • Dernier survivant',
    description:
      'Aucune limite de temps fixe : la guerre continue jusqu’à la chute de toutes les capitales ennemies.',
  },
  campaign: {
    id: 'campaign',
    label: 'Grande Guerre',
    durationLabel: '30–60 min • Dernier survivant',
    description: 'Même victoire par élimination totale, avec rythme stratégique complet.',
  },
};

export const GAME_CONFIG = {
  combatTickSeconds: 3,
  defenseWeaknessDurationSeconds: 120,
  submarineLandingSeconds: 5,
  occupationDurationSeconds: 10,
  capitalCaptureTechBonus: 240,
  capitalCaptureTechStealRatio: 0.35,
  allianceCostGold: 250,
  betrayalCostGold: 350,
  aiDiplomacyMinThinkSeconds: 8,
  aiDiplomacyMaxThinkSeconds: 15,
  neutralGrowthIntervalSeconds: 95,
  startingResources: {
    gold: 950,
    steel: 450,
    gas: 260,
  } as ResourcePool,
  startingTechPoints: 80,
  startingGarrisonCapital: { soldier: 12, scout: 4 },
  startingGarrisonProvince: { soldier: 6, scout: 2 },
  startingGarrisonNeutral: { soldier: 8, scout: 2 },
};

export const LAB_TP_PER_MINUTE: Record<number, number> = {
  0: 0,
  1: 20,
  2: 37.5,
  3: 60,
};

export const DEFENSE_COUNTER_REDUCTION: Record<number, number> = {
  0: 0,
  1: 0.5,
  2: 0.75,
  3: 0.95,
};

export const DEFENSE_COUNTER_MAP: Record<DefenseType, UnitType[]> = {
  trenches: ['light_tank', 'heavy_tank'],
  aa_defense: ['bomber', 'fighter'],
  bunkers: ['scout', 'soldier'],
  naval_defense: ['submarine', 'frigate'],
};

export const UNIT_ORDER: UnitType[] = [
  'scout',
  'soldier',
  'light_tank',
  'heavy_tank',
  'fighter',
  'bomber',
  'submarine',
  'frigate',
];

export interface UnitSpec {
  id: UnitType;
  label: string;
  shortLabel: string;
  category: 'armor' | 'infantry' | 'aviation' | 'naval';
  armyTechAxis: 'tanks' | 'infantry' | 'aviation' | 'naval';
  counteredBy: DefenseType;
  description: string;
  cost: ResourcePool;
  trainSeconds: number;
  attack: number;
  defense: number;
  hp: number;
  travelSeconds: number;
  requiresCoastal?: boolean;
}

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  scout: {
    id: 'scout',
    label: 'Éclaireur',
    shortLabel: 'Écl.',
    category: 'infantry',
    armyTechAxis: 'infantry',
    counteredBy: 'bunkers',
    description:
      'Infanterie rapide idéale pour la reconnaissance et les prises éclairs. Faible face aux bunkers.',
    cost: { gold: 55, steel: 15, gas: 10 },
    trainSeconds: 10,
    attack: 8,
    defense: 6,
    hp: 38,
    travelSeconds: 24,
  },
  soldier: {
    id: 'soldier',
    label: 'Soldat',
    shortLabel: 'Sol.',
    category: 'infantry',
    armyTechAxis: 'infantry',
    counteredBy: 'bunkers',
    description: 'Infanterie de ligne polyvalente et solide en défense. Faible face aux bunkers.',
    cost: { gold: 75, steel: 25, gas: 0 },
    trainSeconds: 13,
    attack: 12,
    defense: 13,
    hp: 55,
    travelSeconds: 36,
  },
  light_tank: {
    id: 'light_tank',
    label: 'Blindé léger',
    shortLabel: 'Bl.Lég',
    category: 'armor',
    armyTechAxis: 'tanks',
    counteredBy: 'trenches',
    description: 'Char rapide de percée. Très inefficace face aux tranchées.',
    cost: { gold: 130, steel: 70, gas: 35 },
    trainSeconds: 18,
    attack: 17,
    defense: 12,
    hp: 68,
    travelSeconds: 28,
  },
  heavy_tank: {
    id: 'heavy_tank',
    label: 'Blindé lourd',
    shortLabel: 'Bl.Lrd',
    category: 'armor',
    armyTechAxis: 'tanks',
    counteredBy: 'trenches',
    description: 'Char lourd à forte puissance de feu et blindage épais. Bloqué par les tranchées.',
    cost: { gold: 220, steel: 130, gas: 55 },
    trainSeconds: 30,
    attack: 29,
    defense: 23,
    hp: 115,
    travelSeconds: 42,
  },
  fighter: {
    id: 'fighter',
    label: 'Chasseur',
    shortLabel: 'Chas.',
    category: 'aviation',
    armyTechAxis: 'aviation',
    counteredBy: 'aa_defense',
    description:
      'Spécialisé dans les combats aériens et l’interception des bombardiers. Contré par la DCA.',
    cost: { gold: 175, steel: 80, gas: 45 },
    trainSeconds: 22,
    attack: 20,
    defense: 16,
    hp: 55,
    travelSeconds: 16,
  },
  bomber: {
    id: 'bomber',
    label: 'Bombardier',
    shortLabel: 'Bomb.',
    category: 'aviation',
    armyTechAxis: 'aviation',
    counteredBy: 'aa_defense',
    description:
      'Détruit les usines ennemies et affaiblit les défenses (2 min), sauf les défenses anti-aériennes.',
    cost: { gold: 210, steel: 95, gas: 60 },
    trainSeconds: 28,
    attack: 24,
    defense: 7,
    hp: 60,
    travelSeconds: 20,
  },
  submarine: {
    id: 'submarine',
    label: 'Sous-marin',
    shortLabel: 'S-Mar.',
    category: 'naval',
    armyTechAxis: 'naval',
    counteredBy: 'naval_defense',
    description:
      'Portée côtière libre, invisible hors défenses marines ou frégates. Débarquement annoncé (5 s).',
    cost: { gold: 185, steel: 90, gas: 45 },
    trainSeconds: 25,
    attack: 21,
    defense: 11,
    hp: 65,
    travelSeconds: 26,
    requiresCoastal: true,
  },
  frigate: {
    id: 'frigate',
    label: 'Frégate',
    shortLabel: 'Frég.',
    category: 'naval',
    armyTechAxis: 'naval',
    counteredBy: 'naval_defense',
    description:
      'Détruit sous-marins et troupes terrestres en mer. Affaiblit les défenses côtières (2 min), sauf anti-marines.',
    cost: { gold: 235, steel: 135, gas: 50 },
    trainSeconds: 32,
    attack: 26,
    defense: 21,
    hp: 110,
    travelSeconds: 32,
    requiresCoastal: true,
  },
};

export const TECH_COSTS_TP: Record<1 | 2 | 3, number> = {
  1: 40,
  2: 80,
  3: 140,
};

export interface TechAxisSpec {
  id: TechAxis;
  branch: TechBranch;
  label: string;
  description: string;
}

export const TECH_AXES_SPECS: Record<TechAxis, TechAxisSpec> = {
  trenches: {
    id: 'trenches',
    branch: 'defense',
    label: 'Tranchées',
    description: 'Débloque les Tranchées niv. 1 à 3 (-50 % / -75 % / -100 %* contre les Tanks).',
  },
  aa_defense: {
    id: 'aa_defense',
    branch: 'defense',
    label: 'Défenses aériennes',
    description: 'Débloque la DCA niv. 1 à 3 (-50 % / -75 % / -100 %* contre les Avions).',
  },
  bunkers: {
    id: 'bunkers',
    branch: 'defense',
    label: 'Bunkers',
    description: 'Débloque les Bunkers niv. 1 à 3 (-50 % / -75 % / -100 %* contre l’Infanterie).',
  },
  naval_defense: {
    id: 'naval_defense',
    branch: 'defense',
    label: 'Défenses marines',
    description:
      'Débloque les Défenses marines niv. 1 à 3 (détectent sous-marins, contrent la Marine).',
  },
  tanks: {
    id: 'tanks',
    branch: 'army',
    label: 'Blindés (Tanks)',
    description:
      'Débloque (niv. 1) et renforce (+20 %/niv.) Blindés légers et lourds (inefficaces vs Tranchées).',
  },
  aviation: {
    id: 'aviation',
    branch: 'army',
    label: 'Aviation',
    description:
      'Débloque (niv. 1) et renforce (+20 %/niv.) Bombardiers et Chasseurs (inefficaces vs DCA).',
  },
  infantry: {
    id: 'infantry',
    branch: 'army',
    label: 'Infanterie',
    description:
      'Débloque (niv. 1) et renforce (+20 %/niv.) Éclaireurs et Soldats (faibles vs Bunkers).',
  },
  naval: {
    id: 'naval',
    branch: 'army',
    label: 'Armée navale',
    description:
      'Débloque (niv. 1) et renforce (+20 %/niv.) Sous-marins et Frégates (faibles vs Défenses marines).',
  },
  gas_extraction: {
    id: 'gas_extraction',
    branch: 'resources',
    label: 'Extraction de gaz',
    description: 'Débloque les Usines de Gaz niv. 1 à 3 et +15 % rendement global par niveau.',
  },
  steel_extraction: {
    id: 'steel_extraction',
    branch: 'resources',
    label: 'Extraction d’acier',
    description: 'Débloque les Usines d’Acier niv. 1 à 3 et +15 % rendement global par niveau.',
  },
  gold_extraction: {
    id: 'gold_extraction',
    branch: 'resources',
    label: 'Extraction d’or',
    description: 'Débloque les Usines d’Or niv. 1 à 3 et +15 % rendement global par niveau.',
  },
  worker_speed: {
    id: 'worker_speed',
    branch: 'resources',
    label: 'Vitesse des ouvriers',
    description: 'Accélère toutes les constructions et améliorations (-20 % / -35 % / -50 % de durée).',
  },
};

export const ALL_TECH_AXES: TechAxis[] = Object.keys(TECH_AXES_SPECS) as TechAxis[];

export const EXTRACTION_TECH_MAP: Record<ExtractionResource, TechAxis> = {
  gas: 'gas_extraction',
  steel: 'steel_extraction',
  gold: 'gold_extraction',
};

export const DEFENSE_LABELS: Record<DefenseType, string> = {
  trenches: 'Tranchées',
  aa_defense: 'Défenses aériennes',
  bunkers: 'Bunkers',
  naval_defense: 'Défenses marines',
};

export const EXTRACTION_LABELS: Record<ExtractionResource, string> = {
  gold: 'Usine d’Or',
  steel: 'Usine d’Acier',
  gas: 'Usine de Gaz',
};

export const TERRAIN_MODIFIERS: Record<
  TerrainType,
  { label: string; defenseBonus: number; tankAttackMult: number }
> = {
  plains: { label: 'Plaine', defenseBonus: 1.0, tankAttackMult: 1.15 },
  mountain: { label: 'Montagne', defenseBonus: 1.25, tankAttackMult: 0.75 },
  urban: { label: 'Métropole', defenseBonus: 1.2, tankAttackMult: 0.85 },
  coastal: { label: 'Littoral', defenseBonus: 1.05, tankAttackMult: 1.0 },
};

export function createEmptyStack(): UnitStack {
  return {
    light_tank: 0,
    heavy_tank: 0,
    scout: 0,
    soldier: 0,
    bomber: 0,
    fighter: 0,
    submarine: 0,
    frigate: 0,
  };
}

export function createInitialTechLevels(): Record<TechAxis, number> {
  return {
    trenches: 0,
    aa_defense: 0,
    bunkers: 0,
    naval_defense: 0,
    tanks: 0,
    aviation: 0,
    infantry: 0,
    naval: 0,
    gas_extraction: 0,
    steel_extraction: 0,
    gold_extraction: 0,
    worker_speed: 0,
  };
}

export function getBarracksCost(currentLevel: number): { cost: ResourcePool; buildSeconds: number } {
  const mult = 1 + (currentLevel - 1) * 0.55;
  return {
    cost: {
      gold: Math.round(95 * mult),
      steel: Math.round(45 * mult),
      gas: 0,
    },
    buildSeconds: 18,
  };
}

export function getLaboratoryCost(currentLevel: number): {
  cost: ResourcePool;
  buildSeconds: number;
} {
  if (currentLevel <= 1) {
    return {
      cost: { gold: 950, steel: 500, gas: 300 },
      buildSeconds: 55,
    };
  }
  return {
    cost: { gold: 2200, steel: 1200, gas: 750 },
    buildSeconds: 85,
  };
}

export function getExtractionCost(
  resource: ExtractionResource,
  currentLevel: number
): { cost: ResourcePool; buildSeconds: number } {
  const mult = 1 + currentLevel * 0.65;
  const base: Record<ExtractionResource, ResourcePool> = {
    gold: { gold: 130, steel: 80, gas: 25 },
    steel: { gold: 145, steel: 65, gas: 30 },
    gas: { gold: 150, steel: 85, gas: 15 },
  };
  const b = base[resource];
  return {
    cost: {
      gold: Math.round(b.gold * mult),
      steel: Math.round(b.steel * mult),
      gas: Math.round(b.gas * mult),
    },
    buildSeconds: 26,
  };
}

export function getDefenseCost(
  defense: DefenseType,
  currentLevel: number
): { cost: ResourcePool; buildSeconds: number } {
  const mult = 1 + currentLevel * 0.7;
  const base: Record<DefenseType, ResourcePool> = {
    trenches: { gold: 120, steel: 75, gas: 10 },
    bunkers: { gold: 130, steel: 85, gas: 10 },
    aa_defense: { gold: 140, steel: 90, gas: 30 },
    naval_defense: { gold: 145, steel: 95, gas: 25 },
  };
  const b = base[defense];
  return {
    cost: {
      gold: Math.round(b.gold * mult),
      steel: Math.round(b.steel * mult),
      gas: Math.round(b.gas * mult),
    },
    buildSeconds: 24,
  };
}