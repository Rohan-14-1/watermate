let currentGroupId = null;
let currentPage = 1;

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderHistory(data) {
  const el = document.getElementById("historyContent");

  if (data.records.length === 0) {
    el.innerHTML = `
      <div class="empty-state card">
        <h3>No water deliveries yet.</h3>
        <p>The first completed delivery will appear here.</p>
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
          <img class="history-card__photo" src="${r.photoUrl}" alt="Water delivery photo" />
          <div class="history-card__body">
            <div class="history-card__name">${escapeHtml(r.name)}</div>
            <div class="history-card__time">${formatDateTime(r.completedAt)}</div>
            <span class="badge badge-success">\u2713 Completed</span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;

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
  try {
    const data = await Api.getHistory(currentGroupId, currentPage);
    renderHistory(data);
  } catch (err) {
    pageAlert(err.message || "Unable to load history.");
  }
}

(async function init() {
  const user = await requireLoggedIn();
  if (!user) return;

  currentGroupId = getActiveGroupId();
  if (!currentGroupId) {
    window.location.href = "group.html";
    return;
  }

  renderUserBox(user);
  loadHistory();
})();
