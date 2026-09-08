const assert = require("assert");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma/client");
const unoController = require("../controllers/unoController");

const JWT_SECRET = process.env.JWT_SECRET || "watermate-fallback-jwt-secret";
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1d" });
}
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
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.data = obj; return this; },
    setHeader() {},
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

async function testUnoPenalty() {
  console.log("=========================================");
  console.log("⚡ Testing UNO Declaration & Catch Penalties");
  console.log("=========================================\n");

  const rohan = await prisma.user.findFirst({ where: { email: "rohan@example.com" } });
  const aman = await prisma.user.findFirst({ where: { email: "aman@example.com" } });
  const group = await prisma.group.findFirst({ where: { name: "Sunrise Apartment" } });

  // 1. Create a 2-player game
  let req = mockReq(rohan, { groupId: group.id });
  let res = mockRes();
  await unoController.createGame(req, res, nextErr(res));
  const gameId = res.data.id;

  req = mockReq(aman, {}, { gameId });
  res = mockRes();
  await unoController.joinGame(req, res, nextErr(res));

  req = mockReq(aman, {}, { gameId });
  res = mockRes();
  await unoController.toggleReady(req, res, nextErr(res));

  req = mockReq(rohan, {}, { gameId });
  res = mockRes();
  await unoController.startGame(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200);

  // Set up a controlled scenario where currentPlayer has 2 cards and plays 1 WITHOUT calling UNO
  const startingPlayerId = res.data.currentPlayerId;
  const activeUser = startingPlayerId === rohan.id ? rohan : aman;
  const waitingUser = activeUser.id === rohan.id ? aman : rohan;

  // Manually give activeUser 2 cards: one matching top card, one dummy
  const topCard = res.data.topDiscardCard;
  const matchingCard = { id: "test_c1", color: res.data.currentColor, value: "1" };
  const lastCard = { id: "test_c2", color: "BLUE", value: "9" };

  await prisma.unoPlayer.updateMany({
    where: { gameId, userId: activeUser.id },
    data: {
      cards: [matchingCard, lastCard],
      cardCount: 2,
      hasCalledUno: false,
      unoSafe: false
    }
  });

  // Active user plays matchingCard WITHOUT calling UNO (callUno: false)
  req = mockReq(activeUser, { cardId: matchingCard.id, callUno: false }, { gameId });
  res = mockRes();
  await unoController.playCard(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.myPlayer.cardCount, 1);
  assert.strictEqual(res.data.myPlayer.unoSafe, false, "Player who did not call UNO must not be safe");
  console.log("✔ Active player played down to 1 card without calling UNO.");

  // Waiting user views game and sees canCatchUno: true
  req = mockReq(waitingUser, {}, { gameId });
  res = mockRes();
  await unoController.getGame(req, res, nextErr(res));
  assert.strictEqual(res.data.canCatchUno, true, "Opponent should see canCatchUno = true");
  console.log("✔ Opponent sees Catch UNO alert.");

  // Active user attempts to catch themselves -> rejected
  req = mockReq(activeUser, {}, { gameId });
  res = mockRes();
  await unoController.catchUno(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 400, "Active player cannot catch themselves");
  console.log("✔ Player cannot catch themselves.");

  // Opponent catches the offending player!
  req = mockReq(waitingUser, {}, { gameId });
  res = mockRes();
  await unoController.catchUno(req, res, nextErr(res));
  assert.strictEqual(res.statusCode, 200);
  console.log("✔ Opponent successfully executed Catch UNO.");

  // Verify offending player received 2 penalty cards (card count: 1 + 2 = 3)
  req = mockReq(activeUser, {}, { gameId });
  res = mockRes();
  await unoController.getGame(req, res, nextErr(res));
  assert.strictEqual(res.data.myPlayer.cardCount, 3, "Caught player must receive 2 penalty cards");
  assert.strictEqual(res.data.canCatchUno, false, "Catch UNO window now closed");
  console.log("✔ Caught player received 2 penalty cards (hand grew from 1 to 3).");

  console.log("\n=========================================");
  console.log("🎉 UNO PENALTY TESTS PASSED!");
  console.log("=========================================\n");
  process.exit(0);
}

testUnoPenalty().catch(err => {
  console.error("Penalty test failed:", err);
  process.exit(1);
});
