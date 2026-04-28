# Bank Account System

A small in-memory banking service module written in TypeScript. Supports account creation, deposit, withdrawal, transfer, and balance lookup. No HTTP layer — this is a library/service module, exercised through unit tests and an optional demo script.

## Stack

- TypeScript (strict)
- Bun (runtime, package manager, test runner)

## Getting started

```bash
bun install
bun test          # run the test suite
bun run typecheck # tsc --noEmit
bun run demo      # walk through create -> deposit -> transfer -> balance
```

## Design notes

- **Money handling: `number` at the boundary, `bigint` minor units inside.** The public `BankService` API takes and returns `number` values in major units (e.g. `12.34`). Internally — repository, ledger storage, balance arithmetic — money is stored as `bigint` minor units (cents) so no floating-point error can ever creep into a balance. Conversion happens exclusively at the service boundary via `toMinor` (on input, immediately after validation) and `fromMinor` (on output). Callers never see `bigint`. This is a deliberate single-currency model; multi-currency would extend `LedgerEntry` with a currency code and gate arithmetic on it.
- **Ledger model.** Account balances are not stored or mutated. Every operation appends one or more `LedgerEntry` postings (credit / debit), and balance is derived as `Σ credits − Σ debits`. This mirrors how real banks work and makes history a first-class concept rather than something reconstructed from change logs.
- **Account opening is in the ledger.** `createAccount` always writes an `opening` entry (`amount: 0n`, `direction: "credit"`) as a lifecycle marker, plus a separate `deposit` entry when `initialDeposit > 0`. Both entries share one `transactionId` so "account opened with funding" is queryable as a single logical event. Cash-in is then cleanly `Σ entries where operation = "deposit"` — opening never pollutes the sum.
- **`transactionId` vs entry `id`.** Each entry has its own `id`; entries belonging to one logical action share a `transactionId`. Single-entry ops (deposit, withdraw) have one of each; multi-entry ops (transfer, account-opening-with-funding) link two entries under one transactionId.
- **Configurable minimum opening deposit.** `new BankService(repo, { minimumOpeningDeposit })` rejects underfunded account creation — useful for jurisdictions where banks mandate a minimum (e.g. Indonesia). Defaults to `0n`.
- **Custom error taxonomy** (`InsufficientFundsError`, `InvalidAmountError`, `AccountNotFoundError`, `SameAccountTransferError`, `DuplicateRequestError`) all extend a `BankError` base, so callers can branch on `instanceof`.
- **Repository pattern.** `BankService` depends on the `AccountRepository` interface; the in-memory implementation can be swapped for a database without touching the service.
- **Atomic multi-entry writes.** `appendEntries` is all-or-nothing. In memory this is guaranteed by single-threaded JS; a SQL repo would wrap it in `BEGIN/COMMIT`.
- **Idempotency.** Mutating operations accept an optional `requestId`. Retries with the same id return the original result (same `transactionId`, no extra entries written); reusing an id for a different operation throws `DuplicateRequestError`.

## Layout

```
src/
  domain/       Account, Money, LedgerEntry, custom errors
  repository/   AccountRepository interface + InMemoryAccountRepository
  service/      BankService (the public API)
tests/          bun test
examples/demo.ts
```

## Out of scope (deliberately, per the brief)

- **End-of-day book closing.** The ledger grows unbounded and `computeBalance` is `O(N)` over the account's entries. The natural next step is a daily snapshot: freeze a balance, then sum entries since the last snapshot. Skipped here on purpose so the credit/debit model stays the focus.
- Persistence (no DB by design — the repository interface leaves room for one)
- HTTP API
- Authentication / authorization
- Multi-currency / FX
- Concurrency primitives (locks). The current code reasons single-threaded; per-account locking — and SQL `SELECT ... FOR UPDATE` for the funds check inside the repo's transaction — would be the natural next step in the pair-programming follow-up.
- Explicit cash / suspense system accounts for true double-entry. Today, deposit and withdraw treat "the outside world" as implicit; transfers are the only operation where both sides of the double-entry are recorded.

## Use of AI

Claude (Anthropic) was used to scaffold the project layout, draft the test matrix, and pressure-test design choices — most notably (a) using `bigint` minor units for money rather than a `number`, (b) moving from a mutable-balance model to an append-only credit/debit ledger with derived balance, and (c) tying multi-entry actions together via a shared `transactionId` distinct from each entry's own `id`. All code was reviewed line-by-line; the design decisions and trade-offs are mine.
