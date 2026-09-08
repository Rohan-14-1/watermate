/**
 * WaterMate UNO Arena Client Controller
 * Realtime synchronization (Supabase Realtime + SSE), audio cues, mobile touch handling
 */

(async function () {
  const currentUser = await requireLoggedIn();
  if (!currentUser) return;

  const urlParams = new URLSearchParams(window.location.search);
  const gameId = urlParams.get("gameId");

  if (!gameId) {
    window.location.href = "games.html";
    return;
  }

  // DOM Elements
  const lobbyView = document.getElementById("lobbyView");
  const gameplayView = document.getElementById("gameplayView");
  const lobbyPlayersList = document.getElementById("lobbyPlayersList");
  const lobbySubtext = document.getElementById("lobbySubtext");
  const btnToggleReady = document.getElementById("btnToggleReady");
  const btnStartGame = document.getElementById("btnStartGame");
  const btnLeaveGame = document.getElementById("btnLeaveGame");
  const btnToggleSound = document.getElementById("btnToggleSound");
  const pageAlert = document.getElementById("pageAlert");
  const arenaStatusBadge = document.getElementById("arenaStatusBadge");

  // Gameplay HUD elements
  const turnBanner = document.getElementById("turnBanner");
  const turnText = document.getElementById("turnText");
  const dirArrow = document.getElementById("dirArrow");
  const dirLabel = document.getElementById("dirLabel");
  const opponentsArea = document.getElementById("opponentsArea");
  const activeColorRing = document.getElementById("activeColorRing");
  const drawPileBtn = document.getElementById("drawPileBtn");
  const drawPileCountBadge = document.getElementById("drawPileCountBadge");
  const discardPile = document.getElementById("discardPile");
  const actionPill = document.getElementById("actionPill");
  const btnDrawCard = document.getElementById("btnDrawCard");
  const btnPassTurn = document.getElementById("btnPassTurn");
  const btnCallUno = document.getElementById("btnCallUno");
  const btnCatchUno = document.getElementById("btnCatchUno");
  const handCountBadge = document.getElementById("handCountBadge");
  const handHint = document.getElementById("handHint");
  const playerHandCards = document.getElementById("playerHandCards");

  // Modals
  const colorPickerModal = document.getElementById("colorPickerModal");
  const gameOverModal = document.getElementById("gameOverModal");
  const gameOverTitle = document.getElementById("gameOverTitle");
  const gameOverSub = document.getElementById("gameOverSub");

  // State
  let currentGame = null;
  let isSubmitting = false;
  let pendingWildCardId = null;
  let isMuted = localStorage.getItem("wm_uno_sound_muted") === "true";
  let eventSource = null;
  let previousTurnPlayerId = null;

  // Sound Engine (Web Audio API - zero external network dependencies)
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx && typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, type, duration, startVol = 0.2) {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(startVol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  function soundCardPlay() {
    playTone(480, "sine", 0.12, 0.25);
  }

  function soundCardDraw() {
    playTone(320, "triangle", 0.15, 0.2);
  }

  function soundTurnChime() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.2, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });
    } catch (_) {}
  }

  function soundUnoFanfare() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [440, 554.37, 659.25, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.25, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.3);
      });
    } catch (_) {}
  }

  function updateSoundButtonUI() {
    btnToggleSound.innerHTML = isMuted ? "&#128263;" : "&#128266;";
  }
  updateSoundButtonUI();

  btnToggleSound.addEventListener("click", () => {
    isMuted = !isMuted;
    localStorage.setItem("wm_uno_sound_muted", String(isMuted));
    updateSoundButtonUI();
    if (!isMuted) playTone(500, "sine", 0.1);
  });

  function showAlert(msg, type = "error") {
    if (!pageAlert) return;
    pageAlert.innerHTML = `
      <div class="alert alert-${type === "error" ? "danger" : "success"}" style="margin-bottom:12px;">
        ${escapeHtml(msg)}
      </div>
    `;
    setTimeout(() => {
      pageAlert.innerHTML = "";
    }, 4500);
  }

  function escapeHtml(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // =======================================================
  // FETCH & RENDER GAME STATE
  // =======================================================

  let isAutoJoining = false;

  async function fetchAndRenderGame() {
    try {
      let game = await Api.getUnoGame(gameId);

      // Auto-join: If current authenticated group member is not yet in the lobby, join them automatically!
      if (!game.myPlayer && game.status === "WAITING" && !isAutoJoining) {
        isAutoJoining = true;
        try {
          game = await Api.joinUnoGame(gameId);
        } catch (joinErr) {
          console.warn("Auto-join notice:", joinErr);
        } finally {
          isAutoJoining = false;
        }
      }

      renderGame(game);
    } catch (err) {
      showAlert(err.message || "Failed to load game state.");
    }
  }

  function renderGame(game) {
    currentGame = game;
    arenaStatusBadge.textContent = game.status;

    if (game.status === "WAITING") {
      renderLobby(game);
    } else if (game.status === "PLAYING" || game.status === "FINISHED") {
      renderGameplay(game);
    } else if (game.status === "CANCELLED") {
      showAlert("This game room was cancelled.", "error");
      setTimeout(() => {
        window.location.href = "games.html";
      }, 2000);
    }
  }

  // =======================================================
  // 1. RENDER LOBBY
  // =======================================================

  function renderLobby(game) {
    lobbyView.style.display = "flex";
    gameplayView.style.display = "none";

    const allPlayers = [game.myPlayer, ...game.opponents].filter(Boolean);
    const playerCount = allPlayers.length;

    lobbySubtext.textContent = `${playerCount} / 10 players joined. ${
      playerCount < 2 ? "Waiting for at least 1 more player." : "Ready to start when everyone is ready!"
    }`;

    lobbyPlayersList.innerHTML = allPlayers
      .map((p) => {
        const isSelf = p.userId === currentUser.id;
        const isCreator = p.userId === game.creatorId;
        const initialsStr = p.name ? p.name.slice(0, 2).toUpperCase() : "?";
        const readyBadge = p.isReady
          ? `<span class="lobby-ready-badge badge-ready">&#10003; Ready</span>`
          : `<span class="lobby-ready-badge badge-not-ready">&#8943; Not Ready</span>`;

        return `
          <div class="lobby-player-row">
            <div class="lobby-player-info">
              <div class="lobby-player-avatar">${initialsStr}</div>
              <div>
                <span class="lobby-player-name">${escapeHtml(p.name)} ${isSelf ? "(You)" : ""}</span>
                ${isCreator ? `<span class="lobby-player-creator">Host</span>` : ""}
              </div>
            </div>
            <div>${readyBadge}</div>
          </div>
        `;
      })
      .join("");

    // Toggle ready / Join lobby button state
    if (game.myPlayer) {
      btnToggleReady.style.display = "block";
      btnToggleReady.textContent = game.myPlayer.isReady ? "Mark Not Ready" : "Mark Ready";
      btnToggleReady.className = game.myPlayer.isReady ? "btn btn-secondary btn-large" : "btn btn-primary btn-large";
    } else if (game.status === "WAITING") {
      btnToggleReady.style.display = "block";
      btnToggleReady.textContent = "Join Lobby";
      btnToggleReady.className = "btn btn-primary btn-large";
    } else {
      btnToggleReady.style.display = "none";
    }

    // Share link input population
    const shareInput = document.getElementById("lobbyShareInput");
    if (shareInput) {
      shareInput.value = window.location.href;
    }

    // Start game button visibility (Creator only)
    if (game.isCreator) {
      btnStartGame.style.display = "block";
      const canStart = playerCount >= 2 && playerCount <= 10 && allPlayers.every((p) => p.userId === game.creatorId || p.isReady);
      btnStartGame.disabled = !canStart;
      btnStartGame.title = canStart ? "Start the game!" : "All players must be ready to start";
    } else {
      btnStartGame.style.display = "none";
    }
  }

  // =======================================================
  // 2. RENDER GAMEPLAY
  // =======================================================

  function renderGameplay(game) {
    lobbyView.style.display = "none";
    gameplayView.style.display = "flex";

    // Play chime if it just became your turn
    if (game.isMyTurn && previousTurnPlayerId !== currentUser.id) {
      soundTurnChime();
    }
    previousTurnPlayerId = game.currentPlayerId;

    // Turn Banner
    if (game.isMyTurn) {
      turnBanner.className = "uno-turn-banner is-my-turn";
      turnText.textContent = "YOUR TURN! Play a card or draw";
    } else {
      turnBanner.className = "uno-turn-banner";
      const currentOpponent = game.opponents.find((o) => o.userId === game.currentPlayerId);
      const oppName = currentOpponent ? currentOpponent.name : "Waiting for player";
      turnText.textContent = `${oppName}'s turn`;
    }

    // Direction indicator
    if (game.direction === 1) {
      dirArrow.className = "uno-dir-arrow";
      dirLabel.textContent = "Clockwise";
    } else {
      dirArrow.className = "uno-dir-arrow counter";
      dirLabel.textContent = "Counter-Clockwise";
    }

    // Active Color Ring
    const activeColor = game.currentColor || (game.topDiscardCard ? game.topDiscardCard.color : "RED");
    activeColorRing.className = `uno-color-ring color-ring-${activeColor}`;

    // Last Action Banner
    if (game.lastAction && game.lastAction.text) {
      actionPill.textContent = game.lastAction.text;
      if (game.lastAction.type === "CAUGHT_UNO") {
        soundUnoFanfare();
      }
    } else {
      actionPill.textContent = "Match in progress";
    }

    // Discard Pile Top Card
    if (game.topDiscardCard) {
      discardPile.innerHTML = renderCardHtml(game.topDiscardCard, false);
    } else {
      discardPile.innerHTML = "";
    }

    // Draw Pile count
    drawPileCountBadge.textContent = `${game.drawPileCount} Cards`;

    // Opponents Area
    opponentsArea.innerHTML = game.opponents
      .map((opp) => {
        const isCurrent = opp.userId === game.currentPlayerId;
        const hasOneCard = opp.cardCount === 1;
        const unoWarningClass = hasOneCard ? "uno-warning" : "";

        return `
          <div class="opponent-card ${isCurrent ? "is-current" : ""}">
            <div class="opponent-avatar">${escapeHtml(opp.name.slice(0, 2).toUpperCase())}</div>
            <div class="opponent-name" title="${escapeHtml(opp.name)}">${escapeHtml(opp.name)}</div>
            <div class="opponent-card-count ${unoWarningClass}">
              &#127183; ${opp.cardCount}
            </div>
          </div>
        `;
      })
      .join("");

    // Gameplay Controls HUD
    btnDrawCard.disabled = !game.isMyTurn || game.hasDrawnThisTurn;
    btnDrawCard.style.display = "inline-flex";

    // Pass turn button visible only if player has drawn
    if (game.isMyTurn && game.hasDrawnThisTurn) {
      btnPassTurn.style.display = "inline-flex";
    } else {
      btnPassTurn.style.display = "none";
    }

    // UNO Button
    if (game.canCallUno) {
      btnCallUno.classList.add("is-active");
      btnCallUno.title = "Call UNO!";
    } else {
      btnCallUno.classList.remove("is-active");
      btnCallUno.title = "Can call UNO with 1 or 2 cards remaining";
    }

    // Catch UNO Button
    if (game.canCatchUno) {
      btnCatchUno.style.display = "inline-flex";
      btnCatchUno.textContent = `🚨 Catch ${escapeHtml(game.catchTargetPlayerName || "Opponent")}!`;
    } else {
      btnCatchUno.style.display = "none";
    }

    // Player Hand
    const myCards = (game.myPlayer && game.myPlayer.cards) || [];
    handCountBadge.textContent = String(myCards.length);

    if (game.isMyTurn) {
      const playableCardsCount = myCards.filter((c) => isCardPlayable(c, game)).length;
      handHint.textContent = `${playableCardsCount} card${playableCardsCount === 1 ? "" : "s"} playable`;
    } else {
      handHint.textContent = "Wait for your turn";
    }

    playerHandCards.innerHTML = myCards
      .map((card) => {
        const playable = game.isMyTurn && isCardPlayable(card, game);
        return renderCardHtml(card, true, playable);
      })
      .join("");

    // Attach click listeners to player cards
    const cardEls = playerHandCards.querySelectorAll(".uno-card");
    cardEls.forEach((el) => {
      el.addEventListener("click", () => {
        const cardId = el.getAttribute("data-card-id");
        handleCardClick(cardId);
      });
    });

    // Handle FINISHED state
    if (game.status === "FINISHED") {
      gameOverModal.hidden = false;
      const winnerName = game.winnerName || "A player";
      gameOverTitle.textContent = `${winnerName} Won!`;
      gameOverSub.textContent = `${winnerName} played all cards and won the match!`;
      soundUnoFanfare();
    }
  }

  // =======================================================
  // 3. CARD RENDERING HELPER
  // =======================================================

  function isCardPlayable(card, game) {
    if (!game.topDiscardCard) return true;
    if (card.color === "WILD") return true;
    const activeColor = game.currentColor || game.topDiscardCard.color;
    if (card.color === activeColor) return true;
    if (card.value === game.topDiscardCard.value) return true;
    return false;
  }

  function getCardDisplaySymbol(value) {
    if (value === "SKIP") return "&#8856;";
    if (value === "REVERSE") return "&#8646;";
    if (value === "DRAW_TWO") return "+2";
    if (value === "WILD") return "W";
    if (value === "WILD_DRAW_FOUR") return "+4";
    return value;
  }

  function renderCardHtml(card, isHandCard = false, isPlayable = false) {
    const symbol = getCardDisplaySymbol(card.value);
    const playableClass = isHandCard ? (isPlayable ? "is-playable" : "not-playable") : "";

    return `
      <div class="uno-card card-${card.color} ${playableClass}" data-card-id="${card.id || ""}">
        <div class="uno-card__corner uno-card__corner--tl">${symbol}</div>
        <div class="uno-card__inner">
          <div class="uno-card__oval">
            <div class="uno-card__value">${symbol}</div>
          </div>
        </div>
        <div class="uno-card__corner uno-card__corner--br">${symbol}</div>
      </div>
    `;
  }

  // =======================================================
  // 4. USER INTERACTIONS
  // =======================================================

  async function handleCardClick(cardId) {
    if (isSubmitting || !currentGame || !currentGame.isMyTurn) return;

    const myCards = (currentGame.myPlayer && currentGame.myPlayer.cards) || [];
    const card = myCards.find((c) => c.id === cardId);
    if (!card) return;

    if (!isCardPlayable(card, currentGame)) {
      showAlert(`Cannot play ${card.color} ${card.value} on top of ${currentGame.currentColor} ${currentGame.topDiscardCard.value}.`);
      return;
    }

    // If Wild card, open color picker modal
    if (card.color === "WILD") {
      pendingWildCardId = card.id;
      colorPickerModal.hidden = false;
      return;
    }

    // Auto-call UNO if exactly 2 cards in hand (playing down to 1)
    const callUnoNow = myCards.length === 2;
    await executePlayCard(card.id, null, callUnoNow);
  }

  async function executePlayCard(cardId, chosenColor = null, callUno = false) {
    isSubmitting = true;
    soundCardPlay();

    try {
      const updated = await Api.playUnoCard(gameId, {
        cardId,
        chosenColor,
        callUno
      });
      renderGame(updated);
    } catch (err) {
      showAlert(err.message || "Could not play card.");
      await fetchAndRenderGame(); // Reload authoritative state
    } finally {
      isSubmitting = false;
    }
  }

  // Color picker selection
  const colorQuadBtns = colorPickerModal.querySelectorAll(".uno-color-quad");
  colorQuadBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const chosenColor = btn.getAttribute("data-color");
      colorPickerModal.hidden = true;

      if (pendingWildCardId) {
        const cardId = pendingWildCardId;
        pendingWildCardId = null;
        const myCards = (currentGame.myPlayer && currentGame.myPlayer.cards) || [];
        const callUnoNow = myCards.length === 2;
        await executePlayCard(cardId, chosenColor, callUnoNow);
      }
    });
  });

  // Draw card button
  async function handleDrawCard() {
    if (isSubmitting || !currentGame || !currentGame.isMyTurn || currentGame.hasDrawnThisTurn) return;
    isSubmitting = true;
    soundCardDraw();

    try {
      const updated = await Api.drawUnoCard(gameId);
      renderGame(updated);
    } catch (err) {
      showAlert(err.message || "Failed to draw card.");
      await fetchAndRenderGame();
    } finally {
      isSubmitting = false;
    }
  }

  btnDrawCard.addEventListener("click", handleDrawCard);
  drawPileBtn.addEventListener("click", handleDrawCard);

  // Pass turn button
  btnPassTurn.addEventListener("click", async () => {
    if (isSubmitting || !currentGame || !currentGame.isMyTurn) return;
    isSubmitting = true;

    try {
      const updated = await Api.passUnoTurn(gameId);
      renderGame(updated);
    } catch (err) {
      showAlert(err.message || "Failed to pass turn.");
      await fetchAndRenderGame();
    } finally {
      isSubmitting = false;
    }
  });

  // Call UNO button
  btnCallUno.addEventListener("click", async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    soundUnoFanfare();

    try {
      const updated = await Api.callUno(gameId);
      showAlert("⚡ You declared UNO!", "success");
      renderGame(updated);
    } catch (err) {
      showAlert(err.message || "Cannot call UNO right now.");
    } finally {
      isSubmitting = false;
    }
  });

  // Catch UNO button
  btnCatchUno.addEventListener("click", async () => {
    if (isSubmitting) return;
    isSubmitting = true;

    try {
      const updated = await Api.catchUno(gameId);
      showAlert("🚨 Caught! 2 penalty cards added to opponent.", "success");
      renderGame(updated);
    } catch (err) {
      showAlert(err.message || "Could not catch player.");
    } finally {
      isSubmitting = false;
    }
  });

  // Lobby actions
  btnToggleReady.addEventListener("click", async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    try {
      if (!currentGame || !currentGame.myPlayer) {
        // Not in lobby yet: join and immediately update view
        const joined = await Api.joinUnoGame(gameId);
        renderGame(joined);
      } else {
        const updated = await Api.toggleUnoReady(gameId);
        renderGame(updated);
      }
    } catch (err) {
      showAlert(err.message || "Could not update lobby state.");
    } finally {
      isSubmitting = false;
    }
  });

  const btnCopyShareLink = document.getElementById("btnCopyShareLink");
  if (btnCopyShareLink) {
    btnCopyShareLink.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        btnCopyShareLink.textContent = "Copied!";
        setTimeout(() => {
          btnCopyShareLink.textContent = "Copy Link";
        }, 2000);
      } catch (_) {
        const shareInput = document.getElementById("lobbyShareInput");
        if (shareInput) {
          shareInput.select();
          document.execCommand("copy");
          btnCopyShareLink.textContent = "Copied!";
          setTimeout(() => {
            btnCopyShareLink.textContent = "Copy Link";
          }, 2000);
        }
      }
    });
  }

  btnStartGame.addEventListener("click", async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    btnStartGame.disabled = true;
    btnStartGame.textContent = "Starting...";

    try {
      const updated = await Api.startUnoGame(gameId);
      soundUnoFanfare();
      renderGame(updated);
    } catch (err) {
      showAlert(err.message || "Failed to start game.");
      btnStartGame.disabled = false;
      btnStartGame.textContent = "▶ Start Game";
    } finally {
      isSubmitting = false;
    }
  });

  btnLeaveGame.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to leave this UNO game?")) return;
    try {
      await Api.leaveUnoGame(gameId);
      window.location.href = "games.html";
    } catch (err) {
      showAlert(err.message || "Failed to leave game.");
    }
  });

  // =======================================================
  // 5. REALTIME SYNCHRONIZATION
  // =======================================================

  async function setupRealtime() {
    // 1. Supabase Realtime (if available on page)
    try {
      const config = await Api.getUnoConfig();
      if (config.hasRealtime && config.supabaseUrl && config.supabaseAnonKey && window.supabase) {
        const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        const channel = client.channel(`room:uno_${gameId}`);
        channel.on("broadcast", { event: "game_update" }, () => {
          fetchAndRenderGame();
        }).subscribe();
      }
    } catch (_) {}

    // 2. Server-Sent Events (SSE) Stream
    try {
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("wm_auth_token") : null;
      const sseUrl = `${API_BASE}/uno/games/${gameId}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
      eventSource = new EventSource(sseUrl, { withCredentials: true });

      eventSource.addEventListener("game_update", () => {
        fetchAndRenderGame();
      });

      eventSource.onerror = () => {
        // SSE reconnects automatically
      };
    } catch (_) {}

    // 3. Fallback liveness polling every 3 seconds
    setInterval(() => {
      if (document.visibilityState === "visible" && !isSubmitting) {
        fetchAndRenderGame();
      }
    }, 3000);
  }

  // Window close / navigation cleanup
  window.addEventListener("beforeunload", () => {
    if (eventSource) eventSource.close();
  });

  // Initial load
  await fetchAndRenderGame();
  await setupRealtime();
})();
