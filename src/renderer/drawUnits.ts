import type { NationId, UnitStack, UnitType } from '../engine/types';
import { NATION_TEMPLATES } from '../data/nations';

export interface UnitTokenOptions {
  x: number;
  y: number;
  owner: NationId;
  units: UnitStack;
  /** 1 = regarde à droite, -1 = regarde à gauche */
  facing?: 1 | -1;
  isMoving?: boolean;
  isNaval?: boolean;
  isCapital?: boolean;
  isEnemyWarning?: boolean;
  morale?: number;
  timeSec?: number;
  scale?: number;
}

export function getDominantUnitType(units: UnitStack, isNaval = false): UnitType {
  if (isNaval || units.battleship > 0) return 'battleship';
  if (units.tank > 0) return 'tank';
  if (units.artillery > 0) return 'artillery';
  return 'infantry';
}

function getStackTotal(units: UnitStack): number {
  return units.infantry + units.tank + units.artillery + units.battleship;
}

/** Petit drapeau 1914 flottant au-dessus de l'unité */
function drawNationFlag(
  ctx: CanvasRenderingContext2D,
  owner: NationId,
  x: number,
  y: number,
  timeSec: number
) {
  const w = 13;
  const h = 8.5;
  const wave = Math.sin(timeSec * 5 + x * 0.05) * 0.9;

  ctx.save();
  ctx.translate(x, y);

  // Hampe
  ctx.strokeStyle = '#d6c7a1';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.lineTo(0, -h - 1);
  ctx.stroke();

  // Tissu du drapeau
  ctx.translate(0.6, -h - 0.5);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  switch (owner) {
    case 'france':
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(0, 0, w / 3, h);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 'germany':
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 'uk':
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      break;
    case 'italy':
      ctx.fillStyle = '#15803d';
      ctx.fillRect(0, 0, w / 3, h);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 'austria':
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(0, h / 2, w, h / 2);
      break;
    case 'russia':
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, w, h / 3);
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 'spain':
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(0, 0, w, h * 0.28);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, h * 0.28, w, h * 0.44);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      break;
    case 'ottoman':
      ctx.fillStyle = '#991b1b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(w * 0.42, h * 0.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#991b1b';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, 1.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = NATION_TEMPLATES[owner].color;
      ctx.fillRect(0, 0, w, h);
      break;
  }

  // Ombre légère de pliure
  ctx.fillStyle = `rgba(0, 0, 0, ${0.14 + wave * 0.05})`;
  ctx.fillRect(w * 0.55, 0, w * 0.25, h);

  ctx.restore();

  // Contour net du drapeau
  ctx.save();
  ctx.translate(x + 0.6, y - h - 0.5);
  ctx.strokeStyle = 'rgba(20, 16, 12, 0.85)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}

/** Silhouette d'une escouade d'infanterie 1914 (3 soldats + baïonnettes) */
function drawInfantrySilhouette(
  ctx: CanvasRenderingContext2D,
  coatColor: string,
  accentColor: string,
  bob: number
) {
  const offsets = [
    { dx: -7.5, dy: -1.5, s: 0.88 },
    { dx: 6.5, dy: -1.2, s: 0.88 },
    { dx: -0.5, dy: 0.5, s: 1.0 },
  ];

  for (const o of offsets) {
    ctx.save();
    ctx.translate(o.dx, o.dy + bob * (o.dx === -0.5 ? 1 : -0.7));
    ctx.scale(o.s, o.s);

    // Jambes
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(-1.5, -1);
    ctx.lineTo(-2.3, 4.5);
    ctx.moveTo(1.5, -1);
    ctx.lineTo(2.4, 4.5);
    ctx.stroke();

    // Manteau / uniforme
    ctx.fillStyle = coatColor;
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-3.4, -7);
    ctx.lineTo(3.4, -7);
    ctx.lineTo(4.2, 0.5);
    ctx.lineTo(-4.2, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Buffleterie / ceinturon
    ctx.strokeStyle = '#d6c7a1';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-3.5, -2.2);
    ctx.lineTo(3.5, -2.2);
    ctx.stroke();

    // Tête + casque Adrian / Stahlhelm
    ctx.fillStyle = '#e7c6a5';
    ctx.beginPath();
    ctx.arc(0, -9.2, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = accentColor;
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, -9.8, 2.7, Math.PI, 0);
    ctx.lineTo(3.5, -9.4);
    ctx.lineTo(-3.5, -9.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fusil + baïonnette pointée vers l'avant (droite)
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-1.5, -3.5);
    ctx.lineTo(7.5, -9.5);
    ctx.stroke();

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(7.3, -9.4);
    ctx.lineTo(10.2, -11.3);
    ctx.stroke();

    ctx.restore();
  }
}

/** Silhouette de char d'assaut 1914 (chenilles, tourelle, canon) */
function drawTankSilhouette(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  accentColor: string,
  bob: number
) {
  ctx.save();
  ctx.translate(0, bob * 0.4);

  // Chenilles
  ctx.fillStyle = '#27272a';
  ctx.strokeStyle = '#09090b';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-12, -2.5, 24, 6.5, 3);
  ctx.fill();
  ctx.stroke();

  // Galets de chenilles
  ctx.fillStyle = '#71717a';
  for (let wx = -8.5; wx <= 8.5; wx += 4.25) {
    ctx.beginPath();
    ctx.arc(wx, 0.8, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Coque blindée
  ctx.fillStyle = hullColor;
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-11, -2);
  ctx.lineTo(-8, -7.5);
  ctx.lineTo(9, -7.5);
  ctx.lineTo(12.5, -2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tourelle
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.roundRect(-5, -12, 10, 5, 1.5);
  ctx.fill();
  ctx.stroke();

  // Canon long vers la droite
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(4.5, -9.5);
  ctx.lineTo(15.5, -10.5);
  ctx.stroke();

  ctx.strokeStyle = '#d4d4d8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(5, -9.8);
  ctx.lineTo(15, -10.7);
  ctx.stroke();

  ctx.restore();
}

/** Silhouette de canon d'artillerie lourde 1914 */
function drawArtillerySilhouette(
  ctx: CanvasRenderingContext2D,
  color: string,
  accentColor: string
) {
  ctx.save();

  // Flèche d'affût vers l'arrière (gauche)
  ctx.strokeStyle = '#292524';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-12, 3.2);
  ctx.lineTo(0, -1.5);
  ctx.stroke();

  // Tube du canon pointé en cloche vers la droite
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-2, -3.5);
  ctx.lineTo(13.5, -11.5);
  ctx.stroke();

  ctx.strokeStyle = '#a8a29e';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-1, -4);
  ctx.lineTo(13, -11.2);
  ctx.stroke();

  // Bouclier blindé
  ctx.fillStyle = color;
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1, -10);
  ctx.lineTo(4.8, -9);
  ctx.lineTo(3.8, 0.5);
  ctx.lineTo(0, 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Grande roue à rayons
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 4.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#18181b';
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Silhouette de cuirassé Dreadnought 1914 */
function drawBattleshipSilhouette(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  timeSec: number,
  isMoving: boolean
) {
  const pitch = Math.sin(timeSec * 3.2) * 0.6;
  ctx.save();
  ctx.translate(0, pitch);

  // Sillage d'écume sous la coque
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-15, 4.2);
  ctx.quadraticCurveTo(0, 5.5, 16, 3.8);
  ctx.stroke();

  // Coque blindée
  ctx.fillStyle = '#475569';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-14, -1.5);
  ctx.lineTo(14.5, -2.2);
  ctx.lineTo(17.5, -4);
  ctx.lineTo(12.5, 3.5);
  ctx.lineTo(-12.5, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Bande de couleur de la nation
  ctx.fillStyle = hullColor;
  ctx.fillRect(-11, -1.2, 22, 1.8);

  // Superstructure + 2 cheminées
  ctx.fillStyle = '#64748b';
  ctx.fillRect(-5, -6.5, 10, 5);
  ctx.strokeRect(-5, -6.5, 10, 5);

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-3.5, -10.5, 2.3, 4.2);
  ctx.fillRect(1.2, -10.5, 2.3, 4.2);

  // Tourelles avant / arrière
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, -3.8);
  ctx.lineTo(14, -5.2);
  ctx.moveTo(-8, -3.5);
  ctx.lineTo(-13.5, -4.6);
  ctx.stroke();

  // Légère fumée des cheminées en mouvement
  if (isMoving) {
    ctx.fillStyle = 'rgba(203, 213, 225, 0.45)';
    const drift = (timeSec * 12) % 8;
    ctx.beginPath();
    ctx.arc(-4 - drift * 0.6, -12.5 - drift * 0.35, 2.2, 0, Math.PI * 2);
    ctx.arc(-0.5 - drift * 0.5, -13.5 - drift * 0.25, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Dessine une unité 1914 complète (ombre, silhouette, drapeau, socle compteur et barre) */
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
    isCapital = false,
    isEnemyWarning = false,
    morale = 100,
    timeSec = 0,
    scale = 1,
  } = opts;

  const tpl = NATION_TEMPLATES[owner];
  const dominant = getDominantUnitType(units, isNaval);
  const bob = isMoving ? Math.sin(timeSec * 9 + x * 0.1) * 1.1 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // 1. Ombre portée au sol
  ctx.fillStyle = isEnemyWarning ? 'rgba(239, 68, 68, 0.35)' : 'rgba(12, 10, 9, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 4.5, isEnemyWarning ? 17 : 14.5, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isEnemyWarning) {
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // 2. Silhouette militaire orientée
  ctx.save();
  ctx.scale(facing, 1);
  if (dominant === 'battleship') {
    drawBattleshipSilhouette(ctx, tpl.color, timeSec, isMoving);
  } else if (dominant === 'tank') {
    drawTankSilhouette(ctx, tpl.color, tpl.borderColor, bob);
  } else if (dominant === 'artillery') {
    drawArtillerySilhouette(ctx, tpl.color, tpl.borderColor);
  } else {
    drawInfantrySilhouette(ctx, tpl.color, tpl.borderColor, bob);
  }
  ctx.restore();

  // 3. Drapeau national
  drawNationFlag(ctx, owner, -11, -10.5, timeSec);

  // 4. Plaquette tactique de compteur sous l'unité
  const label = String(total);
  const badgeW = Math.max(22, label.length * 7 + 12);
  const badgeH = 13;
  const badgeY = 5.5;

  ctx.fillStyle = 'rgba(20, 18, 16, 0.92)';
  ctx.strokeStyle = isCapital ? '#facc15' : isEnemyWarning ? '#f87171' : '#d6c7a1';
  ctx.lineWidth = isCapital ? 1.4 : 1;
  ctx.beginPath();
  ctx.roundRect(-badgeW / 2, badgeY, badgeW, badgeH, 3);
  ctx.fill();
  ctx.stroke();

  // Bande couleur de la nation à gauche de la plaquette
  ctx.fillStyle = tpl.color;
  ctx.beginPath();
  ctx.roundRect(-badgeW / 2 + 1, badgeY + 1, 4, badgeH - 2, 1.5);
  ctx.fill();

  // Effectif total
  ctx.fillStyle = '#fefce8';
  ctx.font = 'bold 9.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 2, badgeY + badgeH / 2 + 0.5);

  // Barre de moral / cohésion fine sous la plaquette
  const barW = badgeW - 2;
  const ratio = Math.max(0.15, Math.min(1, morale / 100));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(-barW / 2, badgeY + badgeH + 1.5, barW, 2.2);
  ctx.fillStyle = ratio > 0.6 ? '#4ade80' : ratio > 0.35 ? '#facc15' : '#f87171';
  ctx.fillRect(-barW / 2, badgeY + badgeH + 1.5, barW * ratio, 2.2);

  ctx.restore();
}

/** Marqueur de brouillard de guerre (?) pour les régions sans renseignement */
export function drawFogUnknownToken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  owner: NationId
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(24, 21, 18, 0.78)';
  ctx.strokeStyle = NATION_TEMPLATES[owner].borderColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-10, -8, 20, 16, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#d6c7a1';
  ctx.font = 'bold 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 0.5);

  ctx.restore();
}