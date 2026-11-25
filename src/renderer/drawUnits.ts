import { UNIT_ORDER } from '../data/balance';
import { NATION_TEMPLATES } from '../data/nations';
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
  isSelected?: boolean;
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

/** Fanion militaire 1914 avec légère ondulation */
function drawRealisticFlag(
  ctx: CanvasRenderingContext2D,
  owner: NationId,
  x: number,
  y: number,
  timeSec: number
) {
  const w = 14;
  const h = 9;
  const wave = Math.sin(timeSec * 4.5 + x * 0.03) * 0.9;

  ctx.save();
  ctx.translate(x, y);

  // Mât métallique
  ctx.strokeStyle = '#b8ad96';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(0, 5.5);
  ctx.lineTo(0, -h - 1.5);
  ctx.stroke();

  // Étoffe avec ondulation subtile
  ctx.save();
  ctx.translate(0.7, -h - 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w * 0.5, wave, w, 0.4);
  ctx.lineTo(w, h + 0.4);
  ctx.quadraticCurveTo(w * 0.5, h + wave, 0, h);
  ctx.closePath();
  ctx.clip();

  switch (owner) {
    case 'france':
      ctx.fillStyle = '#1e3c72';
      ctx.fillRect(0, 0, w / 3, h + 1);
      ctx.fillStyle = '#e7e2d8';
      ctx.fillRect(w / 3, 0, w / 3, h + 1);
      ctx.fillStyle = '#9c2323';
      ctx.fillRect((2 * w) / 3, 0, w / 3 + 1, h + 1);
      break;
    case 'germany':
      ctx.fillStyle = '#18181a';
      ctx.fillRect(0, 0, w + 1, (h + 1) / 3);
      ctx.fillStyle = '#e7e2d8';
      ctx.fillRect(0, (h + 1) / 3, w + 1, (h + 1) / 3);
      ctx.fillStyle = '#9c2323';
      ctx.fillRect(0, (2 * (h + 1)) / 3, w + 1, (h + 1) / 3);
      break;
    case 'uk':
      ctx.fillStyle = '#172e60';
      ctx.fillRect(0, 0, w + 1, h + 1);
      ctx.strokeStyle = '#e7e2d8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.strokeStyle = '#9c2323';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      break;
    case 'italy':
      ctx.fillStyle = '#1e5433';
      ctx.fillRect(0, 0, w / 3, h + 1);
      ctx.fillStyle = '#e7e2d8';
      ctx.fillRect(w / 3, 0, w / 3, h + 1);
      ctx.fillStyle = '#9c2323';
      ctx.fillRect((2 * w) / 3, 0, w / 3 + 1, h + 1);
      break;
    case 'austria':
      ctx.fillStyle = '#18181a';
      ctx.fillRect(0, 0, w + 1, (h + 1) / 2);
      ctx.fillStyle = '#bd9428';
      ctx.fillRect(0, (h + 1) / 2, w + 1, (h + 1) / 2);
      break;
    case 'russia':
      ctx.fillStyle = '#e7e2d8';
      ctx.fillRect(0, 0, w + 1, (h + 1) / 3);
      ctx.fillStyle = '#1e3c72';
      ctx.fillRect(0, (h + 1) / 3, w + 1, (h + 1) / 3);
      ctx.fillStyle = '#9c2323';
      ctx.fillRect(0, (2 * (h + 1)) / 3, w + 1, (h + 1) / 3);
      break;
    case 'spain':
      ctx.fillStyle = '#8c1d1d';
      ctx.fillRect(0, 0, w + 1, h * 0.28);
      ctx.fillStyle = '#c49b2b';
      ctx.fillRect(0, h * 0.28, w + 1, h * 0.44);
      ctx.fillStyle = '#8c1d1d';
      ctx.fillRect(0, h * 0.72, w + 1, h * 0.3);
      break;
    case 'ottoman':
      ctx.fillStyle = '#7d1b1b';
      ctx.fillRect(0, 0, w + 1, h + 1);
      ctx.fillStyle = '#e7e2d8';
      ctx.beginPath();
      ctx.arc(w * 0.42, h * 0.5, 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7d1b1b';
      ctx.beginPath();
      ctx.arc(w * 0.52, h * 0.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = NATION_TEMPLATES[owner].color;
      ctx.fillRect(0, 0, w + 1, h + 1);
      break;
  }

  // Relief de pli sur le tissu
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.fillRect(w * 0.55, 0, w * 0.28, h + 1);
  ctx.restore();

  // Contour sombre net
  ctx.translate(0.7, -h - 1);
  ctx.strokeStyle = 'rgba(12, 10, 8, 0.9)';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w * 0.5, wave, w, 0.4);
  ctx.lineTo(w, h + 0.4);
  ctx.quadraticCurveTo(w * 0.5, h + wave, 0, h);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/** 1. Soldat : escouade réaliste en capote/casque 1914 avec fusils à baïonnette */
function drawSoldierModel(
  ctx: CanvasRenderingContext2D,
  coatColor: string,
  helmetColor: string,
  bob: number
) {
  const squad = [
    { dx: -8.5, dy: -1.8, s: 0.86, phase: -1 },
    { dx: 7.5, dy: -1.4, s: 0.86, phase: 1 },
    { dx: -0.5, dy: 0.8, s: 1.02, phase: 0.5 },
  ];

  for (const m of squad) {
    ctx.save();
    ctx.translate(m.dx, m.dy + bob * m.phase);
    ctx.scale(m.s, m.s);

    // Jambes & bandes molletières
    ctx.strokeStyle = '#24201b';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1.6, -0.5);
    ctx.lineTo(-2.6, 5.2);
    ctx.moveTo(1.6, -0.5);
    ctx.lineTo(2.7, 5.2);
    ctx.stroke();

    // Capote militaire ombrée
    const grad = ctx.createLinearGradient(-4.5, -8, 4.5, 1);
    grad.addColorStop(0, coatColor);
    grad.addColorStop(1, '#1c1916');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#12100e';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(-3.6, -7.8);
    ctx.lineTo(3.6, -7.8);
    ctx.lineTo(4.8, 0.8);
    ctx.lineTo(-4.8, 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Ceinturon & cartouchières en cuir sombre
    ctx.fillStyle = '#3b2d1f';
    ctx.fillRect(-3.8, -3.2, 7.6, 1.5);
    ctx.fillStyle = '#9c8a68';
    ctx.fillRect(-2.4, -3.5, 1.4, 2.1);
    ctx.fillRect(1.0, -3.5, 1.4, 2.1);

    // Visage sobre + casque métallique 1914
    ctx.fillStyle = '#d4b292';
    ctx.beginPath();
    ctx.arc(0.4, -9.6, 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = helmetColor;
    ctx.beginPath();
    ctx.arc(0, -10.4, 3.1, Math.PI * 1.02, -Math.PI * 0.02);
    ctx.lineTo(4.1, -9.8);
    ctx.lineTo(-4.1, -9.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fusil de guerre + baïonnette d'acier
    ctx.strokeStyle = '#4a3522';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-2.2, -3.6);
    ctx.lineTo(8.2, -10.2);
    ctx.stroke();

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(8.0, -10.1);
    ctx.lineTo(11.6, -12.4);
    ctx.stroke();

    ctx.restore();
  }
}

/** 2. Éclaireur : guetteur de reconnaissance avec jumelles et carabine */
function drawScoutModel(
  ctx: CanvasRenderingContext2D,
  coatColor: string,
  helmetColor: string,
  bob: number
) {
  ctx.save();
  ctx.translate(0, bob * 0.75);

  // Posture penchée d'observation
  ctx.strokeStyle = '#24201b';
  ctx.lineWidth = 2.0;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2.2, -0.5);
  ctx.lineTo(-6.2, 4.8);
  ctx.moveTo(1.8, -0.5);
  ctx.lineTo(5.8, 4.6);
  ctx.stroke();

  const grad = ctx.createLinearGradient(-4, -7.5, 5, 1);
  grad.addColorStop(0, coatColor);
  grad.addColorStop(1, '#1c1916');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#12100e';
  ctx.lineWidth = 0.95;
  ctx.beginPath();
  ctx.moveTo(-4.2, -7.2);
  ctx.lineTo(2.8, -8.2);
  ctx.lineTo(5.2, 0.2);
  ctx.lineTo(-3.2, 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Casque
  ctx.fillStyle = helmetColor;
  ctx.beginPath();
  ctx.arc(1.5, -10.2, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Jumelles d'observation en laiton/acier
  ctx.fillStyle = '#8c7851';
  ctx.strokeStyle = '#141210';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.roundRect(4.2, -11.4, 5.5, 3.2, 1);
  ctx.fill();
  ctx.stroke();

  // Carabine courte
  ctx.strokeStyle = '#4a3522';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-1.5, -4.2);
  ctx.lineTo(10.5, -5.8);
  ctx.stroke();

  ctx.restore();
}

/** 3. Blindé léger : char d'assaut léger détaillé (chenilles, galets, caisse, tourelle, canon) */
function drawLightTankModel(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  turretColor: string,
  bob: number,
  timeSec: number,
  isMoving: boolean
) {
  ctx.save();
  ctx.translate(0, bob * 0.35);

  // Train de chenilles sombre
  ctx.fillStyle = '#1e1f22';
  ctx.strokeStyle = '#09090a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-11.5, -2.2, 23, 7.2, 3.4);
  ctx.fill();
  ctx.stroke();

  // Galets et barbotins
  for (let i = 0; i < 5; i++) {
    const gx = -8 + i * 4;
    ctx.fillStyle = '#6e737a';
    ctx.beginPath();
    ctx.arc(gx, 1.4, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Caisse blindée avec dégradé métallique
  const hullGrad = ctx.createLinearGradient(0, -8.5, 0, -1.5);
  hullGrad.addColorStop(0, hullColor);
  hullGrad.addColorStop(1, '#26292e');
  ctx.fillStyle = hullGrad;
  ctx.beginPath();
  ctx.moveTo(-10.5, -1.8);
  ctx.lineTo(-7.2, -8.5);
  ctx.lineTo(7.8, -8.5);
  ctx.lineTo(12.2, -1.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tourelle pivotante
  ctx.fillStyle = turretColor;
  ctx.beginPath();
  ctx.roundRect(-4.6, -13.2, 9.2, 5.2, 1.8);
  ctx.fill();
  ctx.stroke();

  // Canon rayé
  ctx.strokeStyle = '#12110f';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4.2, -10.6);
  ctx.lineTo(17.2, -11.3);
  ctx.stroke();

  ctx.strokeStyle = '#b8bec6';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(5, -11.0);
  ctx.lineTo(16.5, -11.6);
  ctx.stroke();

  // Fumée d'échappement discrète
  if (isMoving) {
    const puff = (timeSec * 8) % 6;
    ctx.fillStyle = 'rgba(161, 161, 170, 0.35)';
    ctx.beginPath();
    ctx.arc(-11.5 - puff * 0.7, -5 - puff * 0.4, 2.2 + puff * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** 4. Blindé lourd : char rhomboïde 1914 (flancs d'artillerie, chenilles hautes, coupole) */
function drawHeavyTankModel(
  ctx: CanvasRenderingContext2D,
  hullColor: string,
  accentColor: string,
  bob: number,
  timeSec: number,
  isMoving: boolean
) {
  ctx.save();
  ctx.translate(0, bob * 0.25);

  // Chenilles enveloppantes massives
  ctx.fillStyle = '#1b1c1f';
  ctx.strokeStyle = '#09090a';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(-15.5, 1.5);
  ctx.lineTo(-10.8, -8.2);
  ctx.lineTo(10.8, -9.2);
  ctx.lineTo(16.5, -1.2);
  ctx.lineTo(13.2, 4.8);
  ctx.lineTo(-13.2, 4.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Plaques de blindage latérales
  const bodyGrad = ctx.createLinearGradient(0, -8, 0, 3);
  bodyGrad.addColorStop(0, hullColor);
  bodyGrad.addColorStop(1, '#25272b');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-12, 1.5);
  ctx.lineTo(-8.8, -6.2);
  ctx.lineTo(8.8, -7.0);
  ctx.lineTo(13, -0.5);
  ctx.lineTo(10.5, 2.8);
  ctx.lineTo(-10.5, 2.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tourelle supérieure d'observation
  ctx.fillStyle = accentColor;
  ctx.fillRect(-5.2, -12.4, 10.4, 4.6);
  ctx.strokeRect(-5.2, -12.4, 10.4, 4.6);

  // Canons de flanc et d'étrave
  ctx.strokeStyle = '#0f0e0d';
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4.8, -9.8);
  ctx.lineTo(18.5, -10.6);
  ctx.moveTo(7.5, -2.8);
  ctx.lineTo(17.5, -3.2);
  ctx.stroke();

  ctx.strokeStyle = '#c4c9d0';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(5.5, -10.2);
  ctx.lineTo(18, -10.9);
  ctx.stroke();

  if (isMoving) {
    const puff = (timeSec * 7) % 7;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.34)';
    ctx.beginPath();
    ctx.arc(-14 - puff * 0.7, -6 - puff * 0.45, 2.6 + puff * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** 5. Chasseur : biplan de chasse 1914 en vol avec ombre portée au sol */
function drawFighterModel(
  ctx: CanvasRenderingContext2D,
  wingColor: string,
  accentColor: string,
  timeSec: number
) {
  const bank = Math.sin(timeSec * 3.5) * 0.06;
  const lift = Math.sin(timeSec * 6) * 1.2;

  // Ombre portée au sol sous l'appareil
  ctx.save();
  ctx.translate(4, 9);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(0, -7 + lift);
  ctx.rotate(bank);

  // Fuselage
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = '#111113';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12.5, -0.6);
  ctx.lineTo(11.5, -2.0);
  ctx.lineTo(13.2, 0);
  ctx.lineTo(11.5, 2.0);
  ctx.lineTo(-12.5, 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Plan de dérive arrière
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.moveTo(-12.5, -5.2);
  ctx.lineTo(-8.2, -4.8);
  ctx.lineTo(-8.2, 4.8);
  ctx.lineTo(-12.5, 5.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Ailes biplan
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.roundRect(-2.0, -12.5, 5.8, 25, 1.8);
  ctx.fill();
  ctx.stroke();

  // Mâts d'entreplan
  ctx.strokeStyle = '#d6cfc2';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-0.5, -8.5);
  ctx.lineTo(2.5, -8.5);
  ctx.moveTo(-0.5, 8.5);
  ctx.lineTo(2.5, 8.5);
  ctx.stroke();

  ctx.restore();
}

/** 6. Bombardier : gros bimoteur stratégique 1914 en vol */
function drawBomberModel(
  ctx: CanvasRenderingContext2D,
  wingColor: string,
  accentColor: string,
  timeSec: number
) {
  const bank = Math.sin(timeSec * 2.5) * 0.04;
  const lift = Math.sin(timeSec * 4.5) * 0.9;

  // Ombre portée au sol
  ctx.save();
  ctx.translate(5, 10);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(0, -7.5 + lift);
  ctx.rotate(bank);

  // Fuselage lourd
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = '#0d0e10';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-14, -2.4, 27.5, 4.8, 2);
  ctx.fill();
  ctx.stroke();

  // Grande voilure
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.roundRect(-3.0, -16.5, 7.6, 33, 2);
  ctx.fill();
  ctx.stroke();

  // Nacelles moteurs
  ctx.fillStyle = '#27272a';
  ctx.fillRect(1.5, -9.2, 5.2, 2.8);
  ctx.strokeRect(1.5, -9.2, 5.2, 2.8);
  ctx.fillRect(1.5, 6.4, 5.2, 2.8);
  ctx.strokeRect(1.5, 6.4, 5.2, 2.8);

  // Empennage bi-dérive
  ctx.fillStyle = wingColor;
  ctx.fillRect(-14.5, -6.5, 4.2, 13);
  ctx.strokeRect(-14.5, -6.5, 4.2, 13);

  ctx.restore();
}

/** 7. Sous-marin : U-Boot 1914 avec kiosque, canon de pont, périscope et sillage */
function drawSubmarineModel(
  ctx: CanvasRenderingContext2D,
  hullStripeColor: string,
  timeSec: number,
  isMoving: boolean
) {
  const bob = Math.sin(timeSec * 2.8) * 0.65;
  ctx.save();
  ctx.translate(0, bob);

  // Sillage d'écume en mer
  ctx.strokeStyle = 'rgba(186, 214, 232, 0.52)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-17, 3.6);
  ctx.quadraticCurveTo(0, 5.2, 17, 3.4);
  ctx.stroke();

  if (isMoving) {
    const wake = (timeSec * 10) % 7;
    ctx.strokeStyle = 'rgba(203, 225, 240, 0.28)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-18 - wake, 2.2);
    ctx.lineTo(-12 - wake * 0.5, 4.5);
    ctx.stroke();
  }

  // Coque fuselée sombre
  const subGrad = ctx.createLinearGradient(0, -3.5, 0, 3.5);
  subGrad.addColorStop(0, '#3e4a54');
  subGrad.addColorStop(1, '#141b21');
  ctx.fillStyle = subGrad;
  ctx.strokeStyle = '#090d10';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-16.5, 1.8);
  ctx.quadraticCurveTo(-12, -3.2, 0, -3.2);
  ctx.quadraticCurveTo(12, -3.2, 16.8, 1.8);
  ctx.lineTo(14, 3.5);
  ctx.lineTo(-14, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Bande de nation discrète sur la coque
  ctx.fillStyle = hullStripeColor;
  ctx.fillRect(-9.5, -0.5, 19, 1.5);

  // Kiosque (conning tower) + canon de pont + périscope
  ctx.fillStyle = '#4b5863';
  ctx.fillRect(-3.6, -8.2, 7.2, 5.4);
  ctx.strokeRect(-3.6, -8.2, 7.2, 5.4);

  ctx.strokeStyle = '#d4dae0';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(6.5, -2.2);
  ctx.lineTo(10.5, -3.4);
  ctx.moveTo(0.8, -8.2);
  ctx.lineTo(0.8, -12.8);
  ctx.lineTo(3.8, -12.8);
  ctx.stroke();

  ctx.restore();
}

/** 8. Frégate : navire de guerre blindé avec cheminées, tourelles, mâts et sillage */
function drawFrigateModel(
  ctx: CanvasRenderingContext2D,
  hullStripeColor: string,
  timeSec: number,
  isMoving: boolean
) {
  const pitch = Math.sin(timeSec * 3.0) * 0.65;
  ctx.save();
  ctx.translate(0, pitch);

  // Sillage maritime
  ctx.strokeStyle = 'rgba(203, 224, 238, 0.58)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-17.5, 4.4);
  ctx.quadraticCurveTo(0, 6.0, 18, 4.0);
  ctx.stroke();

  // Coque blindée
  const shipGrad = ctx.createLinearGradient(0, -4, 0, 4);
  shipGrad.addColorStop(0, '#52606d');
  shipGrad.addColorStop(1, '#1e2730');
  ctx.fillStyle = shipGrad;
  ctx.strokeStyle = '#0b1015';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(-16, -1.6);
  ctx.lineTo(16, -2.4);
  ctx.lineTo(19.5, -4.4);
  ctx.lineTo(14, 3.8);
  ctx.lineTo(-14, 3.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Liseré de nation
  ctx.fillStyle = hullStripeColor;
  ctx.fillRect(-12, -1.3, 24, 1.8);

  // Superstructure centrale & passerelle
  ctx.fillStyle = '#64748b';
  ctx.fillRect(-6, -7.4, 12, 5.4);
  ctx.strokeRect(-6, -7.4, 12, 5.4);

  // 2 cheminées
  ctx.fillStyle = '#27303a';
  ctx.fillRect(-4.2, -11.8, 2.6, 4.5);
  ctx.strokeRect(-4.2, -11.8, 2.6, 4.5);
  ctx.fillRect(1.4, -11.8, 2.6, 4.5);
  ctx.strokeRect(1.4, -11.8, 2.6, 4.5);

  // Tourelles d'artillerie navale
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(9, -4.2);
  ctx.lineTo(16.2, -5.8);
  ctx.moveTo(-9, -3.8);
  ctx.lineTo(-15.5, -5.0);
  ctx.stroke();

  // Fumée de chauffe
  if (isMoving) {
    const drift = (timeSec * 11) % 9;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.34)';
    ctx.beginPath();
    ctx.arc(-4.5 - drift * 0.65, -13.8 - drift * 0.35, 2.4 + drift * 0.15, 0, Math.PI * 2);
    ctx.arc(0.8 - drift * 0.55, -14.6 - drift * 0.25, 2.0 + drift * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Dessine un modèle d'unité réaliste directement posé sur la carte */
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
    isSelected = false,
    isCapital = false,
    isEnemyWarning = false,
    landingSecondsLeft,
    timeSec = 0,
    scale = 1,
  } = opts;

  const tpl = NATION_TEMPLATES[owner];
  const dominant = getDominantUnitType(units, isNaval, isAir, isSubmarine);
  const bob = isMoving ? Math.sin(timeSec * 8.5 + x * 0.08) * 1.1 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (isSubmarine && landingSecondsLeft === undefined) {
    ctx.globalAlpha = 0.82;
  }

  // Halo de sélection ou d'alerte au sol
  if (isSelected || isEnemyWarning || landingSecondsLeft !== undefined) {
    const pulse = 0.65 + 0.35 * Math.sin(timeSec * 7);
    ctx.strokeStyle =
      landingSecondsLeft !== undefined || isEnemyWarning
        ? `rgba(239, 68, 68, ${pulse})`
        : `rgba(250, 204, 21, ${pulse})`;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.ellipse(0, 4.5, 20, 7.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ombre portée réaliste sur le terrain
  ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
  ctx.beginPath();
  ctx.ellipse(1.5, 5.2, 16.5, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Modèle réaliste orienté selon le cap
  ctx.save();
  ctx.scale(facing, 1);
  switch (dominant) {
    case 'submarine':
      drawSubmarineModel(ctx, tpl.color, timeSec, isMoving);
      break;
    case 'frigate':
      drawFrigateModel(ctx, tpl.color, timeSec, isMoving);
      break;
    case 'bomber':
      drawBomberModel(ctx, tpl.color, tpl.borderColor, timeSec);
      break;
    case 'fighter':
      drawFighterModel(ctx, tpl.color, tpl.borderColor, timeSec);
      break;
    case 'heavy_tank':
      drawHeavyTankModel(ctx, tpl.color, tpl.borderColor, bob, timeSec, isMoving);
      break;
    case 'light_tank':
      drawLightTankModel(ctx, tpl.color, tpl.borderColor, bob, timeSec, isMoving);
      break;
    case 'scout':
      drawScoutModel(ctx, tpl.color, tpl.borderColor, bob);
      break;
    default:
      drawSoldierModel(ctx, tpl.color, tpl.borderColor, bob);
      break;
  }
  ctx.restore();

  // Fanion national réaliste
  drawRealisticFlag(ctx, owner, -14, -12, timeSec);

  // Plaquette compacte d'effectif (laiton/acier, sans barre de moral)
  const label = isReturning ? `↩${total}` : String(total);
  const badgeW = Math.max(22, label.length * 6.5 + 11);
  const badgeH = 13;
  const badgeY = 7;

  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(16, 15, 13, 0.94)';
  ctx.strokeStyle = isCapital ? '#d4af37' : isEnemyWarning ? '#ef4444' : '#9c927e';
  ctx.lineWidth = isCapital || isEnemyWarning ? 1.35 : 1;
  ctx.beginPath();
  ctx.roundRect(-badgeW / 2, badgeY, badgeW, badgeH, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = tpl.color;
  ctx.fillRect(-badgeW / 2 + 1.5, badgeY + 1.5, 3.8, badgeH - 3);

  ctx.fillStyle = '#f5f1e6';
  ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 2, badgeY + badgeH / 2 + 0.5);

  if (landingSecondsLeft !== undefined && landingSecondsLeft > 0) {
    const alertText = `DÉBARQ. ${Math.ceil(landingSecondsLeft)}s`;
    ctx.fillStyle = 'rgba(127, 29, 29, 0.96)';
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-36, -29, 72, 13, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fef2f2';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.fillText(alertText, 0, -22.2);
  }

  ctx.restore();
}

export function drawFogUnknownToken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  owner: NationId
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(20, 19, 17, 0.84)';
  ctx.strokeStyle = NATION_TEMPLATES[owner].borderColor;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-10, -8, 20, 16, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#b8ae99';
  ctx.font = 'bold 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 0.5);

  ctx.restore();
}