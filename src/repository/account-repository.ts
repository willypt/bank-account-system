import type {
  Account,
  AccountId,
  LedgerEntry,
  Money,
} from "../domain/account.js";

export interface IdempotencyRecord {
  readonly operation: string;
  readonly result: unknown;
}

export interface AccountRepository {
  /** Persist account metadata. Balance is not stored on the account. */
  create(account: Account): Promise<void>;
  findById(id: AccountId): Promise<Account | null>;

  /**
   * Append one or more ledger entries atomically. Implementations must
   * guarantee all entries are persisted or none are.
   */
  appendEntries(entries: readonly LedgerEntry[]): Promise<void>;

  /** All entries posted on an account, in posting order. */
  listEntries(accountId: AccountId): Promise<readonly LedgerEntry[]>;

  /** Σ credits − Σ debits on the account. */
  computeBalance(accountId: AccountId): Promise<Money>;

  /** Idempotency log: record the result of a successful operation. */
  recordRequest(requestId: string, record: IdempotencyRecord): Promise<void>;
  getRequestRecord(requestId: string): Promise<IdempotencyRecord | null>;
}
