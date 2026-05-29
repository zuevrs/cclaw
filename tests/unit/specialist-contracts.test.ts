import { describe, expect, it } from "vitest";

import { SPECIALIST_PROMPTS, ETHOS_DISCLAIMER } from "../../src/content/specialist-prompts/index.js";
import { missingSections, missingTokens } from "../helpers/contract.js";

/**
 * Structural contract for every specialist prompt.
 *
 * This is the non-brittle counterpart to the older per-feature substring
 * tests: it pins the *shape* each specialist must keep (load-bearing
 * sections + machine tokens that other components consume), not the prose.
 * A specialist prompt may be reworded or aggressively shortened and these
 * tests still pass — they only fail when a real contract surface vanishes.
 *
 * Adding a specialist? Add its contract below. Removing a section/token that
 * appears here is a deliberate, reviewed contract change.
 */

interface SpecialistContract {
  /** Markdown sections (prefix match) the prompt must contain. */
  sections: readonly string[];
  /** Literal machine tokens other components depend on. */
  tokens: readonly string[];
}

const CONTRACTS: Record<string, SpecialistContract> = {
  triage: {
    sections: ["The four-field decision", "Output schema"],
    tokens: ["ceremonyMode", "ambiguityScore"]
  },
  architect: {
    sections: ["Workflow", "Posture heuristic table", "Output schema"],
    tokens: ["plan.md"]
  },
  builder: {
    sections: ["Strict mode commit shapes", "RED phase", "GREEN phase", "REFACTOR phase", "Hard rules"],
    tokens: ["verify(AC-N): passing", "red(SL-N)", "green(SL-N)", "build.md"]
  },
  reviewer: {
    sections: ["Posture-aware TDD checks", "Decision values", "Five Failure Modes", "Output schema"],
    tokens: ["review.md", "git log"]
  },
  critic: {
    sections: ["Investigation protocol", "Escalation triggers", "Output schema"],
    tokens: ["critic.md"]
  },
  "plan-critic": {
    sections: ["When to run", "When NOT to run"],
    tokens: ["rubricMode"]
  },
  "qa-runner": {
    sections: ["Investigation protocol", "Output schema"],
    tokens: ["qa.md"]
  },
  investigator: {
    sections: ["Workflow", "Assumption audit", "Post-mortem"],
    tokens: ["root-cause"]
  }
};

const SPECIALIST_IDS = Object.keys(SPECIALIST_PROMPTS) as Array<keyof typeof SPECIALIST_PROMPTS>;

describe("specialist prompt contracts (structural, not prose)", () => {
  it("every registered specialist has a declared contract", () => {
    const undeclared = SPECIALIST_IDS.filter((id) => !(id in CONTRACTS));
    expect(undeclared, `Specialists missing a structural contract: ${undeclared.join(", ")}`).toEqual([]);
  });

  describe.each(SPECIALIST_IDS)("%s", (id) => {
    const body = SPECIALIST_PROMPTS[id];

    it("opens with its identity H1", () => {
      expect(body.startsWith(`# ${id}`)).toBe(true);
    });

    it("carries the universal dispatch + wiring sections", () => {
      expect(missingSections(body, ["Sub-agent context", "Composition"])).toEqual([]);
    });

    it("embeds the shared ethos disclaimer (single source)", () => {
      expect(body.includes(ETHOS_DISCLAIMER)).toBe(true);
    });

    it("keeps its load-bearing sections", () => {
      const missing = missingSections(body, CONTRACTS[id].sections);
      expect(missing, `${id} prompt is missing load-bearing sections: ${missing.join(", ")}`).toEqual([]);
    });

    it("keeps its machine tokens", () => {
      const missing = missingTokens(body, CONTRACTS[id].tokens);
      expect(missing, `${id} prompt is missing machine tokens other components depend on: ${missing.join(", ")}`).toEqual(
        []
      );
    });
  });
});
