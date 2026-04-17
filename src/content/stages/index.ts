// Barrel for per-stage StageSchemaInput constants. Keep this file lean — it
// should be a pure re-export surface so stage-schema.ts can import all stages
// via a single `import { ... } from "./stages/index.js"`.
export { BRAINSTORM } from "./brainstorm.js";
export { SCOPE } from "./scope.js";
export { DESIGN } from "./design.js";
export { SPEC } from "./spec.js";
export { PLAN } from "./plan.js";
export { TDD } from "./tdd.js";
export { REVIEW } from "./review.js";
export { SHIP } from "./ship.js";
