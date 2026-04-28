import {BankService} from "./service/bank-service";
import {InMemoryAccountRepository} from "./repository/in-memory-repository";
import {randomUUID} from "node:crypto";

export type {
    Account,
    AccountId,
    EntryDirection,
    EntryOperation,
    LedgerEntry,
    Money,
} from "./domain/account.js";
export {fromMinor, toMinor} from "./domain/account.js";
export {
    AccountNotFoundError,
    BankError,
    DuplicateRequestError,
    InsufficientFundsError,
    InvalidAmountError,
    SameAccountTransferError,
} from "./domain/errors.js";
export type {
    AccountRepository,
    IdempotencyRecord,
} from "./repository/account-repository.js";
export {InMemoryAccountRepository} from "./repository/in-memory-repository.js";
export {
    BankService,
    type CreateAccountResult,
    type MutationResult,
    type PublicLedgerEntry,
    type TransferResult,
} from "./service/bank-service.js";