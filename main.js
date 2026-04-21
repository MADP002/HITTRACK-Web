/* =============================================
   HITTRACK — main.js
   Handles: login, signup, forgot password modal, toast
   ============================================= */

(function () {
  "use strict";

  /* ── DOM refs ──────────────────────────── */
  const loginForm    = document.getElementById("loginForm");
  const loginBtn     = document.getElementById("loginBtn");
  const signupBtn    = document.getElementById("signupBtn");
  const emailInput   = document.getElementById("emailInput");
  const passwordInput= document.getElementById("passwordInput");
  const errorMsg     = document.getElementById("errorMsg");

  const forgotLink   = document.getElementById("forgotLink");
  const modalOverlay = document.getElementById("modalOverlay");
  const modalClose   = document.getElementById("modalClose");
  const resetEmail   = document.getElementById("resetEmail");
  const sendResetBtn = document.getElementById("sendResetBtn");

  /* ── Toast utility ─────────────────────── */
  function showToast(message, duration = 3000) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }

  /* ── Simple validation ─────────────────── */
  function validateEmail(val) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) || val.trim().length >= 3;
  }

  function setError(msg) {
    errorMsg.textContent = msg;
  }

  function clearError() {
    errorMsg.textContent = "";
  }

  /* ── Login form submit ─────────────────── */
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();

    const email    = emailInput.value.trim();
    const password = passwordInput.value;

    // Basic client-side validation
    if (!email) {
      setError("Please enter your email or username.");
      emailInput.focus();
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      passwordInput.focus();
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      passwordInput.focus();
      return;
    }

    // Simulate async login
    loginBtn.classList.add("loading");
    loginBtn.disabled = true;

    setTimeout(() => {
      loginBtn.classList.remove("loading");
      loginBtn.disabled = false;

      // Demo: accept any credentials — replace with real API call
      showToast("✓ Login successful! Redirecting…");

      // Reset form after demo
      setTimeout(() => {
        loginForm.reset();
      }, 2000);
    }, 1800);
  });

  /* ── Signup button ─────────────────────── */
  signupBtn.addEventListener("click", function () {
    window.location.href = "signup.html";
  });

  /* ── Input real-time error clear ──────── */
  [emailInput, passwordInput].forEach((input) => {
    input.addEventListener("input", clearError);
  });

  /* ── Forgot password modal ─────────────── */
  forgotLink.addEventListener("click", function (e) {
    e.preventDefault();
    modalOverlay.classList.add("active");
    setTimeout(() => resetEmail.focus(), 100);
  });

  function closeModal() {
    modalOverlay.classList.remove("active");
    resetEmail.value = "";
  }

  modalClose.addEventListener("click", closeModal);

  modalOverlay.addEventListener("click", function (e) {
    if (e.target === modalOverlay) closeModal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modalOverlay.classList.contains("active")) {
      closeModal();
    }
  });

  sendResetBtn.addEventListener("click", function () {
    const email = resetEmail.value.trim();
    if (!email || !validateEmail(email)) {
      resetEmail.style.borderColor = "var(--accent)";
      resetEmail.focus();
      return;
    }
    resetEmail.style.borderColor = "";
    sendResetBtn.classList.add("loading");
    sendResetBtn.disabled = true;

    setTimeout(() => {
      sendResetBtn.classList.remove("loading");
      sendResetBtn.disabled = false;
      closeModal();
      showToast("📧 Reset link sent! Check your inbox.");
    }, 1500);
  });

  /* ── Loader button markup ──────────────── */
  // Inject loader span into sendResetBtn (already in loginBtn via HTML)
  sendResetBtn.innerHTML = `<span class="btn-text">Send Reset Link</span><span class="btn-loader" aria-hidden="true"></span>`;

})();
