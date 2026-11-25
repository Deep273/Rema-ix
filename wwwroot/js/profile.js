(async () => {
  const byId = (id) => document.getElementById(id);
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (response.status === 401) {
    location.replace("/login.html");
    return;
  }
  if (!response.ok) throw Error("Не удалось загрузить аккаунт. Обновите страницу.");
  const { user } = await response.json();
  const key = "landscope-profile:" + user.id;
  let data = { name: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === "object") data = saved;
  } catch {}
  function persist() {
    localStorage.setItem(key, JSON.stringify(data));
  }
  function renderIdentity() {
    const name =
      typeof data.name === "string" && data.name.trim() ? data.name : user.username.split("@")[0];
    byId("display-name").textContent = name;
    byId("profile-avatar").textContent = name.slice(0, 1).toUpperCase();
  }
  byId("account-email").textContent = user.username;
  byId("profile-email").value = user.username;
  byId("profile-name").value = typeof data.name === "string" ? data.name : "";
  byId("profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const previous = data.name;
    data.name = byId("profile-name").value.trim();
    try {
      persist();
      renderIdentity();
      byId("save-status").textContent = "Сохранено";
    } catch {
      data.name = previous;
      byId("save-status").textContent = "Не удалось сохранить настройки в браузере.";
    }
  });
  const plans = {
    solo: { name: "Соло", price: 4990 },
    team: { name: "Команда", price: 6990 },
    unlimited: { name: "Безлимит", price: 11990 },
  };
  const planInputs = [...document.querySelectorAll('[name="plan"]')];
  if (data.subscription && [1, 6, 12].includes(data.subscription.months)) {
    planInputs.forEach((input) => (input.checked = input.value === data.subscription.plan));
    document.querySelector(`[name="period"][value="${data.subscription.months}"]`).checked = true;
  }

  document.querySelectorAll(".subscription-plan,.subscription-period label").forEach((label) => {
    const input = label.querySelector("input");
    label.addEventListener("click", (event) => {
      if (event.target === input) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      input.checked = input.type === "checkbox" ? !input.checked : true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  function selection() {
    return {
      plan: document.querySelector('[name="plan"]:checked')?.value || null,
      months: Number(document.querySelector('[name="period"]:checked').value),
    };
  }
  function subscriptionNotice(title, message, error = false) {
    const box = byId("subscription-status");
    if (box.parentElement !== document.body) document.body.append(box);
    box.replaceChildren();
    box.hidden = !title;
    box.classList.toggle("is-error", error);
    if (!title) return;
    const icon = document.createElement("span");
    icon.className = "subscription-notice-icon";
    icon.textContent = error ? "!" : "✓";
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const description = document.createElement("p");
    description.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "subscription-notice-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрыть уведомление");
    close.addEventListener("click", () => {
      box.hidden = true;
    });
    copy.append(heading, description);
    box.append(icon, copy, close);
  }
  function renderSubscription() {
    const { plan, months } = selection();
    if (plan) {
      const cost = plans[plan].price.toLocaleString("ru-RU");
      byId("subscription-total").textContent =
        `${plans[plan].name} · ${months === 1 ? "1 месяц" : months === 6 ? "6 месяцев" : "12 месяцев"}`;
      byId("subscription-note").textContent =
        `${cost} ₽ / месяц${months === 1 ? "" : " · итоговая стоимость срока уточняется"}`;
    } else {
      byId("subscription-total").textContent = "Тариф не выбран";
      byId("subscription-note").textContent =
        "Выберите подходящий вариант или сохраните без тарифа.";
    }
    subscriptionNotice("", "");
  }
  planInputs.forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked)
        planInputs.forEach((other) => {
          if (other !== input) other.checked = false;
        });
      renderSubscription();
    }),
  );
  document
    .querySelectorAll('[name="period"]')
    .forEach((input) => input.addEventListener("change", renderSubscription));
  byId("save-subscription").addEventListener("click", () => {
    const previous = data.subscription;
    data.subscription = selection();
    try {
      persist();
      subscriptionNotice(
        data.subscription.plan ? "Выбор сохранён" : "Выбор тарифа сброшен",
        data.subscription.plan
          ? "Подписка ещё не активирована. Ваш тариф сохранён в этом браузере."
          : "Сохранено без тарифа. Вы сможете выбрать его позже.",
      );
    } catch {
      data.subscription = previous;
      subscriptionNotice(
        "Не удалось сохранить",
        "Браузер не разрешил сохранение. Попробуйте ещё раз.",
        true,
      );
    }
  });
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const originalLabel = button.getAttribute("aria-label");
    button.addEventListener("click", () => {
      const input = byId(button.dataset.passwordToggle);
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";

      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute(
        "aria-label",
        visible ? originalLabel.replace("Показать", "Скрыть") : originalLabel,
      );
    });
  });
  byId("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("[type=submit]");
    const values = Object.fromEntries(new FormData(form));
    const status = byId("password-status");
    if (values.newPassword !== values.passwordConfirmation) {
      status.textContent = "Новые пароли не совпадают.";
      return;
    }
    button.disabled = true;
    status.textContent = "Меняем пароль…";
    try {
      const result = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await result.json();
      if (!result.ok) throw Error(payload.message || "Не удалось изменить пароль.");
      form.reset();
      status.textContent = payload.message;
    } catch (error) {
      status.textContent = error.message || "Нет соединения с сервером.";
    } finally {
      button.disabled = false;
    }
  });
  const theme = byId("theme");
  function setTheme(dark) {
    document.documentElement.classList.toggle("dark", dark);
    theme?.setAttribute("aria-pressed", String(dark));
    theme?.setAttribute("aria-label", dark ? "Включить светлую тему" : "Включить тёмную тему");
  }
  try {
    setTheme(localStorage.getItem("landscope-theme") === "dark");
  } catch {}
  theme?.addEventListener("click", () => {
    const dark = !document.documentElement.classList.contains("dark");
    setTheme(dark);
    try {
      localStorage.setItem("landscope-theme", dark ? "dark" : "light");
    } catch {}
  });
  renderIdentity();
  renderSubscription();
  byId("profile-status").hidden = true;
  byId("profile-content").hidden = false;
  const sectionLinks = [...document.querySelectorAll('.profile-local-nav a[href^="#"]')];
  const sections = sectionLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let requestedSection = null;
  let navigationTimer;
  document.querySelectorAll('.profile-local-nav a[href^="#"],.profile-back').forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      requestedSection = target;
      clearTimeout(navigationTimer);
      const header = document.querySelector("body > .header,body > .site-header");
      const offset = (header?.getBoundingClientRect().height || 0) + 20;
      window.scrollTo({
        top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset),
        behavior: motion.matches ? "instant" : "smooth",
      });
      sectionLinks.forEach((item) => {
        if (item.hash === "#" + target.id) item.setAttribute("aria-current", "location");
        else item.removeAttribute("aria-current");
      });
      navigationTimer = setTimeout(() => {
        requestedSection = null;
        updateSection();
      }, 1000);
      history.replaceState(null, "", link.getAttribute("href"));
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });
  const topButton = document.querySelector(".profile-to-top");
  topButton?.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: motion.matches ? "instant" : "smooth" }),
  );
  let scheduled = false;
  function updateSection() {
    scheduled = false;
    let active = sections[0];
    const headerHeight =
      document.querySelector("body > .header,body > .site-header")?.getBoundingClientRect()
        .height || 0;
    for (const section of sections)
      if (section.getBoundingClientRect().top <= headerHeight + 40) active = section;

    if (
      window.scrollY > 0 &&
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5
    )
      active = sections.at(-1);
    if (requestedSection) active = requestedSection;
    sectionLinks.forEach((link) => {
      if (active && link.hash === "#" + active.id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    if (topButton) topButton.hidden = window.scrollY < 400;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(updateSection);
      }
    },
    { passive: true },
  );
  updateSection();
  if (["#settings", "#subscription", "#security"].includes(location.hash)) {
    requestAnimationFrame(() =>
      document.querySelector(location.hash)?.scrollIntoView({ block: "start" }),
    );
  }
})().catch((error) => {
  document.getElementById("profile-status").textContent = error.message || "Ошибка загрузки.";
});

