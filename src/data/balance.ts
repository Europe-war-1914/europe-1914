import type { BuildingType, ResourcePool, TerrainType, UnitType } from '../engine/types';

export const BLITZ_CONFIG = {
  maxDurationSeconds: 1800,           // 30 minutes max
  mobilizationDurationSeconds: 150,   // 2 min 30 de trêve initiale sans attaque IA
  victoryShareThreshold: 0.4,         // 40 % des points de victoire pour gagner
  combatTickSeconds: 3,               // Un échange de tirs toutes les 3 s
  startingResources: {
    gold: 900,
    steel: 420,
    oil: 220,
  } as ResourcePool,
  startingGarrisonCapital: 10,        // Permet de diviser ses forces dès le départ
  startingGarrisonProvince: 4,
  startingGarrisonNeutral: 5,
};

export interface UnitSpec {
  id: UnitType;
  label: string;
  description: string;
  cost: ResourcePool;
  trainSeconds: number;
  attack: number;
  defense: number;
  hp: number;
  travelSeconds: number;              // Temps de base entre 2 provinces voisines
  requiresFactoryLevel: number;
  requiresCoastal?: boolean;
  usesOil: boolean;
}

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: {
    id: 'infantry',
    label: 'Infanterie',
    description: 'Polyvalente et économique. Indispensable pour capturer et tenir le front.',
    cost: { gold: 45, steel: 10, oil: 0 },
    trainSeconds: 10,
    attack: 6,
    defense: 8,
    hp: 45,
    travelSeconds: 50,
    requiresFactoryLevel: 0,
    usesOil: false,
  },
  tank: {
    id: 'tank',
    label: 'Char d’assaut',
    description: 'Rapide et puissant en plaine. Consomme du pétrole pour garder sa vitesse.',
    cost: { gold: 150, steel: 85, oil: 40 },
    trainSeconds: 26,
    attack: 22,
    defense: 15,
    hp: 90,
    travelSeconds: 34,
    requiresFactoryLevel: 1,
    usesOil: true,
  },
  artillery: {
    id: 'artillery',
    label: 'Artillerie lourde',
    description: 'Pilonne une province voisine et détruit les forts. Fragile au corps-à-corps.',
    cost: { gold: 130, steel: 75, oil: 20 },
    trainSeconds: 24,
    attack: 20,
    defense: 5,
    hp: 45,
    travelSeconds: 64,
    requiresFactoryLevel: 1,
    usesOil: false,
  },
  battleship: {
    id: 'battleship',
    label: 'Cuirassé',
    description: 'Domine les liaisons maritimes et appuie les débarquements côtiers.',
    cost: { gold: 210, steel: 120, oil: 55 },
    trainSeconds: 36,
    attack: 28,
    defense: 22,
    hp: 130,
    travelSeconds: 44,
    requiresFactoryLevel: 1,
    requiresCoastal: true,
    usesOil: true,
  },
};

export interface BuildingSpec {
  id: BuildingType;
  label: string;
  description: string;
  maxLevel: number;
  baseCost: ResourcePool;
  buildSeconds: number;
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  factory: {
    id: 'factory',
    label: 'Usine d’armement',
    description:
      'Débloque Chars, Artillerie et Cuirassés, accélère le recrutement (-22 % / niv.) et dope l’Acier (+25 % / niv.) et l’Or (+15 % / niv.).',
    maxLevel: 3,
    baseCost: { gold: 180, steel: 100, oil: 20 },
    buildSeconds: 35,
  },
  fort: {
    id: 'fort',
    label: 'Fortification',
    description:
      'Tranchées et casemates : +35 % de défense et -15 % de pertes subies par niveau dans la province.',
    maxLevel: 3,
    baseCost: { gold: 130, steel: 90, oil: 0 },
    buildSeconds: 28,
  },
  railway: {
    id: 'railway',
    label: 'Voies ferrées / Port',
    description:
      'Accélère fortement les mouvements (+30 % départ, +15 % arrivée / niv.), dope la production (+20 % / niv.) et restaure le moral.',
    maxLevel: 3,
    baseCost: { gold: 150, steel: 75, oil: 30 },
    buildSeconds: 30,
  },
};

export const TERRAIN_MODIFIERS: Record<
  TerrainType,
  { label: string; defenseBonus: number; tankAttackMult: number }
> = {
  plains: { label: 'Plaine', defenseBonus: 1.0, tankAttackMult: 1.2 },
  mountain: { label: 'Montagne', defenseBonus: 1.35, tankAttackMult: 0.65 },
  urban: { label: 'Métropole', defenseBonus: 1.25, tankAttackMult: 0.8 },
  coastal: { label: 'Littoral', defenseBonus: 1.05, tankAttackMult: 1.0 },
};

export function getBuildingCost(building: BuildingType, currentLevel: number): ResourcePool {
  const base = BUILDING_SPECS[building].baseCost;
  const mult = 1 + currentLevel * 0.65;
  return {
    gold: Math.round(base.gold * mult),
    steel: Math.round(base.steel * mult),
    oil: Math.round(base.oil * mult),
  };
}