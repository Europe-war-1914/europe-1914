import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, RotateCcw, X } from 'lucide-react';
import { UNIT_ORDER, UNIT_SPECS } from '../data/balance';
import { isPointOnLand, MAP_HEIGHT, MAP_WIDTH } from '../data/geo';
import { findArmyRoute, getMovingArmyWorldPos, totalStack } from '../engine/combat';
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
  moveOrderFromId?: string | null;
  moveOrderUnits?: UnitStack | null;
  onConfirmMove?: (fromId: string, targetId: string, units: UnitStack) => void;
  onCancelMove?: () => void;
  onTurnAroundArmy?: (armyId: string) => void;
  onRedirectArmy?: (armyId: string, newTargetId: string) => void;
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
  onRedirectArmy,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 920, y: 920, zoom: 0.72 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('political');

  const [selectedArmyId, setSelectedArmyId] = useState<string | null>(null);
  const [redirectingArmyId, setRedirectingArmyId] = useState<string | null>(null);

  const pointersRef = useRef<PointerMap>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(0.72);

  const gestureRef = useRef<{
    active: boolean;
    moved: boolean;
    downAt: number;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
  }>({ active: false, moved: false, downAt: 0, startX: 0, startY: 0, camX: 0, camY: 0 });

  const selectedArmy = useMemo(
    () =>
      selectedArmyId
        ? state.movingArmies.find(
            (a) => a.id === selectedArmyId && a.owner === state.playerNationId
          ) ?? null
        : null,
    [selectedArmyId, state.movingArmies, state.playerNationId]
  );

  const redirectingArmy = useMemo(
    () =>
      redirectingArmyId
        ? state.movingArmies.find(
            (a) => a.id === redirectingArmyId && a.owner === state.playerNationId
          ) ?? null
        : null,
    [redirectingArmyId, state.movingArmies, state.playerNationId]
  );

  const isTargetingMove = Boolean(
    moveOrderFromId && moveOrderUnits && totalStack(moveOrderUnits) > 0
  );
  const isTargetingAny = isTargetingMove || Boolean(redirectingArmy);

  const movePreview = useMemo<MoveOrderPreview | null>(() => {
    if (redirectingArmy) {
      const startPos = getMovingArmyWorldPos(state, redirectingArmy);
      if (!hoveredId) {
        return {
          fromId: redirectingArmy.fromProvinceId,
          startPos,
          route: [],
          isAir: redirectingArmy.isAir,
          isSubmarineMission: redirectingArmy.isSubmarineMission,
          isHostile: false,
        };
      }
      const targetProv = state.provinces[hoveredId];
      const isHostile =
        Boolean(targetProv) &&
        targetProv.owner !== state.playerNationId &&
        getDiplomaticStatus(state, state.playerNationId, targetProv.owner) !== 'alliance';

      return {
        fromId: redirectingArmy.fromProvinceId,
        startPos,
        route: [hoveredId],
        isAir: redirectingArmy.isAir,
        isSubmarineMission: redirectingArmy.isSubmarineMission,
        isHostile,
      };
    }

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
  }, [redirectingArmy, isTargetingMove, moveOrderFromId, moveOrderUnits, hoveredId, state]);

  useEffect(() => {
    if (focusTarget) {
      setCamera((prev) => ({
        x: focusTarget[0],
        y: focusTarget[1],
        zoom: Math.max(prev.zoom, 1.05),
      }));
    }
  }, [focusTarget]);

  useEffect(() => {
    if (!isTargetingAny && !selectedArmyId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelMove?.();
        setRedirectingArmyId(null);
        setSelectedArmyId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTargetingAny, selectedArmyId, onCancelMove]);

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
        movePreview,
        selectedArmy?.id ?? null
      );
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [camera, state, selectedProvinceId, hoveredId, mapMode, movePreview, selectedArmy]);

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

  const releasePointer = (target: HTMLCanvasElement, pointerId: number) => {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    pointersRef.current.delete(pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
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
      if (Math.hypot(dx, dy) > 6) gestureRef.current.moved = true;
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
    const wasMoved = gestureRef.current.moved;
    const pressDurationMs = performance.now() - gestureRef.current.downAt;
    gestureRef.current.active = false;

    const remainingBeforeDelete = pointersRef.current.size;
    releasePointer(e.currentTarget, e.pointerId);

    const isShortTap = !wasMoved && (e.pointerType !== 'touch' || pressDurationMs < 400);

    if (isShortTap && remainingBeforeDelete === 1) {
      const { wx, wy } = screenToWorld(e.clientX, e.clientY);

      if (redirectingArmy) {
        const hitProv = isPointOnLand(wx, wy) ? hitTestProvince(wx, wy, state.provinces) : null;
        if (hitProv) {
          onRedirectArmy?.(redirectingArmy.id, hitProv);
        }
        setRedirectingArmyId(null);
        setSelectedArmyId(null);
        return;
      }

      if (isTargetingMove && moveOrderFromId && moveOrderUnits) {
        const hitProv = isPointOnLand(wx, wy) ? hitTestProvince(wx, wy, state.provinces) : null;
        if (hitProv && hitProv !== moveOrderFromId) {
          onConfirmMove?.(moveOrderFromId, hitProv, moveOrderUnits);
        } else {
          onCancelMove?.();
        }
        return;
      }

      const hitArmy = hitTestMovingArmy(wx, wy, state);
      if (hitArmy) {
        setSelectedArmyId(hitArmy.id);
        setRedirectingArmyId(null);
        return;
      }

      setSelectedArmyId(null);
      const hit = isPointOnLand(wx, wy) ? hitTestProvince(wx, wy, state.provinces) : null;
      onSelectProvince(hit);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    gestureRef.current.active = false;
    releasePointer(e.currentTarget, e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setCamera((prev) => clampCamera(prev.x, prev.y, prev.zoom * factor));
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full touch-pan-x touch-pan-y ${
          isTargetingAny ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
      />

      {isTargetingAny && (
        <div className="absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-3 rounded border border-amber-400/60 bg-stone-950/95 px-3.5 py-2 text-xs text-amber-100 shadow-2xl font-sans">
          <span>
            {redirectingArmy ? (
              <>
                <strong>Changer de direction</strong> : cliquez sur la nouvelle province cible (ou
                dans le vide pour annuler).
              </>
            ) : (
              <>
                <strong>Ordre de marche</strong> depuis{' '}
                <span className="text-amber-300">
                  {moveOrderFromId ? state.provinces[moveOrderFromId]?.name : ''}
                </span>{' '}
                : cliquez sur une destination (ou dans le vide pour annuler).
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onCancelMove?.();
              setRedirectingArmyId(null);
            }}
            className="rounded border border-stone-600 bg-stone-800 px-2 py-0.5 text-[11px] font-semibold text-stone-200 hover:bg-stone-700"
          >
            Annuler
          </button>
        </div>
      )}

      {selectedArmy && !redirectingArmy && (
        <div className="absolute bottom-4 left-1/2 z-30 w-72 -translate-x-1/2 rounded-lg border border-amber-500/60 bg-stone-950/96 p-3 text-xs text-stone-100 shadow-2xl backdrop-blur-sm font-sans">
          <div className="flex items-center justify-between gap-2 border-b border-stone-800 pb-2">
            <div>
              <p className="font-serif text-sm font-bold text-amber-100">
                Colonne en mouvement ({totalStack(selectedArmy.units)})
              </p>
              <p className="text-[11px] text-stone-400">
                Cap :{' '}
                <strong className="text-stone-200">
                  {state.provinces[selectedArmy.targetProvinceId]?.name}
                </strong>{' '}
                •{' '}
                <span className="font-mono text-amber-300">
                  {Math.max(
                    0,
                    Math.ceil(
                      (selectedArmy.landingEndsAt ?? selectedArmy.legArrivalAt) -
                        state.elapsedSeconds
                    )
                  )}{' '}
                  s
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedArmyId(null)}
              className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {UNIT_ORDER.filter((t) => selectedArmy.units[t] > 0).map((t) => (
              <span
                key={t}
                className="rounded border border-stone-800 bg-stone-900 px-1.5 py-0.5 text-[10px] text-stone-200"
              >
                {selectedArmy.units[t]} {UNIT_SPECS[t].label}
              </span>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onTurnAroundArmy?.(selectedArmy.id);
                setSelectedArmyId(null);
              }}
              className="flex items-center justify-center gap-1 rounded border border-amber-500/50 bg-stone-900 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-stone-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Faire demi-tour
            </button>

            <button
              type="button"
              onClick={() => setRedirectingArmyId(selectedArmy.id)}
              className="flex items-center justify-center gap-1 rounded bg-amber-600 py-1.5 text-[11px] font-bold text-stone-950 hover:bg-amber-500"
            >
              <Compass className="h-3.5 w-3.5" />
              Changer de cap
            </button>
          </div>
        </div>
      )}

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