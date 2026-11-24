import { useState } from 'react';
import {
  Anchor,
  Crosshair,
  EyeOff,
  Hammer,
  Navigation,
  Shield,
  Swords,
  Users,
  X,
} from 'lucide-react';
import {
  BUILDING_SPECS,
  getBuildingCost,
  TERRAIN_MODIFIERS,
  UNIT_SPECS,
} from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import {
  getDiplomaticStatus,
  getTravelDurationSeconds,
  totalStack,
} from '../engine/combat';
import { canAfford } from '../engine/economy';
import { hasIntelOnProvince } from '../engine/visibility';
import type {
  BuildingType,
  GameState,
  Province,
  UnitStack,
  UnitType,
} from '../engine/types';

interface ProvinceDrawerProps {
  state: GameState;
  province: Province;
  onClose: () => void;
  onBuild: (provinceId: string, building: BuildingType) => void;
  onRecruit: (provinceId: string, unit: UnitType) => void;
  onMoveArmy: (fromId: string, toId: string, units: UnitStack) => void;
  onBombard: (fromId: string, targetId: string) => void;
}

const BUILDING_LIST: BuildingType[] = ['factory', 'fort', 'railway'];
const UNIT_LIST: UnitType[] = ['infantry', 'tank', 'artillery', 'battleship'];

export function ProvinceDrawer({
  state,
  province,
  onClose,
  onBuild,
  onRecruit,
  onMoveArmy,
  onBombard,
}: ProvinceDrawerProps) {
  const [section, setSection] = useState<'orders' | 'recruit' | 'build'>('orders');
  const [targetId, setTargetId] = useState<string>('');
  const [draftUnits, setDraftUnits] = useState<UnitStack>({
    infantry: province.garrison.infantry,
    tank: province.garrison.tank,
    artillery: province.garrison.artillery,
    battleship: province.garrison.battleship,
  });

  const isOwned = province.owner === state.playerNationId;
  const hasIntel = hasIntelOnProvince(state, province.id);
  const player = state.nations[state.playerNationId];
  const ownerTpl = NATION_TEMPLATES[province.owner];
  const terrain = TERRAIN_MODIFIERS[province.terrain];

  // Clamp automatique pour ne jamais dépasser la garnison réelle
  const clampedSend: UnitStack = {
    infantry: Math.min(draftUnits.infantry, province.garrison.infantry),
    tank: Math.min(draftUnits.tank, province.garrison.tank),
    artillery: Math.min(draftUnits.artillery, province.garrison.artillery),
    battleship: Math.min(draftUnits.battleship, province.garrison.battleship),
  };

  const landTargets = province.neighbors
    .map((id) => state.provinces[id])
    .filter((p): p is Province => Boolean(p));
  const seaTargets = province.seaNeighbors
    .filter((id) => !province.neighbors.includes(id))
    .map((id) => state.provinces[id])
    .filter((p): p is Province => Boolean(p));

  const allTargets = [...landTargets, ...seaTargets];
  const activeTarget = allTargets.find((p) => p.id === targetId) ?? allTargets[0] ?? null;
  const isTargetNaval = activeTarget ? !province.neighbors.includes(activeTarget.id) : false;

  const isTargetHostile = activeTarget
    ? activeTarget.owner !== state.playerNationId &&
      getDiplomaticStatus(state, state.playerNationId, activeTarget.owner) !== 'alliance'
    : false;

  const etaSeconds = activeTarget
    ? getTravelDurationSeconds(
        state,
        state.playerNationId,
        province,
        clampedSend,
        isTargetNaval
      )
    : 0;

  const activeConstruction = state.constructions.find((c) => c.provinceId === province.id);
  const activeRecruitments = state.recruitments.filter((r) => r.provinceId === province.id);
  const activeBattle = state.battles.find((b) => b.provinceId === province.id);

  const adjustUnit = (type: UnitType, delta: number) => {
    setDraftUnits((prev) => ({
      ...prev,
      [type]: Math.max(0, Math.min(province.garrison[type], prev[type] + delta)),
    }));
  };

  const setFraction = (ratio: number) => {
    setDraftUnits({
      infantry: Math.ceil(province.garrison.infantry * ratio),
      tank: Math.ceil(province.garrison.tank * ratio),
      artillery: Math.ceil(province.garrison.artillery * ratio),
      battleship: Math.ceil(province.garrison.battleship * ratio),
    });
  };

  return (
    <aside className="absolute bottom-3 left-3 z-20 flex max-h-[78vh] w-80 sm:w-96 flex-col overflow-hidden rounded-lg border border-amber-200/30 bg-stone-950/95 text-amber-50 shadow-2xl backdrop-blur-sm font-sans">
      {/* En-tête de province */}
      <div className="flex items-start justify-between border-b border-stone-800 bg-stone-900/90 px-3.5 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-base font-bold text-amber-100">
              {province.isCapital ? `★ ${province.name}` : province.name}
            </h2>
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: ownerTpl.color }}
            >
              {ownerTpl.shortName}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-stone-400">
            {terrain.label}{' '}
            {hasIntel
              ? `(Déf. ×${(terrain.defenseBonus * (1 + province.buildings.fort * 0.25)).toFixed(2)}) • Moral ${Math.round(province.morale)} %`
              : `(Déf. terrain ×${terrain.defenseBonus.toFixed(2)})`}{' '}
            • {province.victoryPoints} PV
          </p>
          <div className="mt-1 flex gap-3 text-[11px] text-amber-200/90">
            <span>Or +{province.baseIncome.gold}</span>
            <span>Acier +{province.baseIncome.steel}</span>
            <span>Pétrole +{province.baseIncome.oil}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-white"
          title="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Alerte combat en cours (si renseignement disponible) */}
      {activeBattle && hasIntel && (
        <div className="flex items-center gap-2 border-b border-red-800/70 bg-red-950/80 px-3.5 py-1.5 text-xs text-red-200">
          <Swords className="h-3.5 w-3.5 shrink-0" />
          <span>
            {activeBattle.isBombardment ? 'Sous pilonnage' : 'Combat en cours'} — Attaquant :{' '}
            {NATION_TEMPLATES[activeBattle.attacker].shortName} ({totalStack(activeBattle.attackerUnits)})
          </span>
        </div>
      )}

      {/* Corps du panneau */}
      {!isOwned ? (
        <div className="space-y-3 p-3.5 text-xs text-stone-300">
          {hasIntel ? (
            <>
              <div className="rounded border border-stone-800 bg-stone-900/70 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-stone-400">Garnison repérée</span>
                  <span className="font-bold text-amber-100">
                    {totalStack(province.garrison)} division(s)
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-stone-300">
                  <span>Inf: {province.garrison.infantry}</span>
                  <span>Chars: {province.garrison.tank}</span>
                  <span>Art: {province.garrison.artillery}</span>
                  <span>Cuir: {province.garrison.battleship}</span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded border border-stone-800 bg-stone-900/70 p-2.5">
                <span className="text-stone-400">Fortifications</span>
                <span className="font-semibold text-amber-200">
                  Niveau {province.buildings.fort} / 3
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2.5 rounded border border-stone-800 bg-stone-900/70 p-3 text-stone-400">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/70" />
              <div>
                <p className="font-semibold text-stone-200">Renseignement insuffisant</p>
                <p className="mt-0.5 text-[11px] leading-relaxed">
                  Cette région est hors de portée de vos frontières et de vos alliés. Approchez vos troupes pour évaluer sa garnison et ses fortifications.
                </p>
              </div>
            </div>
          )}

          <p className="text-[11px] text-stone-400">
            Sélectionnez l’une de vos provinces voisines pour y envoyer une armée ou lancer un bombardement d’artillerie.
          </p>
        </div>
      ) : (
        <>
          {/* Onglets internes du tiroir */}
          <div className="grid grid-cols-3 border-b border-stone-800 bg-stone-900/50 text-xs font-semibold">
            <button
              onClick={() => setSection('orders')}
              className={`flex items-center justify-center gap-1 py-2 transition ${
                section === 'orders'
                  ? 'border-b-2 border-amber-400 bg-stone-800/80 text-amber-200'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Navigation className="h-3.5 w-3.5" />
              Ordres ({totalStack(province.garrison)})
            </button>
            <button
              onClick={() => setSection('recruit')}
              className={`flex items-center justify-center gap-1 py-2 transition ${
                section === 'recruit'
                  ? 'border-b-2 border-amber-400 bg-stone-800/80 text-amber-200'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Recruter
            </button>
            <button
              onClick={() => setSection('build')}
              className={`flex items-center justify-center gap-1 py-2 transition ${
                section === 'build'
                  ? 'border-b-2 border-amber-400 bg-stone-800/80 text-amber-200'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Hammer className="h-3.5 w-3.5" />
              Construire
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            {/* --- SECTION 1 : ORDRES DE MARCHE & BOMBARDEMENT --- */}
            {section === 'orders' && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-100">Troupes à mobiliser</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setFraction(0.5)}
                        className="rounded bg-stone-800 px-2 py-0.5 text-[11px] hover:bg-stone-700"
                      >
                        50 %
                      </button>
                      <button
                        onClick={() => setFraction(1)}
                        className="rounded bg-stone-800 px-2 py-0.5 text-[11px] hover:bg-stone-700"
                      >
                        Tout
                      </button>
                    </div>
                  </div>

                  {UNIT_LIST.map((uType) => {
                    const avail = province.garrison[uType];
                    if (avail === 0) return null;
                    return (
                      <div
                        key={uType}
                        className="flex items-center justify-between rounded border border-stone-800 bg-stone-900/80 px-2.5 py-1.5"
                      >
                        <span>
                          {UNIT_SPECS[uType].label}{' '}
                          <span className="text-stone-400">(dispo {avail})</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => adjustUnit(uType, -1)}
                            className="h-6 w-6 rounded bg-stone-800 font-bold hover:bg-stone-700"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-bold text-amber-200">
                            {clampedSend[uType]}
                          </span>
                          <button
                            onClick={() => adjustUnit(uType, 1)}
                            className="h-6 w-6 rounded bg-stone-800 font-bold hover:bg-stone-700"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {totalStack(province.garrison) === 0 && (
                    <p className="rounded border border-stone-800 bg-stone-900/50 p-2 text-stone-400">
                      Aucune troupe stationnée ici. Passez dans l’onglet Recruter pour lever des divisions.
                    </p>
                  )}
                </div>

                {/* Cible */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-amber-100">Destination</label>
                  <select
                    value={activeTarget?.id ?? ''}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-xs text-amber-50 focus:border-amber-400 focus:outline-none"
                  >
                    {allTargets.map((t) => {
                      const naval = !province.neighbors.includes(t.id);
                      const ownerName = NATION_TEMPLATES[t.owner].shortName;
                      return (
                        <option key={t.id} value={t.id}>
                          {naval ? '⚓ ' : '→ '}
                          {t.name} ({ownerName}) — Garnison {totalStack(t.garrison)}
                        </option>
                      );
                    })}
                  </select>

                  {activeTarget && (
                    <div className="flex items-center justify-between text-[11px] text-stone-400">
                      <span className="flex items-center gap-1">
                        {isTargetNaval && <Anchor className="h-3 w-3 text-sky-400" />}
                        Trajet estimé (ETA) : <strong className="text-amber-200">{etaSeconds} s</strong>
                      </span>
                      <span
                        className={
                          isTargetHostile ? 'text-red-400 font-semibold' : 'text-emerald-400'
                        }
                      >
                        {isTargetHostile ? 'Offensif' : 'Redéploiement'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Boutons d'action */}
                <div className="flex flex-col gap-1.5">
                  <button
                    disabled={
                      !activeTarget ||
                      totalStack(clampedSend) <= 0 ||
                      (state.phase === 'MOBILIZATION' && isTargetHostile)
                    }
                    onClick={() => activeTarget && onMoveArmy(province.id, activeTarget.id, clampedSend)}
                    className={`w-full rounded py-2 font-bold transition ${
                      isTargetHostile
                        ? 'bg-red-700 text-white hover:bg-red-600 disabled:bg-stone-800 disabled:text-stone-500'
                        : 'bg-amber-600 text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500'
                    }`}
                  >
                    {state.phase === 'MOBILIZATION' && isTargetHostile
                      ? 'Attaque verrouillée (Mobilisation)'
                      : isTargetHostile
                      ? `Lancer l’assaut (${totalStack(clampedSend)})`
                      : `Déplacer les troupes (${totalStack(clampedSend)})`}
                  </button>

                  {province.garrison.artillery > 0 && activeTarget && isTargetHostile && (
                    <button
                      disabled={state.phase === 'MOBILIZATION'}
                      onClick={() => onBombard(province.id, activeTarget.id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded border border-orange-500/50 bg-orange-950/70 py-1.5 font-semibold text-orange-200 hover:bg-orange-900/70 disabled:opacity-40"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      Pilonner {activeTarget.name} ({province.garrison.artillery} art.)
                    </button>
                  )}
                </div>
              </>
            )}

            {/* --- SECTION 2 : RECRUTEMENT --- */}
            {section === 'recruit' && (
              <div className="space-y-2">
                {activeRecruitments.length > 0 && (
                  <div className="rounded border border-amber-500/30 bg-amber-950/30 p-2 space-y-1">
                    <p className="text-[11px] font-semibold text-amber-200">En formation ici :</p>
                    {activeRecruitments.map((r) => (
                      <div key={r.id} className="flex justify-between text-[11px] text-stone-200">
                        <span>
                          +{r.count} {UNIT_SPECS[r.unit].label}
                        </span>
                        <span className="font-mono text-amber-300">
                          {Math.max(0, Math.ceil(r.endsAt - state.elapsedSeconds))} s
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {UNIT_LIST.map((uType) => {
                  const spec = UNIT_SPECS[uType];
                  const hasFactory = province.buildings.factory >= spec.requiresFactoryLevel;
                  const hasCoast =
                    !spec.requiresCoastal ||
                    province.terrain === 'coastal' ||
                    province.seaNeighbors.length > 0;
                  const affordable = canAfford(player.resources, spec.cost);
                  const disabled = !hasFactory || !hasCoast || !affordable;

                  return (
                    <div
                      key={uType}
                      className="rounded border border-stone-800 bg-stone-900/80 p-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-100">{spec.label}</span>
                        <span className="text-[11px] text-stone-400">
                          Att {spec.attack} • Déf {spec.defense}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-stone-400">{spec.description}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-amber-200/90">
                          {spec.cost.gold} Or • {spec.cost.steel} Ac
                          {spec.cost.oil > 0 ? ` • ${spec.cost.oil} Pét` : ''}
                        </span>
                        <button
                          disabled={disabled}
                          onClick={() => onRecruit(province.id, uType)}
                          className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
                        >
                          {!hasFactory
                            ? `Usine niv.${spec.requiresFactoryLevel}`
                            : !hasCoast
                            ? 'Côte requise'
                            : 'Former +1'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* --- SECTION 3 : CONSTRUCTIONS --- */}
            {section === 'build' && (
              <div className="space-y-2">
                {activeConstruction && (
                  <div className="rounded border border-amber-500/30 bg-amber-950/30 p-2 text-[11px]">
                    <div className="flex justify-between font-semibold text-amber-200">
                      <span>Chantier : {BUILDING_SPECS[activeConstruction.building].label}</span>
                      <span className="font-mono">
                        {Math.max(0, Math.ceil(activeConstruction.endsAt - state.elapsedSeconds))} s
                      </span>
                    </div>
                  </div>
                )}

                {BUILDING_LIST.map((bType) => {
                  const spec = BUILDING_SPECS[bType];
                  const level = province.buildings[bType];
                  const maxed = level >= spec.maxLevel;
                  const cost = getBuildingCost(bType, level);
                  const affordable = canAfford(player.resources, cost);
                  const disabled = maxed || Boolean(activeConstruction) || !affordable;

                  return (
                    <div
                      key={bType}
                      className="rounded border border-stone-800 bg-stone-900/80 p-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-bold text-amber-100">
                          {bType === 'fort' && <Shield className="h-3.5 w-3.5 text-amber-400" />}
                          {spec.label}
                        </span>
                        <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[11px] text-amber-200">
                          Niv. {level} / {spec.maxLevel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-stone-400">{spec.description}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-amber-200/90">
                          {maxed
                            ? 'Niveau maximum'
                            : `${cost.gold} Or • ${cost.steel} Ac${cost.oil > 0 ? ` • ${cost.oil} Pét` : ''}`}
                        </span>
                        <button
                          disabled={disabled}
                          onClick={() => onBuild(province.id, bType)}
                          className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
                        >
                          {maxed ? 'Max' : activeConstruction ? 'Occupé' : 'Construire'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}