/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { RefObject, useEffect, useState, useRef, useMemo } from "react";
import { renderBasicFace } from "./basic-face-render";

import useFace from "../../../hooks/demo/use-face";
import useHover from "../../../hooks/demo/use-hover";
import useTilt from "../../../hooks/demo/use-tilt";
import { useLiveAPIContext } from "../../../contexts/LiveAPIContext";

const AUDIO_OUTPUT_DETECTION_THRESHOLD = 0.01;
const TALKING_STATE_COOLDOWN_MS = 150;

// Volume range that maps to mouth open 0..1 (tweak to taste)
const MOUTH_VOL_MIN = 0.015;
const MOUTH_VOL_MAX = 0.22;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

type BasicFaceProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  radius?: number;
  color?: string;
  volume?: number;
};

export default function BasicFace({
  canvasRef,
  radius = 250,
  color,
  volume: propVolume,
}: BasicFaceProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { volume: contextVolume } = useLiveAPIContext();
  const effectiveVolume = propVolume !== undefined ? propVolume : contextVolume;

  const [isTalking, setIsTalking] = useState(false);
  const [scale, setScale] = useState(1.0);

  // Smooth mouth movement so it doesn’t jitter
  const mouthRef = useRef(0);
  const [mouthOpen, setMouthOpen] = useState(0);

  const { eyeScale } = useFace();
  const hoverPosition = useHover();
  const tiltAngle = useTilt({ maxAngle: 5, speed: 0.075, isActive: isTalking });

  useEffect(() => {
    const calculateScale = () => setScale(Math.min(window.innerWidth, window.innerHeight) / 1000);
    window.addEventListener("resize", calculateScale);
    calculateScale();
    return () => window.removeEventListener("resize", calculateScale);
  }, []);

  // Talking state: only start cooldown when volume drops below threshold
  useEffect(() => {
    if (effectiveVolume > AUDIO_OUTPUT_DETECTION_THRESHOLD) {
      setIsTalking(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    } else if (isTalking && !timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        setIsTalking(false);
        timeoutRef.current = null;
      }, TALKING_STATE_COOLDOWN_MS);
    }
  }, [effectiveVolume, isTalking]);

  // Normalize + smooth volume into 0..1 mouthOpen
  useEffect(() => {
    const target =
      (effectiveVolume - MOUTH_VOL_MIN) / (MOUTH_VOL_MAX - MOUTH_VOL_MIN);
    const t = clamp01(target);

    // attack faster than release
    const lerp = t > mouthRef.current ? 0.35 : 0.18;
    mouthRef.current = mouthRef.current + (t - mouthRef.current) * lerp;

    setMouthOpen(mouthRef.current);
  }, [effectiveVolume]);

  // Render
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    renderBasicFace({ ctx, mouthScale: mouthOpen, eyeScale, color });
  }, [canvasRef, eyeScale, mouthOpen, color, scale]);

  return (
    <canvas
      className="basic-face"
      ref={canvasRef}
      width={radius * 2 * scale}
      height={radius * 2 * scale}
      style={{
        display: "block",
        borderRadius: "50%",
        transform: `translateY(${hoverPosition}px) rotate(${tiltAngle}deg)`,
      }}
    />
  );
}
