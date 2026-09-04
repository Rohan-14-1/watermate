const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

let currentGroupId = null;
let selectedFile = null;

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

function pageAlert(message, type = "error") {
  const box = document.getElementById("pageAlert");
  box.innerHTML = `<div class="alert alert-${type === "error" ? "error" : "success"}">${message}</div>`;
}

function clearPageAlert() {
  document.getElementById("pageAlert").innerHTML = "";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function queueTag(member) {
  if (member.isCurrentTurn) return `<span class="queue__tag">Next</span>`;
  return "";
}

function renderDashboard(data) {
  clearPageAlert();
  const el = document.getElementById("dashboardContent");

  const heroClass = data.isYourTurn ? "turn-hero is-your-turn" : "turn-hero";
  const eyebrow = data.isYourTurn ? "YOUR TURN" : "NEXT TURN";
  const personName = data.currentTurn ? data.currentTurn.name : "\u2014";

  const heroBody = data.isYourTurn
    ? `
      <div class="turn-hero__avatar">${initials(personName)}</div>
      <div class="turn-hero__person">It's your turn</div>
      <p class="turn-hero__sub">Bring the water and log it below.</p>
      <button class="btn btn-accent" id="openSubmitBtn">Submit water</button>
    `
    : `
      <div class="turn-hero__avatar">${initials(personName)}</div>
      <div class="turn-hero__person">${escapeHtml(personName)}</div>
      <p class="turn-hero__sub">${escapeHtml(personName)} needs to bring the water.</p>
    `;

  const lastDelivery = data.lastDelivery
    ? `
      <img class="delivery-card__photo" src="${data.lastDelivery.photoUrl}" alt="Water delivery photo" />
      <div class="delivery-card__body">
        <div class="delivery-card__name">Brought by ${escapeHtml(data.lastDelivery.name)}</div>
        <div class="delivery-card__time">${formatDateTime(data.lastDelivery.completedAt)}</div>
      </div>
      <span class="badge badge-success">\u2713 Completed</span>
    `
    : `<div class="text-muted">No water deliveries yet. The first completed delivery will appear here.</div>`;

  const membersSorted = [...data.members].sort((a, b) => a.turnOrder - b.turnOrder);
  const currentIndex = membersSorted.findIndex((m) => m.isCurrentTurn);

  const queueItems = membersSorted
    .map((m, idx) => {
      let stateClass = "";
      let markerContent = initials(m.name);
      let tag = "";
      if (m.isCurrentTurn) {
        stateClass = "is-current";
        tag = `<div class="queue__tag">Next</div>`;
      } else if (currentIndex !== -1 && idx < currentIndex) {
        stateClass = "is-done";
        markerContent = "\u2713";
        tag = `<div class="queue__tag">Done</div>`;
      } else {
        tag = `<div class="queue__tag">Waiting</div>`;
      }
      return `
        <div class="queue__item ${stateClass}">
          <div class="queue__marker">${markerContent}</div>
          <div class="queue__name">${escapeHtml(m.name)}</div>
          ${tag}
        </div>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="group-heading">
      <h1>${escapeHtml(data.group.name)}</h1>
      <span class="text-muted">Invite code: ${data.group.inviteCode}</span>
    </div>

    <div class="${heroClass}">
      <div class="turn-hero__eyebrow">${eyebrow}</div>
      ${heroBody}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="value">${data.stats.totalDeliveries}</div>
        <div class="label">Total deliveries</div>
      </div>
      <div class="stat-card">
        <div class="value">${data.stats.thisMonth}</div>
        <div class="label">This month</div>
      </div>
      <div class="stat-card">
        <div class="value" style="font-size:1.4rem;">${escapeHtml(personName)}</div>
        <div class="label">Current turn</div>
      </div>
    </div>

    <div class="section-title">LAST DELIVERY</div>
    <div class="card delivery-card">${lastDelivery}</div>

    <div class="section-title">MEMBERS</div>
    <div class="card">
      <div class="queue">${queueItems}</div>
    </div>
  `;

  if (data.isYourTurn) {
    document.getElementById("openSubmitBtn").addEventListener("click", openSubmitModal);
  }
}

async function loadDashboard() {
  try {
    const data = await Api.getDashboard(currentGroupId);
    renderDashboard(data);
  } catch (err) {
    pageAlert(err.message || "Unable to load dashboard.");
  }
}

/* ---------------- Submit water modal ---------------- */

function openSubmitModal() {
  selectedFile = null;
  const overlay = document.getElementById("submitModal");
  const body = document.getElementById("modalBody");

  body.innerHTML = `
    <div class="modal__head">
      <h3>Submit water</h3>
      <button class="modal__close" id="closeModalBtn" aria-label="Close">&times;</button>
    </div>
    <div id="modalAlert"></div>
    <label class="photo-drop" id="photoDrop">
      <div id="photoDropLabel">
        <div style="font-size:1.8rem;margin-bottom:6px;">📸</div>
        <strong>Snap or choose a photo of the water</strong><br />
        <span class="text-muted" style="font-size:0.8rem;">JPG, PNG, or WebP &middot; up to 5MB</span>
      </div>
      <input type="file" id="photoInput" accept="image/*,image/jpeg,image/png,image/webp" />
    </label>
    <div id="previewBox"></div>
    <button class="btn btn-accent btn-block" id="submitWaterBtn" style="margin-top:18px;" disabled>Submit water</button>
  `;

  overlay.hidden = false;

  document.getElementById("closeModalBtn").addEventListener("click", closeSubmitModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSubmitModal();
  });

  document.getElementById("photoInput").addEventListener("change", handlePhotoChange);
  document.getElementById("submitWaterBtn").addEventListener("click", handleSubmitWater);
}

function closeSubmitModal() {
  document.getElementById("submitModal").hidden = true;
}

function handlePhotoChange(e) {
  const file = e.target.files[0];
  const modalAlert = document.getElementById("modalAlert");
  modalAlert.innerHTML = "";

  if (!file) return;

  if (!ALLOWED_TYPES.includes(file.type)) {
    modalAlert.innerHTML = `<div class="alert alert-error">Invalid image format. Use JPG, PNG, or WebP.</div>`;
    e.target.value = "";
    return;
  }

  if (file.size > MAX_SIZE_BYTES) {
    modalAlert.innerHTML = `<div class="alert alert-error">Image is too large. Maximum size is 5MB.</div>`;
    e.target.value = "";
    return;
  }

  selectedFile = file;

  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById("previewBox").innerHTML = `
      <div class="photo-preview">
        <img src="${ev.target.result}" alt="Water photo preview" />
      </div>
    `;
    document.getElementById("submitWaterBtn").disabled = false;
  };
  reader.readAsDataURL(file);
}

async function handleSubmitWater() {
  const modalAlert = document.getElementById("modalAlert");
  const btn = document.getElementById("submitWaterBtn");
  modalAlert.innerHTML = "";

  if (!selectedFile) {
    modalAlert.innerHTML = `<div class="alert alert-error">Please upload a photo.</div>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Submitting\u2026";

  try {
    const { record, nextTurn } = await Api.submitWater(currentGroupId, selectedFile);
    showSubmitSuccess(record, nextTurn);
    loadDashboard();
  } catch (err) {
    modalAlert.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled = false;
    btn.textContent = "Submit water";
  }
}

function showSubmitSuccess(record, nextTurn) {
  const body = document.getElementById("modalBody");
  body.innerHTML = `
    <div class="success-banner">
      <div class="success-banner__drop"></div>
      <h3>Water submitted successfully!</h3>
      <p class="text-muted">Completed by ${escapeHtml(record.name)} \u00b7 ${formatDateTime(record.completedAt)}</p>
      <div class="next-turn">
        <div class="label">Next turn</div>
        <div class="name">${escapeHtml(nextTurn.name)}</div>
      </div>
      <button class="btn btn-primary btn-block" id="doneBtn" style="margin-top:20px;">Done</button>
    </div>
  `;
  document.getElementById("doneBtn").addEventListener("click", closeSubmitModal);
}

/* ---------------- Init ---------------- */

(async function init() {
  const user = await requireLoggedIn();
  if (!user) return;

  currentGroupId = getActiveGroupId();
  if (!currentGroupId) {
    window.location.href = "group.html";
    return;
  }

  renderUserBox(user);
  loadDashboard();
})();
