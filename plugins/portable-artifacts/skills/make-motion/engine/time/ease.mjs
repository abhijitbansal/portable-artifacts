// Easing for the v2 engine: ease(name) -> (p) => number, p in [0, 1].
// Names: linear; in|out|inOut + Quad|Cubic|Quart|Expo|Back; spring(<stiffness>,<damping>);
// cubic-bezier(<x1>,<y1>,<x2>,<y2>) (the CSS curve, x1 and x2 from 0 to 1); steps(<n>) or steps(<n>,start|end).
// Pure functions, no clock, no randomness: the same name always gives the same curve.
import { createRegistry } from '../registry.mjs';

const BACK_OVERSHOOT = 1.70158; // Penner's constant: about a 10% overshoot
const BACK_INOUT_SCALE = 1.525; // Penner's inOutBack widening of the overshoot
const EXPO_RATE = 10;

// The "in" curve of each family; "out" and "inOut" are derived from it by mirroring.
const IN_CURVES = {
  Quad: (p) => p ** 2,
  Cubic: (p) => p ** 3,
  Quart: (p) => p ** 4,
  Expo: (p) => (p === 0 ? 0 : 2 ** (EXPO_RATE * p - EXPO_RATE)),
  Back: (p) => (BACK_OVERSHOOT + 1) * p ** 3 - BACK_OVERSHOOT * p ** 2,
};

const mirrorOut = (easeIn) => (p) => 1 - easeIn(1 - p);
const mirrorInOut = (easeIn) => (p) => (p < 0.5 ? easeIn(2 * p) / 2 : 1 - easeIn(2 - 2 * p) / 2);

// inOutBack is not the plain mirror: its overshoot constant is scaled up.
function inOutBack(p) {
  const c2 = BACK_OVERSHOOT * BACK_INOUT_SCALE;
  if (p < 0.5) return ((2 * p) ** 2 * ((c2 + 1) * 2 * p - c2)) / 2;
  return ((2 * p - 2) ** 2 * ((c2 + 1) * (2 * p - 2) + c2) + 2) / 2;
}

const curves = createRegistry('ease');
curves.add('linear', (p) => p);
for (const [family, easeIn] of Object.entries(IN_CURVES)) {
  curves.add(`in${family}`, easeIn);
  curves.add(`out${family}`, mirrorOut(easeIn));
  curves.add(`inOut${family}`, family === 'Back' ? inOutBack : mirrorInOut(easeIn));
}

// ---- spring ----

const SPRING_FORM = 'spring(<stiffness>,<damping>)';
const SPRING_PATTERN = /^spring\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/;
const SETTLE_EPSILON = 1e-3; // the decay envelope the curve is stretched to reach at p = 1
const CRITICAL_BAND = 1e-6; // |damping ratio - 1| below this uses the critically damped form

// Unit step response of x'' = k(1 - x) - c x' (mass 1) at time t, from rest: 0 at t = 0, tends to 1.
function springStep(stiffness, damping) {
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);
  if (Math.abs(zeta - 1) < CRITICAL_BAND) return (t) => 1 - Math.exp(-omega * t) * (1 + omega * t);
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const k = (zeta * omega) / wd;
    return (t) => 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + k * Math.sin(wd * t));
  }
  // Overdamped: cosh/sinh written as two exponentials so a heavy damping ratio cannot overflow.
  const wd = omega * Math.sqrt(zeta * zeta - 1);
  const a = (zeta * omega) / wd;
  return (t) => 1 - ((1 + a) / 2) * Math.exp((wd - zeta * omega) * t) - ((1 - a) / 2) * Math.exp(-(wd + zeta * omega) * t);
}

// Slowest decay rate of the envelope: zeta*omega when underdamped, the slow root when overdamped.
function springDecayRate(stiffness, damping) {
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);
  return zeta <= 1 ? zeta * omega : omega * (zeta - Math.sqrt(zeta * zeta - 1));
}

// Closed-form damped spring, stretched so its envelope has decayed to SETTLE_EPSILON at p = 1, then a
// linear correction of the remaining gap makes p = 1 land on exactly 1. p = 0 is already exactly 0.
function spring(stiffness, damping) {
  if (!(stiffness > 0) || !(damping > 0)) throw new Error(`spring stiffness and damping must be > 0, got ${stiffness},${damping}`);
  const step = springStep(stiffness, damping);
  const settleTime = Math.log(1 / SETTLE_EPSILON) / springDecayRate(stiffness, damping);
  const gap = 1 - step(settleTime);
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return step(p * settleTime) + gap * p;
  };
}

function parseSpring(name) {
  const m = SPRING_PATTERN.exec(name);
  if (!m) throw new Error(`bad ease "${name}"; expected ${SPRING_FORM}`);
  return spring(Number(m[1]), Number(m[2]));
}

// ---- cubic-bezier ----

const BEZIER_FORM = 'cubic-bezier(<x1>,<y1>,<x2>,<y2>) with x1 and x2 from 0 to 1';
const NUMBER = '(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
const BEZIER_PATTERN = new RegExp(`^cubic-bezier\\(\\s*${[NUMBER, NUMBER, NUMBER, NUMBER].join('\\s*,\\s*')}\\s*\\)$`);
const BEZIER_PRECISION = 1e-7; // how close the solved x must land to the asked x
const NEWTON_STEPS = 8;
const FLAT_SLOPE = 1e-6; // a slope under this is too flat for a Newton step: bisect instead

// The CSS curve through (0,0), (x1,y1), (x2,y2), (1,1); y is read at the parameter whose x equals p.
function cubicBezier(x1, y1, x2, y2) {
  const coord = (a, b) => (t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t; // Bernstein form, t^3 folded in
  const x = coord(x1, x2);
  const y = coord(y1, y2);
  const slope = (t) => (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
  const solve = (p) => {
    let t = p;
    for (let i = 0; i < NEWTON_STEPS; i++) {
      const error = x(t) - p;
      if (Math.abs(error) < BEZIER_PRECISION) return t;
      const d = slope(t);
      if (Math.abs(d) < FLAT_SLOPE) break;
      t -= error / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    while (lo < hi && Math.abs(x(t) - p) >= BEZIER_PRECISION) {
      if (x(t) < p) lo = t; else hi = t;
      const next = (lo + hi) / 2;
      if (next === t) break;
      t = next;
    }
    return t;
  };
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return y(solve(p));
  };
}

function parseCubicBezier(name) {
  const m = BEZIER_PATTERN.exec(name);
  const [x1, y1, x2, y2] = m ? m.slice(1).map(Number) : [];
  const ok = m && [x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
  if (!ok) throw new Error(`bad ease "${name}"; expected ${BEZIER_FORM}`);
  return cubicBezier(x1, y1, x2, y2);
}

// ---- steps ----

const STEPS_FORM = 'steps(<n>) or steps(<n>,start|end) with n from 1 to 120';
const STEPS_PATTERN = /^steps\(\s*(\d+)\s*(?:,\s*(start|end)\s*)?\)$/;
const MAX_STEPS = 120;

// CSS steps: end (the default) holds each step's value until the next boundary, start jumps at the boundary.
function parseSteps(name) {
  const m = STEPS_PATTERN.exec(name);
  const n = m ? Number(m[1]) : 0;
  if (!(n >= 1 && n <= MAX_STEPS)) throw new Error(`bad ease "${name}"; expected ${STEPS_FORM}`);
  const round = m[2] === 'start' ? Math.ceil : Math.floor;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return round(p * n) / n;
  };
}

export function ease(name) {
  if (typeof name === 'string' && name.startsWith('spring(')) return parseSpring(name);
  if (typeof name === 'string' && name.startsWith('cubic-bezier(')) return parseCubicBezier(name);
  if (typeof name === 'string' && name.startsWith('steps(')) return parseSteps(name);
  return curves.get(name);
}
