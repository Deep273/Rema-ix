"use strict";

const login = document.getElementById("review-login");
const statusLine = document.getElementById("review-status");
const container = document.getElementById("requests");
const labels = { pending: "На рассмотрении", accepted: "Принята", rejected: "Отклонена" };

async function request(method, data) {
  const response = await fetch("/api/corrections", {
    method,
    headers: {
      Authorization: "Bearer " + login.elements.token.value.trim(),
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.message);
  return result;
}

async function showRequests() {
  const requests = await request("GET");
  container.replaceChildren();
  statusLine.textContent = requests.length ? "" : "Заявок пока нет.";
  for (const item of requests) {
    const article = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = "Объект №" + item.listingId + " · " + labels[item.status];
    const message = document.createElement("p");
    message.textContent = item.message;
    const date = document.createElement("p");
    date.textContent = new Date(item.createdAt).toLocaleString("ru-RU");
    article.append(title, message, date);

    if (item.status === "pending") {
      for (const [status, label] of [
        ["accepted", "Принять"],
        ["rejected", "Отклонить"],
      ]) {
        const button = document.createElement("button");
        button.className = "button outline";
        button.textContent = label;
        button.onclick = async () => {
          try {
            await request("PATCH", { id: item.id, status });
            await showRequests();
          } catch (error) {
            statusLine.textContent = error.message;
          }
        };
        article.append(button);
      }
    }
    container.append(article);
  }
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await showRequests();
  } catch (error) {
    container.replaceChildren();
    statusLine.textContent = error.message;
  }
});
