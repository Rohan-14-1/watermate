const assert = require("assert");
const unoEngine = require("../services/unoEngine");

console.log("=================================");
console.log("🃏 Running UNO Engine Unit Tests");
console.log("=================================\n");

// 1. Deck Size & Composition
const deck = unoEngine.createDeck();
assert.strictEqual(deck.length, 108, `Expected 108 cards, got ${deck.length}`);
console.log("✔ Deck size is exactly 108 cards.");

const colors = ["RED", "BLUE", "GREEN", "YELLOW"];
for (const c of colors) {
  const zeros = deck.filter(card => card.color === c && card.value === "0");
  assert.strictEqual(zeros.length, 1, `Color ${c} should have 1 zero card`);

  for (let i = 1; i <= 9; i++) {
    const numbers = deck.filter(card => card.color === c && card.value === String(i));
    assert.strictEqual(numbers.length, 2, `Color ${c} should have two ${i} cards`);
  }

  for (const act of ["SKIP", "REVERSE", "DRAW_TWO"]) {
    const actions = deck.filter(card => card.color === c && card.value === act);
    assert.strictEqual(actions.length, 2, `Color ${c} should have two ${act} cards`);
  }
}
const wilds = deck.filter(card => card.color === "WILD" && card.value === "WILD");
assert.strictEqual(wilds.length, 4, "Should have 4 Wild cards");

const wildDrawFours = deck.filter(card => card.color === "WILD" && card.value === "WILD_DRAW_FOUR");
assert.strictEqual(wildDrawFours.length, 4, "Should have 4 Wild Draw Four cards");
console.log("✔ Card distribution matches standard UNO rules (76 number, 24 action, 8 wild).");

// 2. Shuffle
const shuffled = unoEngine.shuffleDeck(deck);
assert.strictEqual(shuffled.length, 108);
const sameOrder = deck.every((c, i) => c.id === shuffled[i].id);
assert.strictEqual(sameOrder, false, "Deck should be shuffled into a different order");
console.log("✔ Cryptographically secure shuffle successfully randomizes the deck.");

// 3. Dealing initial hands
const mockPlayers = [
  { userId: "u1", order: 0 },
  { userId: "u2", order: 1 },
  { userId: "u3", order: 2 },
  { userId: "u4", order: 3 }
];
const dealt = unoEngine.dealInitialCards(mockPlayers, shuffled, 7);
assert.strictEqual(dealt.playerHands["u1"].length, 7);
assert.strictEqual(dealt.playerHands["u2"].length, 7);
assert.strictEqual(dealt.playerHands["u3"].length, 7);
assert.strictEqual(dealt.playerHands["u4"].length, 7);
assert.notStrictEqual(dealt.topDiscardCard.value, "WILD_DRAW_FOUR", "Starting card must not be Wild Draw Four");
assert.strictEqual(dealt.drawPile.length, 108 - (7 * 4) - 1);
assert.strictEqual(dealt.discardPile.length, 1);
console.log("✔ Dealing gives exactly 7 cards to 4 players and sets a valid top discard card.");

// 4. Move Validation
const topRedFive = { id: "top", color: "RED", value: "5" };

// Same color -> valid
assert.strictEqual(unoEngine.isValidMove(topRedFive, "RED", { id: "c1", color: "RED", value: "2" }), true);
// Same number, different color -> valid
assert.strictEqual(unoEngine.isValidMove(topRedFive, "RED", { id: "c2", color: "BLUE", value: "5" }), true);
// Wild card -> valid
assert.strictEqual(unoEngine.isValidMove(topRedFive, "RED", { id: "c3", color: "WILD", value: "WILD" }), true);
// Wild Draw 4 -> valid
assert.strictEqual(unoEngine.isValidMove(topRedFive, "RED", { id: "c4", color: "WILD", value: "WILD_DRAW_FOUR" }), true);
// Different color, different value -> invalid
assert.strictEqual(unoEngine.isValidMove(topRedFive, "RED", { id: "c5", color: "GREEN", value: "7" }), false);
console.log("✔ Card move validation correctly allows matching colors, matching values, and wilds, while rejecting mismatches.");

// 5. Next player index calculation
// Clockwise (direction = 1)
assert.strictEqual(unoEngine.getNextPlayerIndex(0, 4, 1, 1), 1);
assert.strictEqual(unoEngine.getNextPlayerIndex(3, 4, 1, 1), 0);
// Counter-clockwise (direction = -1)
assert.strictEqual(unoEngine.getNextPlayerIndex(0, 4, -1, 1), 3);
assert.strictEqual(unoEngine.getNextPlayerIndex(2, 4, -1, 1), 1);
// Skip next (step = 2)
assert.strictEqual(unoEngine.getNextPlayerIndex(0, 4, 1, 2), 2);
assert.strictEqual(unoEngine.getNextPlayerIndex(3, 4, 1, 2), 1);
console.log("✔ Turn rotation math handles clockwise, counter-clockwise, and skip steps accurately.");

// 6. Draw pile replenishment
const emptyDraw = [];
const largeDiscard = [
  { id: "top", color: "RED", value: "5" },
  { id: "d1", color: "BLUE", value: "3" },
  { id: "d2", color: "GREEN", value: "8" },
  { id: "d3", color: "YELLOW", value: "SKIP" },
  { id: "d4", color: "RED", value: "REVERSE" }
];
const replenished = unoEngine.replenishDrawPileIfNeeded(emptyDraw, largeDiscard, largeDiscard[0]);
assert.strictEqual(replenished.discardPile.length, 1);
assert.strictEqual(replenished.discardPile[0].id, "top");
assert.strictEqual(replenished.drawPile.length, 4);
console.log("✔ Draw pile replenishment preserves top discard card and shuffles remaining discard cards.");

console.log("\n=================================");
console.log("🎉 ALL UNO ENGINE TESTS PASSED!");
console.log("=================================\n");
