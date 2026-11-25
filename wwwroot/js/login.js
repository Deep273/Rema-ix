const form = document.getElementById("login-form");
const error = document.getElementById("login-error");
const password = document.getElementById("password");
const username = document.getElementById("username");
const confirmation = document.getElementById("password-confirmation");
const submit = form.querySelector('[type="submit"]');

let registering = false;
let challenge = null;
const verifyForm = document.getElementById("verify-form");
const verifyCode = document.getElementById("verification-code");

function setMode(value) {
  registering = value;
  challenge = null;
  form.hidden = false;
  verifyForm.hidden = true;
  verifyCode.value = "";
  username.type = value ? "email" : "text";
  username.autocomplete = value ? "email" : "username";

  error.hidden = true;
  password.value = "";
  confirmation.value = "";
  username.removeAttribute("aria-invalid");
  password.removeAttribute("aria-invalid");
  confirmation.removeAttribute("aria-invalid");
  document.getElementById("confirmation-field").hidden = !value;
  document.getElementById("password-hint").hidden = !value;
  confirmation.required = value;
  password.minLength = value ? 10 : 0;
  password.autocomplete = value ? "new-password" : "current-password";
  document.getElementById("mode-login").setAttribute("aria-pressed", !value);
  document.getElementById("mode-register").setAttribute("aria-pressed", value);
  document.querySelector(".form-heading h2").textContent = value
    ? "Создать аккаунт"
    : "Вход в аккаунт";
  document.querySelector(".form-heading p").textContent = value
    ? "Зарегистрируйтесь для доступа к ocenshik-plus."
    : "Введите почту и пароль для доступа к ocenshik-plus.";
  submit.textContent = value ? "Зарегистрироваться" : "Войти";
}
document.getElementById("mode-login").addEventListener("click", () => setMode(false));
document.getElementById("mode-register").addEventListener("click", () => setMode(true));
document.getElementById("show-password").addEventListener("click", (event) => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";

  event.currentTarget.setAttribute("aria-pressed", visible);
  event.currentTarget.setAttribute("aria-label", visible ? "Скрыть пароль" : "Показать пароль");
});
form.addEventListener("input", () => {
  error.hidden = true;
  for (const field of [username, password, confirmation]) field.removeAttribute("aria-invalid");
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  error.hidden = true;
  const email = username.value.trim();
  const showFieldError = (field, message) => {
    field.setAttribute("aria-invalid", "true");
    error.textContent = message;
    error.hidden = false;
    field.focus();
  };
  if (!email) {
    showFieldError(username, "Введите электронную почту.");
    return;
  }
  if (
    (registering || email.includes("@")) &&
    (email.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      username.validity.typeMismatch)
  ) {
    showFieldError(username, "Некорректная почта. Введите адрес в формате name@example.com.");
    return;
  }
  if (!password.value) {
    showFieldError(password, "Введите пароль.");
    return;
  }
  if (registering && (password.value.length < 10 || password.value.length > 1024)) {
    showFieldError(password, "Пароль должен содержать от 10 до 1024 символов.");
    return;
  }
  if (registering && !confirmation.value) {
    showFieldError(confirmation, "Повторите пароль.");
    return;
  }
  if (registering && password.value !== confirmation.value) {
    confirmation.setAttribute("aria-invalid", "true");
    error.textContent = "Пароли не совпадают. Введите одинаковый пароль в обоих полях.";
    error.hidden = false;
    confirmation.focus();
    return;
  }
  submit.disabled = true;
  const modes = [document.getElementById("mode-login"), document.getElementById("mode-register")];
  modes.forEach((button) => (button.disabled = true));
  submit.textContent = registering ? "Создаём аккаунт…" : "Входим…";
  try {
    const response = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
        passwordConfirmation: confirmation.value,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (response.status === 202 && registering) {
      const data = await response.json();
      challenge = data.challenge;
      document.getElementById("verify-message").textContent =
        "Отправили код на " + data.email + ". Он действует 15 минут. Проверьте также папку «Спам».";
      form.hidden = true;
      verifyForm.hidden = false;
      password.value = "";
      confirmation.value = "";
      verifyCode.focus();
      return;
    }
    if (response.ok) {
      location.replace("/");
      return;
    }

    if (registering && [401, 404].includes(response.status)) {
      error.textContent =
        "На сервере запущена старая версия без регистрации. Перезапустите обновлённый ocenshik-plus через start.cmd.";
      error.hidden = false;
      return;
    }
    if (response.status === 401) {
      username.setAttribute("aria-invalid", "true");
      password.setAttribute("aria-invalid", "true");
      password.value = "";
      password.focus();
    }
    if (response.status === 409) {
      username.setAttribute("aria-invalid", "true");
      username.focus();
    }
    const data = await response.json();
    error.textContent = data.message || "Сервис временно недоступен. Повторите позже.";
    error.hidden = false;
  } catch {
    error.textContent = "Нет связи с сервером. Проверьте подключение и повторите.";
    error.hidden = false;
  } finally {
    submit.disabled = false;
    modes.forEach((button) => (button.disabled = false));
    submit.textContent = registering ? "Зарегистрироваться" : "Войти";
  }
});
document.getElementById("change-email").addEventListener("click", () => setMode(true));
verifyCode.addEventListener("input", () => {
  error.hidden = true;
});
verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = verifyForm.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge, code: verifyCode.value.trim() }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      location.replace("/");
      return;
    }
    const data = await response.json();
    error.textContent = data.message || "Не удалось подтвердить почту.";
    error.hidden = false;
  } catch {
    error.textContent = "Нет связи с сервером. Попробуйте ещё раз.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("show-confirmation").addEventListener("click", (event) => {
  const visible = confirmation.type === "password";
  confirmation.type = visible ? "text" : "password";
  event.currentTarget.setAttribute("aria-pressed", visible);
  event.currentTarget.setAttribute(
    "aria-label",
    visible ? "Скрыть повтор пароля" : "Показать повтор пароля",
  );
});
