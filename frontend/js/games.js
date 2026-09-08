/**
 * WaterMate Multiplayer UNO - Games Lobby Controller
 */

(async function () {
  const currentUser = await requireLoggedIn();
  if (!currentUser) return;

  function renderUserBox(user) {
    const box = document.getElementById("userBox");
    if (!box || !user) return;
    box.innerHTML = `
      <div class="avatar">${initials(user.name)}</div>
      <button class="btn-link" id="logoutBtn">Log out</button>
    `;
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await Api.logout();
        window.location.href = "login.html";
      });
    }
  }

  // Render topbar user profile
  renderUserBox(currentUser);

  // Group resolution with fallback
  let groupId = getActiveGroupId();
  try {
    const { groups } = await Api.listGroups();
    if (!groups || groups.length === 0) {
      window.location.href = "group.html";
      return;
    }
    if (!groupId || !groups.some((g) => g.id === groupId)) {
      groupId = groups[0].id;
      setActiveGroupId(groupId);
    }
  } catch (err) {
    console.warn("Could not verify groups:", err);
  }

  if (!groupId) {
    window.location.href = "group.html";
    return;
  }

  const gamesListContainer = document.getElementById("gamesListContainer");
  const unoHistoryContainer = document.getElementById("unoHistoryContainer");
  const btnCreateGame = document.getElementById("btnCreateGame");
  const btnRefreshGames = document.getElementById("btnRefreshGames");
  const pageAlert = document.getElementById("pageAlert");

  function showAlert(msg, type = "error") {
    if (!pageAlert) return;
    pageAlert.innerHTML = `
      <div class="alert alert-${type === "error" ? "danger" : "success"}" style="margin-bottom:16px;">
        ${escapeHtml(msg)}
      </div>
    `;
    setTimeout(() => {
      pageAlert.innerHTML = "";
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  async function loadGames() {
    try {
      const data = await Api.listUnoGames(groupId);
      renderGames(data.games || []);
    } catch (err) {
      console.error("Failed to load games:", err);
      gamesListContainer.innerHTML = `
        <div class="empty-state">
          <p class="text-muted">${escapeHtml(err.message || "Could not load games.")}</p>
        </div>
      `;
    }
  }

  function renderGames(games) {
    if (!games || games.length === 0) {
      gamesListContainer.innerHTML = `
        <div class="card empty-state">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">&#127183;</div>
          <h3>No active games right now</h3>
          <p class="text-muted">Create a new game lobby to invite your roommates!</p>
          <button type="button" class="btn btn-primary" id="btnEmptyCreate" style="margin-top:12px;">
            + Start an UNO Game
          </button>
        </div>
      `;
      const btnEmptyCreate = document.getElementById("btnEmptyCreate");
      if (btnEmptyCreate) {
        btnEmptyCreate.addEventListener("click", handleCreateGame);
      }
      return;
    }

    const cardsHtml = games.map((g) => {
      const isPlaying = g.status === "PLAYING";
      const statusBadge = isPlaying
        ? `<span class="badge badge-success">&#9654; In Progress</span>`
        : `<span class="badge badge-warning">&#9203; Waiting in Lobby</span>`;

      const playerList = (g.players || [])
        .map((p) => {
          const readyTag = isPlaying ? "" : p.isReady ? `<span class="player-pill__ready">&#10003;</span>` : `<span class="player-pill__unready">&#8943;</span>`;
          return `<span class="player-pill">${escapeHtml(p.name)} ${readyTag}</span>`;
        })
        .join("");

      const actionBtn = g.isUserInGame
        ? `<a href="uno.html?gameId=${g.id}" class="btn btn-primary btn-game-action">Enter Game &rarr;</a>`
        : isPlaying
        ? `<span class="text-muted" style="font-size:0.85rem;">Match in progress</span>`
        : `<a href="uno.html?gameId=${g.id}" class="btn btn-secondary btn-game-action">Join Lobby &rarr;</a>`;

      return `
        <div class="card game-room-card ${isPlaying ? "is-playing" : "is-waiting"}">
          <div class="game-room-card__header">
            <div>
              <div class="game-room-card__title">UNO by ${escapeHtml(g.creatorName)}</div>
              <div class="game-room-card__meta">${g.playerCount} / 10 Players &bull; Started ${formatRelativeTime(g.createdAt)}</div>
            </div>
            <div>${statusBadge}</div>
          </div>
          <div class="game-room-card__players">
            ${playerList}
          </div>
          <div class="game-room-card__footer">
            <div></div>
            ${actionBtn}
          </div>
        </div>
      `;
    }).join("");

    gamesListContainer.innerHTML = `<div class="games-grid">${cardsHtml}</div>`;
  }

  async function loadHistory() {
    try {
      const data = await Api.getUnoHistory(groupId);
      renderHistory(data.history || []);
    } catch (err) {
      console.warn("History load note:", err);
      unoHistoryContainer.innerHTML = `
        <div class="text-muted" style="padding:16px;">Unable to load recent matches.</div>
      `;
    }
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      unoHistoryContainer.innerHTML = `
        <div class="card" style="padding:24px; text-align:center; color:var(--ink-soft);">
          No finished UNO games in this group yet. The winner of your first match will be honored here!
        </div>
      `;
      return;
    }

    const items = history.map((item) => {
      const durationStr = item.durationSeconds
        ? `${Math.floor(item.durationSeconds / 60)}m ${item.durationSeconds % 60}s`
        : "N/A";
      const dateStr = item.finishedAt ? new Date(item.finishedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      }) : "";

      const versusList = (item.playerNames || []).join(" vs ");

      return `
        <div class="card uno-history-card">
          <div class="uno-history-card__left">
            <div class="uno-history-card__trophy">&#127942;</div>
            <div>
              <div class="uno-history-card__winner">${escapeHtml(item.winnerName)} won!</div>
              <div class="uno-history-card__players">${escapeHtml(versusList)}</div>
            </div>
          </div>
          <div class="uno-history-card__right">
            <div class="uno-history-card__date">${dateStr}</div>
            <div class="uno-history-card__stats">${item.totalTurns} turns &bull; ${durationStr}</div>
          </div>
        </div>
      `;
    }).join("");

    unoHistoryContainer.innerHTML = `<div class="uno-history-list">${items}</div>`;
  }

  async function handleCreateGame() {
    btnCreateGame.disabled = true;
    btnCreateGame.textContent = "Creating Room...";

    try {
      const game = await Api.createUnoGame(groupId);
      window.location.href = `uno.html?gameId=${game.id}`;
    } catch (err) {
      showAlert(err.message || "Failed to create game.");
      btnCreateGame.disabled = false;
      btnCreateGame.textContent = "+ Create New UNO Game";
    }
  }

  btnCreateGame.addEventListener("click", handleCreateGame);
  btnRefreshGames.addEventListener("click", () => {
    loadGames();
    loadHistory();
  });

  function formatRelativeTime(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} mins ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  }

  // Initial load
  await Promise.all([loadGames(), loadHistory()]);

  // Periodic polling for lobby updates every 5 seconds
  setInterval(() => {
    if (document.visibilityState === "visible") {
      loadGames();
    }
  }, 5000);
})();
