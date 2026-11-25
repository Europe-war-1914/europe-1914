import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../engine/types';
import { isPointOnLand, MAP_HEIGHT, MAP_WIDTH } from '../data/geo';
import { drawMap, hitTestProvince, type Camera, type MapMode } from './drawMap';

type PointerPos = { x: number; y: number };
type PointerMap = Map<number, PointerPos>;

interface MapCanvasProps {
  state: GameState;
  selectedProvinceId: string | null;
  onSelectProvince: (id: string | null) => void;
  focusTarget?: [number, number] | null;
}

export function MapCanvas({
  state,
  selectedProvinceId,
  onSelectProvince,
  focusTarget,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 920, y: 920, zoom: 0.72 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('political');

  const pointersRef = useRef<PointerMap>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(0.72);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, camX: 0, camY: 0 });

  useEffect(() => {
    if (focusTarget) {
      setCamera((prev) => ({
        x: focusTarget[0],
        y: focusTarget[1],
        zoom: Math.max(prev.zoom, 1.05),
      }));
    }
  }, [focusTarget]);

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

  // Boucle de rendu fluide 60 FPS (drapeaux, marche des unités, combats)
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
      drawMap(ctx, w, h, camera, state, selectedProvinceId, hoveredId, mapMode, now);
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [camera, state, selectedProvinceId, hoveredId, mapMode]);

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
      dragRef.current.active = false;
      return;
    }

    dragRef.current = {
      active: true,
      moved: false,
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

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 5) dragRef.current.moved = true;
      setCamera((prev) =>
        clampCamera(
          dragRef.current.camX - dx / prev.zoom,
          dragRef.current.camY - dy / prev.zoom,
          prev.zoom
        )
      );
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

    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasMoved && pointersRef.current.size === 0) {
      const { wx, wy } = screenToWorld(e.clientX, e.clientY);
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
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* Barre d'outils cartographiques (haut gauche) */}
      <div className="absolute left-3 top-16 z-10 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setCamera((c) => clampCamera(c.x, c.y, c.zoom * 1.2))}
            className="h-8 w-8 rounded border border-amber-200/30 bg-stone-900/90 font-bold text-amber-100 hover:bg-stone-800"
            title="Zoomer"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setCamera((c) => clampCamera(c.x, c.y, c.zoom * 0.85))}
            className="h-8 w-8 rounded border border-amber-200/30 bg-stone-900/90 font-bold text-amber-100 hover:bg-stone-800"
            title="Dézoomer"
          >
            −
          </button>
          <button
            type="button"
            onClick={recenterOnCapital}
            className="h-8 rounded border border-amber-200/30 bg-stone-900/90 px-2.5 text-xs font-semibold text-amber-100 hover:bg-stone-800"
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
              ? 'border-sky-400/60 bg-sky-950/90 text-sky-200'
              : 'border-amber-200/30 bg-stone-900/90 text-amber-100 hover:bg-stone-800'
          }`}
        >
          Carte : {mapMode === 'political' ? 'Politique' : 'Diplomatique'}
        </button>
      </div>
    </div>
  );
}