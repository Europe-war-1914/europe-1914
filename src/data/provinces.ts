import type { NationId, Province, ResourcePool, TerrainType } from '../engine/types';
import { createEmptyStack, GAME_CONFIG } from './balance';
import { MAP_HEIGHT, MAP_WIDTH, projectGeo } from './geo';

export { MAP_WIDTH, MAP_HEIGHT };

interface RawProvince {
  id: string;
  name: string;
  owner: NationId;
  lon: number;
  lat: number;
  terrain: TerrainType;
  isCapital?: boolean;
  vp?: number;
  income?: Partial<ResourcePool>;
  neighbors: string[];
  seaNeighbors?: string[];
  radius?: number;
}

const RAW_PROVINCES: RawProvince[] = [
  // --- ROYAUME-UNI (7) ---
  { id: 'uk_london', name: 'Londres', owner: 'uk', lon: -0.1, lat: 51.5, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 24, steel: 10, gas: 4 }, neighbors: ['uk_plymouth', 'uk_midlands'], seaNeighbors: ['fr_lille', 'fr_normandy', 'neu_belgium'] },
  { id: 'uk_plymouth', name: 'Cornouailles', owner: 'uk', lon: -3.8, lat: 50.6, terrain: 'coastal', income: { gold: 12, steel: 4 }, neighbors: ['uk_london', 'uk_wales', 'uk_midlands'], seaNeighbors: ['fr_normandy', 'uk_ireland'] },
  { id: 'uk_wales', name: 'Pays de Galles', owner: 'uk', lon: -3.6, lat: 52.3, terrain: 'mountain', income: { gold: 10, steel: 9 }, neighbors: ['uk_plymouth', 'uk_midlands', 'uk_york'], seaNeighbors: ['uk_ireland'] },
  { id: 'uk_midlands', name: 'Midlands', owner: 'uk', lon: -1.5, lat: 52.7, terrain: 'urban', vp: 2, income: { gold: 16, steel: 14 }, neighbors: ['uk_london', 'uk_plymouth', 'uk_wales', 'uk_york'] },
  { id: 'uk_york', name: 'Yorkshire', owner: 'uk', lon: -1.6, lat: 54.3, terrain: 'coastal', income: { gold: 14, steel: 10, gas: 5 }, neighbors: ['uk_midlands', 'uk_wales', 'uk_scotland'], seaNeighbors: ['neu_netherlands', 'neu_denmark'] },
  { id: 'uk_scotland', name: 'Écosse', owner: 'uk', lon: -4.2, lat: 56.8, terrain: 'mountain', income: { gold: 12, steel: 6, gas: 8 }, neighbors: ['uk_york'], seaNeighbors: ['uk_ireland', 'neu_denmark'], radius: 170 },
  { id: 'uk_ireland', name: 'Irlande', owner: 'uk', lon: -7.9, lat: 53.3, terrain: 'coastal', income: { gold: 12, steel: 4 }, neighbors: [], seaNeighbors: ['uk_scotland', 'uk_wales', 'uk_plymouth'], radius: 155 },

  // --- FRANCE (7) ---
  { id: 'fr_paris', name: 'Île-de-France', owner: 'france', lon: 2.3, lat: 48.8, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 24, steel: 9, gas: 4 }, neighbors: ['fr_lille', 'fr_normandy', 'fr_lorraine', 'fr_lyon', 'fr_aquitaine'] },
  { id: 'fr_lille', name: 'Picardie-Flandre', owner: 'france', lon: 2.7, lat: 50.3, terrain: 'plains', vp: 2, income: { gold: 14, steel: 12 }, neighbors: ['fr_paris', 'fr_normandy', 'fr_lorraine', 'neu_belgium'], seaNeighbors: ['uk_london'] },
  { id: 'fr_normandy', name: 'Bretagne-Normandie', owner: 'france', lon: -1.8, lat: 48.3, terrain: 'coastal', income: { gold: 13, steel: 5 }, neighbors: ['fr_paris', 'fr_lille', 'fr_aquitaine'], seaNeighbors: ['uk_london', 'uk_plymouth'], radius: 160 },
  { id: 'fr_lorraine', name: 'Lorraine-Verdun', owner: 'france', lon: 5.8, lat: 48.8, terrain: 'mountain', vp: 2, income: { gold: 13, steel: 13 }, neighbors: ['fr_paris', 'fr_lille', 'fr_lyon', 'neu_belgium', 'de_ruhr', 'de_alsace', 'neu_switzerland'] },
  { id: 'fr_aquitaine', name: 'Aquitaine', owner: 'france', lon: -0.4, lat: 44.8, terrain: 'coastal', income: { gold: 13, steel: 5, gas: 3 }, neighbors: ['fr_normandy', 'fr_paris', 'fr_lyon', 'fr_provence', 'es_bilbao', 'es_catalonia'], radius: 165 },
  { id: 'fr_lyon', name: 'Rhône-Bourgogne', owner: 'france', lon: 4.5, lat: 46.2, terrain: 'plains', income: { gold: 15, steel: 8 }, neighbors: ['fr_paris', 'fr_lorraine', 'fr_aquitaine', 'fr_provence', 'neu_switzerland', 'it_piedmont'] },
  { id: 'fr_provence', name: 'Provence', owner: 'france', lon: 5.5, lat: 43.7, terrain: 'coastal', income: { gold: 14, steel: 6, gas: 4 }, neighbors: ['fr_aquitaine', 'fr_lyon', 'it_piedmont'], seaNeighbors: ['es_catalonia', 'it_tuscany', 'it_sicily'] },

  // --- ESPAGNE (7) ---
  { id: 'es_madrid', name: 'Castille-Madrid', owner: 'spain', lon: -3.7, lat: 40.4, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 22, steel: 8, gas: 4 }, neighbors: ['es_galicia', 'es_bilbao', 'es_catalonia', 'es_valencia', 'es_andalusia', 'es_extremadura'] },
  { id: 'es_galicia', name: 'Galice-Léon', owner: 'spain', lon: -6.8, lat: 42.6, terrain: 'coastal', income: { gold: 11, steel: 7 }, neighbors: ['es_bilbao', 'es_madrid', 'es_extremadura', 'neu_portugal'], radius: 150 },
  { id: 'es_bilbao', name: 'Navarre-Bilbao', owner: 'spain', lon: -2.2, lat: 42.6, terrain: 'mountain', income: { gold: 12, steel: 13 }, neighbors: ['es_galicia', 'es_madrid', 'es_catalonia', 'fr_aquitaine'] },
  { id: 'es_catalonia', name: 'Catalogne', owner: 'spain', lon: 1.5, lat: 41.5, terrain: 'coastal', vp: 2, income: { gold: 16, steel: 10, gas: 3 }, neighbors: ['es_bilbao', 'es_madrid', 'es_valencia', 'fr_aquitaine'], seaNeighbors: ['fr_provence', 'it_tuscany'] },
  { id: 'es_valencia', name: 'Valence', owner: 'spain', lon: -0.9, lat: 39.4, terrain: 'coastal', income: { gold: 13, steel: 5, gas: 4 }, neighbors: ['es_catalonia', 'es_madrid', 'es_andalusia'] },
  { id: 'es_andalusia', name: 'Andalousie', owner: 'spain', lon: -4.8, lat: 37.4, terrain: 'coastal', income: { gold: 13, steel: 5, gas: 5 }, neighbors: ['es_madrid', 'es_valencia', 'es_extremadura', 'neu_portugal'], seaNeighbors: ['it_sicily'], radius: 150 },
  { id: 'es_extremadura', name: 'Estrémadure', owner: 'spain', lon: -6.0, lat: 39.2, terrain: 'plains', income: { gold: 10, steel: 6 }, neighbors: ['es_galicia', 'es_madrid', 'es_andalusia', 'neu_portugal'] },

  // --- EMPIRE ALLEMAND (7) ---
  { id: 'de_berlin', name: 'Brandebourg-Berlin', owner: 'germany', lon: 13.4, lat: 52.5, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 24, steel: 12, gas: 4 }, neighbors: ['de_hamburg', 'de_ruhr', 'de_bavaria', 'de_silesia', 'de_prussia', 'ah_bohemia'] },
  { id: 'de_ruhr', name: 'Rhénanie-Ruhr', owner: 'germany', lon: 7.6, lat: 51.2, terrain: 'urban', vp: 2, income: { gold: 17, steel: 18 }, neighbors: ['de_hamburg', 'de_berlin', 'de_alsace', 'de_bavaria', 'neu_netherlands', 'neu_belgium', 'fr_lorraine'] },
  { id: 'de_hamburg', name: 'Hanovre-Hambourg', owner: 'germany', lon: 9.8, lat: 53.4, terrain: 'coastal', income: { gold: 15, steel: 8, gas: 5 }, neighbors: ['de_ruhr', 'de_berlin', 'neu_netherlands', 'neu_denmark'], seaNeighbors: ['uk_york'] },
  { id: 'de_alsace', name: 'Alsace-Bade', owner: 'germany', lon: 8.1, lat: 48.6, terrain: 'mountain', income: { gold: 13, steel: 10 }, neighbors: ['de_ruhr', 'de_bavaria', 'fr_lorraine', 'neu_switzerland'] },
  { id: 'de_bavaria', name: 'Bavière', owner: 'germany', lon: 11.4, lat: 48.7, terrain: 'mountain', income: { gold: 14, steel: 9 }, neighbors: ['de_ruhr', 'de_berlin', 'de_alsace', 'ah_bohemia', 'ah_tyrol', 'neu_switzerland'] },
  { id: 'de_silesia', name: 'Silésie', owner: 'germany', lon: 16.9, lat: 51.2, terrain: 'urban', vp: 2, income: { gold: 15, steel: 16 }, neighbors: ['de_berlin', 'de_prussia', 'ah_bohemia', 'ah_galicia', 'ru_warsaw'] },
  { id: 'de_prussia', name: 'Prusse-Orientale', owner: 'germany', lon: 20.1, lat: 54.1, terrain: 'coastal', income: { gold: 13, steel: 8, gas: 3 }, neighbors: ['de_berlin', 'de_silesia', 'ru_warsaw', 'ru_baltics'], seaNeighbors: ['neu_denmark'] },

  // --- AUTRICHE-HONGRIE (7) ---
  { id: 'ah_vienna', name: 'Autriche-Vienne', owner: 'austria', lon: 16.2, lat: 48.1, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 22, steel: 11, gas: 4 }, neighbors: ['ah_bohemia', 'ah_tyrol', 'ah_budapest', 'ah_croatia', 'it_veneto'] },
  { id: 'ah_bohemia', name: 'Bohême-Prague', owner: 'austria', lon: 14.5, lat: 49.9, terrain: 'urban', vp: 2, income: { gold: 16, steel: 14 }, neighbors: ['ah_vienna', 'ah_galicia', 'de_berlin', 'de_bavaria', 'de_silesia'] },
  { id: 'ah_tyrol', name: 'Tyrol', owner: 'austria', lon: 11.8, lat: 47.0, terrain: 'mountain', income: { gold: 11, steel: 7 }, neighbors: ['ah_vienna', 'de_bavaria', 'neu_switzerland', 'it_lombardy', 'it_veneto'] },
  { id: 'ah_budapest', name: 'Hongrie-Budapest', owner: 'austria', lon: 19.3, lat: 47.3, terrain: 'plains', vp: 2, income: { gold: 16, steel: 8, gas: 4 }, neighbors: ['ah_vienna', 'ah_galicia', 'ah_transylvania', 'ah_croatia', 'neu_serbia'] },
  { id: 'ah_galicia', name: 'Galicie-Cracovie', owner: 'austria', lon: 21.8, lat: 49.8, terrain: 'plains', income: { gold: 13, steel: 9, gas: 6 }, neighbors: ['ah_bohemia', 'ah_budapest', 'ah_transylvania', 'de_silesia', 'ru_warsaw', 'ru_kiev'] },
  { id: 'ah_transylvania', name: 'Transylvanie', owner: 'austria', lon: 23.8, lat: 46.6, terrain: 'mountain', income: { gold: 12, steel: 10, gas: 5 }, neighbors: ['ah_budapest', 'ah_galicia', 'neu_romania', 'neu_serbia'] },
  { id: 'ah_croatia', name: 'Croatie-Bosnie', owner: 'austria', lon: 17.0, lat: 44.7, terrain: 'mountain', income: { gold: 12, steel: 6 }, neighbors: ['ah_vienna', 'ah_budapest', 'it_veneto', 'neu_serbia'], seaNeighbors: ['it_naples'] },

  // --- ROYAUME D'ITALIE (7) ---
  { id: 'it_rome', name: 'Latium-Rome', owner: 'italy', lon: 12.7, lat: 42.0, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 22, steel: 8, gas: 4 }, neighbors: ['it_tuscany', 'it_naples'] },
  { id: 'it_piedmont', name: 'Piémont-Turin', owner: 'italy', lon: 7.8, lat: 45.0, terrain: 'mountain', income: { gold: 14, steel: 12 }, neighbors: ['it_lombardy', 'it_tuscany', 'fr_lyon', 'fr_provence', 'neu_switzerland'] },
  { id: 'it_lombardy', name: 'Lombardie-Milan', owner: 'italy', lon: 9.7, lat: 45.5, terrain: 'urban', vp: 2, income: { gold: 17, steel: 14 }, neighbors: ['it_piedmont', 'it_veneto', 'it_tuscany', 'neu_switzerland', 'ah_tyrol'] },
  { id: 'it_veneto', name: 'Vénétie', owner: 'italy', lon: 12.2, lat: 45.7, terrain: 'coastal', income: { gold: 14, steel: 8 }, neighbors: ['it_lombardy', 'it_tuscany', 'ah_tyrol', 'ah_vienna', 'ah_croatia'] },
  { id: 'it_tuscany', name: 'Toscane', owner: 'italy', lon: 11.2, lat: 43.6, terrain: 'coastal', income: { gold: 13, steel: 6, gas: 3 }, neighbors: ['it_piedmont', 'it_lombardy', 'it_veneto', 'it_rome'], seaNeighbors: ['fr_provence', 'es_catalonia'] },
  { id: 'it_naples', name: 'Campanie-Naples', owner: 'italy', lon: 15.2, lat: 40.7, terrain: 'coastal', income: { gold: 14, steel: 6, gas: 4 }, neighbors: ['it_rome'], seaNeighbors: ['it_sicily', 'ah_croatia', 'neu_greece'] },
  { id: 'it_sicily', name: 'Sicile', owner: 'italy', lon: 14.2, lat: 37.6, terrain: 'coastal', income: { gold: 12, steel: 5, gas: 5 }, neighbors: [], seaNeighbors: ['it_naples', 'fr_provence', 'es_andalusia', 'neu_greece'], radius: 130 },

  // --- EMPIRE RUSSE (7) ---
  { id: 'ru_moscow', name: 'Moscovie', owner: 'russia', lon: 37.6, lat: 55.7, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 24, steel: 12, gas: 5 }, neighbors: ['ru_petrograd', 'ru_minsk', 'ru_kiev'], radius: 260 },
  { id: 'ru_petrograd', name: 'Petrograd', owner: 'russia', lon: 31.2, lat: 59.6, terrain: 'coastal', vp: 2, income: { gold: 18, steel: 11 }, neighbors: ['ru_baltics', 'ru_minsk', 'ru_moscow'], radius: 240 },
  { id: 'ru_warsaw', name: 'Pologne-Varsovie', owner: 'russia', lon: 21.2, lat: 52.2, terrain: 'plains', vp: 2, income: { gold: 16, steel: 10 }, neighbors: ['de_prussia', 'de_silesia', 'ah_galicia', 'ru_baltics', 'ru_minsk', 'ru_kiev'] },
  { id: 'ru_baltics', name: 'Baltique-Riga', owner: 'russia', lon: 24.8, lat: 56.9, terrain: 'coastal', income: { gold: 13, steel: 7 }, neighbors: ['de_prussia', 'ru_warsaw', 'ru_minsk', 'ru_petrograd'], seaNeighbors: ['neu_denmark'], radius: 190 },
  { id: 'ru_minsk', name: 'Biélorussie-Minsk', owner: 'russia', lon: 28.0, lat: 53.8, terrain: 'plains', income: { gold: 14, steel: 8 }, neighbors: ['ru_warsaw', 'ru_baltics', 'ru_petrograd', 'ru_moscow', 'ru_kiev'], radius: 220 },
  { id: 'ru_kiev', name: 'Ukraine-Kiev', owner: 'russia', lon: 31.0, lat: 50.2, terrain: 'plains', vp: 2, income: { gold: 17, steel: 10, gas: 5 }, neighbors: ['ah_galicia', 'ru_warsaw', 'ru_minsk', 'ru_moscow', 'ru_odessa', 'neu_romania'], radius: 240 },
  { id: 'ru_odessa', name: 'Odessa-Crimée', owner: 'russia', lon: 33.2, lat: 46.8, terrain: 'coastal', income: { gold: 14, steel: 8, gas: 8 }, neighbors: ['ru_kiev', 'neu_romania'], seaNeighbors: ['ot_constantinople', 'ot_trabzon'], radius: 220 },

  // --- EMPIRE OTTOMAN (7) ---
  { id: 'ot_constantinople', name: 'Constantinople', owner: 'ottoman', lon: 29.0, lat: 41.0, terrain: 'urban', isCapital: true, vp: 3, income: { gold: 22, steel: 10, gas: 4 }, neighbors: ['ot_thrace', 'ot_izmir', 'ot_ankara'], seaNeighbors: ['ru_odessa', 'neu_romania'] },
  { id: 'ot_thrace', name: 'Thrace', owner: 'ottoman', lon: 26.5, lat: 41.4, terrain: 'plains', income: { gold: 12, steel: 6 }, neighbors: ['ot_constantinople', 'neu_bulgaria', 'neu_greece'] },
  { id: 'ot_izmir', name: 'Smyrne', owner: 'ottoman', lon: 28.2, lat: 38.4, terrain: 'coastal', income: { gold: 14, steel: 7 }, neighbors: ['ot_constantinople', 'ot_ankara', 'ot_konya'], seaNeighbors: ['neu_greece'], radius: 165 },
  { id: 'ot_ankara', name: 'Anatolie-Ankara', owner: 'ottoman', lon: 33.0, lat: 39.9, terrain: 'mountain', vp: 2, income: { gold: 15, steel: 10, gas: 5 }, neighbors: ['ot_constantinople', 'ot_izmir', 'ot_konya', 'ot_trabzon', 'ot_erzurum'], radius: 190 },
  { id: 'ot_konya', name: 'Cilicie-Konya', owner: 'ottoman', lon: 33.5, lat: 37.3, terrain: 'mountain', income: { gold: 12, steel: 7, gas: 6 }, neighbors: ['ot_izmir', 'ot_ankara', 'ot_erzurum'], radius: 185 },
  { id: 'ot_trabzon', name: 'Trébizonde', owner: 'ottoman', lon: 38.8, lat: 40.6, terrain: 'coastal', income: { gold: 12, steel: 6, gas: 10 }, neighbors: ['ot_ankara', 'ot_erzurum'], seaNeighbors: ['ru_odessa'], radius: 190 },
  { id: 'ot_erzurum', name: 'Arménie-Erzurum', owner: 'ottoman', lon: 40.8, lat: 38.8, terrain: 'mountain', income: { gold: 11, steel: 7, gas: 11 }, neighbors: ['ot_ankara', 'ot_konya', 'ot_trabzon'], radius: 190 },

  // --- NATIONS NEUTRES STRATÉGIQUES (9) ---
  { id: 'neu_portugal', name: 'Portugal', owner: 'neutral', lon: -8.3, lat: 39.6, terrain: 'coastal', income: { gold: 13, steel: 5 }, neighbors: ['es_galicia', 'es_extremadura', 'es_andalusia'], radius: 150 },
  { id: 'neu_belgium', name: 'Belgique', owner: 'neutral', lon: 4.5, lat: 50.6, terrain: 'urban', vp: 2, income: { gold: 16, steel: 12 }, neighbors: ['fr_lille', 'fr_lorraine', 'de_ruhr', 'neu_netherlands'], seaNeighbors: ['uk_london'] },
  { id: 'neu_netherlands', name: 'Pays-Bas', owner: 'neutral', lon: 5.5, lat: 52.3, terrain: 'coastal', income: { gold: 15, steel: 6, gas: 5 }, neighbors: ['neu_belgium', 'de_ruhr', 'de_hamburg'], seaNeighbors: ['uk_york'] },
  { id: 'neu_switzerland', name: 'Suisse', owner: 'neutral', lon: 8.2, lat: 46.8, terrain: 'mountain', income: { gold: 18, steel: 6 }, neighbors: ['fr_lorraine', 'fr_lyon', 'de_alsace', 'de_bavaria', 'ah_tyrol', 'it_piedmont', 'it_lombardy'] },
  { id: 'neu_denmark', name: 'Danemark', owner: 'neutral', lon: 9.7, lat: 56.0, terrain: 'coastal', income: { gold: 14, steel: 5, gas: 5 }, neighbors: ['de_hamburg'], seaNeighbors: ['uk_york', 'uk_scotland', 'de_prussia', 'ru_baltics'], radius: 135 },
  { id: 'neu_serbia', name: 'Serbie', owner: 'neutral', lon: 20.8, lat: 43.8, terrain: 'mountain', vp: 2, income: { gold: 12, steel: 8 }, neighbors: ['ah_croatia', 'ah_budapest', 'ah_transylvania', 'neu_romania', 'neu_bulgaria', 'neu_greece'] },
  { id: 'neu_romania', name: 'Roumanie (Ploiești)', owner: 'neutral', lon: 25.6, lat: 45.0, terrain: 'plains', vp: 2, income: { gold: 14, steel: 6, gas: 16 }, neighbors: ['ah_transylvania', 'ru_kiev', 'ru_odessa', 'neu_serbia', 'neu_bulgaria'], seaNeighbors: ['ot_constantinople'] },
  { id: 'neu_bulgaria', name: 'Bulgarie', owner: 'neutral', lon: 25.2, lat: 42.7, terrain: 'mountain', income: { gold: 12, steel: 7 }, neighbors: ['neu_serbia', 'neu_romania', 'neu_greece', 'ot_thrace'] },
  { id: 'neu_greece', name: 'Grèce', owner: 'neutral', lon: 22.3, lat: 38.8, terrain: 'coastal', income: { gold: 13, steel: 5, gas: 3 }, neighbors: ['neu_serbia', 'neu_bulgaria', 'ot_thrace'], seaNeighbors: ['it_naples', 'it_sicily', 'ot_izmir'], radius: 165 },
];

// Points de séparation hors zone jouable (Afrique du Nord, Scandinavie, détroits, Moyen-Orient)
// Empêchent une province de traverser une mer ou de déborder sur les territoires hors-jeu
const BOUNDARY_ANCHORS_GEO: [number, number][] = [
  // Afrique du Nord
  [-6.0, 34.5], [-1.0, 35.0], [4.5, 36.0], [9.5, 36.4], [14.0, 34.0], [22.0, 33.0],
  // Scandinavie & Finlande (restent en parchemin hors-jeu)
  [7.0, 60.0], [12.5, 57.5], [15.5, 59.5], [18.5, 61.5], [24.5, 61.5], [27.0, 62.5],
  // Détroits maritimes (pour que chaque rive garde sa couleur)
  [-5.2, 53.5], [0.5, 50.1], [-4.5, 45.5], [9.0, 41.5], [15.5, 43.2], [25.2, 38.6],
  [33.8, 43.2], [19.0, 56.5], [3.8, 55.5], [11.5, 57.2],
  // Moyen-Orient & limite Est
  [33.0, 34.5], [37.5, 35.5], [42.5, 36.2], [44.5, 41.8], [43.5, 46.5], [44.0, 52.5], [44.5, 59.0],
];

function clipPolygonByBisector(
  poly: [number, number][],
  ax: number,
  ay: number,
  bx: number,
  by: number
): [number, number][] {
  if (poly.length === 0) return poly;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nx = bx - ax;
  const ny = by - ay;

  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const s = poly[i];
    const e = poly[(i + 1) % poly.length];
    const ds = nx * (s[0] - mx) + ny * (s[1] - my);
    const de = nx * (e[0] - mx) + ny * (e[1] - my);
    const sIn = ds <= 0;
    const eIn = de <= 0;

    if (sIn && eIn) {
      out.push(e);
    } else if (sIn && !eIn) {
      const t = ds / (ds - de);
      out.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]);
    } else if (!sIn && eIn) {
      const t = ds / (ds - de);
      out.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]);
      out.push(e);
    }
  }
  return out;
}

function buildProvincePolygon(
  cx: number,
  cy: number,
  radius: number,
  allSites: [number, number][]
): [number, number][] {
  const sides = 18;
  let poly: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    poly.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }

  for (const [sx, sy] of allSites) {
    if (sx === cx && sy === cy) continue;
    const dx = sx - cx;
    const dy = sy - cy;
    if (dx * dx + dy * dy > 520 * 520) continue;
    poly = clipPolygonByBisector(poly, cx, cy, sx, sy);
    if (poly.length < 3) break;
  }

  return poly;
}

export function createInitialProvinces(): Record<string, Province> {
  const projectedCenters = RAW_PROVINCES.map((p) => projectGeo(p.lon, p.lat));
  const projectedAnchors = BOUNDARY_ANCHORS_GEO.map(([lon, lat]) => projectGeo(lon, lat));
  const allSites: [number, number][] = [...projectedCenters, ...projectedAnchors];

  const provinces: Record<string, Province> = {};

  RAW_PROVINCES.forEach((raw, idx) => {
    const [cx, cy] = projectedCenters[idx];
    const garrison = createEmptyStack();

    if (raw.owner === 'neutral') {
      garrison.soldier = GAME_CONFIG.startingGarrisonNeutral.soldier;
      garrison.scout = GAME_CONFIG.startingGarrisonNeutral.scout;
    } else if (raw.isCapital) {
      garrison.soldier = GAME_CONFIG.startingGarrisonCapital.soldier;
      garrison.scout = GAME_CONFIG.startingGarrisonCapital.scout;
    } else {
      garrison.soldier = GAME_CONFIG.startingGarrisonProvince.soldier;
      garrison.scout = GAME_CONFIG.startingGarrisonProvince.scout;
    }

    const hasLab = Boolean(raw.isCapital && raw.owner !== 'neutral');

    provinces[raw.id] = {
      id: raw.id,
      name: raw.name,
      owner: raw.owner,
      isCapital: Boolean(raw.isCapital),
      victoryPoints: raw.vp ?? 1,
      terrain: raw.terrain,
      center: [cx, cy],
      polygon: buildProvincePolygon(cx, cy, raw.radius ?? 145, allSites),
      neighbors: [...raw.neighbors],
      seaNeighbors: [...(raw.seaNeighbors ?? [])],
      baseIncome: {
        gold: raw.income?.gold ?? 12,
        steel: raw.income?.steel ?? 6,
        gas: raw.income?.gas ?? 2,
      },
      // 1 seul laboratoire par nation, déjà installé au niveau 1 dans la capitale
      hasLaboratory: hasLab,
      laboratoryLevel: hasLab ? 1 : 0,
      barracksLevel: 1,
      extractionFactories: {
        gold: raw.isCapital ? 1 : 0,
        steel: raw.isCapital ? 1 : 0,
        gas: raw.isCapital ? 1 : 0,
      },
      defenses: {
        trenches: 0,
        aa_defense: 0,
        bunkers: 0,
        naval_defense: 0,
      },
      activeWeaknesses: [],
      garrison,
    };
  });

  // Garantit la symétrie des liaisons terrestres et maritimes
  for (const prov of Object.values(provinces)) {
    for (const nId of prov.neighbors) {
      const target = provinces[nId];
      if (target && !target.neighbors.includes(prov.id)) {
        target.neighbors.push(prov.id);
      }
    }
    for (const sId of prov.seaNeighbors) {
      const target = provinces[sId];
      if (target && !target.seaNeighbors.includes(prov.id)) {
        target.seaNeighbors.push(prov.id);
      }
    }
  }

  return provinces;
}