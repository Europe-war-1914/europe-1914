import http from 'node:http';
import { Server } from 'socket.io';
import { NATION_TEMPLATES, PLAYABLE_NATIONS } from '../src/data/nations';
import { respondToDiplomaticOffer } from '../src/engine/ai';
import { syncEliminatedAndFinalElo, type EloResult } from './elo';
import { handleStripeRequest } from './stripe';
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

interface DisconnectedSlot {
  token: string;
  player: RoomPlayer;
  timer: ReturnType<typeof setTimeout>;
}

interface ServerRoom {
  code: string;
  status: 'LOBBY' | 'PLAYING';
  isPublic: boolean;
  autoStartAt: number | null;
  autoStartTimer: ReturnType<typeof setInterval> | null;
  hostSocketId: string;
  players: Map<string, RoomPlayer>;
  participants: Map<PlayableNationId, { userId?: string; name: string }>;
  eloProcessedNations: Set<PlayableNationId>;
  eloResults: Record<string, EloResult>;
  tokenToSocket: Map<string, string>;
  socketToToken: Map<string, string>;
  disconnectedSlots: Map<string, DisconnectedSlot>;
  messages: ChatMessage[];
  state: GameState | null;
  interval: ReturnType<typeof setInterval> | null;
}

const PORT = Number(process.env.PORT ?? 3001);
const TICK_MS = 250;
const MAX_CHAT_HISTORY = 100;
const QUICKPLAY_COUNTDOWN_MS = 30_000;
const RECONNECT_GRACE_MS = 60_000;

const httpServer = http.createServer((req, res) => {
  void handleStripeRequest(req, res)
    .then((handled) => {
      if (handled) return;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('1914 : Serveur Multijoueur actif');
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

function getAllOccupiedNations(room: ServerRoom): Set<PlayableNationId> {
  const taken = new Set<PlayableNationId>();
  for (const p of room.players.values()) taken.add(p.nationId);
  for (const d of room.disconnectedSlots.values()) taken.add(d.player.nationId);
  return taken;
}

function findAvailableNation(
  room: ServerRoom,
  preferred?: PlayableNationId
): PlayableNationId | null {
  const taken = getAllOccupiedNations(room);
  if (preferred && !taken.has(preferred)) return preferred;
  return PLAYABLE_NATIONS.find((id) => !taken.has(id)) ?? null;
}

function toRoomSummary(room: ServerRoom): RoomSummary {
  return {
    code: room.code,
    status: room.status,
    hostSocketId: room.hostSocketId,
    players: Array.from(room.players.values()),
    isPublic: room.isPublic,
    autoStartAt: room.autoStartAt,
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

function stopRoomTimers(room: ServerRoom): void {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
  if (room.autoStartTimer) {
    clearInterval(room.autoStartTimer);
    room.autoStartTimer = null;
  }
  for (const slot of room.disconnectedSlots.values()) {
    clearTimeout(slot.timer);
  }
  room.disconnectedSlots.clear();
}

function cleanupRoomIfEmpty(room: ServerRoom): void {
  if (room.players.size > 0 || room.disconnectedSlots.size > 0) return;
  stopRoomTimers(room);
  rooms.delete(room.code);
  console.log(`[Salon ${room.code}] Fermé (aucun joueur connecté).`);
}

function launchRoomGame(room: ServerRoom): ActionResponse {
  if (room.status !== 'LOBBY') {
    return { ok: false, reason: 'Le salon ne peut pas être lancé.' };
  }

  const firstPlayer = Array.from(room.players.values())[0];
  if (!firstPlayer) {
    return { ok: false, reason: 'Aucun joueur dans le salon.' };
  }

  if (room.autoStartTimer) {
    clearInterval(room.autoStartTimer);
    room.autoStartTimer = null;
  }
  room.autoStartAt = null;
  room.eloProcessedNations.clear();
  room.eloResults = {};
  room.participants.clear();

  const fresh = createNewGame(firstPlayer.nationId);
  fresh.tutorialStep = 0;

  for (const id of PLAYABLE_NATIONS) {
    fresh.nations[id].isPlayer = false;
  }
  for (const p of room.players.values()) {
    fresh.nations[p.nationId].isPlayer = true;
    room.participants.set(p.nationId, { userId: p.userId, name: p.name });
  }
  for (const d of room.disconnectedSlots.values()) {
    fresh.nations[d.player.nationId].isPlayer = true;
    room.participants.set(d.player.nationId, {
      userId: d.player.userId,
      name: d.player.name,
    });
  }

  room.state = fresh;
  room.status = 'PLAYING';

  room.interval = setInterval(() => {
    if (!room.state) return;
    room.state = stepGameState(room.state, TICK_MS / 1000);
    broadcastGameState(room);

    // Vérifie si un joueur vient d'être éliminé (capitale perdue) ou si la partie est finie
    const hasPendingElo =
      room.state.phase === 'ENDED' ||
      Array.from(room.participants.keys()).some(
        (nId) =>
          !room.eloProcessedNations.has(nId) &&
          Boolean(room.state?.nations[nId]?.isEliminated)
      );

    if (hasPendingElo) {
      void syncEliminatedAndFinalElo(
        room.state,
        room.participants,
        room.eloProcessedNations
      ).then((newResults) => {
        if (Object.keys(newResults).length > 0) {
          Object.assign(room.eloResults, newResults);
          io.to(room.code).emit('game:elo', room.eloResults);
        }
      });
    }

    if (room.state.phase === 'ENDED' && room.interval) {
      clearInterval(room.interval);
      room.interval = null;
    }
  }, TICK_MS);

  broadcastRoom(room);
  broadcastGameState(room);
  console.log(`[Salon ${room.code}] Partie lancée (${room.players.size} joueur(s)).`);
  return { ok: true };
}

function schedulePublicAutoStart(room: ServerRoom): void {
  if (room.autoStartTimer) clearInterval(room.autoStartTimer);
  room.autoStartAt = Date.now() + QUICKPLAY_COUNTDOWN_MS;

  room.autoStartTimer = setInterval(() => {
    if (room.status !== 'LOBBY') {
      if (room.autoStartTimer) {
        clearInterval(room.autoStartTimer);
        room.autoStartTimer = null;
      }
      return;
    }

    if (room.players.size === 0 && room.disconnectedSlots.size === 0) {
      cleanupRoomIfEmpty(room);
      return;
    }

    const totalHumans = room.players.size + room.disconnectedSlots.size;
    if (
      totalHumans >= PLAYABLE_NATIONS.length &&
      room.autoStartAt &&
      room.autoStartAt - Date.now() > 3000
    ) {
      room.autoStartAt = Date.now() + 3000;
    }

    if (room.autoStartAt && Date.now() >= room.autoStartAt) {
      launchRoomGame(room);
    } else {
      broadcastRoom(room);
    }
  }, 1000);
}

function finalizePlayerDeparture(room: ServerRoom, player: RoomPlayer): void {
  if (room.status === 'PLAYING' && room.state) {
    room.state.nations[player.nationId].isPlayer = false;
    pushTelegram(
      room.state,
      `${player.name} (${NATION_TEMPLATES[player.nationId].shortName}) a quitté la partie : l'IA prend la relève.`,
      'warning'
    );
  }

  cleanupRoomIfEmpty(room);
  if (rooms.has(room.code)) {
    broadcastRoom(room);
    if (room.status === 'PLAYING') {
      broadcastGameState(room);
    }
  }
}

function removePlayerFromCurrentRoom(socketId: string, immediate = false): void {
  const code = socketToRoom.get(socketId);
  if (!code) return;
  socketToRoom.delete(socketId);

  const room = rooms.get(code);
  if (!room) return;

  const leaving = room.players.get(socketId);
  const token = room.socketToToken.get(socketId);
  room.players.delete(socketId);
  room.socketToToken.delete(socketId);
  if (token) room.tokenToSocket.delete(token);

  if (room.hostSocketId === socketId && room.players.size > 0) {
    const nextHost = Array.from(room.players.values())[0];
    room.hostSocketId = nextHost.socketId;
    nextHost.isHost = true;
  }

  if (!immediate && leaving && token && room.status === 'PLAYING') {
    const timer = setTimeout(() => {
      room.disconnectedSlots.delete(token);
      finalizePlayerDeparture(room, leaving);
    }, RECONNECT_GRACE_MS);

    room.disconnectedSlots.set(token, { token, player: leaving, timer });
    if (room.state) {
      pushTelegram(
        room.state,
        `${leaving.name} (${NATION_TEMPLATES[leaving.nationId].shortName}) a perdu la connexion (60 s pour revenir)...`,
        'warning'
      );
      broadcastGameState(room);
    }
    broadcastRoom(room);
    return;
  }

  if (leaving) {
    finalizePlayerDeparture(room, leaving);
  } else {
    cleanupRoomIfEmpty(room);
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
      payload: {
        playerName?: string;
        preferredNation?: PlayableNationId;
        clientToken?: string;
        userId?: string;
      },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      removePlayerFromCurrentRoom(socket.id, true);

      const code = generateRoomCode();
      const nationId = payload?.preferredNation ?? 'france';
      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';
      const token = (payload?.clientToken ?? '').trim() || socket.id;

      const room: ServerRoom = {
        code,
        status: 'LOBBY',
        isPublic: false,
        autoStartAt: null,
        autoStartTimer: null,
        hostSocketId: socket.id,
        players: new Map(),
        participants: new Map(),
        eloProcessedNations: new Set(),
        eloResults: {},
        tokenToSocket: new Map([[token, socket.id]]),
        socketToToken: new Map([[socket.id, token]]),
        disconnectedSlots: new Map(),
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
      removePlayerFromCurrentRoom(socket.id, true);

      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';
      const token = (payload?.clientToken ?? '').trim() || socket.id;

      let targetRoom: ServerRoom | null = null;
      for (const r of rooms.values()) {
        const occupied = r.players.size + r.disconnectedSlots.size;
        if (r.isPublic && r.status === 'LOBBY' && occupied < PLAYABLE_NATIONS.length) {
          targetRoom = r;
          break;
        }
      }

      if (!targetRoom) {
        const code = generateRoomCode();
        const nationId = payload?.preferredNation ?? 'france';
        targetRoom = {
          code,
          status: 'LOBBY',
          isPublic: true,
          autoStartAt: null,
          autoStartTimer: null,
          hostSocketId: socket.id,
          players: new Map(),
          participants: new Map(),
          eloProcessedNations: new Set(),
          eloResults: {},
          tokenToSocket: new Map([[token, socket.id]]),
          socketToToken: new Map([[socket.id, token]]),
          disconnectedSlots: new Map(),
          messages: [],
          state: null,
          interval: null,
        };

        targetRoom.players.set(socket.id, {
          socketId: socket.id,
          name: cleanName,
          nationId,
          isHost: true,
          userId: payload?.userId,
        });

        rooms.set(code, targetRoom);
        socketToRoom.set(socket.id, code);
        void socket.join(code);
        schedulePublicAutoStart(targetRoom);

        const summary = toRoomSummary(targetRoom);
        broadcastRoom(targetRoom);
        socket.emit('chat:history', []);
        if (typeof ack === 'function') ack({ ok: true, room: summary });
        console.log(`[Matchmaking ${code}] Salle publique ouverte par ${cleanName}`);
        return;
      }

      const nationId = findAvailableNation(targetRoom, payload?.preferredNation);
      if (!nationId) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Salle complète.' });
        return;
      }

      targetRoom.players.set(socket.id, {
        socketId: socket.id,
        name: cleanName,
        nationId,
        isHost: false,
        userId: payload?.userId,
      });
      targetRoom.tokenToSocket.set(token, socket.id);
      targetRoom.socketToToken.set(socket.id, token);

      socketToRoom.set(socket.id, targetRoom.code);
      void socket.join(targetRoom.code);

      const summary = toRoomSummary(targetRoom);
      broadcastRoom(targetRoom);
      socket.emit(
        'chat:history',
        targetRoom.messages.filter((m) => m.channel === 'global')
      );
      if (typeof ack === 'function') ack({ ok: true, room: summary });
      console.log(`[Matchmaking ${targetRoom.code}] ${cleanName} a rejoint (${nationId})`);
    }
  );

  socket.on(
    'room:rejoin',
    (
      payload: { code: string; clientToken: string },
      ack?: (res: { ok: boolean; room?: RoomSummary; reason?: string }) => void
    ) => {
      const code = (payload?.code ?? '').trim().toUpperCase();
      const token = (payload?.clientToken ?? '').trim();
      const room = rooms.get(code);

      if (!room || !token) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Session expirée.' });
        return;
      }

      const slot = room.disconnectedSlots.get(token);
      if (!slot) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'Aucune partie à reprendre.' });
        return;
      }

      clearTimeout(slot.timer);
      room.disconnectedSlots.delete(token);

      const restored: RoomPlayer = {
        ...slot.player,
        socketId: socket.id,
        isHost: room.players.size === 0 ? true : slot.player.isHost,
      };
      if (restored.isHost) {
        room.hostSocketId = socket.id;
      }

      room.players.set(socket.id, restored);
      room.tokenToSocket.set(token, socket.id);
      room.socketToToken.set(socket.id, token);
      socketToRoom.set(socket.id, code);
      void socket.join(code);

      if (room.state) {
        room.state.nations[restored.nationId].isPlayer = true;
        pushTelegram(
          room.state,
          `${restored.name} (${NATION_TEMPLATES[restored.nationId].shortName}) a repris le commandement !`,
          'info'
        );
      }

      const summary = toRoomSummary(room);
      broadcastRoom(room);
      socket.emit(
        'chat:history',
        room.messages.filter(
          (m) =>
            m.channel === 'global' ||
            m.fromNationId === restored.nationId ||
            m.toNationId === restored.nationId
        )
      );
      if (Object.keys(room.eloResults).length > 0) {
        socket.emit('game:elo', room.eloResults);
      }
      if (room.status === 'PLAYING' && room.state) {
        socket.emit('game:state', buildPlayerState(room.state, restored.nationId));
        broadcastGameState(room);
      }

      if (typeof ack === 'function') ack({ ok: true, room: summary });
      console.log(`[Salon ${code}] Reconnexion réussie pour ${restored.name}`);
    }
  );

  socket.on(
    'room:join',
    (
      payload: {
        code: string;
        playerName?: string;
        clientToken?: string;
        userId?: string;
      },
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

      removePlayerFromCurrentRoom(socket.id, true);

      const cleanName = (payload?.playerName ?? '').trim().slice(0, 18) || 'Commandant';
      const token = (payload?.clientToken ?? '').trim() || socket.id;

      room.players.set(socket.id, {
        socketId: socket.id,
        name: cleanName,
        nationId,
        isHost: false,
        userId: payload?.userId,
      });
      room.tokenToSocket.set(token, socket.id);
      room.socketToToken.set(socket.id, token);

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
      const takenByDisconnected = Array.from(room.disconnectedSlots.values()).some(
        (d) => d.player.nationId === payload.nationId
      );
      if (takenByOther || takenByDisconnected) {
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
      if (!room.isPublic && room.hostSocketId !== socket.id) {
        reply({ ok: false, reason: "Seul l'hôte peut lancer la partie." });
        return;
      }

      reply(launchRoomGame(room));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur serveur au lancement.';
      console.error('[room:start] Erreur :', err);
      reply({ ok: false, reason: message });
    }
  });

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
    removePlayerFromCurrentRoom(socket.id, true);
  });

  socket.on('disconnect', () => {
    removePlayerFromCurrentRoom(socket.id, false);
    console.log(`[Socket] Déconnecté : ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Serveur multijoueur 1914 prêt sur http://localhost:${PORT}`);
});