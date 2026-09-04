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

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert();

    const submitBtn = document.getElementById("submitBtn");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    setLoading(submitBtn, true, "Logging in\u2026", "Log in");
    try {
      await Api.login({ email, password });
      window.location.href = "group.html";
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
      window.location.href = "group.html";
    } catch (err) {
      showAlert(err.message || "Unable to create your account.");
      setLoading(submitBtn, false, "Creating account\u2026", "Create account");
    }
  });
}
