let currentUser = null;
let currentActiveGroup = null;

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderActiveGroupSettings(group) {
  const titleEl = document.getElementById("activeGroupSectionTitle");
  const cardEl = document.getElementById("activeGroupCard");
  if (!titleEl || !cardEl) return;

  if (!group || !currentUser) {
    titleEl.style.display = "none";
    cardEl.style.display = "none";
    return;
  }

  currentActiveGroup = group;
  const isAdmin = group.createdBy === currentUser.id;

  const nameEl = document.getElementById("activeGroupName");
  const codeEl = document.getElementById("activeGroupInviteCode");
  const countEl = document.getElementById("activeGroupMemberCount");
  const roleBadge = document.getElementById("activeGroupRoleBadge");
  const actionsEl = document.getElementById("activeGroupActions");

  if (nameEl) nameEl.textContent = group.name;
  if (codeEl) codeEl.textContent = group.inviteCode;
  if (countEl) {
    countEl.textContent = `${group.memberCount || 1} member${group.memberCount === 1 ? "" : "s"}`;
  }

  if (roleBadge) {
    roleBadge.textContent = isAdmin ? "Admin" : "Member";
    roleBadge.className = isAdmin ? "badge badge-success" : "badge";
  }

  if (actionsEl) {
    if (isAdmin) {
      actionsEl.innerHTML = `
        <button type="button" class="btn btn-secondary" id="transferAdminTriggerBtn" style="font-size:0.88rem;padding:8px 14px;">
          &#128101; Transfer Admin
        </button>
        <button type="button" class="btn btn-secondary" id="leaveGroupTriggerBtn" style="font-size:0.88rem;padding:8px 14px;">
          Leave Group
        </button>
        <button type="button" class="btn btn-danger" id="deleteGroupTriggerBtn" style="font-size:0.88rem;padding:8px 14px;color:#b3432f;border-color:#eecbc0;">
          &#128465; Delete Group
        </button>
      `;
    } else {
      actionsEl.innerHTML = `
        <button type="button" class="btn btn-danger" id="leaveGroupTriggerBtn" style="font-size:0.88rem;padding:8px 14px;color:#b3432f;border-color:#eecbc0;">
          Leave Group
        </button>
      `;
    }

    const leaveBtn = document.getElementById("leaveGroupTriggerBtn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => handleLeaveGroupClick(isAdmin));
    }

    const transferBtn = document.getElementById("transferAdminTriggerBtn");
    if (transferBtn) {
      transferBtn.addEventListener("click", () => openTransferAdminModal());
    }

    const deleteBtn = document.getElementById("deleteGroupTriggerBtn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => openDeleteGroupModal());
    }
  }

  titleEl.style.display = "block";
  cardEl.style.display = "block";
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
    renderActiveGroupSettings(null);
    return;
  }

  let activeId = getActiveGroupId();
  let activeGroup = groups.find((g) => g.id === activeId);
  if (!activeGroup) {
    activeGroup = groups[0];
    activeId = activeGroup.id;
    setActiveGroupId(activeId);
  }

  renderActiveGroupSettings(activeGroup);

  section.innerHTML = `
    <div class="group-cards">
      ${groups
        .map((g) => {
          const isActive = g.id === activeId;
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

async function loadGroups() {
  try {
    const { groups } = await Api.listGroups();
    renderGroups(groups);
  } catch (err) {
    document.getElementById("groupsSection").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    renderActiveGroupSettings(null);
  }
}

/* ---------------- Leave Group Flow ---------------- */

function handleLeaveGroupClick(isAdmin) {
  if (isAdmin) {
    // Admin must transfer ownership or delete group
    openModal("adminLeaveModal");
  } else {
    // Normal member confirmation
    const alertEl = document.getElementById("leaveModalAlert");
    if (alertEl) alertEl.innerHTML = "";
    openModal("leaveGroupModal");
  }
}

const confirmLeaveBtn = document.getElementById("confirmLeaveBtn");
if (confirmLeaveBtn) {
  confirmLeaveBtn.addEventListener("click", async () => {
    if (!currentActiveGroup) return;
    const alertEl = document.getElementById("leaveModalAlert");
    if (alertEl) alertEl.innerHTML = "";

    confirmLeaveBtn.disabled = true;
    confirmLeaveBtn.textContent = "Leaving\u2026";
    try {
      await Api.leaveGroup(currentActiveGroup.id);
      closeModal("leaveGroupModal");
      localStorage.removeItem("wm_active_group");
      pageAlert("You have left the group.", "success");
      await loadGroups();
    } catch (err) {
      if (alertEl) alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    } finally {
      confirmLeaveBtn.disabled = false;
      confirmLeaveBtn.textContent = "Leave Group";
    }
  });
}

const adminLeaveToTransferBtn = document.getElementById("adminLeaveToTransferBtn");
if (adminLeaveToTransferBtn) {
  adminLeaveToTransferBtn.addEventListener("click", () => {
    closeModal("adminLeaveModal");
    openTransferAdminModal();
  });
}

const adminLeaveToDeleteBtn = document.getElementById("adminLeaveToDeleteBtn");
if (adminLeaveToDeleteBtn) {
  adminLeaveToDeleteBtn.addEventListener("click", () => {
    closeModal("adminLeaveModal");
    openDeleteGroupModal();
  });
}

/* ---------------- Transfer Admin Flow ---------------- */

let transferMembersList = [];

async function openTransferAdminModal() {
  if (!currentActiveGroup) return;
  const alertEl = document.getElementById("transferModalAlert");
  if (alertEl) alertEl.innerHTML = "";

  const stepSelect = document.getElementById("transferStepSelect");
  const stepConfirm = document.getElementById("transferStepConfirm");
  if (stepSelect) stepSelect.style.display = "block";
  if (stepConfirm) stepConfirm.style.display = "none";

  const select = document.getElementById("newAdminSelect");
  const continueBtn = document.getElementById("continueTransferBtn");
  if (select) {
    select.innerHTML = `<option disabled selected>Loading group members\u2026</option>`;
  }
  if (continueBtn) continueBtn.disabled = true;

  openModal("transferAdminModal");

  try {
    const { members } = await Api.listMembers(currentActiveGroup.id);
    transferMembersList = members || [];
    const eligibleMembers = transferMembersList.filter((m) => m.userId !== currentUser.id);

    if (eligibleMembers.length === 0) {
      if (select) {
        select.innerHTML = `<option disabled selected>No other members in this group</option>`;
      }
      if (continueBtn) continueBtn.disabled = true;
      if (alertEl) {
        alertEl.innerHTML = `<div class="alert alert-error">There are no other members in this group to transfer ownership to. Invite members first, or delete the group.</div>`;
      }
      return;
    }

    if (select) {
      select.innerHTML = eligibleMembers
        .map((m) => `<option value="${m.userId}">${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`)
        .join("");
    }
    if (continueBtn) continueBtn.disabled = false;
  } catch (err) {
    if (alertEl) alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

const continueTransferBtn = document.getElementById("continueTransferBtn");
if (continueTransferBtn) {
  continueTransferBtn.addEventListener("click", () => {
    const select = document.getElementById("newAdminSelect");
    if (!select || !select.value) return;

    const selectedMember = transferMembersList.find((m) => m.userId === select.value);
    const selectedName = selectedMember ? selectedMember.name : "this member";

    const confirmText = document.getElementById("transferConfirmText");
    if (confirmText) {
      confirmText.textContent = `Transfer admin to ${selectedName}?`;
    }

    const stepSelect = document.getElementById("transferStepSelect");
    const stepConfirm = document.getElementById("transferStepConfirm");
    if (stepSelect) stepSelect.style.display = "none";
    if (stepConfirm) stepConfirm.style.display = "block";
  });
}

const backTransferBtn = document.getElementById("backTransferBtn");
if (backTransferBtn) {
  backTransferBtn.addEventListener("click", () => {
    const stepSelect = document.getElementById("transferStepSelect");
    const stepConfirm = document.getElementById("transferStepConfirm");
    if (stepSelect) stepSelect.style.display = "block";
    if (stepConfirm) stepConfirm.style.display = "none";
  });
}

const confirmTransferBtn = document.getElementById("confirmTransferBtn");
if (confirmTransferBtn) {
  confirmTransferBtn.addEventListener("click", async () => {
    const select = document.getElementById("newAdminSelect");
    if (!select || !select.value || !currentActiveGroup) return;

    const alertEl = document.getElementById("transferModalAlert");
    if (alertEl) alertEl.innerHTML = "";

    confirmTransferBtn.disabled = true;
    confirmTransferBtn.textContent = "Transferring\u2026";
    try {
      await Api.transferAdmin(currentActiveGroup.id, select.value);
      closeModal("transferAdminModal");
      pageAlert("Admin ownership transferred successfully.", "success");
      await loadGroups();
    } catch (err) {
      if (alertEl) alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    } finally {
      confirmTransferBtn.disabled = false;
      confirmTransferBtn.textContent = "Transfer Admin";
    }
  });
}

/* ---------------- Delete Group Flow ---------------- */

function openDeleteGroupModal() {
  if (!currentActiveGroup) return;
  const alertEl = document.getElementById("deleteModalAlert");
  if (alertEl) alertEl.innerHTML = "";

  const expectedNameEl = document.getElementById("expectedGroupName");
  if (expectedNameEl) expectedNameEl.textContent = currentActiveGroup.name;

  const input = document.getElementById("confirmDeleteGroupNameInput");
  const confirmBtn = document.getElementById("confirmDeleteBtn");
  if (input) {
    input.value = "";
    input.placeholder = currentActiveGroup.name;
    input.oninput = () => {
      const match = input.value.trim().toLowerCase() === currentActiveGroup.name.trim().toLowerCase();
      if (confirmBtn) confirmBtn.disabled = !match;
    };
  }
  if (confirmBtn) confirmBtn.disabled = true;

  openModal("deleteGroupModal");
}

const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
if (confirmDeleteBtn) {
  confirmDeleteBtn.addEventListener("click", async () => {
    if (!currentActiveGroup) return;
    const alertEl = document.getElementById("deleteModalAlert");
    if (alertEl) alertEl.innerHTML = "";

    confirmDeleteBtn.disabled = true;
    confirmDeleteBtn.textContent = "Deleting group\u2026";
    try {
      await Api.deleteGroup(currentActiveGroup.id);
      closeModal("deleteGroupModal");
      localStorage.removeItem("wm_active_group");
      pageAlert("Group deleted successfully.", "success");
      await loadGroups();
    } catch (err) {
      if (alertEl) alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      confirmDeleteBtn.disabled = false;
      confirmDeleteBtn.textContent = "Delete Group";
    }
  });
}

/* ---------------- Modal Helpers ---------------- */

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = false;
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

// Attach close button and backdrop click handlers for all modals
[
  { modalId: "leaveGroupModal", closeBtnId: "closeLeaveModalBtn", cancelBtnId: "cancelLeaveBtn" },
  { modalId: "adminLeaveModal", closeBtnId: "closeAdminLeaveModalBtn", cancelBtnId: "cancelAdminLeaveBtn" },
  { modalId: "transferAdminModal", closeBtnId: "closeTransferModalBtn", cancelBtnId: "cancelTransferBtn" },
  { modalId: "deleteGroupModal", closeBtnId: "closeDeleteModalBtn", cancelBtnId: "cancelDeleteBtn" },
].forEach(({ modalId, closeBtnId, cancelBtnId }) => {
  const modal = document.getElementById(modalId);
  const closeBtn = document.getElementById(closeBtnId);
  const cancelBtn = document.getElementById(cancelBtnId);

  if (closeBtn) closeBtn.addEventListener("click", () => closeModal(modalId));
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeModal(modalId));
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modalId);
    });
  }
});

/* ---------------- Create & Join Group Handlers ---------------- */

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
    await loadGroups();
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
    await loadGroups();
  } catch (err) {
    resultBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Join group";
  }
});

/* ---------------- Page Initialization ---------------- */

(async function init() {
  const user = await requireLoggedIn();
  if (!user) return;
  currentUser = user;
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

  // Check biometric capability on native devices
  const NativeBiometric = window.Capacitor?.Plugins?.NativeBiometric;
  if (NativeBiometric) {
    try {
      const info = await NativeBiometric.isAvailable();
      if (info.isAvailable) {
        const card = document.getElementById("biometricSettingsCard");
        const icon = document.getElementById("biometricSettingsIcon");
        const title = document.getElementById("biometricSettingsTitle");
        const sub = document.getElementById("biometricSettingsSub");
        const badge = document.getElementById("biometricBadge");

        const platform = window.Capacitor?.getPlatform ? window.Capacitor.getPlatform() : "web";
        const isFaceId = platform === "ios" && info.biometryType !== 1;

        if (icon) icon.textContent = isFaceId ? "\uD83D\uDC64" : "\uD83D\uDC46";
        if (title) title.textContent = isFaceId ? "Face ID Sign-In" : "Fingerprint Sign-In";
        if (sub) {
          sub.textContent = isFaceId
            ? "Unlock WaterMate securely using Face ID"
            : "Unlock WaterMate securely using your fingerprint";
        }

        const enabled = localStorage.getItem("wm_biometric_enabled") === "true";
        if (badge) {
          badge.textContent = enabled ? "\u2713 Active" : "Available";
          badge.className = enabled ? "badge badge-success" : "badge";
        }
        if (card) card.style.display = "block";
      }
    } catch (e) {
      console.warn("Biometric check in settings:", e);
    }
  }

  await loadGroups();
})();
