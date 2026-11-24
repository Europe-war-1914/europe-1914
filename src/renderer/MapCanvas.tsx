import { useEffect, useRef, useState } from 'react';
import { Compass, Globe, Handshake, Minus, Plus } from 'lucide-react';
import { isPointOnLand, MAP_HEIGHT, MAP_WIDTH } from '../data/geo';
import type { GameState } from '../engine/types';
import { drawMap, hitTestProvince, type Camera, type MapMode } from './drawMap';

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
  const [camera, setCamera] = useState<Camera>({ x: 920, y: 920, zoom: 0.68 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('political');

  // Gestion multi-touch (glisser-déposer + pincement à deux doigts)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistRef = useRef<number | null>(null);
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

  const hasActiveAnimations =
    state.battles.length > 0 ||
    state.movingArmies.some(
      (a) =>
        a.owner !== state.playerNationId &&
        state.provinces[a.toProvinceId]?.owner === state.playerNationId
    );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
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
      drawMap(ctx, w, h, camera, state, selectedProvinceId, hoveredId, mapMode);
    };

    let rafId = 0;
    if (hasActiveAnimations) {
      const loop = () => {
        render();
        rafId = window.requestAnimationFrame(loop);
      };
      rafId = window.requestAnimationFrame(loop);
    } else {
      render();
    }

    window.addEventListener('resize', render);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', render);
    };
  }, [camera, state, selectedProvinceId, hoveredId, mapMode, hasActiveAnimations]);

  const clampCamera = (x: number, y: number, zoom: number): Camera => ({
    x: Math.min(MAP_WIDTH - 120, Math.max(120, x)),
    y: Math.min(MAP_HEIGHT - 120, Math.max(120, y)),
    zoom: Math.min(2.2, Math.max(0.45, zoom)),
  });

  const handleRecenterCapital = () => {
    const capital =
      Object.values(state.provinces).find(
        (p) => p.owner === state.playerNationId && p.isCapital
      ) ?? Object.values(state.provinces).find((p) => p.owner === state.playerNationId);

    if (capital) {
      setCamera((prev) => clampCamera(capital.center[0], capital.center[1], Math.max(prev.zoom, 0.95)));
      onSelectProvince(capital.id);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      pinchDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      dragRef.current.active = false;
      dragRef.current.moved = true;
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

    // Pinch-to-zoom sur écran tactile
    if (pointersRef.current.size === 2 && pinchDistRef.current !== null) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (dist > 0) {
        const ratio = dist / pinchDistRef.current;
        pinchDistRef.current = dist;
        setCamera((prev) => clampCamera(prev.x, prev.y, prev.zoom * ratio));
      }
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
      pinchDistRef.current = null;
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

      {/* Barre d'outils cartographiques (en haut à gauche, sans chevauchement) */}
      <div className="absolute left-3 top-16 z-10 flex flex-col gap-1.5 font-sans">
        <div className="flex items-center gap-1 rounded-lg border border-amber-200/30 bg-stone-950/90 p-1 shadow-xl backdrop-blur-sm">
          <button
            onClick={() => setCamera((c) => clampCamera(c.x, c.y, c.zoom * 1.2))}
            className="flex h-8 w-8 items-center justify-center rounded text-amber-100 hover:bg-stone-800"
            title="Zoomer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCamera((c) => clampCamera(c.x, c.y, c.zoom * 0.85))}
            className="flex h-8 w-8 items-center justify-center rounded text-amber-100 hover:bg-stone-800"
            title="Dézoomer"
          >
            <Minus className="h-4 w-4" />
          </button>

          <div className="mx-0.5 h-5 w-px bg-stone-700" />

          <button
            onClick={handleRecenterCapital}
            className="flex h-8 w-8 items-center justify-center rounded text-amber-200 hover:bg-stone-800"
            title="Recentrer sur votre capitale"
          >
            <Compass className="h-4 w-4" />
          </button>

          <div className="mx-0.5 h-5 w-px bg-stone-700" />

          <button
            onClick={() => setMapMode((m) => (m === 'political' ? 'diplomatic' : 'political'))}
            className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition ${
              mapMode === 'diplomatic'
                ? 'bg-amber-600 text-stone-950'
                : 'text-amber-100 hover:bg-stone-800'
            }`}
            title="Basculer entre la carte politique et la carte diplomatique"
          >
            {mapMode === 'diplomatic' ? (
              <>
                <Handshake className="h-3.5 w-3.5" />
                <span>Diplomatique</span>
              </>
            ) : (
              <>
                <Globe className="h-3.5 w-3.5" />
                <span>Politique</span>
              </>
            )}
          </button>
        </div>

        {/* Légende rapide en mode Diplomatique */}
        {mapMode === 'diplomatic' && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-amber-200/25 bg-stone-950/90 px-2.5 py-1.5 text-[11px] text-stone-200 shadow-lg backdrop-blur-sm">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Vous
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> Allié
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-600" /> PNA
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Guerre
            </span>
          </div>
        )}
      </div>
    </div>
  );
}