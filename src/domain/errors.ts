import type { AccountId } from "./account.js";

export class BankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends BankError {
  constructor(public readonly accountId: AccountId) {
    super(`Account not found: ${accountId}`);
  }
}

export class InsufficientFundsError extends BankError {
  constructor(
    public readonly accountId: AccountId,
    public readonly balance: number,
    public readonly requested: number,
  ) {
    super(
      `Insufficient funds in account ${accountId}: balance=${balance}, requested=${requested}`,
    );
  }
}

export class InvalidAmountError extends BankError {
  constructor(public readonly amount: number, reason: string) {
    super(`Invalid amount ${amount}: ${reason}`);
  }
}

export class SameAccountTransferError extends BankError {
  constructor(public readonly accountId: AccountId) {
    super(`Cannot transfer to the same account: ${accountId}`);
  }
}

export class DuplicateRequestError extends BankError {
  constructor(
    public readonly requestId: string,
    public readonly originalOperation: string,
    public readonly attemptedOperation: string,
  ) {
    super(
      `Request id ${requestId} was previously used for ${originalOperation}, ` +
        `cannot reuse for ${attemptedOperation}`,
    );
  }
}
