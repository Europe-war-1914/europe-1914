import { NATION_TEMPLATES } from '../data/nations';
import { UNIT_ORDER } from '../data/balance';
import type { NationId, UnitStack, UnitType } from '../engine/types';

export interface UnitTokenOptions {
  x: number;
  y: number;
  owner: NationId;
  units: UnitStack;
  facing?: 1 | -1;
  isMoving?: boolean;
  isNaval?: boolean;
  isAir?: boolean;
  isSubmarine?: boolean;
  isReturning?: boolean;
  isCapital?: boolean;
  isEnemyWarning?: boolean;
  landingSecondsLeft?: number;
  timeSec?: number;
  scale?: number;
}

export function getDominantUnitType(
  units: UnitStack,
  isNaval = false,
  isAir = false,
  isSubmarine = false
): UnitType {
  if (isSubmarine || (isNaval && units.submarine > 0 && units.frigate === 0)) return 'submarine';
  if (isNaval || units.frigate > 0) return 'frigate';
  if (isAir || units.bomber > 0 || units.fighter > 0) {
    return units.bomber >= units.fighter && units.bomber > 0 ? 'bomber' : 'fighter';
  }
  if (units.heavy_tank > 0) return 'heavy_tank';
  if (units.light_tank > 0) return 'light_tank';
  if (units.soldier > 0) return 'soldier';
  return 'scout';
}

function getStackTotal(units: UnitStack): number {
  let total = 0;
  for (const t of UNIT_ORDER) total += units[t] ?? 0;
  return total;
}

/** Fanion national historique 1914 aux teintes patinées */
function drawNationFlag(
  ctx: CanvasRenderingContext2D,
  owner: NationId,
  x: number,
  y: number,
  timeSec: number
) {
  const w = 12;
  const h = 7.8;
  const wave = Math.sin(timeSec * 4.2 + x * 0.04) * 0.7;

  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = '#9e9278';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0, 4.5);
  ctx.lineTo(0, -h - 1);
  ctx.stroke();

  ctx.translate(0.6, -h - 0.5);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  switch (owner) {
    case 'france':
      ctx.fillStyle = '#1e3a6e';
      ctx.fillRect(0, 0, w / 3, h);
      ctx.fillStyle = '#e5e0d5';
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = '#992424';
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 'germany':
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#e5e0d5';
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#992424';
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 'uk':
      ctx.fillStyle = '#172d5e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e5e0d5';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.strokeStyle = '#992424';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      break;
    case 'italy':
      ctx.fillStyle = '#1e5432';
      ctx.fillRect(0, 0, w / 3, h);
      ctx.fillStyle = '#e5e0d5';
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = '#992424';
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 'austria':
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#b89228';
      ctx.fillRect(0, h / 2, w, h / 2);
      break;
    case 'russia':
      ctx.fillStyle = '#e5e0d5';
      ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#1e3a6e';
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#992424';
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 'spain':
      ctx.fillStyle = '#8c1d1d';
      ctx.fillRect(0, 0, w, h * 0.28);
      ctx.fillStyle = '#c49b2b';
      ctx.fillRect(0, h * 0.28, w, h * 0.44);
      ctx.fillStyle = '#8c1d1d';
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      break;
    case 'ottoman':
      ctx.fillStyle = '#7d1b1b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e5e0d5';
      ctx.beginPath();
      ctx.arc(w * 0.42, h * 0.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7d1b1b';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, 1.75, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = NATION_TEMPLATES[owner].color;
      ctx.fillRect(0, 0, w, h);
      break;
  }

  ctx.fillStyle = `rgba(0, 0, 0, ${0.18 + wave * 0.04})`;
  ctx.fillRect(w * 0.55, 0, w * 0.25, h);
  ctx.restore();

  ctx.save();
  ctx.translate(x + 0.6, y - h - 0.5);
  ctx.strokeStyle = 'rgba(12, 10, 8, 0.9)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}

/** 1. Soldat : escouade d'infanterie de ligne 1914 (casques + fusils à baïonnette) */
function drawSoldierSilhouette(
  ctx: CanvasRenderingContext2D,
  coatColor: string,
  accentColor: string,
  bob: number
) {
  const offsets = [
    { dx: -6.5, dy: -1.2, s: 0.86 },
    { dx: 5.8, dy: -1.0, s: 0.86 },
    { dx: -0.4, dy: 0.6, s: 0.98 },
  ];

  for (const o of offsets) {
    ctx.save();
    ctx.translate(o.dx, o.dy + bob * (o.dx < 0 ? 0.8 : -0.7));
    ctx.scale(o.s, o.s);

    ctx.strokeStyle = '#181614';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-1.4, -0.5);
    ctx.lineTo(-2.1, 4.2);
    ctx.moveTo(1.4, -0.5);
    ctx.lineTo(2.2, 4.2);
    ctx.stroke();

    ctx.fillStyle = coatColor;
    ctx.strokeStyle = '#141312';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(-3.0, -6.8);
    ctx.lineTo(3.0, -6.8);
    ctx.lineTo(3.8, 0.4);
    ctx.lineTo(-3.8, 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#332e2a';
    ctx.fillRect(-3.1, -2.5, 6.2, 1.1);

    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(0, -9.2, 2.4, Math.PI, 0);
    ctx.lineTo(3.2, -8.8);
    ctx.lineTo(-3.2, -8.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#3b352f';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(-1.2, -3.5);
    ctx.lineTo(6.8, -9.0);
    ctx.stroke();

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(6.6, -8.9);
    ctx.lineTo(9.4, -10.7);
    ctx.stroke();

    ctx.restore();
  }
}

/** 2. Éclaireur : unité légère de reconnaissance (chevron tactique + silhouette fine) */
function drawScoutSilhouette(
  ctx: CanvasRenderingContext2D,
  coatColor: string,
  accentColor: string,
  bob: number
) {
  ctx.save();
  ctx.translate(0, bob * 0.7);

  // Silhouette penchée en course de reconnaissance
  ctx.strokeStyle = '#181614';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.lineTo(-5, 4.2);
  ctx.moveTo(1.5, 0);
  ctx.lineTo(5.2, 3.8);
  ctx.stroke();

  ctx.fillStyle = coatColor;
  ctx.strokeStyle = '#141312';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-3.5, -6.5);
  ctx.lineTo(2.5, -7.2);
  ctx.lineTo(4.2, -0.2);
  ctx.lineTo(-2.5, 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Casque léger
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(1.2, -9.3, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Carabine courte horizontale
  ctx.strokeStyle = '#292524';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-1, -4);
  ctx.lineTo(9.5, -5.5);
  ctx.stroke();

  // Ligne de visée / jumelles
  ctx.strokeStyle = 'rgba(214, 199, 161, 0.75)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(4.5, -9.2);
  ctx.lineTo(9.2, -9.2);
  ctx.stroke();

  ctx.restore();
}

/** 3. Blindé léger : silhouette type Renault FT-17 */
function drawLightTankSilhouette(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  accentColor: string,
  bob: number
) {
  ctx.save();
  ctx.translate(0, bob * 0.35);

  ctx.fillStyle = '#242426';
  ctx.strokeStyle = '#0c0a09';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-9.5, -1.8, 19, 5.2, 2.4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hullColor;
  ctx.beginPath();
  ctx.moveTo(-8.5, -1.6);
  ctx.lineTo(-5.5, -6.2);
  ctx.lineTo(6.5, -6.2);
  ctx.lineTo(10, -1.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.roundRect(-3.8, -10.2, 7.6, 4.4, 1.5);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#141312';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(3.6, -8.2);
  ctx.lineTo(12.2, -8.7);
  ctx.stroke();

  ctx.restore();
}

/** 4. Blindé lourd : silhouette rhomboïde massive type Mark IV / A7V */
function drawHeavyTankSilhouette(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  accentColor: string,
  bob: number
) {
  ctx.save();
  ctx.translate(0, bob * 0.25);

  // Chenilles enveloppantes massives
  ctx.fillStyle = '#1f2023';
  ctx.strokeStyle = '#09090b';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-13.5, 1.2);
  ctx.lineTo(-9.5, -6.8);
  ctx.lineTo(9.5, -7.8);
  ctx.lineTo(14.2, -1.2);
  ctx.lineTo(11.5, 4.0);
  ctx.lineTo(-11.5, 4.0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Blindage latéral & casemate
  ctx.fillStyle = hullColor;
  ctx.beginPath();
  ctx.moveTo(-10.5, 1.4);
  ctx.lineTo(-7.8, -5.0);
  ctx.lineTo(7.8, -5.6);
  ctx.lineTo(11.2, -0.5);
  ctx.lineTo(9.2, 2.2);
  ctx.lineTo(-9.2, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Coupole supérieure
  ctx.fillStyle = accentColor;
  ctx.fillRect(-4.5, -10.2, 9, 4.2);
  ctx.strokeRect(-4.5, -10.2, 9, 4.2);

  // Double canon lourd
  ctx.strokeStyle = '#0c0a09';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(4.2, -7.8);
  ctx.lineTo(16.5, -8.6);
  ctx.moveTo(6.5, -2.5);
  ctx.lineTo(15.2, -2.8);
  ctx.stroke();

  ctx.restore();
}

/** 5. Chasseur : biplan de chasse 1914 (vue tactique de profil/trois-quarts) */
function drawFighterSilhouette(
  ctx: CanvasRenderingContext2D,
  wingColor: string,
  accentColor: string,
  timeSec: number
) {
  const hover = Math.sin(timeSec * 6.5) * 1.1;
  ctx.save();
  ctx.translate(0, -6 + hover);

  // Fuselage effilé
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-11, -0.6);
  ctx.lineTo(10, -1.8);
  ctx.lineTo(11.5, 0);
  ctx.lineTo(10, 1.8);
  ctx.lineTo(-11, 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Empennage arrière
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.moveTo(-11, -4.5);
  ctx.lineTo(-7.2, -4.2);
  ctx.lineTo(-7.2, 4.2);
  ctx.lineTo(-11, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Ailes biplan droites
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.roundRect(-1.5, -11, 5.2, 22, 1.5);
  ctx.fill();
  ctx.stroke();

  // Cocardes sobres
  ctx.fillStyle = '#d6c7a1';
  ctx.beginPath();
  ctx.arc(1.1, -6.8, 1.4, 0, Math.PI * 2);
  ctx.arc(1.1, 6.8, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** 6. Bombardier : gros bimoteur stratégique 1914 (Gotha / Handley Page) */
function drawBomberSilhouette(
  ctx: CanvasRenderingContext2D,
  wingColor: string,
  accentColor: string,
  timeSec: number
) {
  const hover = Math.sin(timeSec * 4.5) * 0.9;
  ctx.save();
  ctx.translate(0, -6.5 + hover);

  // Fuselage lourd
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = '#0c0a09';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-12.5, -2.2, 24.5, 4.4, 1.8);
  ctx.fill();
  ctx.stroke();

  // Grande envergure
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.roundRect(-2.5, -14.5, 6.8, 29, 1.8);
  ctx.fill();
  ctx.stroke();

  // Nacelles bimoteurs
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(1.2, -7.8, 4.5, 2.4);
  ctx.fillRect(1.2, 5.4, 4.5, 2.4);

  // Double gouvernail
  ctx.fillStyle = wingColor;
  ctx.fillRect(-13, -5.8, 3.6, 11.6);
  ctx.strokeRect(-13, -5.8, 3.6, 11.6);

  ctx.restore();
}

/** 7. Sous-marin : U-Boot 1914 avec kiosque et périscope */
function drawSubmarineSilhouette(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  timeSec: number
) {
  const bob = Math.sin(timeSec * 2.8) * 0.5;
  ctx.save();
  ctx.translate(0, bob);

  // Remous sombre à fleur d'eau
  ctx.strokeStyle = 'rgba(186, 210, 224, 0.48)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-15, 3.2);
  ctx.quadraticCurveTo(0, 4.5, 15, 3.2);
  ctx.stroke();

  // Coque basse fuselée
  ctx.fillStyle = '#2d3740';
  ctx.strokeStyle = '#0b1014';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-14.5, 1.8);
  ctx.quadraticCurveTo(-11, -2.5, 0, -2.5);
  ctx.quadraticCurveTo(11, -2.5, 14.8, 1.8);
  ctx.lineTo(12.5, 3.2);
  ctx.lineTo(-12.5, 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Liseré national discret
  ctx.fillStyle = hullColor;
  ctx.fillRect(-8, -0.4, 16, 1.5);

  // Kiosque (conning tower) + périscope
  ctx.fillStyle = '#3f4b56';
  ctx.fillRect(-3.2, -7.2, 6.4, 5.0);
  ctx.strokeRect(-3.2, -7.2, 6.4, 5.0);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0.8, -7.2);
  ctx.lineTo(0.8, -11.4);
  ctx.lineTo(3.2, -11.4);
  ctx.stroke();

  ctx.restore();
}

/** 8. Frégate : navire de guerre blindé escorte & anti-sous-marin */
function drawFrigateSilhouette(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  timeSec: number,
  isMoving: boolean
) {
  const pitch = Math.sin(timeSec * 3.0) * 0.55;
  ctx.save();
  ctx.translate(0, pitch);

  ctx.strokeStyle = 'rgba(203, 222, 235, 0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-15, 4.0);
  ctx.quadraticCurveTo(0, 5.2, 16, 3.6);
  ctx.stroke();

  ctx.fillStyle = '#3b4754';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-14, -1.5);
  ctx.lineTo(14.5, -2.2);
  ctx.lineTo(17.5, -3.8);
  ctx.lineTo(12.5, 3.4);
  ctx.lineTo(-12.5, 3.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hullColor;
  ctx.fillRect(-10.5, -1.1, 21, 1.7);

  ctx.fillStyle = '#52606d';
  ctx.fillRect(-5, -6.4, 10, 4.9);
  ctx.strokeRect(-5, -6.4, 10, 4.9);

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-3.4, -10.5, 2.2, 4.2);
  ctx.fillRect(1.2, -10.5, 2.2, 4.2);

  // Tourelles
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, -3.6);
  ctx.lineTo(14.5, -5.0);
  ctx.moveTo(-8, -3.4);
  ctx.lineTo(-13.5, -4.4);
  ctx.stroke();

  if (isMoving) {
    ctx.fillStyle = 'rgba(180, 190, 200, 0.36)';
    const drift = (timeSec * 10) % 8;
    ctx.beginPath();
    ctx.arc(-4 - drift * 0.6, -12.4 - drift * 0.3, 2.0, 0, Math.PI * 2);
    ctx.arc(-0.5 - drift * 0.5, -13.2 - drift * 0.25, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Dessine un pion d'armée réaliste 1914 (sans barre de moral) */
export function drawUnitToken(ctx: CanvasRenderingContext2D, opts: UnitTokenOptions) {
  const total = getStackTotal(opts.units);
  if (total <= 0) return;

  const {
    x,
    y,
    owner,
    units,
    facing = 1,
    isMoving = false,
    isNaval = false,
    isAir = false,
    isSubmarine = false,
    isReturning = false,
    isCapital = false,
    isEnemyWarning = false,
    landingSecondsLeft,
    timeSec = 0,
    scale = 1,
  } = opts;

  const tpl = NATION_TEMPLATES[owner];
  const dominant = getDominantUnitType(units, isNaval, isAir, isSubmarine);
  const bob = isMoving ? Math.sin(timeSec * 8 + x * 0.1) * 0.9 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Sous-marin furtif : légère transparence + halo sonar discret
  if (isSubmarine && landingSecondsLeft === undefined) {
    ctx.globalAlpha = 0.84;
  }

  // 1. Ombre portée au sol
  ctx.fillStyle = isEnemyWarning ? 'rgba(185, 28, 28, 0.35)' : 'rgba(10, 9, 8, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 4.5, isEnemyWarning ? 16 : 13.5, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isEnemyWarning || landingSecondsLeft !== undefined) {
    const pulse = 0.65 + 0.35 * Math.sin(timeSec * 8);
    ctx.strokeStyle =
      landingSecondsLeft !== undefined
        ? `rgba(239, 68, 68, ${pulse})`
        : 'rgba(220, 38, 38, 0.85)';
    ctx.lineWidth = landingSecondsLeft !== undefined ? 2.2 : 1.5;
    ctx.stroke();
  }

  // 2. Silhouette militaire orientée
  ctx.save();
  ctx.scale(facing, 1);
  switch (dominant) {
    case 'submarine':
      drawSubmarineSilhouette(ctx, tpl.color, timeSec);
      break;
    case 'frigate':
      drawFrigateSilhouette(ctx, tpl.color, timeSec, isMoving);
      break;
    case 'bomber':
      drawBomberSilhouette(ctx, tpl.color, tpl.borderColor, timeSec);
      break;
    case 'fighter':
      drawFighterSilhouette(ctx, tpl.color, tpl.borderColor, timeSec);
      break;
    case 'heavy_tank':
      drawHeavyTankSilhouette(ctx, tpl.color, tpl.borderColor, bob);
      break;
    case 'light_tank':
      drawLightTankSilhouette(ctx, tpl.color, tpl.borderColor, bob);
      break;
    case 'scout':
      drawScoutSilhouette(ctx, tpl.color, tpl.borderColor, bob);
      break;
    default:
      drawSoldierSilhouette(ctx, tpl.color, tpl.borderColor, bob);
      break;
  }
  ctx.restore();

  // 3. Fanion national
  drawNationFlag(ctx, owner, -11, -10.5, timeSec);

  // 4. Plaquette tactique de compteur sobre (laiton / acier)
  const label = isReturning ? `↩${total}` : String(total);
  const badgeW = Math.max(22, label.length * 6.5 + 12);
  const badgeH = 13;
  const badgeY = 5.5;

  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(18, 17, 15, 0.94)';
  ctx.strokeStyle = isCapital ? '#d4af37' : isEnemyWarning ? '#dc2626' : '#a89f8c';
  ctx.lineWidth = isCapital ? 1.4 : 1;
  ctx.beginPath();
  ctx.roundRect(-badgeW / 2, badgeY, badgeW, badgeH, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = tpl.color;
  ctx.fillRect(-badgeW / 2 + 1.5, badgeY + 1.5, 3.8, badgeH - 3);

  ctx.fillStyle = '#f3efe6';
  ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 2, badgeY + badgeH / 2 + 0.5);

  // Alerte visuelle débarquement sous-marin (10 secondes)
  if (landingSecondsLeft !== undefined && landingSecondsLeft > 0) {
    const alertText = `DÉBARQ. ${Math.ceil(landingSecondsLeft)}s`;
    ctx.fillStyle = 'rgba(127, 29, 29, 0.95)';
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-34, -27, 68, 13, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fef2f2';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.fillText(alertText, 0, -20.2);
  }

  ctx.restore();
}

/** Marqueur sobre de brouillard de guerre (?) */
export function drawFogUnknownToken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  owner: NationId
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(20, 19, 17, 0.8)';
  ctx.strokeStyle = NATION_TEMPLATES[owner].borderColor;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-9, -7.5, 18, 15, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#b8ae99';
  ctx.font = 'bold 9.5px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 0.5);

  ctx.restore();
}