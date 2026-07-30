/**
 * EduClock GPS Haversine unit tests (no DB).
 * Run: npx tsc && node dist/utils/educlockGpsDistance.test.js
 */
import {
  haversineDistanceMetres,
  roundDistanceMetresForStorage,
} from "./educlockGpsDistance";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function approxEqual(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

function main() {
  const a = { latitude: -26.2041, longitude: 28.0473 };
  const zero = haversineDistanceMetres(a, a);
  assert(zero === 0, `identical coords => 0, got ${zero}`);

  // ~111.32 m per 0.001° latitude near equator; Johannesburg ~111.19 km/° lat
  const north111 = {
    latitude: a.latitude + 0.001,
    longitude: a.longitude,
  };
  const d111 = haversineDistanceMetres(a, north111);
  assert(approxEqual(d111, 111.2, 1.5), `expected ~111m, got ${d111}`);

  // ~5 metres north
  const metresPerDegLat = 111_320;
  const fiveNorth = {
    latitude: a.latitude + 5 / metresPerDegLat,
    longitude: a.longitude,
  };
  const d5 = haversineDistanceMetres(a, fiveNorth);
  assert(approxEqual(d5, 5, 0.05), `expected ~5m, got ${d5}`);

  assert(roundDistanceMetresForStorage(5.006) === 5.01, "round 5.006 -> 5.01");
  assert(roundDistanceMetresForStorage(5.004) === 5, "round 5.004 -> 5");

  let threw = false;
  try {
    haversineDistanceMetres({ latitude: 100, longitude: 0 }, a);
  } catch {
    threw = true;
  }
  assert(threw, "invalid latitude throws");

  console.log("✓ EduClock GPS distance unit tests passed");
}

main();
