import { useState } from 'react';
import {
  Building2,
  Crosshair,
  FlaskConical,
  Minus,
  Plus,
  Shield,
  Users,
  X,
} from 'lucide-react';
import {
  createEmptyStack,
  DEFENSE_LABELS,
  EXTRACTION_LABELS,
  EXTRACTION_TECH_MAP,
  getBarracksCost,
  getDefenseCost,
  getExtractionCost,
  getLaboratoryCost,
  LAB_TP_PER_MINUTE,
  TECH_AXES_SPECS,
  TERRAIN_MODIFIERS,
  UNIT_ORDER,
  UNIT_SPECS,
} from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
import { isCoastalProvince, totalStack } from '../engine/combat';
import { canAfford } from '../engine/economy';
import { hasIntelOnProvince } from '../engine/visibility';
import type {
  DefenseType,
  ExtractionResource,
  GameState,
  Province,
  UnitStack,
  UnitType,
} from '../engine/types';

type DrawerTab = 'orders' | 'recruit' | 'buildings';

interface ProvinceDrawerProps {
  state: GameState;
  province: Province;
  isTargetingFromHere: boolean;
  onClose: () => void;
  onUpgradeBarracks: (provinceId: string) => void;
  onUpgradeLaboratory: (provinceId: string) => void;
  onUpgradeExtraction: (provinceId: string, resource: ExtractionResource) => void;
  onUpgradeDefense: (provinceId: string, defense: DefenseType) => void;
  onRecruit: (provinceId: string, unit: UnitType, count: number) => void;
  onArmMoveOrder: (fromId: string, units: UnitStack) => void;
  onCancelMoveOrder: () => void;
  onOpenTechTree: () => void;
}

const DEFENSES: DefenseType[] = ['trenches', 'bunkers', 'aa_defense', 'naval_defense'];
const EXTRACTIONS: ExtractionResource[] = ['gold', 'steel', 'gas'];

export function ProvinceDrawer({
  state,
  province,
  isTargetingFromHere,
  onClose,
  onUpgradeBarracks,
  onUpgradeLaboratory,
  onUpgradeExtraction,
  onUpgradeDefense,
  onRecruit,
  onArmMoveOrder,
  onCancelMoveOrder,
  onOpenTechTree,
}: ProvinceDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('orders');
  const [selectedUnits, setSelectedUnits] = useState<UnitStack>(() => ({
    ...province.garrison,
  }));

  const isOwned = province.owner === state.playerNationId;
  const player = state.nations[state.playerNationId];
  const ownerTpl = NATION_TEMPLATES[province.owner];
  const intel = hasIntelOnProvince(state, province.id);
  const coastal = isCoastalProvince(province);
  const activeConstruction = state.constructions.find((c) => c.provinceId === province.id);

  const clampedSelection: UnitStack = createEmptyStack();
  for (const t of UNIT_ORDER) {
    clampedSelection[t] = Math.min(province.garrison[t], Math.max(0, selectedUnits[t] ?? 0));
  }
  const totalSelected = totalStack(clampedSelection);
  const totalGarrison = totalStack(province.garrison);

  const setGlobalPreset = (mode: 'zero' | 'half' | 'max') => {
    const next = createEmptyStack();
    for (const t of UNIT_ORDER) {
      const avail = province.garrison[t];
      if (mode === 'zero') next[t] = 0;
      else if (mode === 'max') next[t] = avail;
      else next[t] = Math.ceil(avail / 2);
    }
    setSelectedUnits(next);
  };

  const setUnitValue = (unit: UnitType, value: number) => {
    const avail = province.garrison[unit];
    setSelectedUnits((prev) => ({
      ...prev,
      [unit]: Math.max(0, Math.min(avail, value)),
    }));
  };

  return (
    <aside className="absolute bottom-3 left-3 z-20 flex max-h-[68dvh] w-[calc(100vw-1.5rem)] max-w-sm flex-col overflow-hidden rounded-lg border border-stone-700 bg-stone-950/96 text-stone-100 shadow-2xl backdrop-blur-sm font-sans">
      {/* En-tête de la province */}
      <div className="flex items-start justify-between gap-2 border-b border-stone-800 bg-stone-900/90 px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-base font-bold text-amber-100">
              {province.isCapital ? `★ ${province.name}` : province.name}
            </h2>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: ownerTpl.color }}
            >
              {ownerTpl.shortName}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-stone-400">
            {TERRAIN_MODIFIERS[province.terrain].label}
            {coastal ? ' • Littoral / Port' : ''} • Base : Or +{province.baseIncome.gold} | Acier +
            {province.baseIncome.steel} | Gaz +{province.baseIncome.gas}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Vue renseignement si la province n'appartient pas au joueur */}
      {!isOwned ? (
        <div className="overflow-y-auto p-3 space-y-2.5 text-xs">
          {!intel ? (
            <p className="rounded border border-stone-800 bg-stone-900/80 p-3 text-stone-400">
              Brouillard de guerre : approchez vos troupes ou provinces frontalières pour obtenir des
              renseignements sur cette région.
            </p>
          ) : (
            <>
              <div className="rounded border border-stone-800 bg-stone-900/70 p-2.5">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Garnison repérée ({totalGarrison})
                </p>
                {totalGarrison === 0 ? (
                  <p className="text-stone-400">Aucune troupe stationnée.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {UNIT_ORDER.filter((t) => province.garrison[t] > 0).map((t) => (
                      <div
                        key={t}
                        className="flex justify-between rounded bg-stone-950/80 px-2 py-1"
                      >
                        <span className="text-stone-300">{UNIT_SPECS[t].label}</span>
                        <span className="font-mono font-bold text-amber-200">
                          {province.garrison[t]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded border border-stone-800 bg-stone-900/70 p-2.5">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Défenses observées
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {DEFENSES.map((def) => {
                    const lvl = province.defenses[def];
                    const weak = province.activeWeaknesses.find(
                      (w) => w.defense === def && w.expiresAt > state.elapsedSeconds
                    );
                    return (
                      <div
                        key={def}
                        className="flex items-center justify-between rounded bg-stone-950/80 px-2 py-1"
                      >
                        <span className="text-stone-300">{DEFENSE_LABELS[def]}</span>
                        <span
                          className={`font-mono font-bold ${
                            weak ? 'text-red-400' : lvl > 0 ? 'text-amber-200' : 'text-stone-600'
                          }`}
                        >
                          Niv.{lvl}
                          {weak ? ' !' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Onglets de gestion de la province contrôlée */}
          <div className="grid grid-cols-3 border-b border-stone-800 bg-stone-900/60 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab('orders')}
              className={`flex items-center justify-center gap-1.5 py-2 transition ${
                tab === 'orders'
                  ? 'border-b-2 border-amber-500 bg-stone-900 text-amber-200'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Crosshair className="h-3.5 w-3.5" />
              Ordres ({totalGarrison})
            </button>
            <button
              type="button"
              onClick={() => setTab('recruit')}
              className={`flex items-center justify-center gap-1.5 py-2 transition ${
                tab === 'recruit'
                  ? 'border-b-2 border-amber-500 bg-stone-900 text-amber-200'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Caserne
            </button>
            <button
              type="button"
              onClick={() => setTab('buildings')}
              className={`flex items-center justify-center gap-1.5 py-2 transition ${
                tab === 'buildings'
                  ? 'border-b-2 border-amber-500 bg-stone-900 text-amber-200'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              Bâtiments
            </button>
          </div>

          <div className="overflow-y-auto p-3 space-y-2.5 text-xs">
            {/* ONGLET 1 : ORDRES DE DÉPLACEMENT AU CLIC (0 / 50% / Max + / -) */}
            {tab === 'orders' && (
              <>
                {totalGarrison === 0 ? (
                  <p className="rounded border border-stone-800 bg-stone-900/60 p-3 text-stone-400">
                    Aucune unité disponible ici. Formez des troupes dans l’onglet{' '}
                    <strong>Caserne</strong>.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                        Sélection rapide
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setGlobalPreset('zero')}
                          className="rounded border border-stone-700 bg-stone-900 px-2 py-0.5 text-[11px] font-bold text-stone-300 hover:bg-stone-800"
                        >
                          0
                        </button>
                        <button
                          type="button"
                          onClick={() => setGlobalPreset('half')}
                          className="rounded border border-stone-700 bg-stone-900 px-2 py-0.5 text-[11px] font-bold text-amber-200 hover:bg-stone-800"
                        >
                          50 %
                        </button>
                        <button
                          type="button"
                          onClick={() => setGlobalPreset('max')}
                          className="rounded border border-amber-600/60 bg-amber-950/60 px-2 py-0.5 text-[11px] font-bold text-amber-200 hover:bg-amber-900/60"
                        >
                          Max
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {UNIT_ORDER.filter((t) => province.garrison[t] > 0).map((unit) => {
                        const avail = province.garrison[unit];
                        const val = clampedSelection[unit];
                        return (
                          <div
                            key={unit}
                            className="flex flex-wrap items-center justify-between gap-1.5 rounded border border-stone-800 bg-stone-900/80 px-2 py-1.5"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-stone-100">
                                {UNIT_SPECS[unit].label}
                              </span>
                              <span className="ml-1.5 font-mono text-[10px] text-stone-400">
                                ({val}/{avail})
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setUnitValue(unit, 0)}
                                className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-300 hover:bg-stone-700"
                              >
                                0
                              </button>
                              <button
                                type="button"
                                onClick={() => setUnitValue(unit, Math.ceil(avail / 2))}
                                className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-stone-700"
                              >
                                50%
                              </button>
                              <button
                                type="button"
                                onClick={() => setUnitValue(unit, avail)}
                                className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-stone-700"
                              >
                                Max
                              </button>
                              <button
                                type="button"
                                onClick={() => setUnitValue(unit, val - 1)}
                                className="flex h-5 w-5 items-center justify-center rounded border border-stone-700 bg-stone-950 text-stone-200 hover:bg-stone-800"
                                title="Retirer 1"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setUnitValue(unit, val + 1)}
                                className="flex h-5 w-5 items-center justify-center rounded border border-stone-700 bg-stone-950 text-stone-200 hover:bg-stone-800"
                                title="Ajouter 1"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isTargetingFromHere ? (
                      <button
                        type="button"
                        onClick={onCancelMoveOrder}
                        className="w-full rounded border border-red-500/60 bg-red-950/70 py-2 text-xs font-bold text-red-100 hover:bg-red-900/70"
                      >
                        Annuler le ciblage sur la carte
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={totalSelected <= 0}
                        onClick={() => onArmMoveOrder(province.id, clampedSelection)}
                        className="flex w-full items-center justify-center gap-1.5 rounded bg-amber-600 py-2 font-serif text-xs font-bold text-stone-950 shadow hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
                      >
                        <Crosshair className="h-3.5 w-3.5" />
                        Cliquer la destination sur la carte ({totalSelected} unité
                        {totalSelected > 1 ? 's' : ''})
                      </button>
                    )}

                    <p className="text-[10px] leading-snug text-stone-400">
                      Trajectoire calculée automatiquement par vos provinces ou par la mer (troupes
                      terrestres vulnérables aux Frégates en mer). Appui court = ordre, maintenir &
                      glisser = caméra.
                    </p>
                  </>
                )}
              </>
            )}

            {/* ONGLET 2 : CASERNE (FORMATION DES 8 UNITÉS — VERROU TECHNO NIV. 1) */}
            {tab === 'recruit' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded border border-stone-800 bg-stone-900/70 px-2.5 py-1.5 text-[11px]">
                  <span className="text-stone-300">
                    Caserne <strong className="text-amber-200">Niv. {province.barracksLevel}/3</strong>
                  </span>
                  <span className="text-stone-400">
                    Vitesse ×{(1 + Math.max(0, province.barracksLevel - 1) * 0.35).toFixed(2)}
                  </span>
                </div>

                {UNIT_ORDER.map((unit) => {
                  const spec = UNIT_SPECS[unit];
                  const needsCoastBlocked = Boolean(spec.requiresCoastal && !coastal);
                  const techUnlocked = (player.techLevels[spec.armyTechAxis] ?? 0) >= 1;
                  const affordable = canAfford(player.resources, spec.cost);

                  return (
                    <div
                      key={unit}
                      className="rounded border border-stone-800 bg-stone-900/80 p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold text-amber-100">{spec.label}</span>
                          <span className="ml-1.5 font-mono text-[10px] text-stone-400">
                            ATQ {spec.attack} / DÉF {spec.defense}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={!techUnlocked || needsCoastBlocked || !affordable}
                          onClick={() => onRecruit(province.id, unit, 1)}
                          className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
                        >
                          {techUnlocked ? 'Former' : 'Verrouillé'}
                        </button>
                      </div>

                      <p className="text-[10px] leading-snug text-stone-400">{spec.description}</p>

                      <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-[10px] text-stone-300">
                        <span>
                          Or {spec.cost.gold} • Acier {spec.cost.steel}
                          {spec.cost.gas > 0 ? ` • Gaz ${spec.cost.gas}` : ''}
                        </span>
                        {!techUnlocked ? (
                          <button
                            type="button"
                            onClick={onOpenTechTree}
                            className="font-sans text-sky-400 hover:underline"
                          >
                            Techno « {TECH_AXES_SPECS[spec.armyTechAxis].label} » niv. 1 →
                          </button>
                        ) : needsCoastBlocked ? (
                          <span className="font-sans text-red-400">Port/côte requis</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ONGLET 3 : BÂTIMENTS (CASERNE, LABO UNIQUE, EXTRACTIONS SÉPARÉES, 4 DÉFENSES) */}
            {tab === 'buildings' && (
              <div className="space-y-3">
                {activeConstruction && (
                  <div className="rounded border border-amber-500/40 bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-200">
                    Chantier en cours : reste{' '}
                    <strong className="font-mono">
                      {Math.max(0, Math.ceil(activeConstruction.endsAt - state.elapsedSeconds))} s
                    </strong>
                  </div>
                )}

                {/* Caserne + Laboratoire unique */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    Infrastructures
                  </p>

                  {(() => {
                    const isMax = province.barracksLevel >= 3;
                    const { cost } = getBarracksCost(province.barracksLevel);
                    const ok = !isMax && !activeConstruction && canAfford(player.resources, cost);
                    return (
                      <div className="flex items-center justify-between gap-2 rounded border border-stone-800 bg-stone-900/80 p-2">
                        <div>
                          <p className="font-semibold text-amber-100">
                            Caserne (Niv. {province.barracksLevel}/3)
                          </p>
                          <p className="text-[10px] text-stone-400">
                            Accélère la vitesse de formation (peu coûteuse).
                          </p>
                          {!isMax && (
                            <p className="font-mono text-[10px] text-stone-300">
                              Or {cost.gold} • Acier {cost.steel}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={!ok}
                          onClick={() => onUpgradeBarracks(province.id)}
                          className="shrink-0 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
                        >
                          {isMax ? 'Max' : `Niv.${province.barracksLevel + 1}`}
                        </button>
                      </div>
                    );
                  })()}

                  {province.hasLaboratory &&
                    (() => {
                      const isMax = province.laboratoryLevel >= 3;
                      const { cost } = getLaboratoryCost(province.laboratoryLevel);
                      const ok =
                        !isMax && !activeConstruction && canAfford(player.resources, cost);
                      return (
                        <div className="flex items-center justify-between gap-2 rounded border border-sky-800/60 bg-sky-950/30 p-2">
                          <div>
                            <p className="flex items-center gap-1 font-semibold text-sky-200">
                              <FlaskConical className="h-3.5 w-3.5" />
                              Laboratoire Unique (Niv. {province.laboratoryLevel}/3)
                            </p>
                            <p className="text-[10px] text-stone-300">
                              Produit +{LAB_TP_PER_MINUTE[province.laboratoryLevel]} PT/min (détruit
                              si la capitale tombe).
                            </p>
                            {!isMax && (
                              <p className="font-mono text-[10px] text-sky-200">
                                Or {cost.gold} • Acier {cost.steel} • Gaz {cost.gas}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={!ok}
                            onClick={() => onUpgradeLaboratory(province.id)}
                            className="shrink-0 rounded bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-sky-400 disabled:bg-stone-800 disabled:text-stone-500"
                          >
                            {isMax ? 'Max' : `Niv.${province.laboratoryLevel + 1}`}
                          </button>
                        </div>
                      );
                    })()}
                </div>

                {/* Usines d'extraction séparées */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      Usines d’extraction séparées
                    </p>
                    <button
                      type="button"
                      onClick={onOpenTechTree}
                      className="text-[10px] text-sky-400 hover:underline"
                    >
                      Arbre Techno →
                    </button>
                  </div>

                  {EXTRACTIONS.map((res) => {
                    const cur = province.extractionFactories[res];
                    const isMax = cur >= 3;
                    const techAxis = EXTRACTION_TECH_MAP[res];
                    const techLvl = player.techLevels[techAxis];
                    const techBlocked = !isMax && techLvl < cur + 1;
                    const { cost } = getExtractionCost(res, cur);
                    const ok =
                      !isMax &&
                      !techBlocked &&
                      !activeConstruction &&
                      canAfford(player.resources, cost);

                    return (
                      <div
                        key={res}
                        className="flex items-center justify-between gap-2 rounded border border-stone-800 bg-stone-900/80 p-2"
                      >
                        <div>
                          <p className="font-semibold text-stone-100">
                            {EXTRACTION_LABELS[res]} (Niv. {cur}/3)
                          </p>
                          {techBlocked ? (
                            <p className="text-[10px] text-sky-400">
                              Requiert techno « {TECH_AXES_SPECS[techAxis].label} » niv. {cur + 1}
                            </p>
                          ) : !isMax ? (
                            <p className="font-mono text-[10px] text-stone-400">
                              Or {cost.gold} • Acier {cost.steel} • Gaz {cost.gas}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={!ok}
                          onClick={() => onUpgradeExtraction(province.id, res)}
                          className="shrink-0 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500"
                        >
                          {isMax ? 'Max' : `Niv.${cur + 1}`}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Défenses améliorables (conditionnées par la techno) */}
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    <Shield className="h-3 w-3" />
                    Défenses de province
                  </p>

                  {DEFENSES.map((def) => {
                    const cur = province.defenses[def];
                    const isMax = cur >= 3;
                    const coastBlocked = def === 'naval_defense' && !coastal;
                    const techLvl = player.techLevels[def];
                    const techBlocked = !isMax && techLvl < cur + 1;
                    const weak = province.activeWeaknesses.find(
                      (w) => w.defense === def && w.expiresAt > state.elapsedSeconds
                    );
                    const { cost } = getDefenseCost(def, cur);
                    const ok =
                      !isMax &&
                      !coastBlocked &&
                      !techBlocked &&
                      !activeConstruction &&
                      canAfford(player.resources, cost);

                    return (
                      <div
                        key={def}
                        className="flex items-center justify-between gap-2 rounded border border-stone-800 bg-stone-900/80 p-2"
                      >
                        <div>
                          <p className="font-semibold text-stone-100">
                            {DEFENSE_LABELS[def]} (Niv. {cur}/3)
                            {weak && (
                              <span className="ml-1.5 rounded bg-red-900/80 px-1 py-0.5 font-mono text-[9px] text-red-200">
                                AFFAIBLIE {Math.ceil(weak.expiresAt - state.elapsedSeconds)}s
                              </span>
                            )}
                          </p>
                          {coastBlocked ? (
                            <p className="text-[10px] text-stone-500">Province côtière requise</p>
                          ) : techBlocked ? (
                            <p className="text-[10px] text-sky-400">
                              Requiert techno « {DEFENSE_LABELS[def]} » niv. {cur + 1}
                            </p>
                          ) : !isMax ? (
                            <p className="font-mono text-[10px] text-stone-400">
                              Or {cost.gold} • Acier {cost.steel} • Gaz {cost.gas}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={!ok}
                          onClick={() => onUpgradeDefense(province.id, def)}
                          className="shrink-0 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-stone-950 hover:bg-emerald-500 disabled:bg-stone-800 disabled:text-stone-500"
                        >
                          {isMax ? 'Max' : `Niv.${cur + 1}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}