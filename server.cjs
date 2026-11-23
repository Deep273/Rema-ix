const http = require('node:http');
const fs = require('node:fs/promises');
const { networkInterfaces } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');

const root = path.join(__dirname, 'wwwroot');
const mediaRoot = path.resolve(process.env.REALTY_MEDIA_DIR || path.join(__dirname, '..', 'Parser', 'media'));
const serverLanAddress = '192.168.0.10';
const onOriginalServer = Object.values(networkInterfaces()).flat()
  .some(({ address }) => address === serverLanAddress);
const databaseHost = process.env.PGHOST || (onOriginalServer ? serverLanAddress : '90.188.118.197');
const databasePort = Number(process.env.PGPORT || 5432);
const pool = new Pool({
  host: databaseHost,
  port: databasePort,
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'land_plots_db',
  connectionTimeoutMillis: 12000,
  statement_timeout: 12000,
  options: '-c default_transaction_read_only=on'
});
pool.on('error', error => console.error('PostgreSQL:', error.message));

const query = `
  SELECT m.id_supply AS id, m.external_obj_id AS "externalId", m.title, m.description_text AS description,
    m.operation_kind AS operation, m.link_url AS "sourceUrl",
    COALESCE(m.date_publication::date, m.date_first::date)::text AS "datePublished",
    m.is_active AS active, m.floor_number AS floor, m.exposure_months::float8 AS exposure,
    p.total_area::float8 AS area, m.source_area_unit::text AS "sourceAreaUnit",
    p.cadastral_number AS "cadastralNumber", p.latitude::float8 AS latitude,
    p.longitude::float8 AS longitude, p.ceiling_height::float8 AS ceiling,
    p.object_form::text AS "objectForm",
    COALESCE(to_jsonb(m)->'photos', to_jsonb(m)->'photo_urls', to_jsonb(p)->'photos', to_jsonb(p)->'photo_urls') AS photos,
    COALESCE(to_jsonb(m)->>'screenshot_url', to_jsonb(m)->>'source_screenshot_url') AS "screenshotUrl",
    t.name AS "objectType", v.name AS "objectView", s.name AS source,
    r.name AS region, d.name AS district, l.name AS locality, a.street, a.house_number AS house,
    b.total_floors AS floors, b.building_year AS year, COALESCE(rt.name, deal.renovation_state::text) AS condition,
    vri.name AS vri,
    COALESCE(h.entries, '[]'::jsonb) AS history
  FROM public.market_supply m
  JOIN public.object_profile p USING (id_profile)
  JOIN public.object_type t USING (id_type)
  JOIN public.object_view v USING (id_view)
  LEFT JOIN public.source_platform s USING (id_source)
  LEFT JOIN public.address a ON a.id_address = p.id_address
  LEFT JOIN public.settlement l USING (id_settlement)
  LEFT JOIN public.district_or_okrug d USING (id_district_or_okrug)
  LEFT JOIN public.region r USING (id_region)
  LEFT JOIN LATERAL (SELECT * FROM public.spec_land x WHERE x.id_profile = p.id_profile ORDER BY x.id_land DESC LIMIT 1) land ON true
  LEFT JOIN public.land_vri_types vri ON vri.id_vri = land.id_vri
  LEFT JOIN LATERAL (SELECT * FROM public.spec_building x WHERE x.id_profile = p.id_profile ORDER BY x.id_building DESC LIMIT 1) b ON true
  LEFT JOIN LATERAL (SELECT * FROM public.spec_market_deal x WHERE x.id_supply = m.id_supply ORDER BY x.id_market_deal DESC LIMIT 1) deal ON true
  LEFT JOIN public.renovation_types rt ON rt.id_renovation = deal.id_renovation
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('date', x.date_recording::date, 'amount', x.price_amount,
      'basis', x.price_basis, 'period', x.rent_period) ORDER BY x.date_recording DESC NULLS LAST, x.id_history DESC) AS entries
    FROM public.price_history x WHERE x.id_supply = m.id_supply
  ) h ON true
  WHERE m.operation_kind IN ('sale', 'rent')
  ORDER BY COALESCE(m.date_publication::date, m.date_first::date) DESC NULLS LAST, m.id_supply DESC
`;

function normalize({ externalId, ...row }) {
  const isLand = /^земельн/i.test(row.objectType);
  const landUnits = { sotka: 100, sot: 100, hectare: 10000, ha: 10000 };
  const squareMetres = row.area > 0 ? row.area * (landUnits[row.sourceAreaUnit] || 1) : null;
  const area = squareMetres === null ? null : squareMetres / (isLand ? 100 : 1);
  const history = row.history.map(entry => {
    let price = entry.basis === 'total' && entry.amount != null ? Number(entry.amount) : null;
    if (row.operation === 'rent' && price !== null) {
      if (entry.period === 'year') price /= 12;
      else if (entry.period && entry.period !== 'month') price = null;
    }
    return { date: entry.date, price, unit: area && price !== null && price >= 0 && Number.isFinite(price / area) ? price / area : null };
  });
  const { price = null, unit = null } = history[0] || {};
  return {
    ...row, isLand, area, areaUnit: isLand ? 'сотка' : 'м²', history, price,
    archivedScreenshotUrl: row.source === 'Ру09' && /^\d{1,100}$/.test(externalId)
      ? '/api/listing-screenshot?id=' + externalId : null,
    pricePerUnit: unit, unit, id: String(row.id), settlement: row.locality,
    published: row.datePublished, link: row.sourceUrl,
    title: row.title || row.objectType,
    address: [row.locality, row.street, row.house].filter(Boolean).join(', ') || row.district || '',
    point: row.latitude != null && row.longitude != null ? [row.latitude, row.longitude] : null
  };
}

let pending;
function loadRows() {
  pending ||= pool.query(query).then(result => result.rows.map(normalize)).finally(() => { pending = null; });
  return pending;
}

const same = (value, filter) => !filter || filter === 'all' ||
  String(value ?? '').trim().toLowerCase() === String(filter).trim().toLowerCase();
const segment = value => ['commercial', 'residential', 'structures'].includes(value) ? value : 'land';
function inSegment(row, type) {
  if (type === 'land') return row.isLand;
  if (row.isLand) return false;
  const patterns = { commercial: /^коммерч/i, residential: /^жил/i, structures: /^сооруж/i };
  return patterns[type].test(row.objectView);
}
function within(value, min, max) {
  if (min == null && max == null) return true;
  return value != null && (min == null || value >= Number(min)) && (max == null || value <= Number(max));
}
function filterRows(rows, form) {
  return rows.filter(row => same(row.region, form.region) && same(row.district, form.district) &&
    same(row.operation, form.operation) && same(row.vri, form.vri) &&
    same(row.condition, form.condition) && same(row.categoryLand, form.categoryLand) &&
    within(row.area, form.minArea ?? form.areaFrom, form.maxArea ?? form.areaTo) &&
    within(row.pricePerUnit, form.minPricePerUnit ?? form.priceFrom, form.maxPricePerUnit ?? form.priceTo) &&
    within(row.price, form.minPrice, form.maxPrice) &&
    within(row.floor, form.minFloor, form.maxFloor) && within(row.floors, form.minFloors, form.maxFloors) &&
    within(row.year, form.minYear, form.maxYear) && within(row.ceiling, form.minCeiling, form.maxCeiling) &&
    (!form.search || [row.title, row.address, row.cadastralNumber].join(' ').toLowerCase().includes(String(form.search).toLowerCase())));
}

function stats(rows) {
  const prices = rows.map(row => row.pricePerUnit).filter(Number.isFinite).sort((a, b) => a - b);
  const n = prices.length;
  return {
    announcementCount: rows.length,
    average: n ? prices.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (prices[Math.floor((n - 1) / 2)] + prices[Math.floor(n / 2)]) / 2 : null,
    minimumPerUnit: prices[0] ?? null,
    maximumPerUnit: prices.at(-1) ?? null
  };
}

function report(rows, form, type) {
  const start = String(form.start || '').slice(0, 10);
  const end = String(form.end || '').slice(0, 10);
  if (![start, end].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)) || start > end) {
    throw Object.assign(new Error('Укажите корректный период.'), { status: 400 });
  }
  const territory = row => !form.region || [row.region, row.district, row.locality].some(value =>
    same(String(value || '').replace(/^г\.\s*/i, ''), String(form.region).replace(/^г\.\s*/i, '')));
  const quarter = form.interval === 'По кварталам';
  const timeline = records => {
    const buckets = Map.groupBy(records, row => {
      const [year, month] = row.datePublished.split('-');
      return quarter ? `Q${Math.ceil(Number(month) / 3)} ${year}` : `${year}-${month}`;
    });
    return Array.from(buckets, ([period, group]) => ({ period, ...stats(group) }));
  };
  const prior = date => {
    const [year, month, day] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  };
  const records = rows.filter(territory);
  const inRange = (from, to) => records.filter(row => row.datePublished >= from && row.datePublished <= to);
  const current = inRange(start, end);
  const previous = inRange(prior(start), prior(end));
  if (!current.length) return { message: 'Нет данных за выбранный период' };
  const now = stats(current);
  const before = stats(previous);
  const delta = (a, b) => a != null && b > 0 ? (a / b - 1) * 100 : null;
  const [low, high, labels] = type === 'land'
    ? [30, 50, ['До 30 соток', 'От 30 до 50 соток', 'Свыше 50 соток']]
    : [50, 150, ['До 50 м²', 'От 50 до 150 м²', 'Свыше 150 м²']];
  const groups = Map.groupBy(current.filter(row => row.area !== null), row =>
    labels[row.area < low ? 0 : row.area <= high ? 1 : 2]);
  return {
    summary: {
      totalAnnouncements: now.announcementCount, averagePrice: now.average, medianPrice: now.median,
      priceChangeDeltaPercentage: delta(now.median, before.median),
      countChangeDeltaPercentage: delta(now.announcementCount, before.announcementCount)
    },
    timeline: timeline(current), historyTimeline: timeline(previous),
    areaAnalytics: Array.from(groups, ([segmentGroup, group]) => ({ segmentGroup, ...stats(group) }))
  };
}

const routes = new Map([
  ['GET /api/catalog/commercial', ({ active, type }) => active
    .filter(row => inSegment(row, type) || (type === 'commercial' && row.isLand && /^коммерч/i.test(row.objectView)))
    .map(row => {
      if (type !== 'commercial' || !row.isLand) return row;
      const area = row.area == null ? null : row.area * 100;
      const unit = row.unit == null ? null : row.unit / 100;
      const history = row.history.map(entry => ({ ...entry, unit: entry.unit == null ? null : entry.unit / 100 }));
      return { ...row, area, areaUnit: 'м²', unit, pricePerUnit: unit, history };
    })],
  ['POST /api/analog/find', ({ active, type, form }) =>
    filterRows(active.filter(row => inSegment(row, type)), form).slice(0, 100)],
  ['GET /api/meta/filters', ({ active, type }) => {
    const rows = active.filter(row => inSegment(row, type));
    const values = key => [...new Set(rows.map(row => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    return {
      districts: values('district'), regions: values('region'), categories: values('categoryLand'),
      vri: values('vri'), conditions: values('condition'), locations: [...new Map(rows.map(row => [
        JSON.stringify([row.region, row.district]), { region: row.region, district: row.district }
      ])).values()]
    };
  }],
  ['GET /api/report/total-count', ({ rows, type }) => ({ total: rows.filter(row => inSegment(row, type)).length })],
  ['POST /api/report/calculate', ({ rows, type, form }) =>
    report(rows.filter(row => inSegment(row, type) && same(row.operation, form.operation)), form, type)],
  ['POST /api/listings', ({ active, type, form }) => {
    const rows = filterRows(active.filter(row => inSegment(row, type)), form);
    const [field, direction] = {
      'price-asc': ['pricePerUnit', 1], 'price-desc': ['pricePerUnit', -1],
      'area-asc': ['area', 1], 'area-desc': ['area', -1]
    }[form.sort] || [];
    if (field) rows.sort((a, b) => a[field] == null ? Number(b[field] != null) :
      b[field] == null ? -1 : (a[field] - b[field]) * direction);
    const size = Math.max(1, Math.min(100, Math.trunc(Number(form.pageSize)) || 12));
    const page = Math.max(1, Math.trunc(Number(form.page)) || 1);
    return { total: rows.length, pages: Math.ceil(rows.length / size), items: rows.slice((page - 1) * size, page * size) };
  }]
]);

const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request) {
  let text = '';
  for await (const chunk of request.setEncoding('utf8')) {
    text += chunk;
    if (text.length > 16000) throw Object.assign(new Error('Слишком большой запрос.'), { status: 413 });
  }
  try {
    const value = JSON.parse(text || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw Object.assign(new Error('Некорректный JSON.'), { status: 400 });
}

const { handleCorrections, token } = require('./corrections.cjs');

const { listingPhotos } = require('./listing-photos.cjs');

async function serveListingScreenshot(request, response, id) {
  if (!/^\d{1,100}$/.test(id)) return json(response, 400, null);
  const folder = path.join(mediaRoot, 'ru09', id.slice(-2).padStart(2, '0'));
  // The parser saves a screenshot either inside a full media archive or as a standalone PNG.
  for (const file of [path.join(folder, id, 'screenshot.png'), path.join(folder, id + '.png')]) {
    try {
      const image = await fs.readFile(file);
      response.writeHead(200, {
        'Content-Type': 'image/png', 'Content-Length': image.length,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache'
      });
      return response.end(request.method === 'HEAD' ? undefined : image);
    } catch (error) {
      // A missing parent directory on a Windows network share can report UNKNOWN.
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) &&
          !(process.platform === 'win32' && error.code === 'UNKNOWN')) throw error;
    }
  }
  return json(response, 404, null);
}

const { createAuth } = require('./auth.cjs');
const { createStore } = require('./auth-store.cjs');
const accountStore = createStore(process.env.LANDSCOPE_AUTH_DB || undefined);
const auth = createAuth(accountStore, { json, body, secure: process.argv.includes('--behind-caddy') });
const publicFiles = new Set(['/login.html', '/login.css', '/login.js']);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (await auth.handle(request, response, url)) return;
    if (!publicFiles.has(url.pathname) && !(await auth.user(request))) {
      if (url.pathname.startsWith('/api/')) return json(response, 401, { message: 'Войдите в аккаунт.' });
      response.writeHead(303, { Location: '/login.html', 'Cache-Control': 'no-store' });
      return response.end();
    }
    if (url.pathname === '/api/listing-screenshot' && ['GET', 'HEAD'].includes(request.method)) {
      return await serveListingScreenshot(request, response, url.searchParams.get('id'));
    }
    if (request.method === 'GET' && url.pathname === '/api/listing-photos') {
      const id = url.searchParams.get('id');
      if (!/^\d{1,12}$/.test(id)) return json(response, 400, []);
      try {
        return json(response, 200, await listingPhotos(id));
      } catch {
        return json(response, 502, []);
      }
    }
    if (url.pathname === '/api/corrections') return await handleCorrections(request, response, body, json);
    if (url.pathname.startsWith('/api/')) {
      const handler = routes.get(`${request.method} ${url.pathname}`);
      if (!handler) return json(response, 404, { message: 'Маршрут не найден.' });
      if (!process.env.PGPASSWORD) return json(response, 503, { message: 'Запусти start.cmd и введи пароль PostgreSQL.' });
      const form = request.method === 'POST' ? await body(request) : {};
      const rows = await loadRows();
      const type = segment(form.section || url.searchParams.get('section') ||
        (url.pathname === '/api/catalog/commercial' ? 'commercial' : 'land'));
      return json(response, 200, handler({ rows, active: rows.filter(row => row.active === true), form, type }));
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { message: 'Метод не поддерживается.' });
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
    const mime = contentTypes[path.extname(target)];
    if (!target.startsWith(root + path.sep) || !mime) return json(response, 404, { message: 'Страница не найдена.' });
    let file = await fs.readFile(target);
    if (path.extname(target) === '.html' && url.pathname !== '/login.html') {
      file = Buffer.from(file.toString('utf8').replace('</body>', '<script src="/account.js" defer></script></body>'));
    }
    response.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 503);
    if (status === 503) console.error('Запрос:', error.message);
    json(response, status, { message: error.status ? error.message : status === 404 ?
      'Страница не найдена.' : 'Не удалось загрузить данные PostgreSQL. Подробности в окне сервера.' });
  }
});
const behindCaddy = process.argv.includes('--behind-caddy');
const port = Number(process.env.REALTY_PORT || (behindCaddy ? 5011 : 80));
// Keep the existing router's HTTP forwarding working on the original server.
const exposeOnOriginalServer = onOriginalServer && !behindCaddy && !process.env.REALTY_HOST;
const host = behindCaddy ? '127.0.0.1' : (process.env.REALTY_HOST || (exposeOnOriginalServer ? '0.0.0.0' : '127.0.0.1'));
server.listen(port, host, () => {
  const browserHost = host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host;
  const actualPort = server.address().port;
  const address = `http://${browserHost}${actualPort === 80 ? '' : ':' + actualPort}/`;
  console.log(address);
  if (exposeOnOriginalServer) console.log(address.replace('localhost', serverLanAddress));
  console.log(address + "corrections.html");
  console.log(`PostgreSQL: ${databaseHost}:${databasePort}`);
  console.log("Ключ панели заявок:", token);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const { spawn } = require('node:child_process');
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', address], {
      stdio: 'ignore', windowsHide: true
    });
    browser.on('error', () => console.log('Open the address above in your browser.'));
  }
});
