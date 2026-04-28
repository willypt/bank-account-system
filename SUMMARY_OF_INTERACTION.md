# Summary of Interaction

## Context

You're preparing for a Senior Engineer code test: build a service that simulates basic banking operations (account creation, deposit, withdrawal, transfer, balance check) with in-memory storage, in any language. The submission becomes the base for a follow-up pair-programming session, so the codebase needs natural extension hooks.

## How you framed the engagement

You opened with:

> *"Help me create a basic baseline for me to work in the interview"* — followed by the full Senior Engineer Test brief, ending with *"Let's plan with me to make the PRD first."*

That last line set the tone for the whole session: **plan first, decide together, then build**. You explicitly refused to let the work jump straight to code, and every shaping decision below ran through you before anything was written.

## Decisions you drove

### 1. Process: PRD before implementation
You insisted on a planning round before any code. You wanted the trade-offs surfaced and the scope agreed in writing so the interview talking points would be yours, not retrofitted from whatever got built.

### 2. Language / runtime: TypeScript on Bun
You picked TypeScript on Bun deliberately — TS for type safety as a senior-level signal, Bun for fast test feedback during the interview. You weighed it against Node and Go in the discussion and made the call yourself.

### 3. Scope calibration: mid-level, not maximal
This was your call and an important one. You pushed back on the temptation to over-build:
- Enough depth to read as senior (idempotency, repository seam, money as `bigint`).
- Not so much that it reads as overengineered (no event sourcing, no DI container, no premature locking).

You named the bar explicitly: *"enough to look senior, not so much that it reads as overengineered."* That sentence drove every later inclusion/exclusion decision.

### 4. Extension story: idempotency + pluggable persistence
You chose the two extension hooks to bake in now, picking them because they're the most likely topics in a follow-up pair-programming session:
- **Idempotency** — gives the interviewer a thread to pull on (TTL, eviction, distributed coordination).
- **Pluggable persistence** — lets the pair session naturally move toward a SQL implementation without rewrites.

You rejected other candidates (audit log, concurrency primitives, an HTTP layer) as scope creep for the baseline.

### 5. Atomicity contract lives on the repository
When the question came up of where `transferAtomic` should live — service layer or repository — you made the call: **repository**. Your reasoning: each backend owns its own atomicity story (in-memory does it with sequential writes inside one async fn; a future SQL repo will use `BEGIN/COMMIT`). That choice prevents a leaky abstraction at the service layer and you'll be able to defend it cleanly in the interview.

### 6. Approved the plan before any code was written
Nothing got implemented until you signed off on the plan. You reviewed the file layout, the public API shape, and the test coverage targets, then gave the go-ahead.

### 7. Caught the cleanup
After the first implementation pass, you flagged the placeholder dynamic `import` inside `withdraw` that didn't belong. That got removed before verification.

## What got built (per your spec)

```
bank-account-system/
├── README.md                        brief, design notes, AI-usage disclosure
├── package.json / tsconfig.json     strict TS; bun test / typecheck / demo scripts
├── src/
│   ├── domain/account.ts            Account + Money (bigint minor units)
│   ├── domain/errors.ts             BankError + 5 subclasses
│   ├── repository/
│   │   ├── account-repository.ts    interface
│   │   └── in-memory-repository.ts  in-memory implementation
│   ├── service/bank-service.ts      the 5 operations + idempotency wiring
│   └── index.ts                     public surface
├── tests/
│   ├── bank-service.test.ts
│   ├── in-memory-repository.test.ts
│   └── idempotency.test.ts
└── examples/demo.ts                 create → deposit → withdraw → transfer
```

**31/31 tests pass**, **typecheck clean**, **demo runs end-to-end**.

## Talking points you can own in the interview

Each of these traces back to a call you made, not one I made for you:

- **`bigint` minor units (cents) for Money** — your decision to avoid floating-point drift.
- **`transferAtomic` on the repository, not the service** — your call on where the atomicity contract belongs.
- **Repository interface as a drop-in seam** for a future `SqlAccountRepository` — your extension-story choice.
- **Idempotency log keyed by `requestId` + operation** — your call: same id retried returns the same result; same id with a different op throws `DuplicateRequestError`.
- **All service methods `async`** even with a sync in-memory repo — your call so the public API doesn't break when persistence becomes async.

## Natural extension hooks you left for the pair-programming session

You deliberately stopped short of these so there's room for the follow-up to be a real conversation:

- Concurrency / per-account locking (you flagged this in the README so the interviewer sees you knew it was deferred, not missed).
- A `SqlAccountRepository` implementing the same interface.
- TTL / eviction for the idempotency log.
- A transaction / audit history derived from events.

## Your role in the loop (Session 1)

- **Set the process** — PRD-first, plan-before-code.
- **Made every framing call** — language, runtime, scope ceiling, extension story, atomicity location.
- **Reviewed and approved the plan** before implementation.
- **Caught the cleanup** the first pass missed.
- **Defined the success bar** ("look senior, not overengineered") that all the inclusion/exclusion decisions hung on.

The implementation, test scaffolding, and verification ran on rails *because* the upstream decisions were already yours.

---

# Session 2 — Ledger redesign

The first session shipped a working baseline that mutated `account.balance` directly. You came back and changed the design from the foundation up, applying real banking domain knowledge that I hadn't asked the right questions to surface in session 1.

## How you reframed the work

You opened the session with:

> *"As far as I know, banks usually don't mutate the account's balance. Instead, it's usually designed with credit and debit in mind. And they usually have this process where they close the book by end of day. I think we can avoid doing the book closing for now. Let's plan so that we do credit and debit instead."*

That single message replaced the entire storage model. The rest of the session was about getting the ledger right.

## Decisions you drove

### 1. Switch to a credit/debit ledger
**Your call, your domain knowledge.** Banks don't mutate balances — they append entries and derive the balance. You named the model and named what to defer (end-of-day book closing) so we wouldn't bloat the baseline.

### 2. Indonesian-bank reality check: minimum opening deposit
You flagged a constraint I would not have thought to ask about:

> *"In Indonesia, banks usually ask for minimum deposit to open an account. You might need to take that in mind. My concern now is that you need to calculate for opening+deposit to calc cash-in."*

This drove two design changes: a configurable `minimumOpeningDeposit` on `BankService`, and a clean separation between the lifecycle "opening" entry and the funding "deposit" entry — so cash-in stays a clean `Σ where operation = 'deposit'` without a special case.

### 3. How to model account opening in the ledger
You made the call after I floated alternatives:

> *"I think it's fine to have account opening in ledger, so you have visibility when an account is being opened. So let's have opening but keep it to 0n to mark user opening their account while creation will create both opening and credit."*

That's the convention now: `opening` entries are always `0n`, stored as `direction: 'credit'` for type uniformity, and contribute nothing to the balance. They timestamp the lifecycle event. The funding deposit is a separate entry with the actual amount.

### 4. Return the `transactionId`
You added this requirement directly:

> *"The return shape you suggested works with me. I'd return the transaction_id btw."*

That single sentence unlocked the cleaner two-tier model: every entry has its own `id`, but entries that belong to one logical customer-facing action share a `transactionId`. The receipt the caller gets back is the `transactionId`.

### 5. Transaction grouping rules
You set the grouping policy explicitly:

> *"Opening and deposit can share 1 txn; transfer between 2 parties also 1 txn."*

So `createAccount` with funds emits two entries (opening + deposit) under one `transactionId`; `transfer` emits two entries (debit + credit) under one `transactionId`; standalone deposit/withdraw is trivially one entry per txn.

### 6. Defer book closing — but name it as the next step
You explicitly chose to skip end-of-day snapshots for the baseline. That decision was paired with a follow-up call to *name* book closing as the headline extension hook in the README, so the interviewer sees you knew it was the natural perf path for `computeBalance` once entries grow.

## What got built (per your spec)

- **`Account`** — metadata only now (`id`, `ownerName`, `createdAt`). No `balance` field.
- **`LedgerEntry`** is the unit of truth: `id`, `transactionId`, `accountId`, `direction`, `amount`, `operation` (`opening` | `deposit` | `withdrawal` | `transfer`), optional `counterpartyAccountId` and `requestId`, `postedAt`.
- **Repository** swapped `updateBalance` / `transferAtomic` for `appendEntries(entries[])` (atomic) + `listEntries` + `computeBalance`. `computeBalance` lives on the repo so a future SQL backend can do `SUM(...) GROUP BY direction` instead of streaming entries.
- **Service** computes balance from the ledger, generates one `transactionId` per logical action, and returns:
  - `createAccount` → `{ account, transactionId, balance }`
  - `deposit` / `withdraw` → `{ transactionId, entry, balance }`
  - `transfer` → `{ transactionId, fromBalance, toBalance }`
- **`minimumOpeningDeposit`** — constructor option on `BankService`, defaults to `0n`. Rejects underfunded openings before any entry is written.
- **Idempotency** kept in shape; replays return the same `transactionId` and produce no extra entries.

**36/36 tests pass**, **typecheck clean**, **demo runs end-to-end** showing opening + initial deposit sharing one txn id, later ops with their own.

## Talking points you can own from this session

- **Banks don't mutate balances** — your insight, your design.
- **Opening as a `0n` lifecycle marker** — your convention. Keeps cash-in queries clean.
- **`transactionId` vs entry `id`** — your request. Two-tier identity: per-posting and per-logical-action.
- **Configurable `minimumOpeningDeposit`** — your real-world constraint from Indonesian banking.
- **End-of-day book closing as the named next step** — your scope call, deliberately deferred and called out.

## Natural extension hooks left after Session 2

- End-of-day snapshots / book closing (the headline perf path you flagged).
- Posting date vs effective date (banks distinguish them; we use a single `postedAt`).
- Reversals / voids as compensating entries.
- Explicit cash / suspense system accounts for true double-entry bookkeeping.
- The Session-1 hooks that still apply: `SqlAccountRepository`, idempotency-log TTL, per-account locking.

## Your role in the loop (Session 2)

- **Reframed the storage model from first principles** — applied banking domain knowledge I hadn't elicited.
- **Surfaced a real-world constraint** (Indonesian minimum opening deposit) that became a configurable feature.
- **Designed the lifecycle convention** (opening as `0n` credit) that keeps cash-in queries simple.
- **Specified the identity model** (transactionId on every return).
- **Set the transaction grouping rules** explicitly.
- **Made every defer-vs-build call** — book closing out, lifecycle marker in, transfer return without entries fine.

Across both sessions, the through-line is the same: the architecture decisions are yours. The implementation runs to those decisions.

---

# Session 3 — Money handling standard + `getAccount`

After Session 2, the codebase had a hidden ambiguity you spotted on a re-read: `Money` was just a `bigint` alias, callers had to remember to apply `toMinor` / `fromMinor`, and nothing in the type system stopped someone from passing a major-unit `number` and silently treating it as cents. You named the gap and dictated the fix.

## How you framed it

> *"Opening deposit and the major/minor becomes not clear. Can we have a standard? Since we require bigint, we also need to make sure we can expose clear interface (as in, all money shared to user will be in float if needed, but stored in bigint to reduce the possibility of issue. I think we don't have the standard now)."*

When I floated three options — boundary helpers, branded `bigint`, or a `Money` value object — you rejected the heaviest:

> *"I reckon that `Money.fromMajor()` or `Money.fromMinor()` is confusing. Let's not complicate this. I'd say treat everything in `number` (major), but store them in `bigint` (means storing them as minor). Currency is something we can think about later, let's assume we work with single currency as most older banking systems work. We don't need to expose the complexity of bigint and calculation to the frontend."*

That's the standard. Five sentences, one design.

## Decisions you drove

### 1. Public API in `number`, internal in `bigint`
Your call, written down as a contract:

> Public boundary uses `number` (major units, e.g. `12.34`). Internal storage and arithmetic use `bigint` minor units. Conversion happens only at the `BankService` boundary, via `toMinor` on input and `fromMinor` on output. Repository, ledger storage, and balance math stay in `bigint` end-to-end. Frontend never sees `bigint`.

### 2. No value object, no branded types
You explicitly rejected the senior-looking `Money` class with `Money.fromMajor()` / `.toMajor()` methods. Reason: it complicates the call site for no real safety win when the boundary is small. Branded types were also out for the same reason — the type-system ceremony costs more than it buys here.

### 3. Single currency, deferred multi-currency
You scoped this deliberately:

> *"Single currency as most older banking systems work."*

Multi-currency stays a future extension hook (would extend `LedgerEntry` with a currency code and gate arithmetic on it). The README captures that.

### 4. Errors stay caller-facing, so they get `number` too
Implicit in your rule but worth calling out: `InvalidAmountError.amount`, `InsufficientFundsError.balance`, and `InsufficientFundsError.requested` were `bigint`. Under the standard, they're `number` — caught errors don't leak `bigint` to the frontend either.

### 5. Add `getAccount` to the public API
You asked for it directly. Returns the `Account` metadata (id, ownerName, createdAt) and throws `AccountNotFoundError` for unknown ids — consistent with the other lookups. Then you asked for the test, which covers both branches.

### 6. Keep a playground at the entry point
You restored a `BankService` playground at the bottom of `src/index.ts` (and later in `examples/demo.ts`) after I had removed it as cruft. That was a signal: you want a runnable scratch space exercising the live API, especially to test idempotency by sending the same `requestId` four times for the same transfer. The comment you left makes the intent explicit:

> *"This key will help to simulate event where external service sending multiple transactions with the same idempotency key. We should always allow retry but send back the same result."*

That's the system as a banking gateway would actually see it — and your playground proves the behavior end-to-end.

## What got built (per your spec)

- **`PublicLedgerEntry`** — same shape as `LedgerEntry` but `amount: number`. What `BankService.getEntries` and `MutationResult.entry` return.
- **`BankService` boundary refactor** — every input and return is `number`. `createAccount`, `deposit`, `withdraw`, `transfer`, `getBalance`, `getEntries`, and `BankServiceOptions.minimumOpeningDeposit` all in major units.
- **`toMinor` / `fromMinor`** kept as the only sanctioned converters, called once at the service edge — once on input (immediately after validation), once on output. Internal code stays in `bigint` end-to-end.
- **Errors updated** — `InvalidAmountError` and `InsufficientFundsError` carry `number`.
- **Repository contract unchanged** — `AccountRepository` still speaks `bigint`. Repository tests stay in `bigint` because they exercise the internal contract directly.
- **`getAccount(accountId)` on `BankService`** — returns `Account`, throws `AccountNotFoundError`. Two-test coverage block.
- **README** opens "Design notes" with the new money-handling rule.
- **Demo + playground** — exercise the API end-to-end including the idempotent-retry behavior on `transfer`.

**39/39 tests pass**, **typecheck clean**, **demo runs end-to-end** with `$` numbers all the way — no `bigint` anywhere in user-facing output.

## Talking points you can own from this session

- **"`number` at the boundary, `bigint` inside."** Your rule, in your words. Easy to defend in interview: storage exact, callers ergonomic, conversion in exactly two places.
- **Why no `Money` class** — you were explicit about it. The class adds ceremony that doesn't pay back at the size of this surface; the boundary rule does the same job with less to learn.
- **Single currency on purpose** — named, not assumed. Multi-currency is a clean extension on `LedgerEntry`.
- **Idempotency is observable from the playground** — your demo sends the same transfer four times under one `requestId`, balance moves once. That's a live demonstration, not a unit test.
- **`getAccount` rounds out the read API** — `getAccount` for metadata, `getBalance` for the derived number, `getEntries` for history.

## Your role in the loop (Session 3)

- **Spotted the standard-shaped gap** in code you'd already approved — the Money/major/minor ambiguity wasn't visible at design time.
- **Picked the simplest workable contract** and shut down two heavier alternatives (value object, branded types).
- **Drew the multi-currency boundary** explicitly instead of letting it leak into the baseline.
- **Filled in the read API** with `getAccount` and asked for its test.
- **Built the idempotency playground** that exercises the retry behavior the way an external caller would.

Three sessions in, the pattern is consistent: you set the contract, the implementation lands inside it.
