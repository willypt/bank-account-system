import { randomUUID } from "node:crypto";
import {
  fromMinor,
  toMinor,
  type Account,
  type AccountId,
  type EntryDirection,
  type EntryOperation,
  type LedgerEntry,
  type Money,
} from "../domain/account.js";
import {
  AccountNotFoundError,
  DuplicateRequestError,
  InsufficientFundsError,
  InvalidAmountError,
  SameAccountTransferError,
} from "../domain/errors.js";
import type { AccountRepository } from "../repository/account-repository.js";

/**
 * Public-facing ledger entry. Identical to the storage `LedgerEntry` except
 * `amount` is a `number` in major units. Callers of `BankService` only ever
 * see this shape — `bigint` does not leak across the public API.
 */
export interface PublicLedgerEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly accountId: AccountId;
  readonly direction: EntryDirection;
  readonly amount: number;
  readonly operation: EntryOperation;
  readonly counterpartyAccountId?: AccountId;
  readonly requestId?: string;
  readonly postedAt: Date;
}

interface BankServiceOptions {
  /**
   * Reject `createAccount` if `initialDeposit` is below this value.
   * In major units. Default `0`.
   */
  readonly minimumOpeningDeposit?: number;
}

interface CreateInput {
  ownerName: string;
  /** Major units. */
  initialDeposit: number;
}

interface MutationInput {
  accountId: AccountId;
  /** Major units. */
  amount: number;
  requestId?: string;
}

interface TransferInput {
  fromId: AccountId;
  toId: AccountId;
  /** Major units. */
  amount: number;
  requestId?: string;
}

export interface CreateAccountResult {
  readonly account: Account;
  readonly transactionId: string;
  readonly balance: number;
}

export interface MutationResult {
  readonly transactionId: string;
  readonly entry: PublicLedgerEntry;
  readonly balance: number;
}

export interface TransferResult {
  readonly transactionId: string;
  readonly fromBalance: number;
  readonly toBalance: number;
}

const OP_DEPOSIT = "deposit";
const OP_WITHDRAW = "withdraw";
const OP_TRANSFER = "transfer";

/**
 * Money handling contract:
 * - Public API takes and returns `number` in major units.
 * - `toMinor` is called once on each input, immediately after validation;
 *   from there on, everything is `bigint` (`Money`) until the return path,
 *   where `fromMinor` / `toPublicEntry` convert back.
 */
export class BankService {
  private readonly minimumOpeningDeposit: Money;

  constructor(
    private readonly repo: AccountRepository,
    options: BankServiceOptions = {},
  ) {
    this.minimumOpeningDeposit = toMinor(options.minimumOpeningDeposit ?? 0);
  }

  async createAccount(input: CreateInput): Promise<CreateAccountResult> {
    const { ownerName, initialDeposit } = input;
    if (!ownerName.trim()) {
      throw new InvalidAmountError(0, "ownerName is required");
    }
    assertNonNegative(initialDeposit, "initialDeposit");
    const initialDepositMinor = toMinor(initialDeposit);
    if (initialDepositMinor < this.minimumOpeningDeposit) {
      throw new InvalidAmountError(
        initialDeposit,
        `initialDeposit must be >= minimumOpeningDeposit (${fromMinor(this.minimumOpeningDeposit)})`,
      );
    }

    const account: Account = {
      id: randomUUID(),
      ownerName: ownerName.trim(),
      createdAt: new Date(),
    };
    await this.repo.create(account);

    const transactionId = randomUUID();
    const postedAt = new Date();
    const entries: LedgerEntry[] = [
      this.makeEntry({
        transactionId,
        accountId: account.id,
        direction: "credit",
        amount: 0n,
        operation: "opening",
        postedAt,
      }),
    ];
    if (initialDepositMinor > 0n) {
      entries.push(
        this.makeEntry({
          transactionId,
          accountId: account.id,
          direction: "credit",
          amount: initialDepositMinor,
          operation: "deposit",
          postedAt,
        }),
      );
    }
    await this.repo.appendEntries(entries);

    return { account, transactionId, balance: fromMinor(initialDepositMinor) };
  }

  async deposit(input: MutationInput): Promise<MutationResult> {
    assertPositive(input.amount, "deposit amount");
    const amountMinor = toMinor(input.amount);

    return this.withIdempotency<MutationResult>(
      input.requestId,
      OP_DEPOSIT,
      async () => {
        await this.requireAccount(input.accountId);
        const transactionId = randomUUID();
        const entry = this.makeEntry({
          transactionId,
          accountId: input.accountId,
          direction: "credit",
          amount: amountMinor,
          operation: "deposit",
          requestId: input.requestId,
          postedAt: new Date(),
        });
        await this.repo.appendEntries([entry]);
        const balance = await this.repo.computeBalance(input.accountId);
        return {
          transactionId,
          entry: toPublicEntry(entry),
          balance: fromMinor(balance),
        };
      },
    );
  }

  async withdraw(input: MutationInput): Promise<MutationResult> {
    assertPositive(input.amount, "withdraw amount");
    const amountMinor = toMinor(input.amount);

    return this.withIdempotency<MutationResult>(
      input.requestId,
      OP_WITHDRAW,
      async () => {
        await this.requireAccount(input.accountId);
        const balance = await this.repo.computeBalance(input.accountId);
        if (balance < amountMinor) {
          throw new InsufficientFundsError(
            input.accountId,
            fromMinor(balance),
            input.amount,
          );
        }
        const transactionId = randomUUID();
        const entry = this.makeEntry({
          transactionId,
          accountId: input.accountId,
          direction: "debit",
          amount: amountMinor,
          operation: "withdrawal",
          requestId: input.requestId,
          postedAt: new Date(),
        });
        await this.repo.appendEntries([entry]);
        return {
          transactionId,
          entry: toPublicEntry(entry),
          balance: fromMinor(balance - amountMinor),
        };
      },
    );
  }

  async transfer(input: TransferInput): Promise<TransferResult> {
    assertPositive(input.amount, "transfer amount");
    if (input.fromId === input.toId) {
      throw new SameAccountTransferError(input.fromId);
    }
    const amountMinor = toMinor(input.amount);

    return this.withIdempotency<TransferResult>(
      input.requestId,
      OP_TRANSFER,
      async () => {
        await this.requireAccount(input.fromId);
        await this.requireAccount(input.toId);

        const fromBalance = await this.repo.computeBalance(input.fromId);
        if (fromBalance < amountMinor) {
          throw new InsufficientFundsError(
            input.fromId,
            fromMinor(fromBalance),
            input.amount,
          );
        }
        const toBalance = await this.repo.computeBalance(input.toId);

        const transactionId = randomUUID();
        const postedAt = new Date();
        const debit = this.makeEntry({
          transactionId,
          accountId: input.fromId,
          direction: "debit",
          amount: amountMinor,
          operation: "transfer",
          counterpartyAccountId: input.toId,
          requestId: input.requestId,
          postedAt,
        });
        const credit = this.makeEntry({
          transactionId,
          accountId: input.toId,
          direction: "credit",
          amount: amountMinor,
          operation: "transfer",
          counterpartyAccountId: input.fromId,
          requestId: input.requestId,
          postedAt,
        });
        await this.repo.appendEntries([debit, credit]);

        return {
          transactionId,
          fromBalance: fromMinor(fromBalance - amountMinor),
          toBalance: fromMinor(toBalance + amountMinor),
        };
      },
    );
  }

  async getAccount(accountId: AccountId): Promise<Account> {
    return this.requireAccount(accountId);
  }

  async getBalance(accountId: AccountId): Promise<number> {
    await this.requireAccount(accountId);
    const balance = await this.repo.computeBalance(accountId);
    return fromMinor(balance);
  }

  async getEntries(accountId: AccountId): Promise<readonly PublicLedgerEntry[]> {
    await this.requireAccount(accountId);
    const entries = await this.repo.listEntries(accountId);
    return entries.map(toPublicEntry);
  }

  // ---- internals ----

  private makeEntry(fields: {
    transactionId: string;
    accountId: AccountId;
    direction: EntryDirection;
    amount: Money;
    operation: EntryOperation;
    counterpartyAccountId?: AccountId | undefined;
    requestId?: string | undefined;
    postedAt: Date;
  }): LedgerEntry {
    return {
      id: randomUUID(),
      transactionId: fields.transactionId,
      accountId: fields.accountId,
      direction: fields.direction,
      amount: fields.amount,
      operation: fields.operation,
      postedAt: fields.postedAt,
      ...(fields.counterpartyAccountId !== undefined && {
        counterpartyAccountId: fields.counterpartyAccountId,
      }),
      ...(fields.requestId !== undefined && { requestId: fields.requestId }),
    };
  }

  private async requireAccount(id: AccountId): Promise<Account> {
    const account = await this.repo.findById(id);
    if (!account) throw new AccountNotFoundError(id);
    return account;
  }

  private async withIdempotency<T>(
    requestId: string | undefined,
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    if (!requestId) return run();

    const prior = await this.repo.getRequestRecord(requestId);
    if (prior) {
      if (prior.operation !== operation) {
        throw new DuplicateRequestError(requestId, prior.operation, operation);
      }
      return prior.result as T;
    }

    const result = await run();
    await this.repo.recordRequest(requestId, { operation, result });
    return result;
  }
}

function toPublicEntry(entry: LedgerEntry): PublicLedgerEntry {
  const base: PublicLedgerEntry = {
    id: entry.id,
    transactionId: entry.transactionId,
    accountId: entry.accountId,
    direction: entry.direction,
    amount: fromMinor(entry.amount),
    operation: entry.operation,
    postedAt: entry.postedAt,
    ...(entry.counterpartyAccountId !== undefined && {
      counterpartyAccountId: entry.counterpartyAccountId,
    }),
    ...(entry.requestId !== undefined && { requestId: entry.requestId }),
  };
  return base;
}

function assertPositive(amount: number, label: string): void {
  if (!(amount > 0)) {
    throw new InvalidAmountError(amount, `${label} must be > 0`);
  }
}

function assertNonNegative(amount: number, label: string): void {
  if (!(amount >= 0)) {
    throw new InvalidAmountError(amount, `${label} must be >= 0`);
  }
}
