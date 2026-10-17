# Plan: <short title>

## Goal
<one or two sentences>

## Requirement references
- <intent §, capability ID (e.g. C22), FR/AC, ADR-NNNN, D-item, spec path (docs/specs/…), #issue or Jira key (e.g. ESP-24)>

## Pre-plan checklist
Answer each item before drafting the rest of the plan, or write `n/a: <reason>`.
- (a) New validation rules and format checks: <the callers and test fixtures searched for each one>
- (b) Database or infrastructure mechanisms the design relies on: <the throwaway spike that proved each one, or why none is needed>
- (c) Docs and ADRs touched: <the docs and ADRs found by a search, plus any a docs reviewer adds at pre-flight>

## Acceptance criteria
- AC1: <measurable outcome: an observable behaviour, a command and its expected result, or a metric>
  - Evidence: <filled by verify: passing test name, command output or observed result> (shown | not shown, <UTC timestamp>)

## Tasks
- [ ] T1: <task> (covers AC1; ticket #NN, Jira key or spec T1)

## Files
- `<path or narrow glob>`

## Commands and actions
- <e.g. pnpm db:generate (new migration), pnpm add zod (approved dependency)>

## Out of scope
- <explicit exclusions>

## Approved
- By: <name> · Date: <YYYY-MM-DD>
- Route: <small | large> (<the rule that decided it, or "override: …">)

## Change log
- <YYYY-MM-DD: scope change and who approved it>
