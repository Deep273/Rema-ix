"use strict";

const types = {
  all: "Все типы",
  office: "Офисы",
  retail: "Торговые",
  warehouse: "Склады",
  industrial: "Производственные",
  flexible: "Свободное назначение"
};
const commercialTypes = {
  nonresidential: "Нежилое",
  office: "Офис",
  retail: "Торговля",
  warehouse: "Склад",
  base: "База",
  industrial: "Производство",
  business: "Бизнес",
  garage: "Гараж",
  hall: "Залы"
};

const ru09Conditions = [
  "Черновая отделка", "Требуется ремонт", "В хорошем состоянии", "В отличном состоянии"
];

const ru09Districts = [
  "Кировский", "Советский", "Ленинский", "Октябрьский", "Северск",
  "Томский", "Асиновский", "Область", "Другое"
];

function lookupText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ");
}

function commercialCategory(value) {
  const name = lookupText(value);
  if (/^(торгов|магазин)/.test(name)) return "retail";
  if (/^(офис|рабочее место)/.test(name)) return "office";
  if (/^(склад|ангар)/.test(name)) return "warehouse";
  if (/^производ/.test(name)) return "industrial";
  if (/^баз/.test(name)) return "base";
  if (/^бизнес/.test(name)) return "business";
  if (/^(гараж|паркинг)/.test(name)) return "garage";
  if (/^зал/.test(name)) return "hall";
  if (/нежил|свободн/.test(name) || ["псн", "здание"].includes(name)) return "nonresidential";
  return null;
}

function commercialCondition(value) {
  const name = lookupText(value);
  if (/чернов|без отделки/.test(name)) return ru09Conditions[0];
  if (/требу\S* ремонт/.test(name)) return ru09Conditions[1];
  if (/хорош.*состоян/.test(name)) return ru09Conditions[2];
  if (/отличн.*состоян/.test(name)) return ru09Conditions[3];
  return null;
}

function commercialDistrict({ district, settlement, region }) {
  const area = lookupText(district);
  const town = lookupText(settlement);
  const place = area + " " + town;
  if (/северск/.test(place)) return "Северск";
  const known = ru09Districts.find(name => area.includes(lookupText(name)));
  if (known) return known;
  if (/асино/.test(town)) return "Асиновский";
  if (/томская область/.test(lookupText(region)) && (area || town) && !/(?:^| )томск$/.test(town)) return "Область";
  return area || town ? "Другое" : null;
}

const defaultCommercialTypes = [];
const checkedTypes = new Set(defaultCommercialTypes);
const conditions = [];
let listings = [];
let loadError = "";
const categoryKeys = new Map([
  ["нежилое", "nonresidential"], ["офис", "office"], ["торговое", "retail"], ["склад", "warehouse"],
  ["производство", "industrial"]
]);

for (const [key, label] of Object.entries(commercialTypes)) {
  categoryKeys.set(label.toLowerCase(), key);
}

const pageSize = 18;

const groups = [
  {
    id: "main",
    title: "Основные",
    fields: [
      ["price", "Цена, ₽", 0], ["area", "Площадь, м²", 0], ["unit", "Цена за м², ₽", 0]
    ]
  },
  {
    id: "building",
    title: "Характеристики",
    fields: [
      ["floor", "Этаж", -10], ["floors", "Этажность", null], ["condition", "Отделка", conditions]
    ]
  }
];
const basicFields = groups[0].fields;
const extraFields = groups[1].fields;
const fields = [...basicFields, ...extraFields.filter(([key]) => key !== "floors")];
const dataGroups = [
  ["cost", "Цена и цена за м²", ["price", "unit"]],
  ["area", "Площадь", ["area"]],
  ["address", "Адрес", ["region", "district", "settlement", "street", "house"]],
  ["floor", "Этаж / этажность", ["floorSummary"]],
  ["condition", "Отделка", ["condition"]],
  ["source", "Источник и дата", ["source", "published", "link"]]
];
const selectedFields = new Set(dataGroups.map(([id]) => id));
const selectedListings = new Set();
const sourceOptions = [];
fields.push(["source", "Источник", sourceOptions], ["published", "Дата публикации", "date"]);

const enabledFilters = new Set();
const filterKeys = ([key, , options]) => Array.isArray(options) ? [key] : [key + "From", key + "To"];
const state = {
  page: 1,
  operation: "sale",
  type: "all",
  sort: "new",
  view: "list",
  query: "",
  filters: {},
  location: {}
};
const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const money = (value, operation = state.operation) => integer.format(value) + " ₽" + (operation === "rent" ? "/мес." : "");
const perSquare = (value, operation = state.operation) => integer.format(value) + " ₽/м²" + (operation === "rent" ? "/мес." : "");
const fieldLabel = (key, label) => state.operation === "rent" && ["price", "unit"].includes(key) ? label + "/мес." : label;
const textMatch = (value, query) => value.toLocaleLowerCase("ru").replaceAll("ё", "е")
  .includes(query.trim().toLocaleLowerCase("ru").replaceAll("ё", "е"));

const multiChoice = new Map([
  ["condition", "Любая отделка"]
]);

function updateMultiChoice(form) {
  for (const picker of form.querySelectorAll(".filter-multi")) {
    const count = picker.querySelectorAll("input:checked").length;
    picker.querySelector("summary span").textContent = count > 1 ? "Выбрано: " + count :
      picker.querySelector("input:checked")?.value || multiChoice.get(picker.dataset.filterKey);
  }
}

$("quick").addEventListener("keydown", event => {
  const picker = event.target.closest(".filter-multi[open]");
  if (event.key !== "Escape" || !picker) return;
  event.preventDefault();
  picker.open = false;
  picker.querySelector("summary").focus();
});

document.addEventListener("click", event => {
  for (const other of $("quick").querySelectorAll(".filter-multi[open]")) {
    if (!other.contains(event.target)) other.open = false;
  }
});

function fieldMarkup([key, rawLabel, options]) {
  const label = fieldLabel(key, rawLabel);
  if (multiChoice.has(key)) {
    const placeholder = multiChoice.get(key);
    return '<div class="field"><span>' + escapeHtml(label) + '</span>' +
      '<details class="filter-multi" data-filter-key="' + key + '"><summary>' +
      '<span>' + placeholder + '</span></summary><div class="filter-multi-options">' +
      (options.length ? options.map(option =>
        '<label><input type="checkbox" name="' + key + '" value="' + escapeHtml(option) +
        '"><span>' + escapeHtml(option) + '</span></label>'
      ).join("") : '<span>Нет значений в выдаче</span>') + '</div></details></div>';
  }
  if (Array.isArray(options)) {
    const placeholder = options.length ? "Любой вариант" : "Нет значений в выдаче";
    return '<label class="field" data-field="' + key + '"><span>' + label +
      '</span><select name="' + key + '"><option value="">' + placeholder + '</option>' +
      options.map(option => '<option>' + escapeHtml(option) + '</option>').join("") + '</select></label>';
  }
  if (options === "date") {
    return '<div class="field"><span>Дата публикации</span><div class="range">' +
      '<input type="date" name="publishedFrom" aria-label="Дата публикации от">' +
      '<input type="date" name="publishedTo" aria-label="Дата публикации до"></div></div>';
  }
  const step = ["area", "price", "unit"].includes(key) ? "any" : "1";
  return '<div class="field" data-field="' + key + '"><span data-label="' + key + '">' + label + '</span><div class="range">' +
    [["From", "От"], ["To", "До"]].map(([suffix, placeholder]) =>
      '<span class="number-control"><input type="number" name="' + key + suffix + '" min="' + options + '" step="' + step + '" placeholder="' + placeholder +
      '" aria-label="' + label + ' — ' + placeholder.toLowerCase() + '"><span class="number-arrows">' +
      '<button type="button" data-number-step="1" aria-label="Увеличить: ' + label + ' — ' + placeholder.toLowerCase() + '">▴</button>' +
      '<button type="button" data-number-step="-1" aria-label="Уменьшить: ' + label + ' — ' + placeholder.toLowerCase() + '">▾</button></span></span>').join("") + '</div></div>';
}

function read(form) {
  return Object.fromEntries(Array.from(new FormData(form)).filter(([, value]) => value !== ""));
}
function fill(form, values) {
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.type === "checkbox" && multiChoice.has(input.name)) {
      input.checked = (values[input.name] ?? []).includes(input.value);
    } else {
      input.value = values[input.name] ?? "";
    }
    input.setCustomValidity("");
  }
  updateMultiChoice(form);
}
function validate(form, report = false) {
  for (const input of form.querySelectorAll("input[name$='To']")) {
    const from = form.elements.namedItem(input.name.replace(/To$/, "From"));
    const inverted = from.value !== "" && input.value !== "" && (input.type === "date" ? from.value > input.value : Number(from.value) > Number(input.value));
    input.setCustomValidity(inverted ? "Верхняя граница должна быть не меньше нижней." : "");
  }
  return report ? form.reportValidity() : form.checkValidity();
}
function filtered(filters, type = section === "commercial" ? null : state.type) {
  return listings.filter(item => (state.operation === "all" || item.operation === state.operation) &&
    (type === null ? checkedTypes.size === 0 || checkedTypes.has(item.type) :
      type === "all" || item.type === type) &&
    matchesLocation(item, state.location) &&
    textMatch(item.title + " " + item.address + " " + item.district, state.query) &&
    fields.every(([key, , options]) => {
      if (Array.isArray(options)) {
        const value = key === "condition" && section === "commercial" ? item.conditionGroup : item[key];
        const selected = filters[key];
        return !selected || (Array.isArray(selected) ? selected.includes(value) : value === selected);
      }
      const min = filters[key + "From"];
      const max = filters[key + "To"];
      if (options === "date") return (!min && !max) || Boolean(item.published && (!min || item.published >= min) && (!max || item.published <= max));
      const value = key === "unit" && item.unit != null ? item.unit : item[key];
      if (min === undefined && max === undefined) return true;
      return value != null && (min === undefined || value >= Number(min)) && (max === undefined || value <= Number(max));
    }));
}
function countLabel(n) {
  const last = n % 10;
  const noun = n % 100 >= 11 && n % 100 <= 14 ? "объектов" : last === 1 ? "объект" : last >= 2 && last <= 4 ? "объекта" : "объектов";
  return format.format(n) + " " + noun;
}
function escapeHtml(value) {
  const chars = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return String(value).replace(/[&<>"']/g, char => chars[char]);
}
function screenshotLink(item) {
  try {
    const url = new URL(item.screenshotUrl);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function sourceLink(item) {
  if (!item.link) return "";
  try {
    const url = new URL(item.link);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return '<a class="button outline source-link" href="' + escapeHtml(url.href) +
      '" target="_blank" rel="noopener noreferrer">На объявление ↗</a>';
  } catch {
    return "";
  }
}
const dates = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Tomsk" });
const dateText = value => value && Number.isFinite(Date.parse(value)) ? dates.format(new Date(value)) : null;

const photoRequests = new Map();

function sourcePhotoId(link) {
  try {
    const url = new URL(link);
    const id = url.searchParams.get("id");
    return ["www.tomsk.ru09.ru", "tomsk.ru09.ru"].includes(url.hostname) && /^\/realty\/?$/.test(url.pathname) && /^\d{1,12}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function loadListingPhotos(item) {
  let id = sourcePhotoId(item.link);
  if (!id && item.archivedScreenshotUrl) {
    const archived = new URL(item.archivedScreenshotUrl, location.origin).searchParams.get("id");
    if (/^\d{1,12}$/.test(archived)) id = archived;
  }
  if (!id || photoUrls(item).length >= 10) return Promise.resolve();
  if (!photoRequests.has(id)) {
    const request = fetch("/api/listing-photos?id=" + id + "&limit=10", { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw Error("Фото недоступны");
        return response.json();
      })
      .catch(() => {
        photoRequests.delete(id);
        return [];
      });
    photoRequests.set(id, request);
  }
  return photoRequests.get(id).then(photos => {
    if (photos.length) {
      const unique = new Map();
      for (const url of [...photos, ...photoUrls(item)]) {
        const key = fullSizePhoto(url);
        if (!unique.has(key)) unique.set(key, url);
      }
      item.photos = [...unique.values()].slice(0, 10);
    }
  });
}

const photoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const card = entry.target;
    photoObserver.unobserve(card);
    const item = listings.find(row => row.id === card.dataset.photoListing);
    if (!item) continue;
    loadListingPhotos(item).then(() => {
      const photo = photoUrls(item)[0];
      if (photo && card.isConnected && !card.querySelector(".card-photo")) {
        const placeholder = card.querySelector(".card-photo-placeholder");
        if (placeholder) placeholder.outerHTML = coverMarkup(item, photo);
        else card.querySelector(".card-info").insertAdjacentHTML("afterbegin", coverMarkup(item, photo));
      }
    });
  }
}, { rootMargin: "120px" });

function photoPlaceholder() {
  return '<div class="card-photo-placeholder"><span aria-hidden="true">▧</span>Нет фото</div>';
}

function fullSizePhoto(source) {
  const url = new URL(source);
  if (["www.tomsk.ru09.ru", "tomsk.ru09.ru"].includes(url.hostname) &&
      /^\/img\/tomsk\/realty\/\d+\/\d+\/\d+\/thumb_/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/thumb_/i, "/");
  }
  return url.href;
}

function coverMarkup(item, photo) {
  return '<button class="card-photo" type="button" data-details="' + escapeHtml(item.id) +
    '" aria-label="Открыть фотографии: ' + escapeHtml(item.title) + '">' + photoMarkup(photo, true) + '</button>';
}

function galleryMarkup(photos) {
  const thumbs = photos.map((url, index) =>
    '<button type="button" data-photo-index="' + index + '" data-url="' + escapeHtml(url) +
    '" aria-label="Фото ' + (index + 1) + '" aria-pressed="' + (index === 0) + '">' + photoMarkup(url) + '</button>'
  ).join("");
  return '<section class="detail-photos photo-viewer" aria-label="Фотографии объекта">' +
    '<div class="photo-frame"><div class="photo-pan" tabindex="0" aria-label="Область фотографии">' +
    '<img class="photo-main" alt="" draggable="false" referrerpolicy="no-referrer"></div>' +
    '<button class="photo-prev" type="button" data-photo-action="prev" aria-label="Предыдущее фото">‹</button>' +
    '<button class="photo-next" type="button" data-photo-action="next" aria-label="Следующее фото">›</button>' +
    '<span class="photo-position" aria-live="polite"></span></div>' +
    '<div class="photo-controls" aria-label="Масштаб фотографии">' +
    '<button type="button" data-photo-action="out" aria-label="Уменьшить">−</button>' +
    '<button type="button" data-photo-action="reset" aria-label="Сбросить масштаб">100%</button>' +
    '<button type="button" data-photo-action="in" aria-label="Увеличить">+</button>' +
    '<button type="button" data-photo-action="expand" aria-pressed="false">На весь экран</button></div>' +
    '<div class="photo-thumbs" aria-label="Миниатюры">' + thumbs + '</div></section>';
}

const detailsScrollDialog = $("details-dialog");
const detailsMore = $("details-more");

function updateDetailsScrollHint() {
  const remaining = detailsScrollDialog.scrollHeight - detailsScrollDialog.clientHeight - detailsScrollDialog.scrollTop;
  detailsMore.hidden = !detailsScrollDialog.open || remaining <= 2 ||
    Boolean(detailsScrollDialog.querySelector(".photo-viewer.is-expanded"));
}

detailsScrollDialog.addEventListener("scroll", updateDetailsScrollHint, { passive: true });
detailsScrollDialog.addEventListener("close", updateDetailsScrollHint);
const detailsResize = new ResizeObserver(updateDetailsScrollHint);
detailsResize.observe(detailsScrollDialog);
detailsResize.observe($("details-body"));

detailsMore.addEventListener("click", () => {
  detailsScrollDialog.scrollBy({
    top: Math.max(100, detailsScrollDialog.clientHeight * .72),
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
  });
});

function setupGallery(viewer) {
  if (!viewer) return;
  const image = viewer.querySelector(".photo-main");
  const pan = viewer.querySelector(".photo-pan");
  const thumbs = [...viewer.querySelectorAll("[data-photo-index]")];
  const status = viewer.querySelector(".photo-position");
  let index = 0;
  let zoom = 1;
  let pendingOriginal = null;

  function setZoom(value, x = pan.clientWidth / 2, y = pan.clientHeight / 2) {
    zoom = Math.min(3, Math.max(1, value));
    pan.classList.toggle("is-zoomed", zoom > 1);
    const centerX = (pan.scrollLeft + x) / Math.max(pan.scrollWidth, 1);
    const centerY = (pan.scrollTop + y) / Math.max(pan.scrollHeight, 1);
    image.style.width = (zoom * 100) + "%";
    image.style.height = (zoom * 100) + "%";
    pan.scrollLeft = centerX * pan.scrollWidth - x;
    pan.scrollTop = centerY * pan.scrollHeight - y;
    viewer.querySelector('[data-photo-action="reset"]').textContent = Math.round(zoom * 100) + "%";
    viewer.querySelector('[data-photo-action="out"]').disabled = zoom <= 1;
    viewer.querySelector('[data-photo-action="in"]').disabled = zoom >= 3;
  }

  const expandButton = viewer.querySelector('[data-photo-action="expand"]');
  function setExpanded(expanded) {
    viewer.classList.toggle("is-expanded", expanded);
    updateDetailsScrollHint();
    expandButton.setAttribute("aria-pressed", expanded);
    expandButton.textContent = expanded ? "Свернуть" : "На весь экран";
    setZoom(1);
    expandButton.focus({ preventScroll: true });
  }

  pan.addEventListener("wheel", event => {
    if (!event.deltaY || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const rect = pan.getBoundingClientRect();
    const step = Math.max(.05, Math.min(.25, Math.abs(event.deltaY) / 400));
    setZoom(zoom - Math.sign(event.deltaY) * step, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  function show(next) {
    const available = thumbs.filter(button => !button.hidden);
    if (!available.length) {
      viewer.remove();
      return;
    }
    index = (next + available.length) % available.length;
    const selected = available[index];
    const label = "Фото " + (index + 1) + " из " + available.length;
    image.alt = label;
    status.textContent = label;
    for (const thumb of available) thumb.setAttribute("aria-pressed", thumb === selected);
    selected.scrollIntoView({ block: "nearest", inline: "nearest" });
    for (const arrow of viewer.querySelectorAll(".photo-prev, .photo-next")) arrow.hidden = available.length < 2;
    setZoom(1);
    const preview = selected.dataset.url;
    const original = fullSizePhoto(preview);
    pendingOriginal = null;

    if (original === preview) {
      image.src = preview;
      return;
    }

    const sharpImage = new Image();
    pendingOriginal = sharpImage;
    sharpImage.referrerPolicy = image.referrerPolicy;
    sharpImage.onload = () => {
      if (pendingOriginal !== sharpImage) return;
      pendingOriginal = null;
      image.src = original;
    };
    sharpImage.onerror = () => {
      if (pendingOriginal !== sharpImage) return;
      pendingOriginal = null;
      if (image.complete && !image.naturalWidth) hideFailedPhoto();
    };
    image.src = preview;
    sharpImage.src = original;
  }

  viewer.addEventListener("click", event => {
    const control = event.target.closest("button");
    if (!control) return;
    const available = thumbs.filter(button => !button.hidden);
    if (control.hasAttribute("data-photo-index")) return show(available.indexOf(control));
    const action = control.dataset.photoAction;
    if (action === "prev" || action === "next") show(index + (action === "next" ? 1 : -1));
    if (action === "in") setZoom(zoom + .25);
    if (action === "out") setZoom(zoom - .25);
    if (action === "reset") setZoom(1);
    if (action === "expand") setExpanded(!viewer.classList.contains("is-expanded"));
  });

  viewer.addEventListener("keydown", event => {
    if (event.key === "Escape" && viewer.classList.contains("is-expanded")) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      return;
    }
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || (event.target === pan && zoom > 1)) return;
    event.preventDefault();
    show(index + (event.key === "ArrowRight" ? 1 : -1));
  });

  let drag = null;
  pan.addEventListener("pointerdown", event => {
    if (zoom <= 1 || event.pointerType !== "mouse" || event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: pan.scrollLeft, top: pan.scrollTop };
    pan.setPointerCapture(event.pointerId);
    pan.classList.add("is-dragging");
  });
  pan.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    pan.scrollLeft = drag.left - (event.clientX - drag.x);
    pan.scrollTop = drag.top - (event.clientY - drag.y);
  });
  pan.addEventListener("lostpointercapture", () => {
    drag = null;
    pan.classList.remove("is-dragging");
  });

  function hideFailedPhoto() {
    const failed = thumbs.filter(button => !button.hidden)[index];
    if (failed) failed.hidden = true;
    show(0);
  }

  image.addEventListener("error", () => {
    if (!pendingOriginal) hideFailedPhoto();
  });

  show(0);
}

function photoUrls(item) {
  const savedPhotos = Array.isArray(item.photos) ? item.photos : [];
  const urls = savedPhotos.flatMap(photo => {
    try {
      const url = new URL(typeof photo === "string" ? photo : photo?.url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? [url.href] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)].slice(0, 10);
}

function photoMarkup(url, sharp = false) {
  const src = sharp ? fullSizePhoto(url) : url;
  const fallback = src === url ? "" : ' data-fallback="' + escapeHtml(url) + '"';
  return '<img class="object-photo" src="' + escapeHtml(src) + '"' + fallback + ' alt="Фото объекта" loading="lazy" referrerpolicy="no-referrer">';
}

function listingText(value) {
  return String(value ?? "")
    .replace(/\p{Extended_Pictographic}(?:[\uFE0E\uFE0F\u200D]|\p{Emoji_Modifier})*|[\uFE0E\uFE0F\u200D]|[0-9#*]\uFE0F?\u20E3/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function floorSummary(item) {
  const display = value => value == null || String(value).trim() === "" ? "—" : String(value).trim();
  return display(item.floor) + " / " + display(item.floors);
}

function cardCharacteristics(item) {
  const details = extraFields.filter(([key]) => key !== "floor" && key !== "floors" &&
    item[key] != null && item[key] !== "");
  if (!details.length) return "";
  return '<dl class="selection-facts">' + details.map(([key, label]) =>
    '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(item[key]) + '</dd></div>'
  ).join("") + '</dl>';
}

function card(item) {
  const published = dateText(item.published);
  const id = escapeHtml(item.id);
  const title = escapeHtml(item.title);
  const photo = photoUrls(item)[0];
  return `
    <article class="card photo-emphasis" data-photo-listing="${id}">
      <label class="pick-card"><input type="checkbox" data-pick="${id}" ${selectedListings.has(item.id) ? "checked" : ""} aria-label="Выбрать: ${title}"></label>
      <div class="card-info">
        ${photo ? coverMarkup(item, photo) : photoPlaceholder()}
        <div class="card-copy">
          <div class="price">
            ${item.price == null ? "<strong>Цена не указана</strong>" : `<strong>${money(item.price, item.operation)}</strong>`}
            ${item.unit == null ? "" : `<p class="secondary">${perSquare(item.unit, item.operation)}</p>`}
          </div>
          <div class="card-labels">
            <span class="tag">${item.operation === "sale" ? "Продажа" : "Аренда"}</span>
            ${item.objectType ? `<span class="secondary">${escapeHtml(item.objectType)}</span>` : ""}
          </div>
          <h3><button class="card-title" type="button" data-details="${id}">${title}</button></h3>
          ${item.address ? `<p class="meta card-address">${escapeHtml(item.address)}</p>` : ""}
          <p class="facts">${item.area == null ? "" : `<strong class="card-area">${format.format(item.area)} м²</strong><span aria-hidden="true"> · </span>`}<span>Этаж / этажность ${escapeHtml(floorSummary(item))}</span></p>
          ${item.condition ? `<p class="card-condition">Отделка · ${escapeHtml(item.condition)}</p>` : ""}
          <div class="card-footer">
            <p class="meta card-date">${[item.source, published].filter(Boolean).map(escapeHtml).join(" · ")}</p>
            <div class="card-primary-actions"><button type="button" class="button outline card-details" data-details="${id}" aria-label="Подробнее: ${title}">Подробнее</button>${sourceLink(item)}</div>
          </div>
          <div class="card-source-links">${screenshotLink(item) ? `<a href="${escapeHtml(screenshotLink(item))}" target="_blank" rel="noopener noreferrer">Скриншот источника</a>` : ""}</div>
        </div>
      </div>
    </article>
  `;
}
function syncResultSelection(items = currentResults()) {
  const all = $("select-results");
  const found = new Set(items.map(item => item.id));
  for (const id of selectedListings) if (!found.has(id)) selectedListings.delete(id);
  all.disabled = !items.length;
  all.checked = items.length > 0 && selectedListings.size === items.length;
  all.indeterminate = selectedListings.size > 0 && !all.checked;
}

$("select-results").addEventListener("change", event => {
  selectedListings.clear();
  if (event.target.checked) for (const item of currentResults()) selectedListings.add(item.id);
  render(false);
});

$("cards").addEventListener("change", event => {
  const { pick } = event.target.dataset;
  if (pick === undefined) return;
  if (event.target.checked) selectedListings.add(pick);
  else selectedListings.delete(pick);
  syncResultSelection();
});

function currentResults() {
  const order = {
    new: (a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0),
    unitLow: (a, b) => (a.unit ?? Infinity) - (b.unit ?? Infinity),
    unitHigh: (a, b) => (b.unit ?? -Infinity) - (a.unit ?? -Infinity),
    low: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    high: (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    area: (a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity)
  };
  return filtered(state.filters).sort(order[state.sort]);
}
function render(resetPage = true) {
  const items = currentResults();
  const detailsDialog = $("details-dialog");
  if (detailsDialog.open && !items.some(item => item.id === detailsDialog.dataset.listingId)) detailsDialog.close();

  syncResultSelection(items);
  const unitPrices = items.map(item => item.unit).filter(Number.isFinite).sort((a, b) => a - b);
  const count = unitPrices.length;
  const median = count
    ? (unitPrices[Math.floor((count - 1) / 2)] + unitPrices[Math.floor(count / 2)]) / 2
    : null;
  $("unit-stats").hidden = Boolean(loadError);
  for (const [id, value] of [
    ["unit-min", unitPrices[0]],
    ["unit-avg", count ? unitPrices.reduce((sum, price) => sum + price, 0) / count : null],
    ["unit-median", median],
    ["unit-max", unitPrices.at(-1)]
  ]) {
    $(id).textContent = count ? perSquare(value) : "—";
  }
  const pages = Math.ceil(items.length / pageSize);
  state.page = resetPage ? 1 : Math.min(state.page, Math.max(1, pages));
  const offset = (state.page - 1) * pageSize;
  const visibleItems = items.slice(offset, offset + pageSize);
  renderPages(pages);
  $("count").textContent = loadError || "Найдено " + countLabel(items.length);
  const exportButton = $("export-excel");
  exportButton.disabled = Boolean(loadError) || exportButton.getAttribute("aria-busy") === "true";
  $("cards").classList.toggle("grid", state.view === "grid" && items.length > 0);
  photoObserver.disconnect();
  $("cards").innerHTML = loadError ? "" : items.length ? visibleItems.map(card).join("") :
    '<div class="empty"><strong>Объекты не найдены</strong><p>Измените параметры поиска или сбросьте фильтры.</p><button type="button" class="button outline" data-clear>Сбросить фильтры</button></div>';
  for (const card of $("cards").querySelectorAll("[data-photo-listing]:not(:has(.card-photo))")) {
    photoObserver.observe(card);
  }
  for (const button of $("categories").children) {
    const key = button.dataset.type;
    const checkbox = button.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = checkedTypes.has(key);
    else button.setAttribute("aria-pressed", key === state.type);
    button.querySelector("b").textContent = loadError ? "—" : format.format(filtered(state.filters, key).length);
  }
  $("active-filters").replaceChildren();
  const selectedLocation = locationSummary(state.location);
  $("location-summary").textContent = selectedLocation ? "Выбрано: " + selectedLocation : "";
  for (const [key, label, options] of fields) {
    const keys = filterKeys([key, label, options]);
    const values = keys.filter(name => name in state.filters).map(name => {
      if (name === key) return Array.isArray(state.filters[name]) ? state.filters[name].join(", ") : state.filters[name];
      return (name.endsWith("From") ? "от " : "до ") + (options === "date" ? state.filters[name] : format.format(Number(state.filters[name])));
    });
    if (!values.length) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = fieldLabel(key, label) + ": " + values.join(" ") + " ×";
    chip.addEventListener("click", () => {
      for (const name of keys) delete state.filters[name];
      fill($("quick"), state.filters);
      render();
      $("reset").focus();
    });
    $("active-filters").append(chip);
  }
}
function renderPages(total) {
  const nav = $("catalog-pages");
  nav.hidden = Boolean(loadError) || total <= 1;
  nav.replaceChildren();
  if (nav.hidden) return;

  const addButton = (label, page, disabled = false, current = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button outline";
    button.textContent = label;
    button.dataset.page = page;
    button.disabled = disabled;
    if (current) button.setAttribute("aria-current", "page");
    nav.append(button);
  };
  addButton("‹", state.page - 1, state.page === 1);
  nav.lastChild.setAttribute("aria-label", "Предыдущая страница");
  const start = Math.min(Math.max(1, state.page - 2), Math.max(1, total - 5));
  const end = Math.min(total, start + 5);
  if (start > 1) addButton("1", 1);
  if (start > 2) nav.append("…");
  for (let page = start; page <= end; page++) addButton(String(page), page, false, page === state.page);
  if (end < total - 1) nav.append("…");
  if (end < total) addButton(String(total), total);
  addButton("›", state.page + 1, state.page === total);
  nav.lastChild.setAttribute("aria-label", "Следующая страница");
}

$("catalog-pages").addEventListener("click", event => {
  const button = event.target.closest("button[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  render(false);
  $("catalog-pages").querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  $("count").scrollIntoView({ block: "start" });
});

function reset() {
  state.filters = {};
  state.location = {};
  $("location-filter").reset();
  updateLocationFields();
  state.type = "all";
  checkedTypes.clear();
  for (const key of defaultCommercialTypes) checkedTypes.add(key);
  state.query = "";
  $("search").value = "";
  enabledFilters.clear();
  selectedListings.clear();
  renderQuickFields();
  render();
}


const optionalFilters = fields.filter(field => !basicFields.includes(field)).map(([key, label]) => [key, label]);

function renderQuickFields() {
  const visible = fields.filter(field => basicFields.includes(field) || enabledFilters.has(field[0]));
  $("quick").innerHTML = visible.map(fieldMarkup).join("");
  fill($("quick"), state.filters);
}

function setEnabledFilters(ids) {
  enabledFilters.clear();
  for (const id of ids) enabledFilters.add(id);
  for (const field of fields) {
    if (!basicFields.includes(field) && !enabledFilters.has(field[0])) {
      for (const key of filterKeys(field)) delete state.filters[key];
    }
  }
  renderQuickFields();
  render();
}

function renderExportSelection() {
  for (const checkbox of $("data-fields").querySelectorAll("input")) checkbox.checked = selectedFields.has(checkbox.value);
  const all = $("all-data-fields");
  all.checked = selectedFields.size === dataGroups.length;
  all.indeterminate = selectedFields.size > 0 && !all.checked;
}

function setDataFields(ids) {
  selectedFields.clear();
  for (const id of ids) selectedFields.add(id);
  renderExportSelection();
}

function dataCheckboxes(name, groups) {
  return groups.map(([id, label]) =>
    '<label class="filter-choice" data-choice><input type="checkbox" name="' + name +
    '" value="' + id + '"><span>' + label + '</span></label>'
  ).join("");
}

$("data-fields").innerHTML = dataCheckboxes("data", dataGroups);
renderExportSelection();
$("data-fields").addEventListener("change", () => {
  setDataFields([...$("data-fields").querySelectorAll("input:checked")].map(input => input.value));
});
$("all-data-fields").addEventListener("change", event => {
  setDataFields(event.target.checked ? dataGroups.map(([id]) => id) : []);
});
renderQuickFields();

$("operations").addEventListener("click", event => {
  const button = event.target.closest("[data-operation]");
  if (!button || state.operation === button.dataset.operation) return;
  state.operation = button.dataset.operation;
  for (const sibling of $("operations").children) sibling.setAttribute("aria-pressed", sibling === button);
  for (const key of ["price", "unit"]) {
    for (const suffix of ["From", "To"]) delete state.filters[key + suffix];
  }
  renderQuickFields();
  render();
});
$("categories").addEventListener("click", event => {
  const button = event.target.closest("[data-type]");
  if (!button || section === "commercial") return;
  state.type = button.dataset.type;
  render();
});
$("categories").addEventListener("change", event => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox || checkbox.disabled) return;
  if (checkbox.checked) checkedTypes.add(checkbox.value);
  else checkedTypes.delete(checkbox.value);
  render();
});

function applySearch() {
  state.query = $("search").value;
  render();
}

$("search").addEventListener("input", applySearch);
$("catalog-search-form").addEventListener("submit", event => {
  event.preventDefault();
  applySearch();
});
$("sort").addEventListener("change", event => {
  state.sort = event.target.value;
  render();
});
$("views").addEventListener("click", event => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  for (const sibling of $("views").children) sibling.setAttribute("aria-pressed", sibling === button);
  render(false);
});
$("reset").addEventListener("click", reset);
$("quick").addEventListener("change", applyQuick);
$("quick").addEventListener("submit", event => {
  event.preventDefault();
  applyQuick();
});
function applyQuick() {
  const form = $("quick");
  if (!validate(form, true)) return;
  for (const control of form.elements) if (control.name) delete state.filters[control.name];
  const filters = read(form);
  const data = new FormData(form);
  for (const key of multiChoice.keys()) {
    const values = data.getAll(key);
    delete filters[key];
    if (values.length) filters[key] = values;
  }
  Object.assign(state.filters, filters);
  updateMultiChoice(form);
  render();
}

const filterDialog = $("filters-dialog");
const advanced = $("advanced");
$("advanced-fields").innerHTML = dataCheckboxes("enabled", optionalFilters);
const choices = [...advanced.querySelectorAll('[name="enabled"]')];
function findFilters() {
  for (const choice of choices) choice.closest("[data-choice]").hidden = !textMatch(choice.labels[0].textContent, $("filter-search").value);
  $("no-filter").hidden = choices.some(choice => !choice.closest("[data-choice]").hidden);
}
document.querySelector("[data-open-filters]").addEventListener("click", () => {
  for (const choice of choices) choice.checked = enabledFilters.has(choice.value);
  $("filter-search").value = "";
  findFilters();
  filterDialog.showModal();
  $("filter-search").focus();
});
$("filter-search").addEventListener("input", findFilters);
$("filter-search").addEventListener("keydown", event => {
  if (event.key === "Enter") event.preventDefault();
});
$("select-all-fields").addEventListener("click", () => {
  for (const choice of choices) choice.checked = true;
});
$("reset-draft").addEventListener("click", () => {
  for (const choice of choices) choice.checked = false;
});
advanced.addEventListener("submit", event => {
  event.preventDefault();
  setEnabledFilters(choices.filter(choice => choice.checked).map(choice => choice.value));
  filterDialog.close();
});
$("toggle-sidebar").addEventListener("click", event => {
  const button = event.currentTarget;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", open);
  $("catalog-sidebar").classList.toggle("mobile-open", open);
  if (open) $("catalog-sidebar").scrollIntoView({ block: "nearest" });
});

function exportFilterRows() {
  const result = [
    ["Параметр", "Значение"],
    ["Сделка", { sale: "Продажа", rent: "Аренда", all: "Все сделки" }[state.operation]],
    ["Категория", section === "commercial"
      ? [...checkedTypes].map(key => commercialTypes[key]).join(", ") || "Все типы"
      : types[state.type]],
    ["Сортировка", $("sort").selectedOptions[0].textContent]
  ];
  if (state.query.trim()) result.push(["Поиск", state.query.trim()]);
  const place = locationSummary(state.location);
  if (place) result.push(["Местоположение", place]);

  for (const field of fields) {
    const [key, label, options] = field;
    const values = filterKeys(field).filter(name => name in state.filters).map(name => {
      const value = state.filters[name];
      if (Array.isArray(options)) return Array.isArray(value) ? value.join(", ") : value;
      if (options === "date") return (name.endsWith("From") ? "от " : "до ") + value;
      return (name.endsWith("From") ? "от " : "до ") + format.format(Number(value));
    });
    if (values.length) {
      result.push([fieldLabel(key, label), values.length ? values.join(" ") : "Любое значение"]);
    }
  }
  return result;
}

let exportUrl;
$("export-excel").addEventListener("click", async event => {
  if (!validate($("quick"), true)) return;
  const button = event.currentTarget;
  const status = $("export-status");
  const labels = {
    price: fieldLabel("price", "Цена, ₽"), unit: fieldLabel("unit", "Цена за м², ₽"), area: "Площадь, м²",
    region: "Регион", district: "Район / округ", settlement: "Населённый пункт", street: "Улица", house: "Дом",
    floorSummary: "Этаж / этажность",
    condition: "Отделка", source: "Источник", published: "Дата публикации", link: "Ссылка на объявление"
  };
  const columns = dataGroups.filter(([id]) => selectedFields.has(id)).flatMap(([, , keys]) => keys);
  const found = currentResults();
  const picked = found.filter(item => selectedListings.has(item.id));
  const rows = [
    ["Название", "Сделка", ...columns.map(key => labels[key])],
    ...(picked.length ? picked : found).map(item => [
      item.title, item.operation === "sale" ? "Продажа" : "Аренда", ...columns.map(key => key === "floorSummary" ? floorSummary(item) : item[key])
    ])
  ];
  status.textContent = "";
  button.textContent = "Готовим Excel…";
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    const workbook = await createCatalogWorkbook(rows, exportFilterRows());
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(workbook);
    const link = document.createElement("a");
    link.href = exportUrl;
    link.download = "LandScope — объявления.xlsx";
    link.click();
  } catch {
    status.textContent = "Не удалось сформировать Excel. Попробуйте ещё раз.";
  } finally {
    button.textContent = "Выгрузить Excel";
    button.removeAttribute("aria-busy");
    button.disabled = Boolean(loadError);
  }
});

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog && dialog.matches(":modal")) dialog.close();
  });
}

function prepareListingPhotos(event) {
  const button = event.target.closest("[data-details]");
  if (!button || button.contains(event.relatedTarget)) return;
  const item = listings.find(listing => listing.id === button.dataset.details);
  if (item) void loadListingPhotos(item);
}

$("cards").addEventListener("pointerover", prepareListingPhotos);
$("cards").addEventListener("focusin", prepareListingPhotos);
$("cards").addEventListener("click", event => {
  if (event.target.closest("[data-clear]")) {
    reset();
    $("search").focus();
    return;
  }
  const button = event.target.closest("[data-details]");
  if (!button) return;
  const item = listings.find(listing => listing.id === button.dataset.details);
  if (!item) return;
  const photos = photoUrls(item);
  const photoRequest = photos.length >= 10 ? null : loadListingPhotos(item);
  $("details-title").textContent = listingText(item.title);
  const details = [
    ["Сделка", item.operation === "sale" ? "Продажа" : "Аренда"],
    ["Адрес", item.address], ["Регион", item.region], ["Район / округ", item.district], ["Тип", item.objectType],

    ["Этаж / этажность", floorSummary(item)], ["Отделка", item.condition],
    ["Опубликовано", dateText(item.published)], ["Источник", item.source]
  ];
  const history = (item.history ?? []).filter(entry => dateText(entry.date) && (entry.price != null || entry.unit != null));
  const characteristics = details
    .filter(([, value]) => value != null && value !== "")
    .map(([name, value]) => `
      <div class="detail-fact ${name === "Цена" ? "detail-price" : name === "Цена за м²" ? "detail-unit" : name === "Площадь" ? "detail-area" : ""}">
        <dt>${name}</dt>
        <dd>${escapeHtml(listingText(value))}</dd>
      </div>
    `).join("");
  const priceHistory = history.map(entry => `
    <li>
      <span>${dateText(entry.date)}</span>
      <strong>${entry.price != null ? money(entry.price, item.operation) : perSquare(entry.unit, item.operation)}</strong>
    </li>
  `).join("");
  const link = sourceLink(item);

  const snapshots = [item.archivedScreenshotUrl, screenshotLink(item)].filter(Boolean);
  const description = listingText(item.description);
  $("details-body").innerHTML = `
    ${photos.length ? galleryMarkup(photos) : ""}
    <section class="detail-overview" aria-label="Основные характеристики">
      <div class="detail-cost">
        <p class="detail-cost-value">${item.price == null ? "Цена не указана" : money(item.price, item.operation)}</p>
        ${item.unit == null ? "" : `<p class="detail-cost-unit">${perSquare(item.unit, item.operation)}</p>`}
      </div>
      <div class="detail-size"><span>Площадь</span><strong>${item.area == null ? "—" : format.format(item.area) + " м²"}</strong></div>
    </section>
    <dl class="detail-facts">${characteristics}</dl>
    ${description ? `
      <section class="detail-description" aria-labelledby="detail-description-title">
        <h3 id="detail-description-title">Описание объекта</h3>
        <p>${escapeHtml(description)}</p>
      </section>
    ` : ""}
    ${snapshots.length ? `
      <section class="source-snapshot" hidden>
        <h3>Скриншот исходного объявления</h3>
        <img alt="Скриншот объявления" referrerpolicy="no-referrer">
        <a class="button outline" target="_blank" rel="noopener noreferrer">Открыть скриншот</a>
      </section>
    ` : ""}
    ${priceHistory ? `
      <section class="detail-history">
        <h3>История цены</h3>
        <ul>${priceHistory}</ul>
      </section>
    ` : ""}
    ${link ? `<div class="card-actions">${link}</div>` : ""}
  `;
  const dialog = $("details-dialog");
  const detailsBody = $("details-body");
  const currentFacts = detailsBody.querySelector(".detail-facts");
  dialog.dataset.listingId = item.id;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  updateDetailsScrollHint();
  const snapshot = detailsBody.querySelector(".source-snapshot");
  if (snapshot) {
    const image = snapshot.querySelector("img");
    const loadNext = () => {
      if (snapshots.length && snapshot.isConnected) image.setAttribute("src", snapshots.shift());
    };
    image.addEventListener("load", () => {
      snapshot.querySelector("a").href = image.src;
      snapshot.hidden = false;
      updateDetailsScrollHint();
    }, { once: true });
    image.addEventListener("error", loadNext);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (dialog.open && snapshot.isConnected) loadNext();
    }));
  }
  setupGallery(detailsBody.querySelector(".photo-viewer"));
  if (photoRequest) {
    photoRequest.then(() => {
      const available = photoUrls(item);
      if (available.length > photos.length && dialog.open && currentFacts.isConnected) {
        const previousViewer = detailsBody.querySelector(".photo-viewer");
        const wasExpanded = previousViewer?.classList.contains("is-expanded");
        previousViewer?.remove();
        currentFacts.insertAdjacentHTML("beforebegin", galleryMarkup(available));
        setupGallery(detailsBody.querySelector(".photo-viewer"));
        if (wasExpanded) detailsBody.querySelector('[data-photo-action="expand"]').click();
      }
    });
  }
});
document.addEventListener("error", event => {
  if (!event.target.matches?.(".object-photo") || event.target.closest(".photo-viewer")) return;
  if (event.target.dataset.fallback) {
    const fallback = event.target.dataset.fallback;
    delete event.target.dataset.fallback;
    event.target.src = fallback;
    return;
  }
  const container = event.target.closest(".card-photo, .detail-photos");
  event.target.remove();
  if (!container || container.querySelector(".object-photo")) return;
  if (container.matches(".card-photo") && container.closest(".cards.grid")) {
    container.outerHTML = photoPlaceholder();
  } else {
    container.remove();
  }
}, true);

const locationForm = $("location-filter");
const locationFields = locationForm.elements;

function uniqueOptions(items) {
  return [...new Set(items.filter(value => typeof value === "string" && value.trim()))]
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}

const addressKeys = ["settlement", "district", "street", "house"];

function addressText(value, key) {
  const text = lookupText(value);
  switch (key) {
    case "district": return text.replace(/\s+(?:район|округ)$/, "");
    case "settlement": return text.replace(/^(?:г\.|город|пос\.|поселок|с\.|село|пгт\.?)\s*/, "");
    case "street": return text.replace(/^(?:ул\.|улица|проспект|пр-т|пер\.|переулок)\s*/, "")
      .replace(/\s+(?:ул\.|улица|проспект|пр-т|пер\.|переулок)$/, "");
    case "house": return text.replace(/^(?:д\.|дом)\s*/, "").replace(/\s+/g, "").replace(/[abcehkmoptxy]/g, letter => "авсенкмортху"["abcehkmoptxy".indexOf(letter)]);
    default: return text;
  }
}

function addressValues(item, key) {
  const values = key === "district" ? [item.district, item.districtGroup] : [item[key]];
  return values.map(value => addressText(value, key)).filter(Boolean);
}

function matchesAddress(item, key, value, exact = false) {
  const wanted = addressText(value, key);
  return !wanted || addressValues(item, key).some(candidate => exact ? candidate === wanted : candidate.includes(wanted));
}

function updateStreetAvailability() {
  const streetMode = locationFields.mode.value === "street";
  const settlement = locationFields.settlement.value.trim();
  const selected = settlement && listings.some(item =>
    matchesAddress(item, "settlement", settlement, true));
  if (streetMode) locationFields.street.disabled = !selected;
  locationFields.street.placeholder = streetMode
    ? (selected ? "Введите улицу" : "Сначала выберите населённый пункт")
    : "Например: Ачинская, 15";
  const toggle = locationFields.street.parentElement.querySelector(".location-list-toggle");
  if (toggle) toggle.disabled = locationFields.street.disabled;
}

function updateLocationFields() {
  const mode = locationFields.mode.value;
  for (const button of locationForm.querySelectorAll("[data-location-choice]")) {
    button.setAttribute("aria-pressed", button.dataset.locationChoice === mode);
  }
  for (const container of locationForm.querySelectorAll("[data-location-mode]")) {
    const enabled = container.dataset.locationMode.split(" ").includes(mode);
    container.hidden = !enabled;
    const input = container.querySelector("input");
    if (input) input.disabled = !enabled;
  }
  if (mode === "radius") updateRadiusMap(readLocation());
  locationFields.street.required = mode !== "area";
  updateStreetAvailability();
  closeLocationSuggestions();
}

function splitStreet(value = "") {
  const [street, ...parts] = value.split(",");
  return { street: street.trim(), house: parts.join(",").trim() };
}

function readLocation() {
  const values = Object.fromEntries(Object.entries(read(locationForm)).map(([key, value]) => [key, value.trim()]));
  if (values.street) Object.assign(values, splitStreet(values.street));
  return values;
}

let openLocationInput = null;

function closeLocationSuggestions() {
  if (!openLocationInput) return;
  $(openLocationInput.getAttribute("aria-controls")).hidden = true;
  openLocationInput.setAttribute("aria-expanded", "false");
  openLocationInput.removeAttribute("aria-activedescendant");
  openLocationInput = null;
}

function showLocationSuggestions(input, query = input.value) {
  closeLocationSuggestions();
  if (input.disabled) return;
  const { name } = input;
  const candidates = name === "settlement" ? listings : listings.filter(item =>
    matchesAddress(item, "settlement", locationFields.settlement.value, true));
  const values = uniqueOptions(candidates.flatMap(item => {
    if (name === "district") return section === "commercial" ? [item.districtGroup, item.district] : [item.district];
    if (name === "street" && locationFields.mode.value === "radius" && item.street && item.house) return [item.street, item.street + ", " + item.house];
    return [item[name]];
  }));
  const wanted = name === "street" ? splitStreet(query) : null;
  const matches = values.filter(value => {
    if (!wanted) return addressText(value, name).includes(addressText(query, name));
    const address = splitStreet(value);
    return addressText(address.street, name).includes(addressText(wanted.street, name)) &&
      addressText(address.house, "house").includes(addressText(wanted.house, "house"));
  });
  if (!matches.length) return;
  const list = $(input.getAttribute("aria-controls"));
  list.replaceChildren(...matches.map((value, index) => {
    const option = document.createElement("div");
    option.id = list.id + "-" + index;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = value;
    return option;
  }));
  list.hidden = false;
  list.scrollTop = 0;
  input.setAttribute("aria-expanded", "true");
  openLocationInput = input;
}

function chooseLocationSuggestion(input, option) {
  if (input.value !== option.textContent) {
    input.value = option.textContent;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  closeLocationSuggestions();
}

for (const input of locationForm.querySelectorAll('[role="combobox"]')) {
  const list = $(input.getAttribute("aria-controls"));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "location-list-toggle";
  toggle.textContent = "▾";
  toggle.setAttribute("aria-label", "Открыть список: " + input.closest(".field").querySelector("label").textContent);
  toggle.setAttribute("aria-controls", list.id);
  toggle.addEventListener("mousedown", event => event.preventDefault());
  toggle.addEventListener("click", () => {
    const wasOpen = !list.hidden;
    input.focus();
    if (wasOpen) closeLocationSuggestions();
    else showLocationSuggestions(input);
  });
  input.insertAdjacentElement("afterend", toggle);
  input.addEventListener("focus", () => showLocationSuggestions(input));
  input.addEventListener("click", () => {
    if (list.hidden) showLocationSuggestions(input);
  });
  input.addEventListener("blur", closeLocationSuggestions);
  list.addEventListener("mousedown", event => event.preventDefault());
  list.addEventListener("click", event => {
    const option = event.target.closest('[role="option"]');
    if (option) chooseLocationSuggestion(input, option);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      closeLocationSuggestions();
    }
    const selected = list.hidden ? null : list.querySelector('[aria-selected="true"]');
    if (event.key === "Enter" && !list.hidden) {
      const suggestion = selected || list.firstElementChild;
      if (suggestion) {
        event.preventDefault();
        chooseLocationSuggestion(input, suggestion);
      }
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (list.hidden) showLocationSuggestions(input);
    if (list.hidden) return;
    const next = event.key === "ArrowDown"
      ? selected?.nextElementSibling || list.firstElementChild
      : selected?.previousElementSibling || list.lastElementChild;
    selected?.setAttribute("aria-selected", "false");
    next.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", next.id);
    next.scrollIntoView({ block: "nearest" });
  });
}

function resolveRadiusCenter(values) {
  if (values.coordinates) {
    const coordinates = values.coordinates.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!coordinates) return null;
    const point = coordinates.slice(1).map(Number);
    return Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180 ? point : null;
  }
  const candidates = listings.filter(item => item.point?.length === 2 && item.point.every(Number.isFinite) &&
    addressKeys.every(key => matchesAddress(item, key, values[key], true)));
  const point = candidates[0]?.point;
  if (!point || candidates.some(item => distanceMeters(point, item.point) > 50)) return null;
  return point;
}

function updateRadiusMap(values, point) {
  const link = $("location-map");
  const address = addressKeys.map(key => values[key]).filter(Boolean).join(", ");
  link.hidden = !address;
  if (!address) return;
  const [lat, lon] = point ?? [];
  link.href = point
    ? "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon + "#map=18/" + lat + "/" + lon
    : "https://www.openstreetmap.org/search?query=" + encodeURIComponent(address);
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const deltaLat = (b[0] - a[0]) * rad;
  const deltaLon = (b[1] - a[1]) * rad;
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(deltaLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function matchesLocation(item, location) {
  if (location.mode === "radius") return item.point != null && distanceMeters(location.center, item.point) <= location.radius;
  return addressKeys.every(key => matchesAddress(item, key, location[key], key === "house" || key === "settlement" || (location.mode === "street" && key === "street")));
}
function locationSummary(location) {
  if (location.mode === "radius") return location.address + " · " + format.format(location.radius) + " м";
  return addressKeys.map(key => location[key]).filter(Boolean).join(" · ");
}
function populateLocationOptions() {
  updateLocationFields();
}
locationForm.addEventListener("click", event => {
  const button = event.target.closest("[data-location-choice]");
  if (!button) return;
  locationFields.mode.value = button.dataset.locationChoice;
  $("location-error").textContent = "";
  updateLocationFields();
});
locationForm.addEventListener("input", event => {
  $("location-error").textContent = "";
  if (event.target.name === "settlement") {
    locationFields.district.value = "";
    locationFields.street.value = "";
    locationFields.coordinates.value = "";
    updateStreetAvailability();
  } else if (event.target.name === "street") {
    locationFields.coordinates.value = "";
  }
  if (event.target.matches('[role="combobox"]')) showLocationSuggestions(event.target);
  if (locationFields.mode.value === "radius") updateRadiusMap(readLocation());
});
locationForm.addEventListener("submit", event => {
  event.preventDefault();
  closeLocationSuggestions();
  const values = readLocation();
  const error = $("location-error");
  error.textContent = "";
  if (values.mode === "street" && locationFields.street.disabled) {
    error.textContent = "Выберите населённый пункт из подсказок.";
    return;
  }
  if (values.mode === "radius") {
    if (!values.settlement || !values.street || !values.house) {
      error.textContent = "Укажи населённый пункт, улицу и номер дома.";
      return;
    }
    const point = resolveRadiusCenter(values);
    updateRadiusMap(values, point);
    if (!point) {
      error.textContent = values.coordinates
        ? "Укажи широту и долготу через запятую, например 56.4846, 84.9480."
        : "Для этого дома не найдено однозначных координат. Найди дом на карте и введи широту и долготу.";
      return;
    }
    state.location = { mode: "radius", center: point, address: addressKeys.map(key => values[key]).filter(Boolean).join(", "), radius: Number(values.radius) };
  } else {
    state.location = values;
  }
  render();
});
$("clear-location").addEventListener("click", () => {
  state.location = {};
  locationForm.reset();
  $("location-error").textContent = "";
  updateLocationFields();
  render();
});

function setTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  $("theme").setAttribute("aria-pressed", dark);
}
try {
  setTheme(localStorage.getItem("landscope-theme") === "dark");
} catch { }
$("theme").addEventListener("click", () => {
  const dark = $("theme").getAttribute("aria-pressed") !== "true";
  setTheme(dark);
  try {
    localStorage.setItem("landscope-theme", dark ? "dark" : "light");
  } catch { }
});
async function loadCatalog() {
  loadError = location.protocol === "file:" ? "Откройте сайт через http://localhost/" : "Загрузка объявлений…";
  populateLocationOptions();
  render();
  if (location.protocol === "file:") return;
  try {
    const response = await fetch("/api/catalog/commercial?section=" + encodeURIComponent(section));
    if (!response.ok) throw new Error((await response.json()).message || "Ошибка загрузки");
    const result = await response.json();

    result.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    listings = result.filter(item => item.active === true).map(item => {
      const objectType = (item.objectType || "").trim().replace(/\s+/g, " ");
      const original = objectType.toLowerCase();
      const type = /свободн(?:ое|ого)\s+назначени[ея]/iu.test(original) || original === "псн" ? "flexible" : categoryKeys.get(original) || (/торгов/.test(original) ? "retail" : /производ/.test(original) ? "industrial" : undefined);
      const unit = Number.isFinite(item.price) && item.price >= 0 && Number.isFinite(item.area) && item.area > 0
        ? item.price / item.area : null;
      return {
        ...item, type: section === "commercial" ? commercialCategory(objectType) : type, objectType, unit: Number.isFinite(unit) ? unit : null,
        condition: item.condition?.trim() || null,
        conditionGroup: commercialCondition(item.condition),
        districtGroup: commercialDistrict(item),
        source: item.source?.trim() || null,
        region: item.region?.trim() || null,
        district: item.district?.trim() || null,
        settlement: item.settlement?.trim() || null,
        street: item.street?.trim() || null
      };

    });
    for (const [options, key] of [
      [conditions, "condition"],
      [sourceOptions, "source"]
    ]) {
      const values = options === conditions && section === "commercial"
        ? ru09Conditions : uniqueOptions(listings.map(item => item[key]));
      options.splice(0, options.length, ...values);
    }
    loadError = "";
    renderQuickFields();
    populateLocationOptions();
  } catch (error) {
    loadError = error.message || "Не удалось загрузить объявления из базы";
  }
  render();
}

const sectionNames = {
  commercial: "Коммерческая недвижимость",
  residential: "Жилая недвижимость",
  structures: "Сооружение"
};
const params = new URLSearchParams(location.search);
const section = Object.hasOwn(sectionNames, params.get("section")) ? params.get("section") : "commercial";
const viewTitles = { market: "Отчёт по рынку", analogs: "Подбор аналогов" };
const view = params.get("view");
const hasReport = Object.hasOwn(viewTitles, view);
if (hasReport) {
  const page = view === "market" ? "quarterly" : "analogs";
  location.replace("/report/" + page + "/?section=" + section);
} else {
  document.querySelector("main h1").textContent = sectionNames[section];
  document.title = sectionNames[section] + " · LandScope";
  if (section === "commercial") {
    $("commercial-type-heading").hidden = false;
    conditions.splice(0, conditions.length, ...ru09Conditions);
    renderQuickFields();
    $("categories").classList.add("commercial-types");
    $("categories").innerHTML = Object.entries(commercialTypes).map(([key, label]) => `
      <label class="category" data-type="${key}">
        <input type="checkbox" value="${key}" ${checkedTypes.has(key) ? "checked" : ""}>
        <span>${label}</span>
        <b></b>
      </label>
    `).join("");
  } else {
    $("categories").innerHTML = Object.entries(types).map(([key, label]) =>
  '<button class="category" type="button" data-type="' + key + '" aria-pressed="false">' + label + ' <b></b></button>').join("");
  }
  loadCatalog();
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-number-step]");
  if (!button) return;
  const input = button.closest(".number-control").querySelector("input");
  const savedStep = input.getAttribute("step");
  if (savedStep === "any") input.step = "1";
  try {
    if (button.dataset.numberStep === "1") input.stepUp();
    else input.stepDown();
  } finally {
    input.setAttribute("step", savedStep);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.focus();
});