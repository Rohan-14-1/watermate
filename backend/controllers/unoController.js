const prisma = require("../prisma/client");
const unoEngine = require("../services/unoEngine");
const unoRealtimeService = require("../services/unoRealtimeService");

/**
 * Filter game state so private player hands are NEVER leaked to opponents.
 */
function buildSanitizedGameState(game, requestingUserId) {
  const isCreator = game.creatorId === requestingUserId;
  const isMyTurn = game.status === "PLAYING" && game.currentPlayerId === requestingUserId;

  const opponents = [];
  let myPlayer = null;

  // Sort players by seat order
  const sortedPlayers = [...(game.players || [])].sort((a, b) => a.order - b.order);

  for (const p of sortedPlayers) {
    const isSelf = p.userId === requestingUserId;
    const playerSummary = {
      id: p.id,
      userId: p.userId,
      name: p.user?.name || "Player",
      profileImage: p.user?.profileImage || null,
      order: p.order,
      cardCount: p.cardCount,
      isReady: p.isReady,
      hasCalledUno: p.hasCalledUno,
      unoSafe: p.unoSafe,
      isCurrentTurn: game.status === "PLAYING" && game.currentPlayerId === p.userId
    };

    if (isSelf) {
      myPlayer = {
        ...playerSummary,
        cards: Array.isArray(p.cards) ? p.cards : []
      };
    } else {
      opponents.push(playerSummary);
    }
  }

  const drawPile = Array.isArray(game.drawPile) ? game.drawPile : [];
  const discardPile = Array.isArray(game.discardPile) ? game.discardPile : [];

  // Check if someone can be caught for failing to call UNO
  let canCatchUno = false;
  let catchTargetPlayerName = null;
  if (
    game.status === "PLAYING" &&
    game.unoCallWindow &&
    game.unoCallWindow.playerId &&
    game.unoCallWindow.playerId !== requestingUserId &&
    !game.unoCallWindow.caught
  ) {
    const targetPlayer = sortedPlayers.find(p => p.userId === game.unoCallWindow.playerId);
    if (targetPlayer && targetPlayer.cardCount === 1 && !targetPlayer.unoSafe) {
      canCatchUno = true;
      catchTargetPlayerName = targetPlayer.user?.name || "Player";
    }
  }

  // Check if requesting player can call UNO (has 1 card and not unoSafe, or has 2 cards on their turn)
  const canCallUno = Boolean(
    myPlayer &&
    ((myPlayer.cardCount === 1 && !myPlayer.unoSafe) ||
     (myPlayer.cardCount === 2 && isMyTurn))
  );

  return {
    id: game.id,
    groupId: game.groupId,
    creatorId: game.creatorId,
    status: game.status,
    direction: game.direction,
    currentColor: game.currentColor,
    topDiscardCard: game.topDiscardCard,
    currentPlayerId: game.currentPlayerId,
    turnNumber: game.turnNumber,
    version: game.version,
    winnerId: game.winnerId,
    winnerName: game.winner?.name || null,
    lastAction: game.lastAction,
    hasDrawnThisTurn: game.hasDrawnThisTurn,
    drawnCardPlayable: game.drawnCardPlayable,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    createdAt: game.createdAt,
    drawPileCount: drawPile.length,
    discardPileCount: discardPile.length,
    isCreator,
    isMyTurn,
    canCallUno,
    canCatchUno,
    catchTargetPlayerName,
    myPlayer,
    opponents,
    totalPlayers: sortedPlayers.length
  };
}

/**
 * Helper to fetch a game with full player & user data
 */
async function fetchFullGame(gameId, tx = prisma) {
  return tx.unoGame.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: {
          user: {
            select: { id: true, name: true, profileImage: true }
          }
        }
      },
      winner: {
        select: { id: true, name: true }
      },
      creator: {
        select: { id: true, name: true }
      }
    }
  });
}

/**
 * 1. Create Game (Lobby)
 */
async function createGame(req, res, next) {
  try {
    const { groupId } = req.body;
    if (!groupId) {
      return res.status(400).json({ message: "groupId is required." });
    }

    // Verify membership in group
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.id } }
    });
    if (!membership) {
      return res.status(403).json({ message: "You are not a member of this group." });
    }

    // Cancel any older stale WAITING games created by this user in this group
    await prisma.unoGame.updateMany({
      where: {
        groupId,
        creatorId: req.user.id,
        status: "WAITING"
      },
      data: { status: "CANCELLED" }
    });

    const newGame = await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.create({
        data: {
          groupId,
          creatorId: req.user.id,
          status: "WAITING",
          direction: 1,
          discardPile: [],
          drawPile: [],
          players: {
            create: {
              userId: req.user.id,
              order: 0,
              isReady: true, // Creator is ready by default
              cards: [],
              cardCount: 0
            }
          }
        }
      });
      return game;
    });

    const fullGame = await fetchFullGame(newGame.id);
    const sanitized = buildSanitizedGameState(fullGame, req.user.id);

    unoRealtimeService.broadcastGameUpdate(newGame.id, {
      status: "WAITING",
      lastAction: { type: "GAME_CREATED", text: `${req.user.name} created a new UNO game.` }
    });

    res.status(201).json(sanitized);
  } catch (err) {
    next(err);
  }
}

/**
 * 2. List Group Games (active lobbies, in-progress, recent)
 */
async function listGroupGames(req, res, next) {
  try {
    const groupId = req.params.groupId || req.query.groupId;
    if (!groupId) {
      return res.status(400).json({ message: "groupId is required." });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.id } }
    });
    if (!membership) {
      return res.status(403).json({ message: "You are not a member of this group." });
    }

    const games = await prisma.unoGame.findMany({
      where: {
        groupId,
        status: { in: ["WAITING", "PLAYING"] }
      },
      include: {
        creator: { select: { id: true, name: true } },
        players: {
          include: { user: { select: { id: true, name: true, profileImage: true } } }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 10
    });

    const formatted = games.map((g) => ({
      id: g.id,
      groupId: g.groupId,
      status: g.status,
      creatorId: g.creatorId,
      creatorName: g.creator?.name || "Creator",
      createdAt: g.createdAt,
      startedAt: g.startedAt,
      playerCount: g.players.length,
      players: g.players.map((p) => ({
        userId: p.userId,
        name: p.user?.name || "Player",
        isReady: p.isReady
      })),
      isUserInGame: g.players.some((p) => p.userId === req.user.id)
    }));

    res.json({ games: formatted });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Get Game State (Sanitized for caller)
 */
async function getGame(req, res, next) {
  try {
    const { gameId } = req.params;
    const game = await fetchFullGame(gameId);

    if (!game) {
      return res.status(404).json({ message: "UNO game not found." });
    }

    // Verify user belongs to the game's group
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: game.groupId, userId: req.user.id } }
    });
    if (!membership) {
      return res.status(403).json({ message: "You are not a member of this group." });
    }

    const sanitized = buildSanitizedGameState(game, req.user.id);
    res.json(sanitized);
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Join Game
 */
async function joinGame(req, res, next) {
  try {
    const { gameId } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: { players: true }
      });

      if (!game) {
        throw { status: 404, message: "Game not found." };
      }

      if (game.status !== "WAITING") {
        throw { status: 400, message: "This game has already started or finished." };
      }

      // Verify membership
      const membership = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: game.groupId, userId: req.user.id } }
      });
      if (!membership) {
        throw { status: 403, message: "You do not belong to this group." };
      }

      // Check duplicate
      const alreadyJoined = game.players.find((p) => p.userId === req.user.id);
      if (alreadyJoined) {
        return game; // Already in game
      }

      if (game.players.length >= 10) {
        throw { status: 400, message: "Game lobby is full (maximum 10 players)." };
      }

      const nextOrder = game.players.length;
      await tx.unoPlayer.create({
        data: {
          gameId,
          userId: req.user.id,
          order: nextOrder,
          isReady: false,
          cards: [],
          cardCount: 0
        }
      });

      return tx.unoGame.update({
        where: { id: gameId },
        data: {
          lastAction: { type: "PLAYER_JOINED", text: `${req.user.name} joined the lobby.` },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: "WAITING",
      lastAction: { type: "PLAYER_JOINED", text: `${req.user.name} joined the lobby.` }
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 5. Leave Game
 */
async function leaveGame(req, res, next) {
  try {
    const { gameId } = req.params;

    await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: { players: true }
      });

      if (!game) throw { status: 404, message: "Game not found." };

      const player = game.players.find((p) => p.userId === req.user.id);
      if (!player) throw { status: 400, message: "You are not in this game." };

      if (game.status === "WAITING") {
        await tx.unoPlayer.delete({ where: { id: player.id } });

        const remaining = game.players.filter((p) => p.id !== player.id);
        if (remaining.length === 0) {
          await tx.unoGame.update({
            where: { id: gameId },
            data: { status: "CANCELLED" }
          });
        } else {
          // Re-order remaining seats
          for (let i = 0; i < remaining.length; i++) {
            await tx.unoPlayer.update({
              where: { id: remaining[i].id },
              data: { order: i }
            });
          }
          // If creator left, assign new creator
          const newCreatorId = game.creatorId === req.user.id ? remaining[0].userId : game.creatorId;
          await tx.unoGame.update({
            where: { id: gameId },
            data: {
              creatorId: newCreatorId,
              lastAction: { type: "PLAYER_LEFT", text: `${req.user.name} left the lobby.` },
              version: { increment: 1 }
            }
          });
        }
      } else if (game.status === "PLAYING") {
        // Safe forfeit during live game
        const remaining = game.players.filter((p) => p.id !== player.id);

        if (remaining.length <= 1) {
          const winnerId = remaining.length === 1 ? remaining[0].userId : null;
          await tx.unoGame.update({
            where: { id: gameId },
            data: {
              status: "FINISHED",
              winnerId,
              finishedAt: new Date(),
              lastAction: { type: "GAME_FINISHED", text: `${req.user.name} left. Game ended.` },
              version: { increment: 1 }
            }
          });
          await tx.unoPlayer.delete({ where: { id: player.id } });
        } else {
          let nextPlayerId = game.currentPlayerId;
          if (game.currentPlayerId === req.user.id) {
            const sorted = remaining.sort((a, b) => a.order - b.order);
            const nextIdx = unoEngine.getNextPlayerIndex(0, sorted.length, game.direction, 1);
            nextPlayerId = sorted[nextIdx].userId;
          }

          await tx.unoPlayer.delete({ where: { id: player.id } });
          await tx.unoGame.update({
            where: { id: gameId },
            data: {
              currentPlayerId: nextPlayerId,
              hasDrawnThisTurn: false,
              drawnCardPlayable: false,
              lastAction: { type: "PLAYER_LEFT", text: `${req.user.name} left the game.` },
              version: { increment: 1 }
            }
          });
        }
      }
    });

    unoRealtimeService.broadcastGameUpdate(gameId, {
      lastAction: { type: "PLAYER_LEFT", text: `${req.user.name} left.` }
    });

    res.json({ success: true, message: "Left game." });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 6. Ready Toggle (Lobby)
 */
async function toggleReady(req, res, next) {
  try {
    const { gameId } = req.params;

    const updated = await prisma.$transaction(async (tx) => {
      const player = await tx.unoPlayer.findUnique({
        where: { gameId_userId: { gameId, userId: req.user.id } },
        include: { game: true }
      });

      if (!player) throw { status: 404, message: "Player not found in this game." };
      if (player.game.status !== "WAITING") {
        throw { status: 400, message: "Game is not in lobby state." };
      }

      const newReady = !player.isReady;
      await tx.unoPlayer.update({
        where: { id: player.id },
        data: { isReady: newReady }
      });

      return tx.unoGame.update({
        where: { id: gameId },
        data: {
          lastAction: {
            type: "PLAYER_READY",
            text: `${req.user.name} is ${newReady ? "ready" : "not ready"}.`
          },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: "WAITING",
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 7. Start Game
 */
async function startGame(req, res, next) {
  try {
    const { gameId } = req.params;

    await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: { players: true }
      });

      if (!game) throw { status: 404, message: "Game not found." };
      if (game.creatorId !== req.user.id) {
        throw { status: 403, message: "Only the game creator can start the game." };
      }
      if (game.status !== "WAITING") {
        throw { status: 400, message: "Game has already started." };
      }

      if (game.players.length < 2) {
        throw { status: 400, message: "At least 2 players are required to start UNO." };
      }
      if (game.players.length > 10) {
        throw { status: 400, message: "A maximum of 10 players can play." };
      }

      // Check that all non-creators are ready
      const unready = game.players.filter((p) => p.userId !== game.creatorId && !p.isReady);
      if (unready.length > 0) {
        throw { status: 400, message: "All players must be ready before starting." };
      }

      // Generate & shuffle deck
      const freshDeck = unoEngine.createDeck();
      const shuffled = unoEngine.shuffleDeck(freshDeck);

      // Deal 7 cards
      const dealt = unoEngine.dealInitialCards(game.players, shuffled, 7);

      // Save each player's dealt cards
      for (const p of game.players) {
        const hand = dealt.playerHands[p.userId] || [];
        await tx.unoPlayer.update({
          where: { id: p.id },
          data: {
            cards: hand,
            cardCount: hand.length,
            hasCalledUno: false,
            unoSafe: false
          }
        });
      }

      // Analyze starting card
      let direction = 1;
      let startColor = dealt.topDiscardCard.color;
      if (startColor === "WILD") {
        // Pick random color if wild
        startColor = unoEngine.COLORS[Math.floor(Math.random() * 4)];
      }

      const sortedPlayers = [...game.players].sort((a, b) => a.order - b.order);
      let currentIdx = 0; // creator starts by default

      // Handle special starting card effects
      if (dealt.topDiscardCard.value === "REVERSE") {
        direction = -1;
        if (sortedPlayers.length === 2) {
          // 2 players: reverse acts like skip
          currentIdx = 1;
        }
      } else if (dealt.topDiscardCard.value === "SKIP") {
        currentIdx = 1;
      } else if (dealt.topDiscardCard.value === "DRAW_TWO") {
        // First player draws 2 and turn skips to next
        const victim = sortedPlayers[0];
        const victimHand = [...(dealt.playerHands[victim.userId] || [])];
        const drawnCards = dealt.drawPile.splice(-2);
        victimHand.push(...drawnCards);

        await tx.unoPlayer.update({
          where: { id: victim.id },
          data: {
            cards: victimHand,
            cardCount: victimHand.length
          }
        });
        currentIdx = 1;
      }

      const startingPlayerId = sortedPlayers[currentIdx].userId;

      await tx.unoGame.update({
        where: { id: gameId },
        data: {
          status: "PLAYING",
          direction,
          currentColor: startColor,
          topDiscardCard: dealt.topDiscardCard,
          discardPile: dealt.discardPile,
          drawPile: dealt.drawPile,
          currentPlayerId: startingPlayerId,
          turnNumber: 1,
          hasDrawnThisTurn: false,
          drawnCardPlayable: false,
          unoCallWindow: null,
          startedAt: new Date(),
          lastAction: {
            type: "GAME_STARTED",
            text: `Game started! Top card is ${startColor} ${dealt.topDiscardCard.value}.`
          },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: "PLAYING",
      currentPlayerId: fullGame.currentPlayerId,
      currentColor: fullGame.currentColor,
      topDiscardCard: fullGame.topDiscardCard,
      turnNumber: fullGame.turnNumber,
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 8. Play Card
 */
async function playCard(req, res, next) {
  try {
    const { gameId } = req.params;
    const { cardId, chosenColor, callUno } = req.body;

    if (!cardId) {
      return res.status(400).json({ message: "cardId is required." });
    }

    const updatedGame = await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: {
          players: {
            include: { user: { select: { id: true, name: true } } }
          }
        }
      });

      if (!game) throw { status: 404, message: "Game not found." };
      if (game.status !== "PLAYING") {
        throw { status: 400, message: "Game is not currently active." };
      }

      // Strictly verify turn
      if (game.currentPlayerId !== req.user.id) {
        throw { status: 403, message: "It is not your turn to play." };
      }

      const player = game.players.find((p) => p.userId === req.user.id);
      if (!player) throw { status: 400, message: "Player not in game." };

      const hand = Array.isArray(player.cards) ? [...player.cards] : [];
      const cardIndex = hand.findIndex((c) => c.id === cardId);

      if (cardIndex === -1) {
        throw { status: 400, message: "Card not found in your hand." };
      }

      const cardToPlay = hand[cardIndex];

      // Validate legality of move
      const isValid = unoEngine.isValidMove(game.topDiscardCard, game.currentColor, cardToPlay);
      if (!isValid) {
        throw {
          status: 400,
          message: `Cannot play ${cardToPlay.color} ${cardToPlay.value} on top of ${game.currentColor || game.topDiscardCard.color} ${game.topDiscardCard.value}.`
        };
      }

      // If wild card, ensure valid chosen color
      let nextColor = cardToPlay.color;
      if (cardToPlay.color === "WILD") {
        const normalizedChosen = (chosenColor || "").toUpperCase();
        if (!unoEngine.COLORS.includes(normalizedChosen)) {
          throw { status: 400, message: "You must choose a valid color (RED, BLUE, GREEN, or YELLOW)." };
        }
        nextColor = normalizedChosen;
      }

      // Remove card from hand
      hand.splice(cardIndex, 1);
      const remainingCardsCount = hand.length;

      // Handle UNO Call
      let playerHasCalledUno = player.hasCalledUno;
      let playerUnoSafe = player.unoSafe;
      let newUnoCallWindow = null;

      if (remainingCardsCount === 1) {
        if (callUno === true) {
          playerHasCalledUno = true;
          playerUnoSafe = true;
        } else {
          // Open UNO catch window: opponents can catch until the next turn completes
          newUnoCallWindow = {
            playerId: req.user.id,
            turnNumber: game.turnNumber + 1,
            caught: false
          };
          playerHasCalledUno = false;
          playerUnoSafe = false;
        }
      } else {
        playerHasCalledUno = false;
        playerUnoSafe = false;
      }

      await tx.unoPlayer.update({
        where: { id: player.id },
        data: {
          cards: hand,
          cardCount: remainingCardsCount,
          hasCalledUno: playerHasCalledUno,
          unoSafe: playerUnoSafe
        }
      });

      // Check WINNER
      if (remainingCardsCount === 0) {
        const finishedGame = await tx.unoGame.update({
          where: { id: gameId },
          data: {
            status: "FINISHED",
            winnerId: req.user.id,
            finishedAt: new Date(),
            topDiscardCard: cardToPlay,
            discardPile: [...(game.discardPile || []), cardToPlay],
            currentColor: nextColor,
            lastAction: {
              type: "WINNER",
              userId: req.user.id,
              text: `🏆 ${req.user.name} played their last card and WON the game!`
            },
            version: { increment: 1 }
          }
        });
        return finishedGame;
      }

      // Setup discard & draw piles
      let drawPile = Array.isArray(game.drawPile) ? [...game.drawPile] : [];
      let discardPile = Array.isArray(game.discardPile) ? [...game.discardPile, cardToPlay] : [cardToPlay];

      // Replenish draw pile from discard if low
      const replenished = unoEngine.replenishDrawPileIfNeeded(drawPile, discardPile, cardToPlay);
      drawPile = replenished.drawPile;
      discardPile = replenished.discardPile;

      // Calculate next turn progression and special card effects
      const sortedPlayers = [...game.players].sort((a, b) => a.order - b.order);
      const currentIdx = sortedPlayers.findIndex((p) => p.userId === req.user.id);
      let direction = game.direction;
      let step = 1;
      let actionText = `${req.user.name} played ${cardToPlay.color === "WILD" ? `${nextColor} Wild` : `${cardToPlay.color} ${cardToPlay.value}`}.`;

      if (cardToPlay.value === "REVERSE") {
        if (sortedPlayers.length === 2) {
          step = 2; // In 2 players, reverse skips opponent
          actionText += " (Reverse skips opponent!)";
        } else {
          direction = direction * -1;
          step = 1;
          actionText += ` (Direction reversed to ${direction === 1 ? "clockwise" : "counter-clockwise"}!)`;
        }
      } else if (cardToPlay.value === "SKIP") {
        step = 2;
        const skippedIdx = unoEngine.getNextPlayerIndex(currentIdx, sortedPlayers.length, direction, 1);
        const skippedPlayer = sortedPlayers[skippedIdx];
        actionText += ` (${skippedPlayer.user?.name || "Next player"} was skipped!)`;
      } else if (cardToPlay.value === "DRAW_TWO") {
        step = 2;
        const victimIdx = unoEngine.getNextPlayerIndex(currentIdx, sortedPlayers.length, direction, 1);
        const victim = sortedPlayers[victimIdx];
        const victimHand = Array.isArray(victim.cards) ? [...victim.cards] : [];

        // Victim draws 2 cards
        for (let i = 0; i < 2; i++) {
          if (drawPile.length > 0) victimHand.push(drawPile.pop());
        }

        await tx.unoPlayer.update({
          where: { id: victim.id },
          data: {
            cards: victimHand,
            cardCount: victimHand.length,
            hasCalledUno: false,
            unoSafe: false
          }
        });
        actionText += ` (${victim.user?.name || "Next player"} drew 2 cards and lost their turn!)`;
      } else if (cardToPlay.value === "WILD_DRAW_FOUR") {
        step = 2;
        const victimIdx = unoEngine.getNextPlayerIndex(currentIdx, sortedPlayers.length, direction, 1);
        const victim = sortedPlayers[victimIdx];
        const victimHand = Array.isArray(victim.cards) ? [...victim.cards] : [];

        // Victim draws 4 cards
        for (let i = 0; i < 4; i++) {
          if (drawPile.length > 0) victimHand.push(drawPile.pop());
        }

        await tx.unoPlayer.update({
          where: { id: victim.id },
          data: {
            cards: victimHand,
            cardCount: victimHand.length,
            hasCalledUno: false,
            unoSafe: false
          }
        });
        actionText += ` (${victim.user?.name || "Next player"} drew 4 cards and lost their turn!)`;
      }

      if (remainingCardsCount === 1 && playerUnoSafe) {
        actionText += ` ⚡ UNO! (${req.user.name} has 1 card left!)`;
      }

      const nextIdx = unoEngine.getNextPlayerIndex(currentIdx, sortedPlayers.length, direction, step);
      const nextPlayerId = sortedPlayers[nextIdx].userId;

      const updated = await tx.unoGame.update({
        where: { id: gameId },
        data: {
          direction,
          currentColor: nextColor,
          topDiscardCard: cardToPlay,
          discardPile,
          drawPile,
          currentPlayerId: nextPlayerId,
          turnNumber: { increment: 1 },
          hasDrawnThisTurn: false,
          drawnCardPlayable: false,
          unoCallWindow: newUnoCallWindow,
          lastAction: {
            type: "PLAY_CARD",
            userId: req.user.id,
            card: cardToPlay,
            text: actionText
          },
          version: { increment: 1 }
        }
      });

      return updated;
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: fullGame.status,
      currentPlayerId: fullGame.currentPlayerId,
      currentColor: fullGame.currentColor,
      topDiscardCard: fullGame.topDiscardCard,
      turnNumber: fullGame.turnNumber,
      winnerId: fullGame.winnerId,
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 9. Draw Card
 */
async function drawCard(req, res, next) {
  try {
    const { gameId } = req.params;

    const updatedGame = await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: { players: true }
      });

      if (!game) throw { status: 404, message: "Game not found." };
      if (game.status !== "PLAYING") {
        throw { status: 400, message: "Game is not currently active." };
      }

      if (game.currentPlayerId !== req.user.id) {
        throw { status: 403, message: "It is not your turn to draw." };
      }

      if (game.hasDrawnThisTurn) {
        throw { status: 400, message: "You have already drawn a card this turn. Play it or pass." };
      }

      const player = game.players.find((p) => p.userId === req.user.id);
      if (!player) throw { status: 400, message: "Player not in game." };

      let drawPile = Array.isArray(game.drawPile) ? [...game.drawPile] : [];
      let discardPile = Array.isArray(game.discardPile) ? [...game.discardPile] : [];

      // Replenish if empty
      if (drawPile.length === 0) {
        const replenished = unoEngine.replenishDrawPileIfNeeded(drawPile, discardPile, game.topDiscardCard);
        drawPile = replenished.drawPile;
        discardPile = replenished.discardPile;
      }

      if (drawPile.length === 0) {
        throw { status: 400, message: "No cards left in draw pile." };
      }

      const drawnCard = drawPile.pop();
      const hand = Array.isArray(player.cards) ? [...player.cards, drawnCard] : [drawnCard];

      // Check if drawn card is playable
      const playable = unoEngine.isValidMove(game.topDiscardCard, game.currentColor, drawnCard);

      await tx.unoPlayer.update({
        where: { id: player.id },
        data: {
          cards: hand,
          cardCount: hand.length,
          hasCalledUno: false,
          unoSafe: false
        }
      });

      return tx.unoGame.update({
        where: { id: gameId },
        data: {
          drawPile,
          discardPile,
          hasDrawnThisTurn: true,
          drawnCardPlayable: playable,
          lastAction: {
            type: "DRAW_CARD",
            userId: req.user.id,
            text: `${req.user.name} drew a card.`
          },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: fullGame.status,
      currentPlayerId: fullGame.currentPlayerId,
      currentColor: fullGame.currentColor,
      topDiscardCard: fullGame.topDiscardCard,
      turnNumber: fullGame.turnNumber,
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 10. Pass Turn (after drawing)
 */
async function passTurn(req, res, next) {
  try {
    const { gameId } = req.params;

    await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: { players: true }
      });

      if (!game) throw { status: 404, message: "Game not found." };
      if (game.status !== "PLAYING") {
        throw { status: 400, message: "Game is not currently active." };
      }

      if (game.currentPlayerId !== req.user.id) {
        throw { status: 403, message: "It is not your turn to pass." };
      }

      if (!game.hasDrawnThisTurn) {
        throw { status: 400, message: "You must draw a card before you can pass your turn." };
      }

      const sortedPlayers = [...game.players].sort((a, b) => a.order - b.order);
      const currentIdx = sortedPlayers.findIndex((p) => p.userId === req.user.id);
      const nextIdx = unoEngine.getNextPlayerIndex(currentIdx, sortedPlayers.length, game.direction, 1);
      const nextPlayerId = sortedPlayers[nextIdx].userId;

      await tx.unoGame.update({
        where: { id: gameId },
        data: {
          currentPlayerId: nextPlayerId,
          turnNumber: { increment: 1 },
          hasDrawnThisTurn: false,
          drawnCardPlayable: false,
          lastAction: {
            type: "PASS_TURN",
            userId: req.user.id,
            text: `${req.user.name} passed their turn.`
          },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: fullGame.status,
      currentPlayerId: fullGame.currentPlayerId,
      turnNumber: fullGame.turnNumber,
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 11. Call UNO!
 */
async function callUno(req, res, next) {
  try {
    const { gameId } = req.params;

    await prisma.$transaction(async (tx) => {
      const player = await tx.unoPlayer.findUnique({
        where: { gameId_userId: { gameId, userId: req.user.id } },
        include: { game: true }
      });

      if (!player) throw { status: 404, message: "Player not found in game." };
      if (player.game.status !== "PLAYING") {
        throw { status: 400, message: "Game is not playing." };
      }

      // Can call UNO if hand has 1 card (or 2 cards on their turn)
      const hand = Array.isArray(player.cards) ? player.cards : [];
      if (hand.length > 2) {
        throw { status: 400, message: "You can only call UNO when you have 1 or 2 cards remaining." };
      }

      await tx.unoPlayer.update({
        where: { id: player.id },
        data: {
          hasCalledUno: true,
          unoSafe: true
        }
      });

      // Clear catch window if it belonged to this player
      let newWindow = player.game.unoCallWindow;
      if (newWindow && newWindow.playerId === req.user.id) {
        newWindow = null;
      }

      await tx.unoGame.update({
        where: { id: gameId },
        data: {
          unoCallWindow: newWindow,
          lastAction: {
            type: "UNO_CALLED",
            userId: req.user.id,
            text: `⚡ ${req.user.name} called UNO!`
          },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: fullGame.status,
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 12. Catch UNO! (Opponent penalizes player who forgot to call UNO)
 */
async function catchUno(req, res, next) {
  try {
    const { gameId } = req.params;

    await prisma.$transaction(async (tx) => {
      const game = await tx.unoGame.findUnique({
        where: { id: gameId },
        include: {
          players: { include: { user: { select: { name: true } } } }
        }
      });

      if (!game) throw { status: 404, message: "Game not found." };
      if (game.status !== "PLAYING") {
        throw { status: 400, message: "Game is not active." };
      }

      const window = game.unoCallWindow;
      if (!window || !window.playerId || window.caught) {
        throw { status: 400, message: "No active UNO catch window at this moment." };
      }

      if (window.playerId === req.user.id) {
        throw { status: 400, message: "You cannot catch yourself!" };
      }

      const targetPlayer = game.players.find((p) => p.userId === window.playerId);
      if (!targetPlayer || targetPlayer.cardCount !== 1 || targetPlayer.unoSafe) {
        throw { status: 400, message: "Player already called UNO or does not have exactly 1 card." };
      }

      // Inflict 2-card penalty
      let drawPile = Array.isArray(game.drawPile) ? [...game.drawPile] : [];
      let discardPile = Array.isArray(game.discardPile) ? [...game.discardPile] : [];

      if (drawPile.length < 2) {
        const replenished = unoEngine.replenishDrawPileIfNeeded(drawPile, discardPile, game.topDiscardCard);
        drawPile = replenished.drawPile;
        discardPile = replenished.discardPile;
      }

      const targetHand = Array.isArray(targetPlayer.cards) ? [...targetPlayer.cards] : [];
      for (let i = 0; i < 2; i++) {
        if (drawPile.length > 0) targetHand.push(drawPile.pop());
      }

      await tx.unoPlayer.update({
        where: { id: targetPlayer.id },
        data: {
          cards: targetHand,
          cardCount: targetHand.length,
          hasCalledUno: false,
          unoSafe: false
        }
      });

      await tx.unoGame.update({
        where: { id: gameId },
        data: {
          drawPile,
          discardPile,
          unoCallWindow: { ...window, caught: true },
          lastAction: {
            type: "CAUGHT_UNO",
            userId: req.user.id,
            text: `🚨 ${req.user.name} caught ${targetPlayer.user?.name || "Player"} not calling UNO! 2 penalty cards added.`
          },
          version: { increment: 1 }
        }
      });
    });

    const fullGame = await fetchFullGame(gameId);
    unoRealtimeService.broadcastGameUpdate(gameId, {
      status: fullGame.status,
      lastAction: fullGame.lastAction
    });

    res.json(buildSanitizedGameState(fullGame, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/**
 * 13. Game History
 */
async function getHistory(req, res, next) {
  try {
    const groupId = req.params.groupId || req.query.groupId;
    if (!groupId) {
      return res.status(400).json({ message: "groupId is required." });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.id } }
    });
    if (!membership) {
      return res.status(403).json({ message: "You do not belong to this group." });
    }

    const finishedGames = await prisma.unoGame.findMany({
      where: {
        groupId,
        status: "FINISHED"
      },
      include: {
        winner: { select: { id: true, name: true, profileImage: true } },
        players: {
          include: { user: { select: { id: true, name: true, profileImage: true } } }
        }
      },
      orderBy: { finishedAt: "desc" },
      take: 20
    });

    const history = finishedGames.map((g) => {
      let durationSeconds = null;
      if (g.startedAt && g.finishedAt) {
        durationSeconds = Math.round((new Date(g.finishedAt) - new Date(g.startedAt)) / 1000);
      }

      return {
        id: g.id,
        winnerName: g.winner?.name || "Winner",
        winnerId: g.winnerId,
        startedAt: g.startedAt,
        finishedAt: g.finishedAt,
        durationSeconds,
        totalTurns: g.turnNumber,
        playerNames: g.players.map((p) => p.user?.name || "Player"),
        playerCount: g.players.length
      };
    });

    res.json({ history });
  } catch (err) {
    next(err);
  }
}

/**
 * 14. Server-Sent Events (SSE) Stream
 */
function streamEvents(req, res) {
  const { gameId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  unoRealtimeService.addSseClient(gameId, req.user.id, res);
}

/**
 * 15. Public Realtime Config
 */
function getConfig(req, res) {
  res.json(unoRealtimeService.getPublicConfig());
}

module.exports = {
  createGame,
  listGroupGames,
  getGame,
  joinGame,
  leaveGame,
  toggleReady,
  startGame,
  playCard,
  drawCard,
  passTurn,
  callUno,
  catchUno,
  getHistory,
  streamEvents,
  getConfig
};
