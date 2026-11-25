"use strict";

for (const navigation of document.querySelectorAll(".section-nav")) {
  const menus = Array.from(navigation.querySelectorAll(".section-tab > details"));

  function closeOtherMenus(current) {
    for (const menu of menus) {
      if (menu !== current) menu.open = false;
    }
  }

  for (const menu of menus) {
    const tab = menu.closest(".section-tab");
    const arrow = menu.querySelector("summary");

    tab.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      closeOtherMenus(menu);
      menu.open = true;
    });

    tab.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" && !menu.contains(document.activeElement)) {
        menu.open = false;
      }
    });

    menu.addEventListener("toggle", () => {
      if (menu.open) closeOtherMenus(menu);
    });

    tab.addEventListener("focusout", (event) => {
      if (!tab.contains(event.relatedTarget) && !tab.matches(":hover")) {
        menu.open = false;
      }
    });

    tab.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !menu.open) return;
      event.preventDefault();
      menu.open = false;
      arrow.focus();
    });
  }

  document.addEventListener("click", (event) => {
    closeOtherMenus(event.target.closest(".section-tab > details"));
  });
}
