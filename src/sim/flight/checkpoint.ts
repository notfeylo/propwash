// Copy the sim's own mutable state (motors, pack, wind, FC filters and integrators, RNG streams…)
// in and out of plain data, for replays (Phase 2 PRD §8.2). Rapier's state is its own snapshot.
//
// Objects are walked field by field: numbers, strings, booleans, arrays, typed arrays and nested
// objects are copied; functions are left alone (they are wiring, not state). Keys in `SHARED` hold
// configuration shared with the rest of the app (the airframe, motor constants, the pack spec);
// they are never copied, so restoring can't write one preset's values into another.

/** Field names that reference shared configuration, not state. */
const SHARED = new Set(['airframe', 'm', 'pack', 'R']);

export type Plain = null | boolean | number | string | Plain[] | Float64Array | Float32Array | { [k: string]: Plain };

/** A deep copy of `obj`'s state (skipping `skip` at the top level and shared config anywhere). */
export function capture(obj: object, skip: ReadonlySet<string> = new Set()): { [k: string]: Plain } {
  const out: { [k: string]: Plain } = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || SHARED.has(k)) continue;
    const c = copy(v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

function copy(v: unknown): Plain | undefined {
  if (v === null) return null;
  if (typeof v === 'function' || v === undefined) return undefined;
  if (typeof v !== 'object') return v as Plain;
  if (v instanceof Float64Array || v instanceof Float32Array) return v.slice();
  if (Array.isArray(v)) return v.map((x) => copy(x) ?? null);
  return capture(v);
}

/** Write captured state back into the live object graph (same shape as when captured). */
export function restore(dst: Record<string, unknown>, data: { [k: string]: Plain }): void {
  for (const [k, v] of Object.entries(data)) dst[k] = assign(dst[k], v);
}

function assign(cur: unknown, v: Plain): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Float64Array || v instanceof Float32Array) return v.slice();
  if (Array.isArray(v)) {
    // Arrays of instances (filters, motors) keep them; everything else is rebuilt.
    const old = Array.isArray(cur) ? cur : [];
    return v.map((x, i) => assign(old[i], x));
  }
  // A class instance is filled in place (keeps its prototype and wiring). Plain objects are
  // rebuilt, so aliasing in the target (say `prev === state`) can't cross-write.
  if (cur && typeof cur === 'object' && Object.getPrototypeOf(cur) !== Object.prototype) {
    restore(cur as Record<string, unknown>, v);
    return cur;
  }
  // (Instances inside a plain container, like a record of filters, are still kept.)
  const old = cur && typeof cur === 'object' ? (cur as Record<string, unknown>) : {};
  const fresh: Record<string, unknown> = { ...old };
  for (const [k, x] of Object.entries(v)) fresh[k] = assign(old[k], x);
  return fresh;
}
