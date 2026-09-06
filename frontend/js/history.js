let currentGroupId = null;
let currentPage = 1;
let currentTab = "water"; // "water" | "chicken"

function renderUserBox(user) {
  const box = document.getElementById("userBox");
  if (!box) return;
  box.innerHTML = `
    <div class="avatar">${initials(user.name)}</div>
    <button class="btn-link" id="logoutBtn">Log out</button>
  `;
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await Api.logout();
    localStorage.removeItem("wm_active_group");
    window.location.href = "login.html";
  });
}

function pageAlert(message) {
  document.getElementById("pageAlert").innerHTML = `<div class="alert alert-error">${message}</div>`;
}

function clearPageAlert() {
  const el = document.getElementById("pageAlert");
  if (el) el.innerHTML = "";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderWaterHistory(data) {
  const el = document.getElementById("historyContent");

  if (data.records.length === 0) {
    el.innerHTML = `
      <div class="empty-state card">
        <h3>No water deliveries yet.</h3>
        <p>The first completed water delivery will appear here.</p>
      </div>
    `;
    document.getElementById("pagination").innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="history-list">
      ${data.records
        .map(
          (r) => `
        <div class="history-card">
          <img class="history-card__photo" src="${Api.resolveMediaUrl(r.photoUrl)}" alt="Water delivery photo" onerror="this.onerror=null;this.classList.add('photo-load-error');" />
          <div class="history-card__body">
            <div class="history-card__name">${escapeHtml(r.name)}</div>
            <div class="history-card__time">${formatDateTime(r.completedAt)}</div>
            <span class="badge badge-success">&#10003; Completed</span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  renderPagination(data);
}

function renderChickenHistory(data) {
  const el = document.getElementById("historyContent");

  if (data.records.length === 0) {
    el.innerHTML = `
      <div class="empty-state card">
        <h3>No chicken deliveries yet.</h3>
        <p>Deliveries marked done and approved by teammates will appear here.</p>
      </div>
    `;
    document.getElementById("pagination").innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="chicken-history-list">
      ${data.records
        .map(
          (r) => `
        <div class="chicken-history-card">
          <div class="chicken-history-card__icon" aria-hidden="true">🍗</div>
          <div class="chicken-history-card__body">
            <div class="chicken-history-card__title">Chicken Delivery</div>
            <div class="chicken-history-card__meta">
              <strong>Brought by ${escapeHtml(r.broughtByName)}</strong><br />
              <span class="text-muted">${formatDateTime(r.completedAt)}</span>
            </div>
            <div class="chicken-history-card__approver">
              Approved by ${escapeHtml(r.approvedByName)}${r.approvedAt ? ` &middot; ${formatDateTime(r.approvedAt)}` : ""}
            </div>
          </div>
          <span class="badge badge-success">&#10003; Approved</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  renderPagination(data);
}

function renderPagination(data) {
  const pagination = document.getElementById("pagination");
  if (data.totalPages > 1) {
    pagination.innerHTML = `
      <button class="btn btn-secondary" id="prevPageBtn" ${data.page <= 1 ? "disabled" : ""}>Previous</button>
      <span class="text-muted" style="align-self:center;">Page ${data.page} of ${data.totalPages}</span>
      <button class="btn btn-secondary" id="nextPageBtn" ${data.page >= data.totalPages ? "disabled" : ""}>Next</button>
    `;
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    if (prevBtn) prevBtn.addEventListener("click", () => changePage(data.page - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => changePage(data.page + 1));
  } else {
    pagination.innerHTML = "";
  }
}

function changePage(page) {
  currentPage = page;
  loadHistory();
}

async function loadHistory() {
  clearPageAlert();
  const el = document.getElementById("historyContent");
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>Loading history&hellip;</span></div>`;

  try {
    if (currentTab === "water") {
      const data = await Api.getHistory(currentGroupId, currentPage);
      renderWaterHistory(data);
    } else {
      const data = await Api.getChickenHistory(currentGroupId, currentPage);
      renderChickenHistory(data);
    }
  } catch (err) {
    pageAlert(err.message || "Unable to load history.");
  }
}

function setupTabs() {
  const tabWater = document.getElementById("tabWater");
  const tabChicken = document.getElementById("tabChicken");
  const historyTitle = document.getElementById("historyTitle");

  if (tabWater && tabChicken) {
    tabWater.addEventListener("click", () => {
      if (currentTab === "water") return;
      currentTab = "water";
      currentPage = 1;
      tabWater.classList.add("is-active");
      tabWater.setAttribute("aria-selected", "true");
      tabChicken.classList.remove("is-active");
      tabChicken.setAttribute("aria-selected", "false");
      if (historyTitle) historyTitle.textContent = "Water History";
      loadHistory();
    });

    tabChicken.addEventListener("click", () => {
      if (currentTab === "chicken") return;
      currentTab = "chicken";
      currentPage = 1;
      tabChicken.classList.add("is-active");
      tabChicken.setAttribute("aria-selected", "true");
      tabWater.classList.remove("is-active");
      tabWater.setAttribute("aria-selected", "false");
      if (historyTitle) historyTitle.textContent = "Chicken History";
      loadHistory();
    });
  }
}

(async function init() {
  const user = await requireLoggedIn();
  if (!user) return;

  renderUserBox(user);
  setupTabs();

  currentGroupId = getActiveGroupId();
  try {
    const { groups } = await Api.listGroups();
    if (!groups || groups.length === 0) {
      window.location.href = "group.html";
      return;
    }
    if (!currentGroupId || !groups.some((g) => g.id === currentGroupId)) {
      currentGroupId = groups[0].id;
      setActiveGroupId(currentGroupId);
    }
  } catch (err) {
    console.warn("Could not verify groups:", err);
  }

  if (!currentGroupId) {
    window.location.href = "group.html";
    return;
  }

  loadHistory();
})();
