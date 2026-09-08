function showAlert(message, type = "error") {
  const box = document.getElementById("alertBox");
  if (!box) return;
  box.innerHTML = `<div class="alert alert-${type === "error" ? "error" : "success"}">${message}</div>`;
}

function clearAlert() {
  const box = document.getElementById("alertBox");
  if (box) box.innerHTML = "";
}

function setLoading(button, isLoading, loadingText, defaultText) {
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : defaultText;
}

async function routeAfterAuth() {
  try {
    const { groups } = await Api.listGroups();
    const active = getActiveGroupId();
    if (active && groups.some((g) => g.id === active)) {
      window.location.href = "dashboard.html";
      return;
    }
    if (groups && groups.length > 0) {
      setActiveGroupId(groups[0].id);
      window.location.href = "dashboard.html";
      return;
    }
    window.location.href = "group.html";
  } catch (_) {
    window.location.href = "dashboard.html";
  }
}

/* ---------------- Biometric Authentication (Face ID / Fingerprint) ---------------- */

let isBiometricAvailable = false;
let isFaceIdDevice = false;

async function checkBiometrics() {
  const NativeBiometric = window.Capacitor?.Plugins?.NativeBiometric;
  if (!NativeBiometric) return;

  try {
    const info = await NativeBiometric.isAvailable();
    if (!info.isAvailable) return;

    isBiometricAvailable = true;
    const platform = window.Capacitor?.getPlatform ? window.Capacitor.getPlatform() : "web";
    // BiometryType: 1 = TouchId, 2 = FaceId, 3 = Fingerprint, 4 = FaceAuthentication
    isFaceIdDevice = platform === "ios" && info.biometryType !== 1;

    const biometricSection = document.getElementById("biometricSection");
    const biometricLabel = document.getElementById("biometricLabel");
    const biometricIcon = document.getElementById("biometricIcon");
    const biometricBtn = document.getElementById("biometricBtn");

    if (biometricSection && biometricLabel && biometricIcon) {
      if (isFaceIdDevice) {
        biometricLabel.textContent = "Log in with Face ID";
        biometricIcon.textContent = "\uD83D\uDC64";
      } else {
        biometricLabel.textContent = "Log in with Fingerprint";
        biometricIcon.textContent = "\uD83D\uDC46";
      }
      biometricSection.style.display = "block";
    }

    if (biometricBtn) {
      biometricBtn.addEventListener("click", handleBiometricLogin);
    }

    // If biometric login was previously enabled and credentials saved, auto-prompt once
    const enabled = localStorage.getItem("wm_biometric_enabled");
    if (enabled === "true") {
      setTimeout(handleBiometricLogin, 400);
    }
  } catch (err) {
    console.warn("Biometric check error:", err);
  }
}

async function handleBiometricLogin() {
  clearAlert();
  const NativeBiometric = window.Capacitor?.Plugins?.NativeBiometric;
  if (!NativeBiometric || !isBiometricAvailable) return;

  try {
    await NativeBiometric.verifyIdentity({
      reason: isFaceIdDevice
        ? "Scan your face to log in to WaterMate"
        : "Scan your fingerprint to log in to WaterMate",
      title: isFaceIdDevice ? "Face ID Login" : "Fingerprint Login",
      subtitle: "Sign in to your WaterMate account",
      description: "Quick and secure biometric authentication.",
    });

    const creds = await NativeBiometric.getCredentials({ server: "com.watermate.app" });
    if (creds && creds.username && creds.password) {
      const submitBtn = document.getElementById("submitBtn");
      if (submitBtn) setLoading(submitBtn, true, "Logging in\u2026", "Log in");
      await Api.login({ email: creds.username, password: creds.password });
      await routeAfterAuth();
    } else {
      showAlert("Please log in with email and password once to enable biometric login for your device.", "error");
    }
  } catch (err) {
    const msg = err?.message || "";
    if (
      !msg.toLowerCase().includes("cancel") &&
      !msg.toLowerCase().includes("cancelled") &&
      !msg.toLowerCase().includes("fallback")
    ) {
      showAlert(msg || "Biometric authentication failed.");
    }
  }
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  checkBiometrics();

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert();

    const submitBtn = document.getElementById("submitBtn");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    setLoading(submitBtn, true, "Logging in\u2026", "Log in");
    try {
      await Api.login({ email, password });

      // Save credentials for biometric login if native biometrics is available
      const NativeBiometric = window.Capacitor?.Plugins?.NativeBiometric;
      if (NativeBiometric && isBiometricAvailable) {
        try {
          await NativeBiometric.setCredentials({
            username: email,
            password: password,
            server: "com.watermate.app",
          });
          localStorage.setItem("wm_biometric_enabled", "true");
        } catch (bioErr) {
          console.warn("Could not save biometric credentials:", bioErr);
        }
      }

      await routeAfterAuth();
    } catch (err) {
      showAlert(err.message || "Invalid email or password.");
      setLoading(submitBtn, false, "Logging in\u2026", "Log in");
    }
  });
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert();

    const submitBtn = document.getElementById("submitBtn");
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      showAlert("Passwords do not match.");
      return;
    }

    setLoading(submitBtn, true, "Creating account\u2026", "Create account");
    try {
      await Api.register({ name, email, password, confirmPassword });
      await routeAfterAuth();
    } catch (err) {
      showAlert(err.message || "Unable to create your account.");
      setLoading(submitBtn, false, "Creating account\u2026", "Create account");
    }
  });
}

