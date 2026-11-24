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

export type GamePhase = 'LOBBY' | 'MOBILIZATION' | 'WAR' | 'ENDED';

export type TerrainType = 'plains' | 'mountain' | 'urban' | 'coastal';

export type UnitType = 'infantry' | 'tank' | 'artillery' | 'battleship';

export type BuildingType = 'factory' | 'fort' | 'railway';

export type DiplomaticStatus = 'war' | 'neutral' | 'nap' | 'alliance';

export type AiPersonality = 'expansionist' | 'fortress' | 'opportunist' | 'diplomat';

export interface ResourcePool {
  gold: number;
  steel: number;
  oil: number;
}

export interface UnitStack {
  infantry: number;
  tank: number;
  artillery: number;
  battleship: number;
}

export interface ConstructionOrder {
  id: string;
  owner: NationId;
  provinceId: string;
  building: BuildingType;
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
  morale: number;
  buildings: Record<BuildingType, number>;
  garrison: UnitStack;
}

export interface MovingArmy {
  id: string;
  owner: NationId;
  fromProvinceId: string;
  toProvinceId: string;
  units: UnitStack;
  startedAt: number;
  arrivalAt: number;
  isNaval: boolean;
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
  isBombardment: boolean;
}

export interface Nation {
  id: NationId;
  name: string;
  shortName: string;
  color: string;
  borderColor: string;
  isPlayer: boolean;
  personality: AiPersonality;
  resources: ResourcePool;
  isEliminated: boolean;
}

export interface DiplomaticOffer {
  id: string;
  from: PlayableNationId;
  to: PlayableNationId;
  type: 'nap' | 'alliance' | 'peace';
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
  mode: 'blitz';
  phase: GamePhase;
  elapsedSeconds: number;
  maxDurationSeconds: number;
  mobilizationDurationSeconds: number;
  lastAiTickAt: number;
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
  tutorialStep: number; // 1 à 4 (0 = terminé/masqué)
  winnerId: PlayableNationId | null;
}