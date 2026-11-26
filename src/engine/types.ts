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

export type AiDifficulty = 'standard' | 'hard' | 'hardcore';

export interface MatchSettings {
  mode: GameMode;
  fogOfWar: boolean;
  aiDifficulty: AiDifficulty;
}

export type GamePhase = 'LOBBY' | 'MOBILIZATION' | 'WAR' | 'ENDED';

export type TerrainType = 'plains' | 'mountain' | 'urban' | 'coastal';

export type UnitType =
  | 'scout'
  | 'soldier'
  | 'light_tank'
  | 'heavy_tank'
  | 'fighter'
  | 'bomber'
  | 'submarine'
  | 'frigate';

export type DefenseType = 'trenches' | 'aa_defense' | 'bunkers' | 'naval_defense';

export type ExtractionResource = 'gas' | 'steel' | 'gold';

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

export type DiplomaticStatus = 'war' | 'neutral' | 'nap' | 'alliance';

export type AiPersonality = 'expansionist' | 'fortress' | 'opportunist' | 'diplomat';

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
  expiresAt: number;
}

export type ConstructionKind = 'barracks' | 'laboratory' | 'extraction' | 'defense';

export interface ConstructionOrder {
  id: string;
  owner: NationId;
  provinceId: string;
  kind: ConstructionKind;
  targetKey: string;
  targetLevel: number;
  resource?: ExtractionResource;
  defense?: DefenseType;
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

export interface Province {
  id: string;
  name: string;
  owner: NationId;
  isCapital: boolean;
  victoryPoints: number;
  terrain: TerrainType;
  center: [number, number];
  polygon: [number, number][];
  neighbors: string[];
  seaNeighbors: string[];
  baseIncome: ResourcePool;
  barracksLevel: number;
  hasLaboratory: boolean;
  laboratoryLevel: number;
  extractionFactories: Record<ExtractionResource, number>;
  defenses: Record<DefenseType, number>;
  activeWeaknesses: DefenseWeakness[];
  garrison: UnitStack;
}

export interface MovingArmy {
  id: string;
  owner: NationId;
  originProvinceId: string;
  fromProvinceId: string;
  toProvinceId: string;
  targetProvinceId: string;
  route: string[];
  currentLegIndex: number;
  units: UnitStack;
  startedAt: number;
  legStartedAt: number;
  legArrivalAt: number;
  startPos?: [number, number];
  isNaval: boolean;
  isAir: boolean;
  isSubmarineMission: boolean;
  landingStartedAt?: number;
  landingEndsAt?: number;
  landingCompleted?: boolean;
  detectedBy?: NationId[];
  isReturning?: boolean;
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

export interface Nation {
  id: NationId;
  name: string;
  shortName: string;
  color: string;
  borderColor: string;
  lore?: string;
  isPlayer: boolean;
  personality: AiPersonality;
  resources: ResourcePool;
  techPoints: number;
  techLevels: Record<TechAxis, number>;
  activeAllianceWith: PlayableNationId | null;
  lastAttackAt?: number;
  isEliminated: boolean;
  capitalProvinceId?: string;
}

export interface DiplomaticOffer {
  id: string;
  from: PlayableNationId;
  to: PlayableNationId;
  type: 'nap' | 'alliance' | 'peace';
  goldEscrow?: number;
  aiDecisionAt?: number;
  createdAt: number;
  expiresAt: number;
}

export interface TelegramMessage {
  id: string;
  time: number;
  text: string;
  level: 'info' | 'warning' | 'danger' | 'diplomacy';
  provinceId?: string;
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