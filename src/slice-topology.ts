/**
 * Topological layering of slice dependencies.
 *
 * v8.63 introduced `Slice.dependsOn: SliceId[]` so the architect can
 * declare which slices a builder must implement after which others.
 * v8.64 wires that data into the builder's per-slice loop: independent
 * slices (those whose `dependsOn` is satisfied by previously-shipped
 * layers) run in PARALLEL, while dependent slices block on their
 * predecessors.
 *
 * `topologicalLayers` is the small pure utility that converts the flat
 * `SliceState[]` list into an ordered array of **layers**. Every layer
 * is a set of slices whose `dependsOn` is satisfied by the union of
 * all prior layers. A layer of size 1 falls back to the historical
 * sequential cycle; a layer of size ≥2 is what the builder dispatches
 * in parallel.
 *
 * The function is intentionally tiny: validation surfaces (cycles,
 * unknown dependsOn ids) throw informative `Error`s so the builder's
 * dispatch path can surface a finding (architect-side fix) rather
 * than silently mis-order the build.
 */

import type { Slice, SliceId, SliceState } from "./types.js";

/**
 * Minimal shape required by {@link topologicalLayers}. The full
 * {@link SliceState} satisfies this; the broader {@link Slice}
 * (plan-md parser shape, no lifecycle fields) also satisfies it. The
 * helper takes the intersection so callers can layer either shape
 * without copying.
 */
export type LayerableSlice = Pick<Slice | SliceState, "id" | "dependsOn">;

/**
 * Group `slices` into topologically-ordered layers.
 *
 * A **layer** is the maximal set of slices whose entire `dependsOn`
 * list is satisfied by the union of every previous layer. The first
 * layer therefore contains every slice with an empty `dependsOn`; the
 * second contains every slice whose `dependsOn` is a subset of layer
 * 1; and so on.
 *
 * Determinism: within a layer, slice ids are sorted by their numeric
 * suffix (`SL-1` < `SL-2` < `SL-10`), so the orchestrator and the
 * reviewer see the same dispatch order regardless of the
 * `flow-state.json` array ordering.
 *
 * Failure modes:
 * - A slice that references a `dependsOn` id absent from the input
 *   throws `Error("topologicalLayers: SL-X dependsOn unknown id SL-Y")`.
 * - A cycle (direct `SL-A → SL-B → SL-A` or transitive across N
 *   slices) throws `Error("topologicalLayers: cycle detected ...")`
 *   listing the slices that could not be scheduled. The error names
 *   every still-pending slice so the architect can locate the loop.
 *
 * Empty input returns `[]`. A duplicate slice id in the input throws
 * `Error("topologicalLayers: duplicate slice id SL-N")` — the caller
 * (orchestrator / builder) should have de-duped before passing.
 */
export function topologicalLayers<S extends LayerableSlice>(slices: readonly S[]): S[][] {
  if (slices.length === 0) return [];

  const byId = new Map<SliceId, S>();
  for (const slice of slices) {
    if (byId.has(slice.id)) {
      throw new Error(`topologicalLayers: duplicate slice id ${slice.id}`);
    }
    byId.set(slice.id, slice);
  }

  for (const slice of slices) {
    for (const dep of slice.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(
          `topologicalLayers: ${slice.id} dependsOn unknown id ${dep}`,
        );
      }
    }
  }

  const settled = new Set<SliceId>();
  const layers: S[][] = [];
  let remaining = [...slices];

  while (remaining.length > 0) {
    const ready = remaining.filter((slice) =>
      slice.dependsOn.every((dep) => settled.has(dep)),
    );
    if (ready.length === 0) {
      const pending = remaining.map((s) => s.id).join(", ");
      throw new Error(
        `topologicalLayers: cycle detected — could not schedule ${pending}`,
      );
    }
    ready.sort((a, b) => sliceIdOrder(a.id) - sliceIdOrder(b.id));
    layers.push(ready);
    for (const slice of ready) settled.add(slice.id);
    remaining = remaining.filter((slice) => !settled.has(slice.id));
  }

  return layers;
}

/**
 * `SL-N` → `N` (extracts the numeric suffix for stable layer-order
 * sorting). An id that does not match the `SL-N` shape sorts as
 * `Number.POSITIVE_INFINITY` so it lands at the end deterministically
 * rather than throwing — `topologicalLayers` already rejects unknown
 * dependsOn ids and duplicates; an unparseable id is a downstream
 * type error that should never reach this helper.
 */
function sliceIdOrder(id: SliceId): number {
  const match = /^SL-(\d+)$/.exec(id);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]);
}
