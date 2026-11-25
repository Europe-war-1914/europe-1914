export type NationId =
  | 'france'
  | 'germany'
  | 'uk'
  | 'italy'
  | 'austria'
  | 'russia'
  | 'spain'
  | 'ottoman'
  | 'neutral';

export type PlayableNationId = Exclude<NationId, 'neutral'>;

export type GameMode = 'blitz' | 'campaign';
export type AiDifficulty = 'standard' | 'hard';
export type GamePhase = 'LOBBY' | 'MOBILIZATION' | 'WAR' | 'ENDED';

export type TerrainType = 'plains' | 'mountain' | 'urban' | 'coastal';

export type ResourceType = 'gold' | 'steel' | 'gas' | 'techPoints';
export type ExtractionResource = 'gas' | 'steel' | 'gold';

export type UnitType =
  | 'light_tank'
  | 'heavy_tank'
  | 'scout'
  | 'soldier'
  | 'bomber'
  | 'fighter'
  | 'submarine'
  | 'frigate';

export type DefenseType = 'trenches' | 'aa_defense' | 'bunkers' | 'naval_defense';

// Traité de non-agression (PNA) supprimé
export type DiplomaticStatus = 'war' | 'neutral' | 'alliance';

export type AiPersonality = 'expansionist' | 'fortress' | 'opportunist' | 'diplomat';

export type TechBranch = 'defense' | 'army' | 'resources';

export type TechAxis =
  | 'trenches'
  | 'aa_defense'
  | 'bunkers'
  | 'naval_defense'
  | 'tanks'
  | 'aviation'
  | 'infantry'
  | 'naval'
  | 'gas_extraction'
  | 'steel_extraction'
  | 'gold_extraction'
  | 'worker_speed';

export interface ResourcePool {
  gold: number;
  steel: number;
  gas: number;
}

export interface UnitStack {
  light_tank: number;
  heavy_tank: number;
  scout: number;
  soldier: number;
  bomber: number;
  fighter: number;
  submarine: number;
  frigate: number;
}

export interface DefenseWeakness {
  defense: DefenseType;
  expiresAt: number; // +120 s (2 minutes)
}

export interface Province {
  id: string;
  name: string;
  owner: NationId;
  isCapital: boolean;
  terrain: TerrainType;
  victoryPoints: number;
  center: [number, number];
  polygon: [number, number][];
  neighbors: string[];
  seaNeighbors: string[];
  baseIncome: ResourcePool;
  hasLaboratory: boolean; // Max 1 par nation dans la capitale, détruit si conquise
  laboratoryLevel: number; // 0 à 3
  barracksLevel: number; // 1 à 3 (vitesse de formation de toutes les unités)
  extractionFactories: Record<ExtractionResource, number>; // 0 à 3 (gaz, acier, or)
  defenses: Record<DefenseType, number>; // 0 à 3
  activeWeaknesses: DefenseWeakness[];
  garrison: UnitStack;
}

export interface MovingArmy {
  id: string;
  owner: NationId;
  originProvinceId: string; // Province d'origine pour le demi-tour
  fromProvinceId: string; // Début du tronçon actuel
  toProvinceId: string; // Fin du tronçon actuel
  targetProvinceId: string; // Destination finale
  route: string[]; // Chemin complet calculé (terre possédée ou mer)
  currentLegIndex: number;
  units: UnitStack;
  startedAt: number;
  legStartedAt: number;
  legArrivalAt: number;
  isNaval: boolean; // Tronçon actuel en mer
  isAir: boolean; // Escadrille aérienne
  isSubmarineMission: boolean; // Débarquement furtif par sous-marin
  landingStartedAt?: number; // Début du débarquement 10 s
  landingEndsAt?: number; // Fin du débarquement 10 s
  detectedBy?: NationId[]; // Nations qui voient ce sous-marin
  isReturning: boolean;
}

export interface ActiveBattle {
  id: string;
  provinceId: string;
  attacker: NationId;
  defender: NationId;
  attackerUnits: UnitStack;
  defenderUnits: UnitStack;
  startedAt: number;
  lastTickAt: number;
  isAirStrike?: boolean;
  isNavalStrike?: boolean;
}

export interface ConstructionOrder {
  id: string;
  owner: NationId;
  provinceId: string;
  kind: 'laboratory' | 'barracks' | 'extraction' | 'defense';
  targetKey: string;
  targetLevel: number;
  startedAt: number;
  endsAt: number;
}

export interface RecruitmentOrder {
  id: string;
  owner: NationId;
  provinceId: string;
  unit: UnitType;
  count: number;
  startedAt: number;
  endsAt: number;
}

export interface Nation {
  id: NationId;
  name: string;
  shortName: string;
  color: string;
  borderColor: string;
  isPlayer: boolean;
  personality: AiPersonality;
  capitalProvinceId?: string;
  resources: ResourcePool;
  techPoints: number;
  techLevels: Record<TechAxis, number>; // 0 à 3
  activeAllianceWith: PlayableNationId | null; // Max 1 alliance active
  isEliminated: boolean;
  lastAttackAt?: number; // Temporisation anti-attaque compulsive de l'IA
}

export interface DiplomaticOffer {
  id: string;
  from: PlayableNationId;
  to: PlayableNationId;
  type: 'alliance' | 'peace';
  goldEscrow?: number; // Or bloqué pour une offre d'alliance (remboursé si refus)
  createdAt: number;
  expiresAt: number;
  aiDecisionAt?: number; // Délai de réflexion de l'IA avant réponse
}

export interface TelegramMessage {
  id: string;
  time: number;
  text: string;
  level: 'info' | 'warning' | 'danger' | 'diplomacy';
  provinceId?: string;
}

export interface MatchSettings {
  mode: GameMode;
  fogOfWar: boolean;
  aiDifficulty: AiDifficulty;
}

export interface GameState {
  mode: GameMode;
  fogOfWar: boolean;
  aiDifficulty: AiDifficulty;
  phase: GamePhase;
  elapsedSeconds: number;
  lastAiTickAt: number;
  lastNeutralGrowthAt: number;
  playerNationId: PlayableNationId;
  nations: Record<NationId, Nation>;
  provinces: Record<string, Province>;
  movingArmies: MovingArmy[];
  battles: ActiveBattle[];
  constructions: ConstructionOrder[];
  recruitments: RecruitmentOrder[];
  diplomacy: Record<string, DiplomaticStatus>;
  pendingOffers: DiplomaticOffer[];
  telegrams: TelegramMessage[];
  tutorialStep: number;
  eliminationOrder: PlayableNationId[];
  winnerId: PlayableNationId | null;
}