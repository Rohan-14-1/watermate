const assert = require("assert");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma/client");
const unoController = require("../controllers/unoController");

const JWT_SECRET = process.env.JWT_SECRET || "watermate-fallback-jwt-secret";

function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1d" });
}

// Mock Express Req/Res helpers
function mockReq(user, body = {}, params = {}, query = {}) {
  return {
    user,
    body,
    params,
    query,
    headers: { authorization: `Bearer ${createToken(user.id)}` }
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    write() {},
    on() {}
  };
  return res;
}

function nextErr(res) {
  return (err) => {
    if (err) {
      res.statusCode = err.status || 500;
      res.data = { message: err.message };
    }
  };
}

async function runTests() {
  console.log("===========================================");
  console.log("👥 Running 4-Player Multiplayer UNO Test");
  console.log("===========================================\n");

  // Retrieve 4 users from Sunrise Apartment
  const rohan = await prisma.user.findFirst({ where: { email: "rohan@example.com" } });
  const aman = await prisma.user.findFirst({ where: { email: "aman@example.com" } });
  const sagar = await prisma.user.findFirst({ where: { email: "sagar@example.com" } });
  const bibek = await prisma.user.findFirst({ where: { email: "bibek@example.com" } });
  const outsider = await prisma.user.findFirst({ where: { email: "test_delivery_a@watermate.local" } });

  const group = await prisma.group.findFirst({ where: { name: "Sunrise Apartment" } });

  assert(rohan && aman && sagar && bibek && group, "All 4 test users and Sunrise Apartment group must exist");
  console.log(`✔ Found group "${group.name}" with Rohan, Aman, Sagar, Bibek.`);

  // 1. Rohan creates game
  let req = mockReq(rohan, { groupId: group.id });
  let res = mockRes();
  await unoController.createGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 201, `Create game failed: ${res.data?.message}`);
  const gameId = res.data.id;
  assert.strictEqual(res.data.status, "WAITING");
  assert.strictEqual(res.data.totalPlayers, 1);
  assert.strictEqual(res.data.isCreator, true);
  console.log("✔ Step 1: Rohan successfully created UNO game lobby.");

  // 2. Aman joins
  req = mockReq(aman, {}, { gameId });
  res = mockRes();
  await unoController.joinGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200, `Aman join failed: ${res.data?.message}`);
  assert.strictEqual(res.data.totalPlayers, 2);
  console.log("✔ Step 2: Aman joined lobby.");

  // 3. Sagar joins
  req = mockReq(sagar, {}, { gameId });
  res = mockRes();
  await unoController.joinGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200, `Sagar join failed: ${res.data?.message}`);
  assert.strictEqual(res.data.totalPlayers, 3);
  console.log("✔ Step 3: Sagar joined lobby.");

  // 4. Bibek joins
  req = mockReq(bibek, {}, { gameId });
  res = mockRes();
  await unoController.joinGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200, `Bibek join failed: ${res.data?.message}`);
  assert.strictEqual(res.data.totalPlayers, 4);
  console.log("✔ Step 4: Bibek joined lobby.");

  // 5. Test duplicate join protection
  req = mockReq(bibek, {}, { gameId });
  res = mockRes();
  await unoController.joinGame(req, res, nextErr(res));
  assert.strictEqual(res.data.totalPlayers, 4, "Duplicate join should not add extra player");
  console.log("✔ Step 5: Duplicate join prevented.");

  // 6. Test outsider rejection (Tester A from another group)
  req = mockReq(outsider, {}, { gameId });
  res = mockRes();
  await unoController.joinGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 403, "Outsider from another group must be rejected (403)");
  console.log("✔ Step 6: Non-group member strictly blocked from joining.");

  // 7. Non-creator starting game rejected
  req = mockReq(aman, {}, { gameId });
  res = mockRes();
  await unoController.startGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 403, "Only creator can start game");
  console.log("✔ Step 7: Non-creator cannot start game.");

  // 8. Players ready toggle
  for (const player of [aman, sagar, bibek]) {
    req = mockReq(player, {}, { gameId });
    res = mockRes();
    await unoController.toggleReady(req, res, nextErr(res));
    assert.strictEqual(res.statusCode, 200);
  }
  console.log("✔ Step 8: Aman, Sagar, and Bibek marked Ready.");

  // 9. Rohan starts game
  req = mockReq(rohan, {}, { gameId });
  res = mockRes();
  await unoController.startGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200, `Start game failed: ${res.data?.message}`);
  assert.strictEqual(res.data.status, "PLAYING");
  assert(res.data.topDiscardCard, "Top discard card must be defined");
  console.log(`✔ Step 9: Game started! Top discard card: ${res.data.currentColor} ${res.data.topDiscardCard.value}.`);

  // 10. Privacy verification: Rohan inspects his view
  assert.strictEqual(res.data.myPlayer.cards.length, 7, "Rohan should have exactly 7 cards");
  assert.strictEqual(res.data.opponents.length, 3, "Rohan should see 3 opponents");
  for (const opp of res.data.opponents) {
    assert.strictEqual(opp.cards, undefined, "Opponent cards array must NEVER be leaked in API response");
    assert.strictEqual(opp.cardCount, 7, "Opponent card count must be public");
  }
  console.log("✔ Step 10: Player privacy validated—private hands strictly shielded on backend.");

  // 11. Fetch state for Aman and check his view
  req = mockReq(aman, {}, { gameId });
  res = mockRes();
  await unoController.getGame(req, res, nextErr(res));
  assert.strictEqual(res.data.myPlayer.cards.length, 7, "Aman should have exactly 7 cards");
  for (const opp of res.data.opponents) {
    assert.strictEqual(opp.cards, undefined, "Aman cannot see opponents' cards");
  }
  console.log("✔ Step 11: Aman sees only his cards and opponents' counts.");

  // 12. Turn enforcement: Try playing when it's NOT your turn
  const gameState = res.data;
  const currentUserId = gameState.currentPlayerId;
  const nonCurrentPlayer = [rohan, aman, sagar, bibek].find(u => u.id !== currentUserId);

  req = mockReq(nonCurrentPlayer, { cardId: "dummy_card" }, { gameId });
  res = mockRes();
  await unoController.playCard(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 403, "Move by player out of turn must return 403");
  console.log("✔ Step 12: Backend rejected move from player when it was not their turn.");

  // 13. Current player plays a valid card or draws
  const currentPlayer = [rohan, aman, sagar, bibek].find(u => u.id === currentUserId);
  req = mockReq(currentPlayer, {}, { gameId });
  res = mockRes();
  await unoController.getGame(req, res, nextErr(res));
  const myCards = res.data.myPlayer.cards;
  const topCard = res.data.topDiscardCard;
  const currColor = res.data.currentColor;

  const validCard = myCards.find(c =>
    c.color === "WILD" || c.color === currColor || c.value === topCard.value
  );

  if (validCard) {
    req = mockReq(currentPlayer, { cardId: validCard.id, chosenColor: "RED" }, { gameId });
    res = mockRes();
    await unoController.playCard(req, res, nextErr(res));
    assert.strictEqual(res.statusCode, 200, `Play card failed: ${res.data?.message}`);
    assert.strictEqual(res.data.myPlayer.cards.length, 6, "Player should have 6 cards after playing 1");
    console.log(`✔ Step 13: Current player played ${validCard.color} ${validCard.value}. Hand reduced to 6 cards.`);
  } else {
    // Draw a card
    req = mockReq(currentPlayer, {}, { gameId });
    res = mockRes();
    await unoController.drawCard(req, res, nextErr(res));
    assert.strictEqual(res.statusCode, 200, `Draw card failed: ${res.data?.message}`);
    assert.strictEqual(res.data.myPlayer.cards.length, 8, "Hand should increase to 8 cards after draw");
    console.log("✔ Step 13: Current player drew a card.");

    // Pass turn
    req = mockReq(currentPlayer, {}, { gameId });
    res = mockRes();
    await unoController.passTurn(req, res, nextErr(res));
    assert.strictEqual(res.statusCode, 200, `Pass turn failed: ${res.data?.message}`);
    console.log("✔ Step 13b: Current player passed turn after drawing.");
  }

  // 14. Test Concurrency & Stale Turn protection
  // Attempting to play an action for the previous player should fail
  req = mockReq(currentPlayer, { cardId: "card_1" }, { gameId });
  res = mockRes();
  await unoController.playCard(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 403, "Turn has moved on, stale request rejected");
  console.log("✔ Step 14: Concurrency control verified—stale play request correctly rejected.");

  // 15. Check UNO history endpoint
  req = mockReq(rohan, {}, {}, { groupId: group.id });
  res = mockRes();
  await unoController.getHistory(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200);
  assert(Array.isArray(res.data.history));
  console.log("✔ Step 15: History endpoint working.");

  console.log("\n===========================================");
  console.log("🎉 ALL 4-PLAYER MULTIPLAYER TESTS PASSED!");
  console.log("===========================================\n");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
