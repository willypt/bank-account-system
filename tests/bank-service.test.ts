import {beforeEach, describe, expect, test} from "bun:test";
import {
    AccountNotFoundError,
    BankService,
    InMemoryAccountRepository,
    InsufficientFundsError,
    InvalidAmountError,
    SameAccountTransferError,
} from "../src/index.js";

let repo: InMemoryAccountRepository;
let service: BankService;

beforeEach(() => {
    repo = new InMemoryAccountRepository();
    service = new BankService(repo);
});

describe("createAccount", () => {
    test("creates an account with a positive initial deposit", async () => {
        const result = await service.createAccount({
            ownerName: "Ada Lovelace",
            initialDeposit: 100,
        });
        expect(result.account.id).toBeTruthy();
        expect(result.account.ownerName).toBe("Ada Lovelace");
        expect(result.account.createdAt).toBeInstanceOf(Date);
        expect(result.balance).toBe(100);
        expect(result.transactionId).toBeTruthy();
        expect(await service.getBalance(result.account.id)).toBe(100);
    });

    test("writes opening + deposit entries that share one transactionId", async () => {
        const {account, transactionId} = await service.createAccount({
            ownerName: "Ada",
            initialDeposit: 5,
        });
        const entries = await service.getEntries(account.id);
        expect(entries).toHaveLength(2);

        const opening = entries.find((e) => e.operation === "opening")!;
        const deposit = entries.find((e) => e.operation === "deposit")!;
        expect(opening.amount).toBe(0);
        expect(opening.direction).toBe("credit");
        expect(deposit.amount).toBe(5);
        expect(deposit.direction).toBe("credit");
        expect(opening.transactionId).toBe(transactionId);
        expect(deposit.transactionId).toBe(transactionId);
    });

    test("zero initial deposit writes only the opening marker", async () => {
        const {account, balance} = await service.createAccount({
            ownerName: "Grace",
            initialDeposit: 0,
        });
        expect(balance).toBe(0);

        const entries = await service.getEntries(account.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.operation).toBe("opening");
        expect(entries[0]!.amount).toBe(0);
    });

    test("rejects negative initial deposit", async () => {
        await expect(
            service.createAccount({ownerName: "Alan", initialDeposit: -1}),
        ).rejects.toBeInstanceOf(InvalidAmountError);
    });

    test("rejects empty owner name", async () => {
        await expect(
            service.createAccount({ownerName: "   ", initialDeposit: 0}),
        ).rejects.toBeInstanceOf(InvalidAmountError);
    });

    test("rejects initial deposit below the configured minimum", async () => {
        const strict = new BankService(repo, {minimumOpeningDeposit: 500});
        await expect(
            strict.createAccount({ownerName: "Ina", initialDeposit: 100}),
        ).rejects.toBeInstanceOf(InvalidAmountError);
    });

    test("accepts initial deposit at the configured minimum", async () => {
        const strict = new BankService(repo, {minimumOpeningDeposit: 500});
        const {balance} = await strict.createAccount({
            ownerName: "Ina",
            initialDeposit: 500,
        });
        expect(balance).toBe(500);
    });

    test("preserves cents precision across the bigint boundary", async () => {
        const {account, balance} = await service.createAccount({
            ownerName: "Cent",
            initialDeposit: 12.34,
        });
        expect(balance).toBe(12.34);
        expect(await service.getBalance(account.id)).toBe(12.34);
    });
});

describe("deposit", () => {
    test("increases derived balance and returns the new entry", async () => {
        const {account} = await service.createAccount({
            ownerName: "x",
            initialDeposit: 1,
        });
        const result = await service.deposit({accountId: account.id, amount: 0.5});
        expect(result.balance).toBe(1.5);
        expect(result.entry.direction).toBe("credit");
        expect(result.entry.operation).toBe("deposit");
        expect(result.entry.amount).toBe(0.5);
        expect(result.transactionId).toBe(result.entry.transactionId);
        expect(await service.getBalance(account.id)).toBe(1.5);
    });

    test.each([0, -10])("rejects non-positive amount %p", async (amount) => {
        const {account} = await service.createAccount({
            ownerName: "x",
            initialDeposit: 0,
        });
        await expect(
            service.deposit({accountId: account.id, amount}),
        ).rejects.toBeInstanceOf(InvalidAmountError);
    });

    test("rejects when account is missing", async () => {
        await expect(
            service.deposit({accountId: "nope", amount: 10}),
        ).rejects.toBeInstanceOf(AccountNotFoundError);
    });
});

describe("withdraw", () => {
    test("decreases derived balance and writes a debit entry", async () => {
        const {account} = await service.createAccount({
            ownerName: "x",
            initialDeposit: 1,
        });
        const result = await service.withdraw({
            accountId: account.id,
            amount: 0.3,
        });
        expect(result.balance).toBe(0.7);
        expect(result.entry.direction).toBe("debit");
        expect(result.entry.operation).toBe("withdrawal");
        expect(result.entry.amount).toBe(0.3);
        expect(await service.getBalance(account.id)).toBe(0.7);
    });

    test("rejects overdraft and leaves the ledger unchanged", async () => {
        const {account} = await service.createAccount({
            ownerName: "x",
            initialDeposit: 0.5,
        });
        const before = await service.getEntries(account.id);
        await expect(
            service.withdraw({accountId: account.id, amount: 1}),
        ).rejects.toBeInstanceOf(InsufficientFundsError);
        expect(await service.getBalance(account.id)).toBe(0.5);
        expect(await service.getEntries(account.id)).toHaveLength(before.length);
    });

    test("rejects on missing account", async () => {
        await expect(
            service.withdraw({accountId: "nope", amount: 1}),
        ).rejects.toBeInstanceOf(AccountNotFoundError);
    });

    test("allows withdrawing the entire balance", async () => {
        const {account} = await service.createAccount({
            ownerName: "x",
            initialDeposit: 1,
        });
        const result = await service.withdraw({
            accountId: account.id,
            amount: 1,
        });
        expect(result.balance).toBe(0);
    });
});

describe("transfer", () => {
    test("moves funds between accounts and writes two linked entries", async () => {
        const {account: a} = await service.createAccount({
            ownerName: "a",
            initialDeposit: 5,
        });
        const {account: b} = await service.createAccount({
            ownerName: "b",
            initialDeposit: 1,
        });
        const result = await service.transfer({
            fromId: a.id,
            toId: b.id,
            amount: 2,
        });
        expect(result.fromBalance).toBe(3);
        expect(result.toBalance).toBe(3);

        const debit = (await service.getEntries(a.id)).find(
            (e) => e.transactionId === result.transactionId,
        )!;
        const credit = (await service.getEntries(b.id)).find(
            (e) => e.transactionId === result.transactionId,
        )!;
        expect(debit.direction).toBe("debit");
        expect(debit.counterpartyAccountId).toBe(b.id);
        expect(credit.direction).toBe("credit");
        expect(credit.counterpartyAccountId).toBe(a.id);
        expect(debit.amount).toBe(2);
        expect(credit.amount).toBe(2);
    });

    test("is atomic: failed transfer writes neither entry", async () => {
        const {account: a} = await service.createAccount({
            ownerName: "a",
            initialDeposit: 0.5,
        });
        const {account: b} = await service.createAccount({
            ownerName: "b",
            initialDeposit: 1,
        });
        const beforeA = (await service.getEntries(a.id)).length;
        const beforeB = (await service.getEntries(b.id)).length;

        await expect(
            service.transfer({fromId: a.id, toId: b.id, amount: 2}),
        ).rejects.toBeInstanceOf(InsufficientFundsError);

        expect(await service.getBalance(a.id)).toBe(0.5);
        expect(await service.getBalance(b.id)).toBe(1);
        expect((await service.getEntries(a.id)).length).toBe(beforeA);
        expect((await service.getEntries(b.id)).length).toBe(beforeB);
    });

    test("rejects self-transfer", async () => {
        const {account: a} = await service.createAccount({
            ownerName: "a",
            initialDeposit: 1,
        });
        await expect(
            service.transfer({fromId: a.id, toId: a.id, amount: 0.1}),
        ).rejects.toBeInstanceOf(SameAccountTransferError);
    });

    test("rejects transfer with non-positive amount", async () => {
        const {account: a} = await service.createAccount({
            ownerName: "a",
            initialDeposit: 1,
        });
        const {account: b} = await service.createAccount({
            ownerName: "b",
            initialDeposit: 1,
        });
        await expect(
            service.transfer({fromId: a.id, toId: b.id, amount: 0}),
        ).rejects.toBeInstanceOf(InvalidAmountError);
    });

    test("rejects when source account is missing", async () => {
        const {account: b} = await service.createAccount({
            ownerName: "b",
            initialDeposit: 0,
        });
        await expect(
            service.transfer({fromId: "nope", toId: b.id, amount: 1}),
        ).rejects.toBeInstanceOf(AccountNotFoundError);
    });

    test("rejects when destination account is missing", async () => {
        const {account: a} = await service.createAccount({
            ownerName: "a",
            initialDeposit: 1,
        });
        await expect(
            service.transfer({fromId: a.id, toId: "nope", amount: 1}),
        ).rejects.toBeInstanceOf(AccountNotFoundError);
    });
});

describe("getBalance", () => {
    test("returns the derived balance", async () => {
        const {account} = await service.createAccount({
            ownerName: "a",
            initialDeposit: 0.42,
        });
        expect(await service.getBalance(account.id)).toBe(0.42);
    });

    test("rejects on missing account", async () => {
        await expect(service.getBalance("nope")).rejects.toBeInstanceOf(
            AccountNotFoundError,
        );
    });
});

describe("getAccount", () => {
    test("returns the account metadata", async () => {
        const {account} = await service.createAccount({
            ownerName: "Ada",
            initialDeposit: 10,
        });
        const fetched = await service.getAccount(account.id);
        expect(fetched).toEqual(account);
        expect(fetched.id).toBe(account.id);
        expect(fetched.ownerName).toBe("Ada");
        expect(fetched.createdAt).toBeInstanceOf(Date);
    });

    test("rejects on missing account", async () => {
        await expect(service.getAccount("nope")).rejects.toBeInstanceOf(
            AccountNotFoundError,
        );
    });
});
