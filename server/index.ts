import http from 'node:http';
import { Server } from 'socket.io';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from '../src/data/nations';
import {
  orderMoveArmy,
  orderRedirectArmy,
  orderTurnAround,
  retreatFromBattle,
} from '../src/engine/combat';
import { requestDiplomaticAction, respondToDiplomaticOffer } from '../src/engine/diplomacy';
import {
  createId,
  pushTelegram,
  startRecruitment,
  unlockTechnology,
  upgradeBarracks,
  upgradeDefense,
  upgradeExtractionFactory,
  upgradeLaboratory,
} from '../src/engine/economy';
import { createNewGame, stepGameState } from '../src/engine/gameLoop';
import type { GameState, MatchSettings, PlayableNationId } from '../src/engine/types';
import type {
  ActionResponse,
  ChatMessage,
  ClientAction,
  RoomPlayer,
  RoomSummary,
} from '../src/network/protocol';
import { syncEliminatedAndFinalElo, type EloResult } from './elo';
import { handleStripeRequest } from './stripe';

interface InternalPlayer extends RoomPlayer {
  clientToken?: string;
}

interface ServerRoom {
  code: string;
  status: 'LOBBY' | 'PLAYING';
  isPublic: boolean;
  autoStartAt: number | null;
  autoStartTimer: ReturnType<typeof setTimeout> | null;
  settings: MatchSettings;
  hostSocketId: string;
  players: Map<string, InternalPlayer>;
  participantsByNation: Map<PlayableNationId, { userId?: string; name: string; clientToken?: string }>;
  processedEloNations: Set<PlayableNationId>;
  eloResults: Record<string, EloResult>;
  messages: ChatMessage[];
  state: GameState | null;
  interval: ReturnType<typeof setInterval> | null;
}

const PORT = Number(process.env.PORT ?? 3001);
const TICK_MS = 250;
const MAX_CHAT_HISTORY = 100;
const PUBLIC_AUTOSTART_MS = 30_000;

const httpServer = http.createServer((req, res) => {
  void handleStripeRequest(req, res)
    .then((handled) => {
      if (handled) return;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('1914 : L’Europe en Flammes — Serveur Multijoueur actif');
    })
    .catch((err) => {
      console.error('[Stripe] Erreur inattendue :', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erreur interne du serveur.' }));
      }
    });
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const rooms = new Map<string, ServerRoom>();
const socketToRoom = new Map<string, string>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  const code = `1914-${suffix}`;
  return rooms.has(code) ? generateRoomCode() : code;
}

function findAvailableNation(
  room: ServerRoom,
  preferred?: PlayableNationId
): PlayableNationId | null {
  const taken = new Set(Array.from(room.players.values()).map((p) => p.nationId));
  if (preferred && !taken.has(preferred)) return preferred;
  return PLAYABLE_NATIONS.find((id) => !taken.has(id)) ?? null;
}

function toRoomSummary(room: ServerRoom): RoomSummary {
  return {
    code: room.code,
    status: room.status,
    hostSocketId: room.hostSocketId,
    isPublic: room.isPublic,
    autoStartAt: room.autoStartAt,
    settings: room.settings,
    players: Array.from(room.players.values()).map(({ clientToken: _tok, ...rest }) => rest),
  };
}

function broadcastRoom(room: ServerRoom): void {
  io.to(room.code).emit('room:update', toRoomSummary(room));
}

function buildPlayerState(state: GameState, nationId: PlayableNationId): GameState {
  return {
    ...state,
    playerNationId: nationId,
    tutorialStep: 0,
    pendingOffers: state.pendingOffers.filter((o) => o.to === nationId || o.from === nationId),
  };
}

function broadcastGameState(room: ServerRoom): void {
  if (!room.state) return;
  for (const player of room.players.values()) {
    io.to(player.socketId).emit('game:state', buildPlayerState(room.state, player.nationId));
  }
}

function cleanupRoomIfEmpty(room: ServerRoom): void {
  if (room.players.size > 0) return;
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
  if (room.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
  rooms.delete(room.code);
  console.log(`[Salon ${room.code}] Fermé (aucun joueur connecté).`);
}

function launchRoomGame(room: ServerRoom): void {
  if (room.status !== 'LOBBY') return;
  if (room.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
  room.autoStartAt = null;

  const firstPlayer = Array.from(room.players.values())[0];
  if (!firstPlayer) return;

  const fresh = createNewGame(firstPlayer.nationId, room.settings);
  fresh.tutorialStep = 0;

  room.participantsByNation.clear();
  room.processedEloNations.clear();
  room.eloResults = {};

  for (const id of PLAYABLE_NATIONS) {
    fresh.nations[id].isPlayer = false;
  }
  for (const p of room.players.values()) {
    fresh.nations[p.nationId].isPlayer = true;
    room.participantsByNation.set(p.nationId, {
      userId: p.userId,
      name: p.name,
      clientToken: p.clientToken,
    });
  }

  room.state = fresh;
  room.status = 'PLAYING';

  room.interval = setInterval(() => {
    if (!room.state) return;
    room.state = stepGameState(room.state, TICK_MS / 1000);

    void syncEliminatedAndFinalElo(
      room.state,
      room.participantsByNation,
      room.processedEloNations
    ).then((deltaMap) => {
      if (Object.keys(deltaMap).length > 0) {
        room.eloResults = { ...room.eloResults, ...deltaMap };
        io.to(room.code).emit('game:elo', room.eloResults);
      }
    });

    broadcastGameState(room);

    if (room.state.phase === 'ENDED' && room.interval) {
      clearInterval(room.interval);
      room.interval = null;
    }
  }, TICK_MS);

  broadcastRoom(room);
  broadcastGameState(room);
  console.log(`[Salon ${room.code}] Partie lancée (${room.players.size} humain(s)).`);
}

function removePlayerFromCurrentRoom(socketId: string): void {
  const code = socketToRoom.get(socketId);
  if (!code) return;
  socketToRoom.delete(socketId);

  const room = rooms.get(code);
  if (!room) return;

  const leaving = room.players.get(socketId);
  room.players.delete(socketId);

  if (leaving && room.status === 'PLAYING' && room.state) {
    room.state.nations[leaving.nationId].isPlayer = false;
    pushTelegram(
      room.state,
      `${leaving.name} (${NATION_TEMPLATES[leaving.nationId].shortName}) a quitté la partie : l’IA prend la relève.`,
      'warning'
    );
  }

  if (room.hostSocketId === socketId && room.players.size > 0) {
    const nextHost = Array.from(room.players.values())[0];
    room.hostSocketId = nextHost.socketId;
    nextHost.isHost = true;
  }

  cleanupRoomIfEmpty(room);
  if (rooms.has(code)) {
    broadcastRoom(room);
    if (room.status === 'PLAYING') {
      broadcastGameState(room);
    }
  }
}

io.on('connection', (socket) => {
  console.log(`[Socket] Connecté : ${socket.id}`);

  socket.on(
    'room:create',
    (
      payload: {
        playerName?: string;
        preferredNation?: PlayableNationId;
        clientToken?: string;
        userId?: string;
      },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      removePlayerFromCurrentRoom(socket.id);

      const code = generateRoomCode();
      const nationId = payload?.preferredNation ?? 'france';
      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';

      const room: ServerRoom = {
        code,
        status: 'LOBBY',
        isPublic: false,
        autoStartAt: null,
        autoStartTimer: null,
        settings: { mode: 'blitz', fogOfWar: true, aiDifficulty: 'standard' },
        hostSocketId: socket.id,
        players: new Map(),
        participantsByNation: new Map(),
        processedEloNations: new Set(),
        eloResults: {},
        messages: [],
        state: null,
        interval: null,
      };

      room.players.set(socket.id, {
        socketId: socket.id,
        name: cleanName,
        nationId,
        isHost: true,
        userId: payload?.userId,
        clientToken: payload?.clientToken,
      });

      rooms.set(code, room);
      socketToRoom.set(socket.id, code);
      void socket.join(code);

      const summary = toRoomSummary(room);
      broadcastRoom(room);
      socket.emit('chat:history', []);
      if (typeof ack === 'function') ack({ ok: true, room: summary });
    }
  );

  socket.on(
    'room:join',
    (
      payload: { code: string; playerName?: string; clientToken?: string; userId?: string },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      const code = (payload?.code ?? '').trim().toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Salon introuvable.' });
        return;
      }
      if (room.status !== 'LOBBY') {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Cette partie a déjà commencé.' });
        return;
      }

      const nationId = findAvailableNation(room);
      if (!nationId) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Le salon est complet (8/8).' });
        return;
      }

      removePlayerFromCurrentRoom(socket.id);

      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';
      room.players.set(socket.id, {
        socketId: socket.id,
        name: cleanName,
        nationId,
        isHost: false,
        userId: payload?.userId,
        clientToken: payload?.clientToken,
      });

      socketToRoom.set(socket.id, code);
      void socket.join(code);

      const summary = toRoomSummary(room);
      broadcastRoom(room);
      socket.emit(
        'chat:history',
        room.messages.filter((m) => m.channel === 'global')
      );
      if (typeof ack === 'function') ack({ ok: true, room: summary });
    }
  );

  socket.on(
    'room:quickplay',
    (
      payload: {
        playerName?: string;
        preferredNation?: PlayableNationId;
        clientToken?: string;
        userId?: string;
      },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      removePlayerFromCurrentRoom(socket.id);
      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';

      let targetRoom = Array.from(rooms.values()).find(
        (r) => r.isPublic && r.status === 'LOBBY' && r.players.size < PLAYABLE_NATIONS.length
      );

      if (!targetRoom) {
        const code = generateRoomCode();
        targetRoom = {
          code,
          status: 'LOBBY',
          isPublic: true,
          autoStartAt: null,
          autoStartTimer: null,
          settings: { mode: 'blitz', fogOfWar: true, aiDifficulty: 'standard' },
          hostSocketId: socket.id,
          players: new Map(),
          participantsByNation: new Map(),
          processedEloNations: new Set(),
          eloResults: {},
          messages: [],
          state: null,
          interval: null,
        };
        rooms.set(code, targetRoom);
      }

      const nationId = findAvailableNation(targetRoom, payload?.preferredNation);
      if (!nationId) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Aucune place libre.' });
        return;
      }

      const isFirst = targetRoom.players.size === 0;
      targetRoom.players.set(socket.id, {
        socketId: socket.id,
        name: cleanName,
        nationId,
        isHost: isFirst,
        userId: payload?.userId,
        clientToken: payload?.clientToken,
      });
      if (isFirst) targetRoom.hostSocketId = socket.id;

      socketToRoom.set(socket.id, targetRoom.code);
      void socket.join(targetRoom.code);

      if (targetRoom.players.size >= 2 && !targetRoom.autoStartTimer) {
        targetRoom.autoStartAt = Date.now() + PUBLIC_AUTOSTART_MS;
        const roomRef = targetRoom;
        targetRoom.autoStartTimer = setTimeout(() => launchRoomGame(roomRef), PUBLIC_AUTOSTART_MS);
      }

      const summary = toRoomSummary(targetRoom);
      broadcastRoom(targetRoom);
      socket.emit(
        'chat:history',
        targetRoom.messages.filter((m) => m.channel === 'global')
      );
      if (typeof ack === 'function') ack({ ok: true, room: summary });
    }
  );

  socket.on(
    'room:rejoin',
    (
      payload: { code: string; clientToken: string },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      const room = rooms.get((payload?.code ?? '').trim().toUpperCase());
      if (!room || !payload?.clientToken) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Session expirée.' });
        return;
      }

      let foundNation: PlayableNationId | null = null;
      let foundInfo: { userId?: string; name: string; clientToken?: string } | null = null;
      for (const [nId, info] of room.participantsByNation.entries()) {
        if (info.clientToken === payload.clientToken) {
          foundNation = nId;
          foundInfo = info;
          break;
        }
      }

      if (!foundNation || !foundInfo || !room.state) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Impossible de reprendre la partie.' });
        return;
      }

      room.players.set(socket.id, {
        socketId: socket.id,
        name: foundInfo.name,
        nationId: foundNation,
        isHost: room.players.size === 0,
        userId: foundInfo.userId,
        clientToken: payload.clientToken,
      });
      if (room.players.size === 1) room.hostSocketId = socket.id;
      room.state.nations[foundNation].isPlayer = true;

      socketToRoom.set(socket.id, room.code);
      void socket.join(room.code);

      const summary = toRoomSummary(room);
      broadcastRoom(room);
      socket.emit('game:state', buildPlayerState(room.state, foundNation));
      if (Object.keys(room.eloResults).length > 0) {
        socket.emit('game:elo', room.eloResults);
      }
      if (typeof ack === 'function') ack({ ok: true, room: summary });
    }
  );

  socket.on(
    'room:selectNation',
    (payload: { nationId: PlayableNationId }, ack?: (res: ActionResponse) => void) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.status !== 'LOBBY') return;

      const player = room.players.get(socket.id);
      if (!player) return;

      const takenByOther = Array.from(room.players.values()).some(
        (p) => p.socketId !== socket.id && p.nationId === payload.nationId
      );
      if (takenByOther) {
        if (typeof ack === 'function') {
          ack({ ok: false, reason: 'Cette puissance est déjà choisie.' });
        }
        return;
      }

      player.nationId = payload.nationId;
      broadcastRoom(room);
      if (typeof ack === 'function') ack({ ok: true });
    }
  );

  socket.on(
    'room:updateSettings',
    (payload: Partial<MatchSettings>, ack?: (res: ActionResponse) => void) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.status !== 'LOBBY' || room.hostSocketId !== socket.id) return;

      room.settings = { ...room.settings, ...payload };
      broadcastRoom(room);
      if (typeof ack === 'function') ack({ ok: true });
    }
  );

  socket.on('room:start', (ack?: (res: ActionResponse) => void) => {
    const reply = (res: ActionResponse) => {
      if (typeof ack === 'function') ack(res);
    };

    const code = socketToRoom.get(socket.id);
    if (!code) {
      reply({ ok: false, reason: 'Session introuvable.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.status !== 'LOBBY') {
      reply({ ok: false, reason: 'Le salon ne peut pas être lancé.' });
      return;
    }
    if (room.hostSocketId !== socket.id) {
      reply({ ok: false, reason: 'Seul l’hôte peut lancer la partie.' });
      return;
    }

    launchRoomGame(room);
    reply({ ok: true });
  });

  socket.on(
    'chat:send',
    (
      payload: { channel: 'global' | 'private'; toNationId?: PlayableNationId; text: string },
      ack?: (res: ActionResponse) => void
    ) => {
      const reply = (res: ActionResponse) => {
        if (typeof ack === 'function') ack(res);
      };

      const code = socketToRoom.get(socket.id);
      if (!code) return reply({ ok: false, reason: 'Aucun salon.' });
      const room = rooms.get(code);
      if (!room) return reply({ ok: false, reason: 'Salon introuvable.' });
      const sender = room.players.get(socket.id);
      if (!sender) return reply({ ok: false, reason: 'Expéditeur inconnu.' });

      const text = (payload?.text ?? '').trim().slice(0, 240);
      if (!text) return reply({ ok: false, reason: 'Message vide.' });

      const channel = payload.channel === 'private' ? 'private' : 'global';
      const time = room.state ? room.state.elapsedSeconds : 0;

      if (channel === 'private') {
        const targetNationId = payload.toNationId;
        if (!targetNationId || targetNationId === sender.nationId) {
          return reply({ ok: false, reason: 'Destinataire privé invalide.' });
        }
        const recipient = Array.from(room.players.values()).find(
          (p) => p.nationId === targetNationId
        );
        if (!recipient) {
          return reply({ ok: false, reason: 'Cette puissance est pilotée par l’IA.' });
        }

        const msg: ChatMessage = {
          id: createId('msg'),
          channel: 'private',
          fromSocketId: sender.socketId,
          fromNationId: sender.nationId,
          fromName: sender.name,
          toNationId: recipient.nationId,
          toName: recipient.name,
          text,
          time,
        };
        room.messages.push(msg);
        if (room.messages.length > MAX_CHAT_HISTORY) room.messages.shift();
        io.to(sender.socketId).emit('chat:message', msg);
        io.to(recipient.socketId).emit('chat:message', msg);
        return reply({ ok: true });
      }

      const msg: ChatMessage = {
        id: createId('msg'),
        channel: 'global',
        fromSocketId: sender.socketId,
        fromNationId: sender.nationId,
        fromName: sender.name,
        text,
        time,
      };
      room.messages.push(msg);
      if (room.messages.length > MAX_CHAT_HISTORY) room.messages.shift();
      io.to(room.code).emit('chat:message', msg);
      reply({ ok: true });
    }
  );

  socket.on('game:action', (action: ClientAction, ack?: (res: ActionResponse) => void) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.status !== 'PLAYING' || !room.state) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const state = room.state;
    const actor = player.nationId;
    let result: ActionResponse = { ok: false, reason: 'Action inconnue.' };

    switch (action.type) {
      case 'unlockTech':
        result = unlockTechnology(state, actor, action.axis);
        break;
      case 'upgradeBarracks':
        result = upgradeBarracks(state, actor, action.provinceId);
        break;
      case 'upgradeLaboratory':
        result = upgradeLaboratory(state, actor, action.provinceId);
        break;
      case 'upgradeExtraction':
        result = upgradeExtractionFactory(state, actor, action.provinceId, action.resource);
        break;
      case 'upgradeDefense':
        result = upgradeDefense(state, actor, action.provinceId, action.defense);
        break;
      case 'recruit':
        result = startRecruitment(state, actor, action.provinceId, action.unit, action.count);
        break;
      case 'move':
        result = orderMoveArmy(state, actor, action.fromId, action.targetId, action.units);
        break;
      case 'turnAround':
        result = orderTurnAround(state, actor, action.armyId);
        break;
      case 'redirectArmy':
        result = orderRedirectArmy(state, actor, action.armyId, action.targetId);
        break;
      case 'retreat':
        result = retreatFromBattle(state, action.battleId, actor);
        break;
      case 'diplomacy':
        result = requestDiplomaticAction(state, actor, action.target, action.status);
        break;
      case 'respondOffer': {
        const targetOffer = state.pendingOffers.find((o) => o.id === action.offerId);
        if (!targetOffer || targetOffer.to !== actor) {
          result = { ok: false, reason: 'Offre invalide ou déjà traitée.' };
        } else {
          result = respondToDiplomaticOffer(state, action.offerId, action.accept);
        }
        break;
      }
    }

    if (result.ok) {
      broadcastGameState(room);
    }
    if (typeof ack === 'function') ack(result);
  });

  socket.on('room:leave', () => {
    const code = socketToRoom.get(socket.id);
    if (code) void socket.leave(code);
    removePlayerFromCurrentRoom(socket.id);
  });

  socket.on('disconnect', () => {
    removePlayerFromCurrentRoom(socket.id);
    console.log(`[Socket] Déconnecté : ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`1914 : L’Europe en Flammes — Serveur prêt sur http://localhost:${PORT}`);
});