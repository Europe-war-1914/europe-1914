import type {
  BuildingType,
  DiplomaticStatus,
  PlayableNationId,
  UnitStack,
  UnitType,
} from '../engine/types';

export interface RoomPlayer {
  socketId: string;
  name: string;
  nationId: PlayableNationId;
  isHost: boolean;
}

export interface RoomSummary {
  code: string;
  status: 'LOBBY' | 'PLAYING';
  hostSocketId: string;
  players: RoomPlayer[];
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
  | { type: 'build'; provinceId: string; building: BuildingType }
  | { type: 'recruit'; provinceId: string; unit: UnitType }
  | { type: 'move'; fromId: string; toId: string; units: UnitStack }
  | { type: 'bombard'; fromId: string; targetId: string }
  | { type: 'retreat'; battleId: string }
  | { type: 'diplomacy'; target: PlayableNationId; status: DiplomaticStatus }
  | { type: 'respondOffer'; offerId: string; accept: boolean };

export interface ActionResponse {
  ok: boolean;
  reason?: string;
}