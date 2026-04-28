export type AccountId = string;

/**
 * INTERNAL money representation: integer minor units (e.g. cents) as `bigint`.
 *
 * Money is stored, computed, and persisted as `Money` end-to-end inside the
 * service. It is **not** part of the public API — callers of `BankService`
 * pass and receive `number` values in major units. The conversion happens at
 * the service boundary via `toMinor` / `fromMinor`.
 *
 * `bigint` is used (rather than `number`) so arithmetic is exact: no
 * floating-point representation error can ever creep into a balance.
 */
export type Money = bigint;

export interface Account {
  readonly id: AccountId;
  readonly ownerName: string;
  readonly createdAt: Date;
}

export type EntryDirection = "credit" | "debit";

export type EntryOperation = "opening" | "deposit" | "withdrawal" | "transfer";

/**
 * A single posting on the ledger. This is the **storage** shape and uses
 * `Money` (bigint minor units) for `amount`. Public callers of `BankService`
 * receive `PublicLedgerEntry` instead, where `amount` is already a `number`
 * in major units. `LedgerEntry` is exported only so custom repository
 * implementations can speak the internal contract.
 *
 * `opening` entries are zero-amount markers stored as `direction: "credit"`
 * by convention. They timestamp the account-opened lifecycle event without
 * affecting balance.
 *
 * Entries belonging to one logical transaction (e.g. the debit + credit of a
 * transfer, or the opening + initial deposit of a new account) share a
 * `transactionId`.
 */
export interface LedgerEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly accountId: AccountId;
  readonly direction: EntryDirection;
  readonly amount: Money;
  readonly operation: EntryOperation;
  readonly counterpartyAccountId?: AccountId;
  readonly requestId?: string;
  readonly postedAt: Date;
}

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Boundary converter: major-unit `number` → `Money` (bigint minor units).
 * The only sanctioned way to bring a major-unit value into the internal
 * representation. Use at the public-API entry of `BankService`.
 *
 * Rounds half-away-from-zero on the cent — a `number` like `12.345` becomes
 * `1234n` (`12.34`). Callers sending sub-cent precision should round
 * deliberately on their side.
 */
export function toMinor(major: number): Money {
  if (!Number.isFinite(major)) {
    throw new RangeError(`toMinor: expected finite number, got ${major}`);
  }
  const cents = Math.round(major * MINOR_UNITS_PER_MAJOR);
  return BigInt(cents);
}

/**
 * Boundary converter: `Money` (bigint minor units) → major-unit `number`.
 * Use only when crossing the public-API exit of `BankService`. Internal
 * code stays in `bigint` end-to-end and never calls this.
 */
export function fromMinor(minor: Money): number {
  return Number(minor) / MINOR_UNITS_PER_MAJOR;
}
