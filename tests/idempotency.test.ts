import { beforeEach, describe, expect, test } from "bun:test";
import {
  BankService,
  DuplicateRequestError,
  InMemoryAccountRepository,
} from "../src/index.js";

let repo: InMemoryAccountRepository;
let service: BankService;

beforeEach(() => {
  repo = new InMemoryAccountRepository();
  service = new BankService(repo);
});

describe("idempotency", () => {
  test("retrying a deposit with the same requestId posts exactly one entry", async () => {
    const { account } = await service.createAccount({
      ownerName: "x",
      initialDeposit: 0,
    });
    const requestId = "req-deposit-1";
    const before = (await service.getEntries(account.id)).length;

    const first = await service.deposit({
      accountId: account.id,
      amount: 1,
      requestId,
    });
    const second = await service.deposit({
      accountId: account.id,
      amount: 1,
      requestId,
    });

    expect(first.balance).toBe(1);
    expect(second.balance).toBe(1);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await service.getBalance(account.id)).toBe(1);
    expect((await service.getEntries(account.id)).length).toBe(before + 1);
  });

  test("retrying a transfer with the same requestId posts exactly two entries", async () => {
    const { account: a } = await service.createAccount({
      ownerName: "a",
      initialDeposit: 5,
    });
    const { account: b } = await service.createAccount({
      ownerName: "b",
      initialDeposit: 0,
    });
    const requestId = "req-transfer-1";
    const beforeA = (await service.getEntries(a.id)).length;
    const beforeB = (await service.getEntries(b.id)).length;

    const first = await service.transfer({
      fromId: a.id,
      toId: b.id,
      amount: 2,
      requestId,
    });
    const second = await service.transfer({
      fromId: a.id,
      toId: b.id,
      amount: 2,
      requestId,
    });

    expect(second.transactionId).toBe(first.transactionId);
    expect(await service.getBalance(a.id)).toBe(3);
    expect(await service.getBalance(b.id)).toBe(2);
    expect((await service.getEntries(a.id)).length).toBe(beforeA + 1);
    expect((await service.getEntries(b.id)).length).toBe(beforeB + 1);
  });

  test("reusing a requestId for a different operation throws DuplicateRequestError", async () => {
    const { account } = await service.createAccount({
      ownerName: "a",
      initialDeposit: 1,
    });
    const requestId = "req-shared";

    await service.deposit({ accountId: account.id, amount: 0.5, requestId });
    await expect(
      service.withdraw({ accountId: account.id, amount: 0.1, requestId }),
    ).rejects.toBeInstanceOf(DuplicateRequestError);
  });

  test("operations without a requestId are not affected by the idempotency log", async () => {
    const { account } = await service.createAccount({
      ownerName: "a",
      initialDeposit: 0,
    });
    await service.deposit({ accountId: account.id, amount: 0.1 });
    await service.deposit({ accountId: account.id, amount: 0.1 });
    expect(await service.getBalance(account.id)).toBe(0.2);
  });
});
