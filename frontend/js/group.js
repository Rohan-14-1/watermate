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
  if (box) box.innerHTML = `<div class="alert alert-${type === "error" ? "error" : "success"}">${message}</div>`;
}

function renderGroups(groups) {
  const section = document.getElementById("groupsSection");

  if (groups.length === 0) {
    section.innerHTML = `
      <div class="empty-state card">
        <h3>You haven't joined any groups yet.</h3>
        <p>Create one for your flat, or join with an invite code below.</p>
      </div>
    `;
    return;
  }

  const activeId = getActiveGroupId();

  section.innerHTML = `
    <div class="group-cards">
      ${groups
        .map((g) => {
          const isActive = g.id === activeId || (!activeId && groups[0].id === g.id);
          return `
            <div class="group-card" data-group-id="${g.id}" style="${
              isActive ? "border-color:var(--teal-500);box-shadow:0 0 0 2px var(--teal-100);" : ""
            }">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <div class="group-card__name" style="margin-bottom:0;">${escapeHtml(g.name)}</div>
                ${
                  isActive
                    ? '<span class="badge badge-success">Active Flat</span>'
                    : '<span class="text-muted" style="font-size:0.78rem;">Tap to open &rarr;</span>'
                }
              </div>
              <div class="group-card__meta">${g.memberCount} member${
            g.memberCount === 1 ? "" : "s"
          } &middot; Invite Code <strong>${g.inviteCode}</strong></div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  section.querySelectorAll(".group-card").forEach((card) => {
    card.addEventListener("click", () => {
      setActiveGroupId(card.dataset.groupId);
      window.location.href = "dashboard.html";
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadGroups() {
  try {
    const { groups } = await Api.listGroups();
    renderGroups(groups);
  } catch (err) {
    document.getElementById("groupsSection").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

document.getElementById("createGroupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("createBtn");
  const nameInput = document.getElementById("groupName");
  const resultBox = document.getElementById("createResult");
  resultBox.innerHTML = "";

  btn.disabled = true;
  btn.textContent = "Creating\u2026";
  try {
    const { group } = await Api.createGroup(nameInput.value.trim());
    resultBox.innerHTML = `
      <div class="invite-code-display">
        <div class="text-muted" style="font-size:0.85rem;">Invite code</div>
        <div class="code">${group.inviteCode}</div>
        <div class="text-muted" style="font-size:0.85rem;margin-top:6px;">Share this with your roommates</div>
      </div>
      <button class="btn btn-primary btn-block" id="goToNewGroup">Go to ${escapeHtml(group.name)}</button>
    `;
    document.getElementById("goToNewGroup").addEventListener("click", () => {
      setActiveGroupId(group.id);
      window.location.href = "dashboard.html";
    });
    nameInput.value = "";
    loadGroups();
  } catch (err) {
    resultBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Create group";
  }
});

document.getElementById("joinGroupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("joinBtn");
  const codeInput = document.getElementById("inviteCode");
  const resultBox = document.getElementById("joinResult");
  resultBox.innerHTML = "";

  btn.disabled = true;
  btn.textContent = "Joining\u2026";
  try {
    const { message, group } = await Api.joinGroup(codeInput.value.trim());
    resultBox.innerHTML = `<div class="alert alert-success">${message}</div>`;
    codeInput.value = "";
    if (group) setActiveGroupId(group.id);
    loadGroups();
  } catch (err) {
    resultBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Join group";
  }
});

(async function init() {
  const user = await requireLoggedIn();
  if (!user) return;
  renderUserBox(user);

  const avatar = document.getElementById("settingsAvatar");
  const nameEl = document.getElementById("settingsUserName");
  const emailEl = document.getElementById("settingsUserEmail");
  const logoutBtn = document.getElementById("settingsLogoutBtn");

  if (avatar) avatar.textContent = initials(user.name);
  if (nameEl) nameEl.textContent = user.name;
  if (emailEl) emailEl.textContent = user.email;
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await Api.logout();
      localStorage.removeItem("wm_active_group");
      window.location.href = "login.html";
    });
  }

  loadGroups();
})();
