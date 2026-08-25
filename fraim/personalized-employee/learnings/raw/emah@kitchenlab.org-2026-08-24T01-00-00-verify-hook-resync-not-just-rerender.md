---
author: emah@kitchenlab.org
date: 2026-08-24
job: fully-delegate
context: conversational-session
---

# Coaching Moment: verify-hook-resync-not-just-rerender

## What happened

A delegated `feature-implementation` sub-agent fixed a "wheel doesn't snap back" bug in `DashboardScreen.tsx`'s minutes-wheel-reject case by changing `return p;` to `return { ...p };` in a `useState` updater, reasoning that returning a new object reference would stop React from bailing the re-render. MANdy (this agent) reviewed that fix by reasoning alone, accepted the reasoning as sufficient, and coached the sub-agent to apply exactly that one-line change. After a second manager coaching round reported the fix "still not landing," the user told MANdy to stop the coaching loop and fix it herself. Re-deriving the bug from scratch surfaced that the one-line change was necessary but not sufficient: `WheelPicker.tsx`'s own resync `useEffect` was gated on a `[selectedIndex]` dependency array, so even with a genuine parent re-render, React would still skip the effect body because the effect only re-runs when a listed dependency's *value* changes between renders, independent of whether a re-render happened for other reasons -- and in the reject case the value is deliberately unchanged. The actual fix required also removing WheelPicker's dependency array so its internal ref-based check could run on every render.

## Why it happened

The failed heuristic: "making React re-render again" was treated as equivalent to "the child's effect will observe the change and correct itself." That conflates two independent gates -- whether a component re-renders at all (governed by state reference/Object.is equality) and whether a *specific* `useEffect` inside that re-rendered component actually re-executes (governed separately by its own dependency array's value-equality check). The first coaching pass fixed only the outer gate and stopped analyzing once a plausible-sounding mechanism was found, without tracing the concrete render-by-render value of `selectedIndex` across the reject-case sequence to confirm the effect would truly fire.

## What was learned

When coaching or applying a fix for "component didn't update," trace the actual prop/dependency *values* across the specific failing render sequence end to end, not just whether a re-render will occur -- a re-render happening and a specific effect inside it firing are two separate, independently-gated conditions in React.

## What will be done to recover

Already recovered in this session: fixed `WheelPicker.tsx`'s resync effect to run with no dependency array (relying on its existing internal `settledIndexRef.current === selectedIndex` guard instead of React's dependency-array gate), in addition to the original `DashboardScreen.tsx` fix. Verified with `npx tsc --noEmit` (clean) and `npx jest` (12/12 suites, 115/115 tests passing) -- though note neither actually exercises the live gesture/render-timing path; the verification is code-level trace, not an on-device/simulator observation, since none was available in this Hub session.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: none found specific to this class of bug; `delegated-job-review-mapping`'s "Do not mark a node verified based only on the child agent's assertion" guardrail was followed (MANdy did independently re-derive the mechanism rather than trust the child's claim), but the independent re-derivation itself stopped one layer too shallow the first time.
- Suggested hardening: when a manager-review or self-fix claims a React/RN state-update or effect will "now fire correctly," require tracing the actual dependency-array contents and value sequence for every `useEffect`/`useMemo` involved in the claimed fix path, not just the outer component's re-render trigger.
- Future prevention gate: for any fix framed as "returning a new reference so it re-renders," explicitly ask "does anything downstream that needs to react to this actually have a dependency array that will detect the change" before accepting the fix as complete.

## Ways to detect and recover quickly without manager guidance

- Detection signal: a fix targets a state-update's referential equality (`return p` vs `return {...p}`) but the desired downstream correction depends on a *value* that is deliberately unchanged (a "reject and restore" case) -- that combination is a reliable signal that an intermediate effect's dependency array also needs inspection.
- Recovery path: grep the consuming component for `useEffect` and check every dependency array against the actual value sequence in the failing scenario, not just the triggering component's state update.

## What the agent should have done

On the first review pass, trace `WheelPicker.tsx`'s `useEffect` dependency array (`[selectedIndex]`) against the specific reject-case render sequence (pre-drag value -> rejected drag -> post-fix re-render) to confirm the effect would actually invoke, instead of accepting "returns a new reference, so it will re-render, so the resync effect will fire" as a complete chain of reasoning.
