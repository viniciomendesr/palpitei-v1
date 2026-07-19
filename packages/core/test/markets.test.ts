import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketEngine, START_BALANCE_CENTS } from "../src/markets.ts";
import type { Fixture, RoomMessage } from "../src/types.ts";
import { makeFakeStore } from "./fake-store.ts";

const FX: Fixture = { fixtureId: 222, p1: "França", p2: "Alemanha" };

function makeMarket() {
  const emitted: RoomMessage[] = [];
  const fake = makeFakeStore();
  const me = new MarketEngine({ fixture: FX, emit: (m) => emitted.push(m), ports: fake.ports });
  return { me, emitted, createUser: fake.createUser, fake };
}

test("a stake debits the balance and feeds the pool; input validation", () => {
  const { me, createUser } = makeMarket();
  const ana = createUser("ana_m");

  const ok = me.placeBet(ana, "p1", 2000, 1000);
  assert.ok(ok.ok);
  assert.equal(ana.balanceCents, START_BALANCE_CENTS - 2000);
  assert.equal(me.market.pools.p1, 2000);

  const poor = me.placeBet(ana, "p1", 999_999, 1000);
  assert.deepEqual(poor, { ok: false, error: "saldo insuficiente" });

  const badAmount = me.placeBet(ana, "p1", 10.5, 1000);
  assert.deepEqual(badAmount, { ok: false, error: "valor inválido" });

  const badOutcome = me.placeBet(ana, "xx" as any, 100, 1000);
  assert.deepEqual(badOutcome, { ok: false, error: "resultado inválido" });
});

test("the market closes on time: a stake with ts >= closesAt is refused", () => {
  const { me, createUser } = makeMarket();
  const bob = createUser("bob_m");

  me.setCloseAt(5000);
  assert.ok(me.placeBet(bob, "draw", 1000, 4999).ok);

  const late = me.placeBet(bob, "draw", 1000, 5000);
  assert.deepEqual(late, { ok: false, error: "mercado fechado" });
  assert.equal(me.market.state, "closed");
});

test("resolve pays the winners in whole cents (5% rake, dust to the house)", () => {
  const { me, emitted, createUser } = makeMarket();
  const ana = createUser("ana_m2");
  const bob = createUser("bob_m2");
  const carl = createUser("carl_m2");

  assert.ok(me.placeBet(ana, "p1", 999, 100).ok);
  assert.ok(me.placeBet(bob, "p1", 1000, 100).ok);
  assert.ok(me.placeBet(carl, "draw", 1500, 100).ok);

  const total = 999 + 1000 + 1500; // 3499
  const distributable = Math.floor((total * 9500) / 10000); // 3324
  const winnersPool = 1999;

  me.resolve("p1");

  assert.equal(me.market.state, "resolved");
  assert.equal(me.market.winner, "p1");

  const payoutAna = Math.floor((999 * distributable) / winnersPool); // 1661
  const payoutBob = Math.floor((1000 * distributable) / winnersPool); // 1662
  const sum = payoutAna + payoutBob;
  assert.ok(sum <= distributable, "the sum of payouts does not exceed the distributable amount");
  assert.ok(distributable - sum >= 0, "dust is never negative");

  assert.equal(ana.balanceCents, START_BALANCE_CENTS - 999 + payoutAna);
  assert.equal(bob.balanceCents, START_BALANCE_CENTS - 1000 + payoutBob);
  assert.equal(carl.balanceCents, START_BALANCE_CENTS - 1500);

  const msg = emitted.find((m) => m.type === "market_resolved")!;
  assert.ok(msg);
  const pAna = msg.payouts.find((p: any) => p.userId === ana.id);
  assert.equal(pAna.amountCents, payoutAna);
  assert.equal(pAna.handle, "ana_m2");
});

test("nobody got it right => full refund with no rake", () => {
  const { me, createUser } = makeMarket();
  const ana = createUser("ana_m3");
  const bob = createUser("bob_m3");

  assert.ok(me.placeBet(ana, "p1", 3000, 100).ok);
  assert.ok(me.placeBet(bob, "draw", 2000, 100).ok);

  me.resolve("p2");

  assert.equal(me.market.refunded, true);
  assert.equal(ana.balanceCents, START_BALANCE_CENTS);
  assert.equal(bob.balanceCents, START_BALANCE_CENTS);
});

test("resolving twice is a no-op: it does not pay out twice", () => {
  const { me, emitted, createUser } = makeMarket();
  const ana = createUser("ana_m4");
  const bob = createUser("bob_m4");

  assert.ok(me.placeBet(ana, "p1", 1000, 100).ok);
  assert.ok(me.placeBet(bob, "draw", 1000, 100).ok);

  me.resolve("p1");
  const balanceAfterFirst = ana.balanceCents;

  me.resolve("p1");
  assert.equal(ana.balanceCents, balanceAfterFirst, "a second resolve does not credit again");
  assert.ok(
    emitted.some((m) => m.type === "log" && m.level === "warn"),
    "a second resolve produces a warning log"
  );
  assert.equal(emitted.filter((m) => m.type === "market_resolved").length, 1);
});
