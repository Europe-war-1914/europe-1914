import http from 'node:http';
import { Server } from 'socket.io';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from '../src/data/nations';
import { respondToDiplomaticOffer } from '../src/engine/ai';
import {
  orderArtilleryBombardment,
  orderMoveArmy,
  retreatFromBattle,
  setDiplomaticStatus,
} from '../src/engine/combat';
import {
  createId,
  pushTelegram,
  startConstruction,
  startRecruitment,
} from '../src/engine/economy';
import { createNewGame, stepGameState } from '../src/engine/gameLoop';
import type { GameState, PlayableNationId } from '../src/engine/types';
import type {
  ActionResponse,
  ChatMessage,
  ClientAction,
  RoomPlayer,
  RoomSummary,
} from '../src/network/protocol';

interface ServerRoom {
  code: string;
  status: 'LOBBY' | 'PLAYING';
  hostSocketId: string;
  players: Map<string, RoomPlayer>;
  messages: ChatMessage[];
  state: GameState | null;
  interval: ReturnType<typeof setInterval> | null;
}

const PORT = Number(process.env.PORT ?? 3001);
const TICK_MS = 250;
const MAX_CHAT_HISTORY = 100;

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('1914 : Serveur Multijoueur actif');
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
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
    players: Array.from(room.players.values()),
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
    pendingOffers: state.pendingOffers.filter((o) => o.to === nationId),
  };
}

function broadcastGameState(room: ServerRoom): void {
  if (!room.state) return;
  for (const player of room.players.values()) {
    io.to(player.socketId).emit(
      'game:state',
      buildPlayerState(room.state, player.nationId)
    );
  }
}

function cleanupRoomIfEmpty(room: ServerRoom): void {
  if (room.players.size > 0) return;
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
  rooms.delete(room.code);
  console.log(`[Salon ${room.code}] Fermé (aucun joueur connecté).`);
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
      `${leaving.name} (${NATION_TEMPLATES[leaving.nationId].shortName}) a quitté la partie : l'IA prend la relève.`,
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

function handleDiplomacyAction(
  state: GameState,
  actorId: PlayableNationId,
  targetId: PlayableNationId,
  status: 'war' | 'neutral' | 'nap' | 'alliance'
): ActionResponse {
  if (actorId === targetId) {
    return { ok: false, reason: 'Cible diplomatique invalide.' };
  }

  const actorName = NATION_TEMPLATES[actorId].shortName;
  const targetName = NATION_TEMPLATES[targetId].shortName;
  const targetIsHuman = state.nations[targetId]?.isPlayer ?? false;

  if (status === 'war' || !targetIsHuman) {
    setDiplomaticStatus(state, actorId, targetId, status);
    pushTelegram(
      state,
      status === 'war'
        ? `Guerre déclarée entre ${actorName} et ${targetName} !`
        : `Diplomatie : ${actorName} et ${targetName} passent en statut ${status.toUpperCase()}.`,
      status === 'war' ? 'danger' : 'diplomacy'
    );
    return { ok: true };
  }

  const offerType: 'nap' | 'alliance' | 'peace' = status === 'neutral' ? 'peace' : status;
  const duplicate = state.pendingOffers.some(
    (o) => o.from === actorId && o.to === targetId && o.type === offerType
  );
  if (duplicate) {
    return { ok: false, reason: 'Une proposition identique est déjà en attente.' };
  }

  state.pendingOffers.push({
    id: createId('dip'),
    from: actorId,
    to: targetId,
    type: offerType,
    createdAt: state.elapsedSeconds,
    expiresAt: state.elapsedSeconds + 60,
  });

  const label =
    offerType === 'alliance'
      ? 'une Alliance'
      : offerType === 'nap'
      ? 'un Pacte de non-agression'
      : 'un Traité de paix';

  pushTelegram(
    state,
    `Diplomatie : ${actorName} propose ${label} à ${targetName}.`,
    'diplomacy'
  );
  return { ok: true };
}

io.on('connection', (socket) => {
  console.log(`[Socket] Connecté : ${socket.id}`);

  socket.on(
    'room:create',
    (
      payload: { playerName?: string; preferredNation?: PlayableNationId },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      removePlayerFromCurrentRoom(socket.id);

      const code = generateRoomCode();
      const nationId = payload?.preferredNation ?? 'france';
      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';

      const room: ServerRoom = {
        code,
        status: 'LOBBY',
        hostSocketId: socket.id,
        players: new Map(),
        messages: [],
        state: null,
        interval: null,
      };

      room.players.set(socket.id, {
        socketId: socket.id,
        name: cleanName,
        nationId,
        isHost: true,
      });

      rooms.set(code, room);
      socketToRoom.set(socket.id, code);
      void socket.join(code);

      const summary = toRoomSummary(room);
      broadcastRoom(room);
      socket.emit('chat:history', []);
      if (typeof ack === 'function') ack({ ok: true, room: summary });
      console.log(`[Salon ${code}] Créé par ${cleanName} (${nationId})`);
    }
  );

  socket.on(
    'room:join',
    (
      payload: { code: string; playerName?: string },
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
      console.log(`[Salon ${code}] ${cleanName} a rejoint (${nationId})`);
    }
  );

  socket.on(
    'room:selectNation',
    (
      payload: { nationId: PlayableNationId },
      ack?: (res: ActionResponse) => void
    ) => {
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
          ack({ ok: false, reason: 'Cette puissance est déjà choisie par un autre joueur.' });
        }
        return;
      }

      player.nationId = payload.nationId;
      broadcastRoom(room);
      if (typeof ack === 'function') ack({ ok: true });
    }
  );

  socket.on('room:start', (ack?: (res: ActionResponse) => void) => {
    const reply = (res: ActionResponse) => {
      if (typeof ack === 'function') ack(res);
    };

    try {
      const code = socketToRoom.get(socket.id);
      if (!code) {
        reply({ ok: false, reason: 'Session introuvable dans un salon.' });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.status !== 'LOBBY') {
        reply({ ok: false, reason: 'Le salon ne peut pas être lancé.' });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        reply({ ok: false, reason: "Seul l'hôte peut lancer la partie." });
        return;
      }

      const host = room.players.get(socket.id);
      if (!host) {
        reply({ ok: false, reason: 'Hôte introuvable.' });
        return;
      }

      const fresh = createNewGame(host.nationId);
      fresh.tutorialStep = 0;

      for (const id of PLAYABLE_NATIONS) {
        fresh.nations[id].isPlayer = false;
      }
      for (const p of room.players.values()) {
        fresh.nations[p.nationId].isPlayer = true;
      }

      room.state = fresh;
      room.status = 'PLAYING';

      room.interval = setInterval(() => {
        if (!room.state) return;
        room.state = stepGameState(room.state, TICK_MS / 1000);
        broadcastGameState(room);

        if (room.state.phase === 'ENDED' && room.interval) {
          clearInterval(room.interval);
          room.interval = null;
        }
      }, TICK_MS);

      broadcastRoom(room);
      broadcastGameState(room);
      reply({ ok: true });
      console.log(`[Salon ${code}] Partie lancée (${room.players.size} joueur(s)).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur serveur au lancement.';
      console.error('[room:start] Erreur :', err);
      reply({ ok: false, reason: message });
    }
  });

  // --- CHAT DIPLOMATIQUE (PUBLIC & DÉPÊCHES PRIVÉES) ---
  socket.on(
    'chat:send',
    (
      payload: {
        channel: 'global' | 'private';
        toNationId?: PlayableNationId;
        text: string;
      },
      ack?: (res: ActionResponse) => void
    ) => {
      const reply = (res: ActionResponse) => {
        if (typeof ack === 'function') ack(res);
      };

      const code = socketToRoom.get(socket.id);
      if (!code) {
        reply({ ok: false, reason: 'Vous n’êtes dans aucun salon.' });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        reply({ ok: false, reason: 'Salon introuvable.' });
        return;
      }
      const sender = room.players.get(socket.id);
      if (!sender) {
        reply({ ok: false, reason: 'Expéditeur inconnu.' });
        return;
      }

      const text = (payload?.text ?? '').trim().slice(0, 240);
      if (!text) {
        reply({ ok: false, reason: 'Message vide.' });
        return;
      }

      const channel = payload.channel === 'private' ? 'private' : 'global';
      const time = room.state ? room.state.elapsedSeconds : 0;

      if (channel === 'private') {
        const targetNationId = payload.toNationId;
        if (!targetNationId || targetNationId === sender.nationId) {
          reply({ ok: false, reason: 'Destinataire privé invalide.' });
          return;
        }

        const recipient = Array.from(room.players.values()).find(
          (p) => p.nationId === targetNationId
        );
        if (!recipient) {
          reply({
            ok: false,
            reason: 'Impossible : cette puissance est pilotée par l’IA ou déconnectée.',
          });
          return;
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

        // Transmis exclusivement à l'expéditeur et au destinataire
        io.to(sender.socketId).emit('chat:message', msg);
        io.to(recipient.socketId).emit('chat:message', msg);
        reply({ ok: true });
        return;
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

  socket.on(
    'game:action',
    (action: ClientAction, ack?: (res: ActionResponse) => void) => {
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
        case 'build':
          result = startConstruction(state, actor, action.provinceId, action.building);
          break;
        case 'recruit':
          result = startRecruitment(state, actor, action.provinceId, action.unit, 1);
          break;
        case 'move':
          result = orderMoveArmy(state, actor, action.fromId, action.toId, action.units);
          break;
        case 'bombard':
          result = orderArtilleryBombardment(state, actor, action.fromId, action.targetId);
          break;
        case 'retreat':
          result = retreatFromBattle(state, action.battleId, actor);
          break;
        case 'diplomacy':
          result = handleDiplomacyAction(state, actor, action.target, action.status);
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
    }
  );

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
  console.log(`Serveur multijoueur 1914 prêt sur http://localhost:${PORT}`);
});