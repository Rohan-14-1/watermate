const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const unoController = require("../controllers/unoController");

// Public realtime configuration for clients
router.get("/config", unoController.getConfig);

// All other UNO routes require authentication
router.use(requireAuth);

// Game creation & discovery
router.post("/games", unoController.createGame);
router.get("/groups/:groupId/games", unoController.listGroupGames);
router.get("/history", unoController.getHistory);
router.get("/groups/:groupId/history", unoController.getHistory);

// Specific game actions
router.get("/games/:gameId", unoController.getGame);
router.get("/games/:gameId/events", unoController.streamEvents);
router.post("/games/:gameId/join", unoController.joinGame);
router.post("/games/:gameId/leave", unoController.leaveGame);
router.post("/games/:gameId/ready", unoController.toggleReady);
router.post("/games/:gameId/start", unoController.startGame);
router.post("/games/:gameId/play", unoController.playCard);
router.post("/games/:gameId/draw", unoController.drawCard);
router.post("/games/:gameId/pass", unoController.passTurn);
router.post("/games/:gameId/uno", unoController.callUno);
router.post("/games/:gameId/catch-uno", unoController.catchUno);

module.exports = router;
