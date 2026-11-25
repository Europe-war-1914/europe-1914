import type {
  DefenseType,
  DiplomaticStatus,
  ExtractionResource,
  MatchSettings,
  PlayableNationId,
  TechAxis,
  UnitStack,
  UnitType,
} from '../engine/types';

export interface ActionResponse {
  ok: boolean;
  reason?: string;
}

export interface RoomPlayer {
  socketId: string;
  name: string;
  nationId: PlayableNationId;
  isHost: boolean;
  userId?: string;
}

export interface RoomSummary {
  code: string;
  status: 'LOBBY' | 'PLAYING';
  hostSocketId: string;
  players: RoomPlayer[];
  isPublic?: boolean;
  autoStartAt?: number | null;
  settings?: MatchSettings;
}

export interface ChatMessage {
  id: string;
  channel: 'global' | 'private';
  fromSocketId: string;
  fromNationId: PlayableNationId;
  fromName: string;
  toNationId?: PlayableNationId;
  toName?: string;
  text: string;
  time: number;
}

export type ClientAction =
  | { type: 'unlockTech'; axis: TechAxis }
  | { type: 'upgradeBarracks'; provinceId: string }
  | { type: 'upgradeLaboratory'; provinceId: string }
  | { type: 'upgradeExtraction'; provinceId: string; resource: ExtractionResource }
  | { type: 'upgradeDefense'; provinceId: string; defense: DefenseType }
  | { type: 'recruit'; provinceId: string; unit: UnitType; count: number }
  | { type: 'move'; fromId: string; targetId: string; units: UnitStack }
  | { type: 'turnAround'; armyId: string }
  | { type: 'retreat'; battleId: string }
  | { type: 'diplomacy'; target: PlayableNationId; status: DiplomaticStatus }
  | { type: 'respondOffer'; offerId: string; accept: boolean };