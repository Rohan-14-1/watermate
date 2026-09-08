const crypto = require("crypto");

const COLORS = ["RED", "BLUE", "GREEN", "YELLOW"];
const VALUES = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "SKIP", "REVERSE", "DRAW_TWO"
];

/**
 * Generates standard 108-card UNO deck
 */
function createDeck() {
  const deck = [];
  let cardId = 1;

  for (const color of COLORS) {
    // One '0' per color
    deck.push({
      id: `card_${cardId++}`,
      color,
      value: "0"
    });

    // Two of '1' through '9'
    for (let i = 1; i <= 9; i++) {
      const val = String(i);
      deck.push({ id: `card_${cardId++}`, color, value: val });
      deck.push({ id: `card_${cardId++}`, color, value: val });
    }

    // Two of action cards (Skip, Reverse, Draw Two)
    for (const action of ["SKIP", "REVERSE", "DRAW_TWO"]) {
      deck.push({ id: `card_${cardId++}`, color, value: action });
      deck.push({ id: `card_${cardId++}`, color, value: action });
    }
  }

  // 4 Wild cards
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `card_${cardId++}`, color: "WILD", value: "WILD" });
  }

  // 4 Wild Draw Four cards
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `card_${cardId++}`, color: "WILD", value: "WILD_DRAW_FOUR" });
  }

  return deck;
}

/**
 * Cryptographically secure Fisher-Yates shuffle
 */
function shuffleDeck(cards) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Reshuffles discard pile into draw pile if draw pile runs low/empty
 */
function replenishDrawPileIfNeeded(drawPile, discardPile, topCard) {
  let newDraw = [...drawPile];
  let newDiscard = [...discardPile];

  if (newDraw.length < 5 && newDiscard.length > 1) {
    // Keep top discard card, shuffle the rest back into draw pile
    const cardsToShuffle = newDiscard.filter(c => c.id !== topCard.id);
    const reshuffled = shuffleDeck(cardsToShuffle);
    newDraw = [...newDraw, ...reshuffled];
    newDiscard = [topCard];
  }

  return { drawPile: newDraw, discardPile: newDiscard };
}

/**
 * Validates if a card is legally playable on top of current top card & active color
 */
function isValidMove(topCard, currentColor, cardToPlay) {
  if (!cardToPlay || !topCard) return false;

  // Wild cards can always be played
  if (cardToPlay.color === "WILD") {
    return true;
  }

  // Match current active color
  const activeColor = currentColor || topCard.color;
  if (cardToPlay.color === activeColor) {
    return true;
  }

  // Match value (number or action symbol)
  if (cardToPlay.value === topCard.value) {
    return true;
  }

  return false;
}

/**
 * Calculates next player index given current index, player count, direction, and step (default 1)
 */
function getNextPlayerIndex(currentIndex, playerCount, direction, step = 1) {
  const total = playerCount;
  let next = (currentIndex + (direction * step)) % total;
  if (next < 0) {
    next += total;
  }
  return next;
}

/**
 * Deals 7 initial cards to each player from the shuffled deck
 */
function dealInitialCards(players, deck, handSize = 7) {
  const drawPile = [...deck];
  const playerHands = {};

  for (const player of players) {
    playerHands[player.userId] = [];
    for (let i = 0; i < handSize; i++) {
      if (drawPile.length > 0) {
        playerHands[player.userId].push(drawPile.pop());
      }
    }
  }

  // Pick top discard card (not Wild Draw Four)
  let topIndex = drawPile.length - 1;
  while (topIndex >= 0 && drawPile[topIndex].value === "WILD_DRAW_FOUR") {
    topIndex--;
  }

  // If all were somehow wild draw 4 (virtually impossible), take top
  if (topIndex < 0) topIndex = drawPile.length - 1;

  const topDiscardCard = drawPile.splice(topIndex, 1)[0];
  const discardPile = [topDiscardCard];

  return {
    drawPile,
    discardPile,
    topDiscardCard,
    playerHands
  };
}

module.exports = {
  COLORS,
  VALUES,
  createDeck,
  shuffleDeck,
  replenishDrawPileIfNeeded,
  isValidMove,
  getNextPlayerIndex,
  dealInitialCards
};
