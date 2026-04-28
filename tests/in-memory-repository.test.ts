import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AccountNotFoundError,
  InMemoryAccountRepository,
  type Account,
  type LedgerEntry,
} from "../src/index.js";

function makeAccount(ownerName = "owner"): Account {
  return {
    id: randomUUID(),
    ownerName,
    createdAt: new Date(),
  };
}

function makeEntry(
  accountId: string,
  direction: "credit" | "debit",
  amount: bigint,
  overrides: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id: randomUUID(),
    transactionId: randomUUID(),
    accountId,
    direction,
    amount,
    operation: "deposit",
    postedAt: new Date(),
    ...overrides,
  };
}

let repo: InMemoryAccountRepository;

beforeEach(() => {
  repo = new InMemoryAccountRepository();
});

describe("InMemoryAccountRepository", () => {
  test("create + findById round-trips account metadata", async () => {
    const account = makeAccount();
    await repo.create(account);
    expect(await repo.findById(account.id)).toEqual(account);
  });

  test("findById returns null for missing account", async () => {
    expect(await repo.findById("missing")).toBeNull();
  });

  test("computeBalance is 0 for a newly created account", async () => {
    const account = makeAccount();
    await repo.create(account);
    expect(await repo.computeBalance(account.id)).toBe(0n);
  });

  test("appendEntries writes credits and debits, computeBalance derives the sum", async () => {
    const account = makeAccount();
    await repo.create(account);
    await repo.appendEntries([
      makeEntry(account.id, "credit", 500n),
      makeEntry(account.id, "debit", 200n),
      makeEntry(account.id, "credit", 50n),
    ]);
    expect(await repo.computeBalance(account.id)).toBe(350n);
    expect(await repo.listEntries(account.id)).toHaveLength(3);
  });

  test("appendEntries writes multiple entries atomically across accounts", async () => {
    const a = makeAccount();
    const b = makeAccount();
    await repo.create(a);
    await repo.create(b);
    const txnId = randomUUID();
    await repo.appendEntries([
      makeEntry(a.id, "debit", 100n, { transactionId: txnId, operation: "transfer" }),
      makeEntry(b.id, "credit", 100n, { transactionId: txnId, operation: "transfer" }),
    ]);
    expect(await repo.computeBalance(a.id)).toBe(-100n);
    expect(await repo.computeBalance(b.id)).toBe(100n);
  });

  test("appendEntries rejects if any target account is missing and writes nothing", async () => {
    const a = makeAccount();
    await repo.create(a);
    await expect(
      repo.appendEntries([
        makeEntry(a.id, "credit", 100n),
        makeEntry("missing", "debit", 100n),
      ]),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
    expect(await repo.computeBalance(a.id)).toBe(0n);
  });

  test("listEntries throws for missing account", async () => {
    await expect(repo.listEntries("missing")).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  test("computeBalance throws for missing account", async () => {
    await expect(repo.computeBalance("missing")).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  test("idempotency log records and returns the same record", async () => {
    await repo.recordRequest("req-1", { operation: "deposit", result: { ok: true } });
    expect(await repo.getRequestRecord("req-1")).toEqual({
      operation: "deposit",
      result: { ok: true },
    });
    expect(await repo.getRequestRecord("nope")).toBeNull();
  });
});
