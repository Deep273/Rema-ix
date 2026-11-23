const origin = 'https://www.tomsk.ru09.ru';
const cache = new Map();
const waiting = [];
let active = 0;

function drain() {
  while (active < 3 && waiting.length) {
    active++;
    waiting.shift()().finally(() => {
      active--;
      drain();
    });
  }
}

async function fetchPhotos(id) {
  const url = origin + '/realty?subaction=detail&id=' + id;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    redirect: 'error'
  });
  if (!response.ok) throw Error('Ru09 returned ' + response.status);
  const html = await response.text();
  const pattern = new RegExp('/img/tomsk/realty/\\d+/\\d+/' + id + '/thumb_[a-z0-9_.%-]+\\.(?:jpe?g|png|webp)(?=["\\s])', 'gi');
  return [...new Set(html.match(pattern) || [])].slice(0, 10).map(path => origin + path);
}

function listingPhotos(id) {
  const existing = cache.get(id);
  if (existing && existing.until > Date.now()) return existing.promise;
  if (waiting.length >= 90) return Promise.reject(Error('Photo queue full'));
  if (cache.size >= 2000) cache.delete(cache.keys().next().value);

  const entry = { until: Infinity };
  entry.promise = new Promise((resolve, reject) => {
    waiting.push(async () => {
      try {
        const photos = await fetchPhotos(id);
        entry.until = Date.now() + (photos.length ? 86400000 : 3600000);
        resolve(photos);
      } catch (error) {
        entry.until = Date.now() + 60000;
        reject(error);
      }
    });
  });
  cache.set(id, entry);
  drain();
  return entry.promise;
}

module.exports = { listingPhotos };
