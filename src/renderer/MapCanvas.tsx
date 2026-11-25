import { useEffect, useMemo, useRef, useState } from 'react';
import { isPointOnLand, MAP_HEIGHT, MAP_WIDTH } from '../data/geo';
import { findArmyRoute, totalStack } from '../engine/combat';
import { getDiplomaticStatus } from '../engine/diplomacy';
import type { GameState, UnitStack } from '../engine/types';
import {
  drawMap,
  hitTestMovingArmy,
  hitTestProvince,
  type Camera,
  type MapMode,
  type MoveOrderPreview,
} from './drawMap';

type PointerPos = { x: number; y: number };
type PointerMap = Map<number, PointerPos>;

interface MapCanvasProps {
  state: GameState;
  selectedProvinceId: string | null;
  onSelectProvince: (id: string | null) => void;
  focusTarget?: [number, number] | null;
  /** Mode déplacement au clic : province d'origine + effectifs armés */
  moveOrderFromId?: string | null;
  moveOrderUnits?: UnitStack | null;
  onConfirmMove?: (fromId: string, targetId: string, units: UnitStack) => void;
  onCancelMove?: () => void;
  onTurnAroundArmy?: (armyId: string) => void;
}

export function MapCanvas({
  state,
  selectedProvinceId,
  onSelectProvince,
  focusTarget,
  moveOrderFromId = null,
  moveOrderUnits = null,
  onConfirmMove,
  onCancelMove,
  onTurnAroundArmy,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 920, y: 920, zoom: 0.72 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('political');

  const pointersRef = useRef<PointerMap>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(0.72);

  // Sépare nettement l'appui court (action d'armée) du maintien/glisser (déplacer la carte)
  const gestureRef = useRef<{
    active: boolean;
    moved: boolean;
    downAt: number;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
  }>({ active: false, moved: false, downAt: 0, startX: 0, startY: 0, camX: 0, camY: 0 });

  const isTargetingMove = Boolean(
    moveOrderFromId && moveOrderUnits && totalStack(moveOrderUnits) > 0
  );

  // Calcul en direct de la trajectoire survolée quand un ordre de marche est armé
  const movePreview = useMemo<MoveOrderPreview | null>(() => {
    if (!isTargetingMove || !moveOrderFromId || !moveOrderUnits) return null;
    if (!hoveredId || hoveredId === moveOrderFromId) {
      return {
        fromId: moveOrderFromId,
        route: [moveOrderFromId],
        isAir: false,
        isSubmarineMission: false,
        isHostile: false,
      };
    }

    const found = findArmyRoute(
      state,
      state.playerNationId,
      moveOrderFromId,
      hoveredId,
      moveOrderUnits
    );
    if (!found) return null;

    const targetProv = state.provinces[hoveredId];
    const isHostile =
      Boolean(targetProv) &&
      targetProv.owner !== state.playerNationId &&
      getDiplomaticStatus(state, state.playerNationId, targetProv.owner) !== 'alliance';

    return {
      fromId: moveOrderFromId,
      route: found.route,
      isAir: found.isAir,
      isSubmarineMission: found.isSubmarineMission,
      isHostile,
    };
  }, [isTargetingMove, moveOrderFromId, moveOrderUnits, hoveredId, state]);

  useEffect(() => {
    if (focusTarget) {
      setCamera((prev) => ({
        x: focusTarget[0],
        y: focusTarget[1],
        zoom: Math.max(prev.zoom, 1.05),
      }));
    }
  }, [focusTarget]);

  // Touche Échap pour annuler un ordre de déplacement en cours
  useEffect(() => {
    if (!isTargetingMove) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelMove?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTargetingMove, onCancelMove]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      wx: (sx - rect.width / 2) / camera.zoom + camera.x,
      wy: (sy - rect.height / 2) / camera.zoom + camera.y,
    };
  };

  // Boucle de rendu 60 FPS
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;

    const render = (now: number) => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(
        ctx,
        w,
        h,
        camera,
        state,
        selectedProvinceId,
        hoveredId,
        mapMode,
        now,
        movePreview
      );
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [camera, state, selectedProvinceId, hoveredId, mapMode, movePreview]);

  const clampCamera = (x: number, y: number, zoom: number): Camera => ({
    x: Math.min(MAP_WIDTH - 120, Math.max(120, x)),
    y: Math.min(MAP_HEIGHT - 120, Math.max(120, y)),
    zoom: Math.min(2.3, Math.max(0.45, zoom)),
  });

  const recenterOnCapital = () => {
    const cap = Object.values(state.provinces).find(
      (p) => p.owner === state.playerNationId && p.isCapital
    );
    if (cap) {
      setCamera((prev) => clampCamera(cap.center[0], cap.center[1], Math.max(prev.zoom, 0.95)));
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      pinchStartDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartZoomRef.current = camera.zoom;
      gestureRef.current.active = false;
      return;
    }

    gestureRef.current = {
      active: true,
      moved: false,
      downAt: performance.now(),
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.x,
      camY: camera.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointersRef.current.size === 2 && pinchStartDistRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / pinchStartDistRef.current;
      setCamera((prev) => clampCamera(prev.x, prev.y, pinchStartZoomRef.current * ratio));
      return;
    }

    if (gestureRef.current.active) {
      const dx = e.clientX - gestureRef.current.startX;
      const dy = e.clientY - gestureRef.current.startY;
      // Glissement > 7 px = déplacement de la carte
      if (Math.hypot(dx, dy) > 7) gestureRef.current.moved = true;
      if (gestureRef.current.moved) {
        setCamera((prev) =>
          clampCamera(
            gestureRef.current.camX - dx / prev.zoom,
            gestureRef.current.camY - dy / prev.zoom,
            prev.zoom
          )
        );
      }
      return;
    }

    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const hit = isPointOnLand(wx, wy) ? hitTestProvince(wx, wy, state.provinces) : null;
    setHoveredId(hit);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
    }

    const wasMoved = gestureRef.current.moved;
    const pressDurationMs = performance.now() - gestureRef.current.downAt;
    gestureRef.current.active = false;

    // Maintien long (> 340 ms sur tactile sans glisser) ou glissement = navigation carte, pas d'ordre d'armée
    const isShortTap = !wasMoved && (e.pointerType !== 'touch' || pressDurationMs < 340);

    if (isShortTap && pointersRef.current.size === 0) {
      const { wx, wy } = screenToWorld(e.clientX, e.clientY);

      // 1. Si un ordre de déplacement au clic est armé : clic sur une province valide -> envoyer, sinon annuler
      if (isTargetingMove && moveOrderFromId && moveOrderUnits) {
        const hitProv = isPointOnLand(wx, wy) ? hitTestProvince(wx, wy, state.provinces) : null;
        if (hitProv && hitProv !== moveOrderFromId) {
          onConfirmMove?.(moveOrderFromId, hitProv, moveOrderUnits);
        } else {
          // Cliquer ailleurs (mer, même province, vide) annule l'ordre
          onCancelMove?.();
        }
        return;
      }

      // 2. Clic court sur l'une de ses armées en marche -> demi-tour direct
      const hitArmy = hitTestMovingArmy(wx, wy, state);
      if (hitArmy && !hitArmy.isReturning && onTurnAroundArmy) {
        onTurnAroundArmy(hitArmy.id);
        return;
      }

      // 3. Sélection standard de province
      const hit = isPointOnLand(wx, wy) ? hitTestProvince(wx, wy, state.provinces) : null;
      onSelectProvince(hit);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setCamera((prev) => clampCamera(prev.x, prev.y, prev.zoom * factor));
  };

  return (
    <div className="relative h-full w-full overflow-hidden touch-none">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${
          isTargetingMove ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* Bandeau contextuel lorsque le mode ciblage au clic est actif */}
      {isTargetingMove && moveOrderFromId && (
        <div className="absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-3 rounded border border-amber-400/60 bg-stone-950/95 px-3.5 py-2 text-xs text-amber-100 shadow-2xl font-sans">
          <span>
            <strong>Ordre de marche</strong> depuis{' '}
            <span className="text-amber-300">{state.provinces[moveOrderFromId]?.name}</span> :
            cliquez sur une destination (ou cliquez dans le vide pour annuler).
          </span>
          <button
            type="button"
            onClick={() => onCancelMove?.()}
            className="rounded border border-stone-600 bg-stone-800 px-2 py-0.5 text-[11px] font-semibold text-stone-200 hover:bg-stone-700"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Barre d'outils cartographiques (haut gauche) */}
      <div className="absolute left-3 top-16 z-10 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setCamera((c) => clampCamera(c.x, c.y, c.zoom * 1.2))}
            className="h-8 w-8 rounded border border-stone-600/70 bg-stone-950/90 font-bold text-stone-100 hover:bg-stone-800"
            title="Zoomer"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setCamera((c) => clampCamera(c.x, c.y, c.zoom * 0.85))}
            className="h-8 w-8 rounded border border-stone-600/70 bg-stone-950/90 font-bold text-stone-100 hover:bg-stone-800"
            title="Dézoomer"
          >
            −
          </button>
          <button
            type="button"
            onClick={recenterOnCapital}
            className="h-8 rounded border border-stone-600/70 bg-stone-950/90 px-2.5 text-xs font-semibold text-amber-200 hover:bg-stone-800"
            title="Recentrer sur ma capitale"
          >
            ★ Capitale
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMapMode((m) => (m === 'political' ? 'diplomatic' : 'political'))}
          className={`rounded border px-2.5 py-1 text-xs font-semibold transition ${
            mapMode === 'diplomatic'
              ? 'border-sky-500/60 bg-sky-950/90 text-sky-200'
              : 'border-stone-600/70 bg-stone-950/90 text-stone-200 hover:bg-stone-800'
          }`}
        >
          Carte : {mapMode === 'political' ? 'Politique' : 'Diplomatique'}
        </button>
      </div>
    </div>
  );
}