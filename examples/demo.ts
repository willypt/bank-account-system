import {BankService, InMemoryAccountRepository} from "../src";
import {randomUUID} from "node:crypto";

const bankService = new BankService(new InMemoryAccountRepository())

const {account: willypt} = await bankService.createAccount({ownerName: "Willy PT", initialDeposit: 1000})
const {account: wella} = await bankService.createAccount({ownerName: "Wella", initialDeposit: 6000})

console.log('After account opening', {
    WillyBalance: await bankService.getBalance(willypt.id),
    WellaBalance: await bankService.getBalance(wella.id),
})

await bankService.deposit({accountId: willypt.id, amount: 100, requestId: randomUUID()});
await bankService.withdraw({accountId: willypt.id, amount: 10, requestId: randomUUID()});

console.log('After WillyPT depo and withdraw event', {
    WillyBalance: await bankService.getBalance(willypt.id),
    WillyEntries: await bankService.getEntries(willypt.id),
})

console.log("=====Willy sends 200 to Wella=====")
/**
 * This key will help to simulate event where external service sending multiple transactions with the same idempotency key.
 * We should always allow retry but send back the same result
 */
const consistentIdempotencyKey = randomUUID();

await bankService.transfer({
    fromId: willypt.id,
    toId: wella.id,
    amount: 200,
    requestId: consistentIdempotencyKey
});

await bankService.transfer({
    fromId: willypt.id,
    toId: wella.id,
    amount: 200,
    requestId: consistentIdempotencyKey
});
await bankService.transfer({
    fromId: willypt.id,
    toId: wella.id,
    amount: 200,
    requestId: consistentIdempotencyKey
});
await bankService.transfer({
    fromId: willypt.id,
    toId: wella.id,
    amount: 200,
    requestId: consistentIdempotencyKey
});


console.log('After banking events', {
    WillyBalance: await bankService.getBalance(willypt.id),
    WellaBalance: await bankService.getBalance(wella.id),
    WillyLedger: await bankService.getEntries(willypt.id),
    WellaLedger: await bankService.getEntries(wella.id),
})

