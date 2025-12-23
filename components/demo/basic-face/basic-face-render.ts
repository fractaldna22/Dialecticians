/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
type BasicFaceProps = {
  ctx: CanvasRenderingContext2D;
  mouthScale: number; // expected 0..1
  eyeScale: number;   // expected ~0..1
  color?: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

const eye = (
  ctx: CanvasRenderingContext2D,
  pos: [number, number],
  radius: number,
  scaleY: number
) => {
  ctx.save();
  ctx.translate(pos[0], pos[1]);
  ctx.scale(1, clamp(scaleY, 0.05, 1.25));
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0, radius), 0, Math.PI * 2);
  ctx.restore();
  ctx.fill();
};

export function renderBasicFace(props: BasicFaceProps) {
  const { ctx, eyeScale, mouthScale, color } = props;
  const { width, height } = ctx.canvas;

  ctx.clearRect(0, 0, width, height);

  // Use the smaller dimension so circles stay circles.
  const minDim = Math.min(width, height);
  const padding = Math.min(20, minDim * 0.1);
  const faceRadius = Math.max(0, minDim / 2 - padding);
  const cx = width / 2;
  const cy = height / 2;

  // Face
  ctx.fillStyle = color || "white";
  ctx.beginPath();
  ctx.arc(cx, cy, faceRadius, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const eyesCenterY = cy - faceRadius * 0.18;
  const eyesOffsetX = faceRadius * 0.32;
  const eyeRadius = faceRadius * 0.12;

  ctx.fillStyle = "black";
  eye(ctx, [cx - eyesOffsetX, eyesCenterY], eyeRadius, eyeScale + 0.1);
  eye(ctx, [cx + eyesOffsetX, eyesCenterY], eyeRadius, eyeScale + 0.1);

  // Mouth (fixed)
  const open = clamp01(mouthScale); // 0..1
  const mouthX = cx;
  const mouthY = cy + faceRadius * 0.33;
  const mouthW = faceRadius * 0.85;
  const mouthH = faceRadius * (0.10 + 0.38 * open);

  ctx.save();
  ctx.translate(mouthX, mouthY);

  if (open < 0.12) {
    // Mostly closed: draw a simple smile line (no fill = no cat-eye).
    const t = open / 0.12; // 0..1
    const smile = faceRadius * (0.22 + 0.08 * t);
    const lift = faceRadius * (0.06 + 0.02 * t);

    ctx.strokeStyle = "black";
    ctx.lineWidth = Math.max(2, faceRadius * 0.07);
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.arc(0, lift, smile, Math.PI * 0.12, Math.PI - Math.PI * 0.12, false);
    ctx.stroke();
  } else {
    // Open: full ellipse cavity (this is the key change).
    const rx = mouthW * 0.5;
    const ry = mouthH * 0.5;

    // Mouth cavity
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Teeth band (subtle)
    const teethH = ry * clamp01(0.28 - open * 0.12);
    if (teethH > 1) {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.ellipse(0, -ry * 0.30, rx * 0.78, teethH, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tongue (only when open enough)
    if (open > 0.28) {
      ctx.fillStyle = "#7a0f1a"; // dark red
      ctx.beginPath();
      ctx.ellipse(0, ry * 0.25, rx * 0.62, ry * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
