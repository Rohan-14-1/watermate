let currentGroupId = null;
let isAdmin = false;
let members = [];
let dragFromIndex = null;

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
  document.getElementById("pageAlert").innerHTML = `<div class="alert alert-${type === "error" ? "error" : "success"}">${message}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderMembers() {
  const el = document.getElementById("membersContent");

  if (members.length === 0) {
    el.innerHTML = `<div class="empty-state card"><h3>No members yet.</h3></div>`;
    return;
  }

  el.innerHTML = `
    <ul class="member-list" id="memberList">
      ${members
        .map(
          (m, idx) => `
        <li class="member-row" draggable="${isAdmin}" data-member-id="${m.id}" data-index="${idx}">
          ${
            isAdmin
              ? `
            <div class="member-row__reorder-btns">
              <button type="button" class="btn-icon" data-move-up="${idx}" title="Move up" ${idx === 0 ? "disabled" : ""}>▲</button>
              <button type="button" class="btn-icon" data-move-down="${idx}" title="Move down" ${idx === members.length - 1 ? "disabled" : ""}>▼</button>
            </div>
            <span class="member-row__handle" title="Drag to reorder">&#x2630;</span>
          `
              : ""
          }
          <span class="member-row__order">${idx + 1}</span>
          <span class="member-row__name">
            <div class="name">${escapeHtml(m.name)}</div>
            <div class="email">${escapeHtml(m.email)}</div>
          </span>
          ${m.isCurrentTurn ? `<span class="badge badge-next">Next</span>` : ""}
          ${isAdmin ? `<button class="btn-link" data-remove="${m.id}" style="color:#b3432f;margin-left:auto;">Remove</button>` : ""}
        </li>
      `
        )
        .join("")}
    </ul>
  `;

  if (isAdmin) {
    attachDragHandlers();
    el.querySelectorAll("[data-move-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.moveUp);
        if (i <= 0) return;
        const [moved] = members.splice(i, 1);
        members.splice(i - 1, 0, moved);
        renderMembers();
        showSaveBar();
      });
    });
    el.querySelectorAll("[data-move-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.moveDown);
        if (i >= members.length - 1) return;
        const [moved] = members.splice(i, 1);
        members.splice(i + 1, 0, moved);
        renderMembers();
        showSaveBar();
      });
    });
    el.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => handleRemove(btn.dataset.remove));
    });
  }
}

function attachDragHandlers() {
  const rows = document.querySelectorAll(".member-row");
  rows.forEach((row) => {
    row.addEventListener("dragstart", () => {
      dragFromIndex = Number(row.dataset.index);
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const toIndex = Number(row.dataset.index);
      if (dragFromIndex === null || dragFromIndex === toIndex) return;
      const [moved] = members.splice(dragFromIndex, 1);
      members.splice(toIndex, 0, moved);
      dragFromIndex = null;
      renderMembers();
      showSaveBar();
    });
  });
}

function showSaveBar() {
  document.getElementById("saveBar").innerHTML = `
    <button class="btn btn-primary" id="saveOrderBtn">Save turn order</button>
  `;
  document.getElementById("saveOrderBtn").addEventListener("click", saveOrder);
}

async function saveOrder() {
  const btn = document.getElementById("saveOrderBtn");
  btn.disabled = true;
  btn.textContent = "Saving\u2026";
  try {
    const { members: updated } = await Api.updateTurnOrder(
      currentGroupId,
      members.map((m) => m.id)
    );
    members = updated;
    renderMembers();
    document.getElementById("saveBar").innerHTML = "";
    pageAlert("Turn order updated.", "success");
  } catch (err) {
    pageAlert(err.message || "Unable to save turn order.");
    btn.disabled = false;
    btn.textContent = "Save turn order";
  }
}

async function handleRemove(memberId) {
  if (!confirm("Remove this member from the group?")) return;
  try {
    await Api.removeMember(currentGroupId, memberId);
    await loadMembers();
  } catch (err) {
    pageAlert(err.message || "Unable to remove member.");
  }
}

async function loadMembers() {
  try {
    const [{ members: m }, { group }] = await Promise.all([
      Api.listMembers(currentGroupId),
      Api.getGroup(currentGroupId),
    ]);
    members = m;
    const user = await Api.me();
    isAdmin = group.createdBy === user.user.id;
    document.getElementById("adminHint").style.display = isAdmin ? "block" : "none";
    renderMembers();
  } catch (err) {
    pageAlert(err.message || "Unable to load members.");
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
  loadMembers();
})();
