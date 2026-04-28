import type {
  Account,
  AccountId,
  LedgerEntry,
  Money,
} from "../domain/account.js";
import { AccountNotFoundError } from "../domain/errors.js";
import type {
  AccountRepository,
  IdempotencyRecord,
} from "./account-repository.js";

export class InMemoryAccountRepository implements AccountRepository {
  private readonly accounts = new Map<AccountId, Account>();
  private readonly entriesByAccount = new Map<AccountId, LedgerEntry[]>();
  private readonly requests = new Map<string, IdempotencyRecord>();

  async create(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
    this.entriesByAccount.set(account.id, []);
  }

  async findById(id: AccountId): Promise<Account | null> {
    return this.accounts.get(id) ?? null;
  }

  async appendEntries(entries: readonly LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!this.accounts.has(entry.accountId)) {
        throw new AccountNotFoundError(entry.accountId);
      }
    }
    /**
     * In-memory + single-threaded JS: the loop below runs without yielding,
     * so either every entry is persisted or none are (a thrown error in the
     * pre-check above leaves the maps untouched).
     */
    for (const entry of entries) {
      this.entriesByAccount.get(entry.accountId)!.push(entry);
    }
  }

  async listEntries(accountId: AccountId): Promise<readonly LedgerEntry[]> {
    const entries = this.entriesByAccount.get(accountId);
    if (!entries) throw new AccountNotFoundError(accountId);
    return entries.slice();
  }

  async computeBalance(accountId: AccountId): Promise<Money> {
    const entries = this.entriesByAccount.get(accountId);
    if (!entries) throw new AccountNotFoundError(accountId);
    let balance = 0n;
    for (const entry of entries) {
      if (entry.direction === "credit") balance += entry.amount;
      else balance -= entry.amount;
    }
    return balance;
  }

  async recordRequest(
    requestId: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    this.requests.set(requestId, record);
  }

  async getRequestRecord(requestId: string): Promise<IdempotencyRecord | null> {
    return this.requests.get(requestId) ?? null;
  }
}
