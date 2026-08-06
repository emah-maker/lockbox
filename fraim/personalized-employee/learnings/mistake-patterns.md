# Mistake Patterns

Errors and anti-behaviors to avoid, with the correction that prevents recurrence.

## Pending Review - 2026-07-19

### Proposed new entry

#### [P-HIGH] Assumed structure instead of verifying the source of truth

**Recommendation**: Before extracting from or reasoning about a file, verify its actual structure against the real artifact — don't trust an assumed format or a convenient pattern.

**Why FRAIM is proposing this**: This showed up twice in one day. A data-extraction regex assumed a compact file grammar and silently returned nothing; separately, a hardware parts list was built by matching to familiar price buckets instead of reading every input from the config, so a real part was missed. Both came from assuming rather than checking the source.

**Example**: (a) The STEP CAD regex assumed `CARTESIAN_POINT('...'` with no spaces and returned **0 points**; the exporter actually writes `CARTESIAN_POINT ( 'NONE', ( ... ) )`. (b) The first Phone Box BOM omitted the mechanical override switch because the override input was pattern-matched to a generic tactile button rather than enumerated from `BTN_OVERRIDE_PIN = "GPIO10"`.

**If approved, future behavior changes**: The agent greps one real entity line to confirm format before trusting an extraction (a zero-count result triggers a format re-check, not a "no data" conclusion), and enumerates from the config/source of truth rather than pattern-matching to expectations.

**Scope if approved**: Save for all projects on this machine.

**Applies to**: all jobs.

**Review action**: Approve as-is, edit, reject, or defer.

**Technical trace**: Score 8.0. Last seen 2026-07-19. Recurrences 2. First synthesized: (pending).

---

#### [P-MED] Empty tool-config placeholders rejected by the schema validator

**Recommendation**: When a required config block has no real values, omit the block entirely rather than filling it with empty placeholders.

**Why FRAIM is proposing this**: During onboarding, the FRAIM `customizations.validation` block was scaffolded with empty-string commands as placeholders; the validator treats an empty command as invalid (not as "none"), so the first validation run failed and cost an extra cycle.

**Example**: `npx fraim workspace-config validate` failed on empty `customizations.validation.*` commands; removing the block (the project has no host build/test) validated clean.

**If approved, future behavior changes**: For projects with no host build/test, the validation block is left unset/omitted rather than populated with empty strings.

**Scope if approved**: Save for all projects on this machine.

**Applies to**: all jobs.

**Review action**: Approve as-is, edit, reject, or defer.

**Technical trace**: Score 5.0. Last seen 2026-07-19. Recurrences 1. First synthesized: (pending).
