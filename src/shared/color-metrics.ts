// Colour maths for token tests and later legends: pure functions, no DOM, no three.
export type Lab = readonly [l: number, a: number, b: number];
type Rgb = readonly [number, number, number];

const D65 = [0.95047, 1, 1.08883] as const;

function parseHex(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a 7-character hex colour: ${hex}`);
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToLinear(hex: string): Rgb {
  const [r, g, b] = parseHex(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

export function linearToLab([r, g, b]: Rgb): Lab {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = labF(x / D65[0]);
  const fy = labF(y / D65[1]);
  const fz = labF(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): Lab {
  return linearToLab(hexToLinear(hex));
}

// CIELAB chroma C*.
export function chroma(hex: string): number {
  const [, a, b] = hexToLab(hex);
  return Math.hypot(a, b);
}

// CIEDE2000 (Sharma, Wu, Dalal 2005), kL = kC = kH = 1.
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const deg = (r: number) => {
    const d = r / rad;
    return d < 0 ? d + 360 : d;
  };

  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = c1p === 0 ? 0 : deg(Math.atan2(b1, a1p));
  const h2p = c2p === 0 ? 0 : deg(Math.atan2(b2, a2p));

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * rad) / 2);

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP /= 2;
    else hBarP = (hBarP + (h1p + h2p < 360 ? 360 : -360)) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * rad) +
    0.24 * Math.cos(2 * hBarP * rad) +
    0.32 * Math.cos((3 * hBarP + 6) * rad) -
    0.2 * Math.cos((4 * hBarP - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;

  const lTerm = dLp / sl;
  const cTerm = dCp / sc;
  const hTerm = dHp / sh;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rt * cTerm * hTerm);
}

// Machado, Oliveira, Fernandes 2009, severity 1.0, applied to linear sRGB.
const MACHADO = {
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
} as const;

export type Deficiency = keyof typeof MACHADO;

// Simulated linear sRGB, clamped to 0..1.
export function simulateLinear(hex: string, kind: Deficiency): Rgb {
  const [r, g, b] = hexToLinear(hex);
  const [x, y, z] = MACHADO[kind].map((row) =>
    Math.min(1, Math.max(0, row[0] * r + row[1] * g + row[2] * b)),
  );
  return [x!, y!, z!];
}

// ΔE2000 between two hex colours, optionally as seen with a colour-vision deficiency.
export function hexDeltaE(a: string, b: string, kind?: Deficiency): number {
  if (!kind) return deltaE2000(hexToLab(a), hexToLab(b));
  return deltaE2000(linearToLab(simulateLinear(a, kind)), linearToLab(simulateLinear(b, kind)));
}
