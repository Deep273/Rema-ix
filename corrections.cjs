const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const directory = path.join(__dirname, "local-data");
const file = path.join(directory, "corrections.json");
const token = process.env.LANDSCOPE_ADMIN_TOKEN || crypto.randomBytes(16).toString("hex");
let queue = Promise.resolve();

async function readRequests() {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function changeRequests(update) {
  const operation = queue.then(async () => {
    const requests = await readRequests();
    const result = update(requests);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file + ".tmp", JSON.stringify(requests, null, 2), "utf8");
    await fs.rename(file + ".tmp", file);
    return result;
  });
  queue = operation.catch(() => {});
  return operation;
}

async function handleCorrections(request, response, body, json) {
                                                                                        
  const proxiedHttps = request.socket.remoteAddress === "127.0.0.1" &&
    request.headers["x-forwarded-proto"] === "https";
  const scheme = proxiedHttps ? "https" : "http";
  if (request.headers.origin && request.headers.origin !== scheme + "://" + request.headers.host) {
    return json(response, 403, { message: "Запрос с другого сайта отклонён." });
  }
  if (request.method === "POST") {
    if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
      return json(response, 415, { message: "Ожидается JSON." });
    }
    const { listingId, message } = await body(request);
    if (!/^\d{1,30}$/.test(listingId) || typeof message !== "string" ||
        message.trim().length < 5 || message.trim().length > 1000) {
      return json(response, 400, { message: "Укажи объект и опиши исправление (от 5 до 1000 символов)." });
    }
    const id = crypto.randomUUID();
    await changeRequests(requests => requests.push({
      id, listingId, message: message.trim(), createdAt: new Date().toISOString(), status: "pending"
    }));
    return json(response, 201, { id });
  }
  if (request.headers.authorization !== "Bearer " + token) {
    return json(response, 401, { message: "Введи ключ из окна сервера." });
  }
  if (request.method === "GET") return json(response, 200, (await readRequests()).reverse());
  if (request.method === "PATCH") {
    const { id, status } = await body(request);
    if (!["accepted", "rejected"].includes(status)) return json(response, 400, { message: "Недопустимый статус." });
    const changed = await changeRequests(requests => {
      const item = requests.find(entry => entry.id === id && entry.status === "pending");
      if (!item) return false;
      item.status = status;
      item.reviewedAt = new Date().toISOString();
      return true;
    });
    return json(response, changed ? 200 : 404, changed ? { status } : { message: "Заявка уже рассмотрена или отсутствует." });
  }
  return json(response, 405, { message: "Метод не поддерживается." });
}

module.exports = { handleCorrections, token };
