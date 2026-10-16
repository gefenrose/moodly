const DB_NAME = "shura-bayom";
const DB_VERSION = 1;
const STORE_NAMES = ["records", "habits", "photos"];
const today = toLocalDateString(new Date());

const state = {
  tab: "journal",
  selectedDate: today,
  habitDate: today,
  weightDate: today,
  records: [],
  habits: [],
  photoURLs: new Map(),
  draftPhoto: null,
  draftHasPhoto: false,
  draftPreviewURL: null,
  draftDate: today,
  toastTimer: null,
};

const view = document.querySelector("#view");
const entryDialog = document.querySelector("#entry-dialog");
const habitDialog = document.querySelector("#habit-dialog");
const entryForm = document.querySelector("#entry-form");
const habitForm = document.querySelector("#habit-form");
const backupInput = document.querySelector("#backup-file");

function toLocalDateString(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromString(value) {
  return new Date(`${value}T12:00:00`);
}

function formatLongDate(value, year = true) {
  const options = { weekday: "long", day: "numeric", month: "long" };
  if (year) options.year = "numeric";
  return new Intl.DateTimeFormat("he-IL", options).format(dateFromString(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(dateFromString(value));
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("האחסון המקומי אינו זמין בדפדפן הזה."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("records")) database.createObjectStore("records", { keyPath: "date" });
      if (!database.objectStoreNames.contains("habits")) database.createObjectStore("habits", { keyPath: "id" });
      if (!database.objectStoreNames.contains("photos")) database.createObjectStore("photos", { keyPath: "date" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("לא ניתן לפתוח את היומן."));
  });
}

async function dbRequest(storeName, method, value) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const mode = method === "get" || method === "getAll" ? "readonly" : "readwrite";
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = value === undefined ? store[method]() : store[method](value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("לא ניתן לשמור את הנתונים."));
    transaction.onabort = () => reject(transaction.error || new Error("הפעולה בוטלה."));
    transaction.oncomplete = () => database.close();
  });
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function validBackupDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function photoFromBase64(photo) {
  if (!validBackupDate(photo.date) || typeof photo.data !== "string" || !photo.data.length || photo.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) {
    throw new Error("קובץ הגיבוי מכיל תמונה לא תקינה.");
  }
  const type = typeof photo.type === "string" && /^image\/(jpeg|png|webp|gif)$/i.test(photo.type) ? photo.type : "image/jpeg";
  let binary;
  try {
    binary = atob(photo.data);
  } catch {
    throw new Error("קובץ הגיבוי מכיל תמונה לא תקינה.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { date: photo.date, blob: new Blob([bytes], { type }) };
}

function validateBackup(data) {
  if (!data || data.format !== "shura-bayom-backup" || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.habits) || !Array.isArray(data.photos)) {
    throw new Error("זה לא קובץ גיבוי תקין של שורה ביום.");
  }

  const habits = data.habits.map((habit) => {
    if (!habit || typeof habit.id !== "string" || !habit.id || typeof habit.name !== "string" || !habit.name.trim()) {
      throw new Error("קובץ הגיבוי מכיל הרגל לא תקין.");
    }
    return { id: habit.id, name: habit.name.trim().slice(0, 60) };
  });

  const photos = data.photos.map(photoFromBase64);
  const photoDates = new Set(photos.map((photo) => photo.date));
  if (photoDates.size !== photos.length) throw new Error("קובץ הגיבוי מכיל תמונות כפולות.");

  const records = data.records.map((record) => {
    if (!record || !validBackupDate(record.date) || typeof record.note !== "string") {
      throw new Error("קובץ הגיבוי מכיל רישום יומי לא תקין.");
    }
    const low = record.moodLow ?? null;
    const high = record.moodHigh ?? null;
    const hasMood = low !== null || high !== null;
    if (hasMood && (!Number.isInteger(low) || low < 1 || low > 10 || !Number.isInteger(high) || high < 1 || high > 10)) {
      throw new Error("קובץ הגיבוי מכיל דירוג מצב רוח לא תקין.");
    }
    const weightKg = record.weightKg ?? null;
    if (weightKg !== null && (!Number.isFinite(Number(weightKg)) || Number(weightKg) <= 0 || Number(weightKg) >= 1000)) {
      throw new Error("קובץ הגיבוי מכיל רישום משקל לא תקין.");
    }
    if (record.checkedHabits !== undefined && (!Array.isArray(record.checkedHabits) || record.checkedHabits.some((id) => typeof id !== "string"))) {
      throw new Error("קובץ הגיבוי מכיל מעקב הרגלים לא תקין.");
    }
    const hasPhoto = photoDates.has(record.date);
    if (Boolean(record.hasPhoto) !== hasPhoto) throw new Error("קובץ הגיבוי אינו שלם: חסרה תמונה של אחד הרישומים.");
    return {
      date: record.date,
      note: record.note.slice(0, 180),
      moodLow: hasMood ? Math.min(low, high) : null,
      moodHigh: hasMood ? Math.max(low, high) : null,
      weightKg: weightKg === null ? null : Math.round(Number(weightKg) * 10) / 10,
      checkedHabits: record.checkedHabits || [],
      hasPhoto,
    };
  });

  const recordDates = new Set(records.map((record) => record.date));
  if (recordDates.size !== records.length || photos.some((photo) => !recordDates.has(photo.date))) {
    throw new Error("קובץ הגיבוי מכיל תאריכים כפולים או תמונה ללא רישום.");
  }
  return { records, habits, photos };
}

async function exportBackup() {
  const [records, habits, photos] = await Promise.all([
    dbRequest("records", "getAll"),
    dbRequest("habits", "getAll"),
    dbRequest("photos", "getAll"),
  ]);
  const photoDates = new Set(photos.map((photo) => photo.date));
  const backup = {
    format: "shura-bayom-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    records: records.map((record) => ({ ...record, hasPhoto: photoDates.has(record.date) })),
    habits,
    photos: await Promise.all(photos.map(async ({ date, blob }) => ({
      date,
      type: blob.type || "image/jpeg",
      data: await blobToBase64(blob),
    }))),
  };
  const file = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shura-bayom-backup-${today}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  showToast("קובץ הגיבוי ירד למכשיר");
}

async function writeBackupToDatabase(backup) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAMES, "readwrite");
    const recordsStore = transaction.objectStore("records");
    const habitsStore = transaction.objectStore("habits");
    const photosStore = transaction.objectStore("photos");
    backup.records.forEach((record) => recordsStore.put(record));
    backup.habits.forEach((habit) => habitsStore.put(habit));
    backup.records.filter((record) => !record.hasPhoto).forEach((record) => photosStore.delete(record.date));
    backup.photos.forEach((photo) => photosStore.put(photo));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error("לא ניתן לייבא את הגיבוי."));
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("לא ניתן לייבא את הגיבוי."));
    };
  });
}

async function importBackupFile(file) {
  if (!file) return;
  let backup;
  try {
    backup = validateBackup(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("לא ניתן לקרוא את הקובץ. בחרו קובץ גיבוי JSON של שורה ביום.");
    throw error;
  }
  const accepted = window.confirm("הייבוא יוסיף רישומים חדשים ויחליף רישומים באותם תאריכים, כולל תמונות. נתונים מתאריכים אחרים יישארו. להמשיך?");
  if (!accepted) return;
  await writeBackupToDatabase(backup);
  for (const url of state.photoURLs.values()) URL.revokeObjectURL(url);
  state.photoURLs.clear();
  await loadData();
  await render();
  showToast(`הגיבוי יובא: ${backup.records.length} רישומים`);
}

async function loadData() {
  const [records, habits] = await Promise.all([
    dbRequest("records", "getAll"),
    dbRequest("habits", "getAll"),
  ]);
  state.records = records.sort((a, b) => b.date.localeCompare(a.date));
  state.habits = habits.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

function recordFor(date) {
  return state.records.find((record) => record.date === date) || {
    date,
    note: "",
    hasPhoto: false,
    moodLow: null,
    moodHigh: null,
    weightKg: null,
    checkedHabits: [],
  };
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
}

function setActiveTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  render().catch(reportError);
  view.focus({ preventScroll: true });
}

async function getPhotoURL(date) {
  if (state.photoURLs.has(date)) return state.photoURLs.get(date);
  const item = await dbRequest("photos", "get", date);
  if (!item?.blob) return null;
  const url = URL.createObjectURL(item.blob);
  state.photoURLs.set(date, url);
  return url;
}

function cleanupPhotoURLs() {
  const datesWithPhotos = new Set(state.records.filter((record) => record.hasPhoto).map((record) => record.date));
  for (const [date, url] of state.photoURLs) {
    if (!datesWithPhotos.has(date)) {
      URL.revokeObjectURL(url);
      state.photoURLs.delete(date);
    }
  }
}

function pageHeading(title, subtitle, action = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ""}</div>`;
}

async function renderJournal() {
  const entries = state.records;
  const dateInput = `<label class="date-control"><span>תאריך</span><input id="journal-date" aria-label="בחירת תאריך ליומן" type="date" max="${today}" value="${state.selectedDate}" /></label>`;
  const action = `<button class="primary-button" id="add-selected" type="button">כתיבה לתאריך</button>`;
  if (!entries.length) {
    view.innerHTML = `${pageHeading("היומן שלי", "שורה אחת קטנה מהיום, שתישאר איתך.")}
      <div class="journal-toolbar">${dateInput}${action}</div>
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 4.75h11a1.5 1.5 0 0 1 1.5 1.5v13h-11A2.5 2.5 0 0 1 5.5 16.75v-10a2 2 0 0 1 1-2Z"/><path d="M8.5 9h8M8.5 12.5h6"/></svg></div>
        <h2>מתחילים בשורה אחת</h2>
        <p>רגע קטן, מחשבה או תמונה — אפשר לשמור כאן משהו אחד מכל יום.</p>
      </div>`;
    return;
  }

  const rows = await Promise.all(entries.map(async (record) => {
    const photoURL = record.hasPhoto ? await getPhotoURL(record.date) : null;
    const moods = record.moodLow !== null && record.moodHigh !== null
      ? `<span class="mood-chip low">נמוך ${record.moodLow}</span><span class="mood-chip high">גבוה ${record.moodHigh}</span>` : "";
    const weight = record.weightKg !== null && record.weightKg !== undefined
      ? `<span class="weight-chip">${Number(record.weightKg).toFixed(1)} ק״ג</span>` : "";
    const note = record.note?.trim() ? escapeHTML(record.note) : "יום במעקב";
    return `<button class="entry-row" type="button" data-action="edit-entry" data-date="${record.date}" aria-label="עריכת הרשומה מיום ${escapeHTML(formatLongDate(record.date))}">
      <time class="entry-date" datetime="${record.date}">${escapeHTML(formatShortDate(record.date))}</time>
      <span class="entry-body"><span class="entry-note">${note}</span><span class="entry-meta">${moods}${weight}</span></span>
      ${photoURL ? `<img class="entry-thumb" src="${photoURL}" alt="תמונה מהיום" loading="lazy" />` : ""}
      <span class="entry-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></span>
    </button>`;
  }));
  cleanupPhotoURLs();
  view.innerHTML = `${pageHeading("היומן שלי", "שורה אחת קטנה מהיום, שתישאר איתך.")}
    <div class="journal-toolbar">${dateInput}${action}</div>
    <div class="section-heading"><h2>הימים שלי</h2><span class="count-label">${entries.length} ${entries.length === 1 ? "יום" : "ימים"}</span></div>
    <div class="entry-list">${rows.join("")}</div>`;
}

function chartGrid(width, height, left, right, top, bottom, values) {
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  return values.map((value) => {
    const y = top + ((10 - value) / 9) * plotHeight;
    return `<line class="chart-grid" x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" />
      <text x="${left - 9}" y="${(y + 4).toFixed(1)}" text-anchor="end">${value}</text>`;
  }).join("");
}

function moodChart(records) {
  const width = 720;
  const height = 245;
  const left = 37;
  const right = 12;
  const top = 15;
  const bottom = 31;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const lastIndex = Math.max(1, records.length - 1);
  const x = (index) => left + (index / lastIndex) * plotWidth;
  const y = (value) => top + ((10 - value) / 9) * plotHeight;
  const low = records.map((record, index) => `${x(index).toFixed(1)},${y(record.moodLow).toFixed(1)}`);
  const high = records.map((record, index) => `${x(index).toFixed(1)},${y(record.moodHigh).toFixed(1)}`);
  const linePath = (points) => points.map((point, index) => `${index ? "L" : "M"}${point}`).join(" ");
  const areaPath = `M${low[0]} ${low.slice(1).map((point) => `L${point}`).join(" ")} ${high.slice().reverse().map((point) => `L${point}`).join(" ")} Z`;
  const points = records.map((record, index) => `<circle class="chart-point-low" cx="${x(index).toFixed(1)}" cy="${y(record.moodLow).toFixed(1)}" r="3.5"><title>${escapeHTML(formatLongDate(record.date))}: נמוך ${record.moodLow}</title></circle>
      <circle class="chart-point-high" cx="${x(index).toFixed(1)}" cy="${y(record.moodHigh).toFixed(1)}" r="3.5"><title>${escapeHTML(formatLongDate(record.date))}: גבוה ${record.moodHigh}</title></circle>`).join("");
  const xLabels = [...new Set([0, Math.floor((records.length - 1) / 2), records.length - 1])].map((index) =>
    `<text x="${x(index).toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHTML(formatShortDate(records[index].date))}</text>`).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="תרשים טווח מצב רוח יומי">
    <title>המצב הנמוך והגבוה ביותר בכל יום</title>
    ${chartGrid(width, height, left, right, top, bottom, [10, 5, 1])}
    <path class="chart-range" d="${areaPath}" />
    <path class="chart-low" d="${linePath(low)}" />
    <path class="chart-high" d="${linePath(high)}" />
    ${points}${xLabels}
  </svg>`;
}

function weightChart(records) {
  const width = 720;
  const height = 220;
  const left = 50;
  const right = 12;
  const top = 18;
  const bottom = 31;
  const weights = records.map((record) => Number(record.weightKg));
  const minValue = Math.floor(Math.min(...weights) - 1);
  const maxValue = Math.ceil(Math.max(...weights) + 1);
  const range = Math.max(2, maxValue - minValue);
  const lower = minValue;
  const upper = minValue + range;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const lastIndex = Math.max(1, records.length - 1);
  const x = (index) => left + (index / lastIndex) * plotWidth;
  const y = (value) => top + ((upper - value) / range) * plotHeight;
  const points = records.map((record, index) => `${x(index).toFixed(1)},${y(Number(record.weightKg)).toFixed(1)}`);
  const path = points.map((point, index) => `${index ? "L" : "M"}${point}`).join(" ");
  const grid = [upper, (upper + lower) / 2, lower].map((value) => {
    const gy = y(value);
    return `<line class="chart-grid" x1="${left}" y1="${gy.toFixed(1)}" x2="${width - right}" y2="${gy.toFixed(1)}" />
      <text x="${left - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end">${value.toFixed(value % 1 ? 1 : 0)}</text>`;
  }).join("");
  const dots = records.map((record, index) => `<circle class="chart-point-low" cx="${x(index).toFixed(1)}" cy="${y(Number(record.weightKg)).toFixed(1)}" r="3.5"><title>${escapeHTML(formatLongDate(record.date))}: ${Number(record.weightKg).toFixed(1)} ק״ג</title></circle>`).join("");
  const labels = [...new Set([0, Math.floor((records.length - 1) / 2), records.length - 1])].map((index) =>
    `<text x="${x(index).toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHTML(formatShortDate(records[index].date))}</text>`).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="תרשים משקל לאורך זמן">
    <title>משקל לאורך זמן בקילוגרמים</title>${grid}<path class="chart-low" d="${path}" />${dots}${labels}
  </svg>`;
}

function renderTrends() {
  const moods = state.records.filter((record) => record.moodLow !== null && record.moodHigh !== null).slice(0, 30).reverse();
  const weights = state.records.filter((record) => record.weightKg !== null && record.weightKg !== undefined).slice(0, 30).reverse();
  const moodView = moods.length ? `<div class="chart-wrap">${moodChart(moods)}</div>
    <div class="chart-legend"><span class="legend-key"><span class="legend-line"></span>הנמוך ביותר</span><span class="legend-key"><span class="legend-line high"></span>הגבוה ביותר</span></div>`
    : `<div class="chart-empty">כשתשמרו טווח מצב רוח יומי, הוא יופיע כאן.</div>`;
  const weightView = weights.length ? `<div class="chart-wrap">${weightChart(weights)}</div>`
    : `<div class="chart-empty">רישומי המשקל שלכם יופיעו כאן.</div>`;
  view.innerHTML = `${pageHeading("מגמות", "מבט אישי על הנתונים שבחרתם לשמור.")}
    <section class="chart-section" aria-labelledby="mood-chart-title">
      <div class="chart-heading"><div><h2 id="mood-chart-title">טווח מצב הרוח היומי</h2><p>הנמוך והגבוה ביותר שנרשמו בכל יום</p></div><span class="count-label">${moods.length} ימים</span></div>
      ${moodView}
    </section>
    <section class="chart-section" aria-labelledby="weight-chart-title">
      <div class="chart-heading"><div><h2 id="weight-chart-title">משקל לאורך זמן</h2><p>רק הרישומים שנשמרו ביומן</p></div><span class="count-label">${weights.length} רישומים</span></div>
      ${weightView}
    </section>`;
}

function renderHabits() {
  const dateInput = `<label class="date-control"><span>תאריך</span><input id="habit-date" aria-label="בחירת תאריך להרגלים" type="date" max="${today}" value="${state.habitDate}" /></label>`;
  const record = recordFor(state.habitDate);
  const checked = new Set(record.checkedHabits || []);
  const complete = state.habits.filter((habit) => checked.has(habit.id)).length;
  const rows = state.habits.map((habit) => `<div class="habit-row ${checked.has(habit.id) ? "is-checked" : ""}">
    <label class="habit-check"><input type="checkbox" data-action="toggle-habit" data-id="${escapeHTML(habit.id)}" ${checked.has(habit.id) ? "checked" : ""} aria-label="${checked.has(habit.id) ? "ביטול" : "סימון"} ${escapeHTML(habit.name)}" /><span class="habit-name">${escapeHTML(habit.name)}</span></label>
    <button class="habit-remove" type="button" data-action="delete-habit" data-id="${escapeHTML(habit.id)}" aria-label="הסרת ההרגל ${escapeHTML(habit.name)}">×</button>
  </div>`).join("");
  view.innerHTML = `${pageHeading("הרגלים", "צעדים קטנים, בקצב שמתאים לכם.", dateInput)}
    <div class="progress-row"><span class="progress-copy"><strong>${complete}</strong> מתוך <strong>${state.habits.length}</strong> הושלמו ביום ${escapeHTML(formatLongDate(state.habitDate, false))}</span>
      <span class="progress-track" role="progressbar" aria-label="התקדמות יומית" aria-valuenow="${complete}" aria-valuemin="0" aria-valuemax="${state.habits.length || 1}"><span class="progress-fill" style="width:${state.habits.length ? Math.round((complete / state.habits.length) * 100) : 0}%"></span></span>
    </div>
    ${state.habits.length ? `<div class="habit-list">${rows}</div>` : `<div class="habit-empty">עוד אין כאן הרגלים. אפשר להתחיל ממשהו קטן וחשוב לכם.</div>`}
    <button class="secondary-button habit-add" type="button" data-action="add-habit">הוספת הרגל</button>`;
}

function renderWeight() {
  const record = recordFor(state.weightDate);
  const weights = state.records.filter((item) => item.weightKg !== null && item.weightKg !== undefined);
  const sorted = [...weights].sort((a, b) => b.date.localeCompare(a.date));
  const history = sorted.length ? `<div class="metric-table">${sorted.map((item) => `<div class="metric-row"><time datetime="${item.date}">${escapeHTML(formatLongDate(item.date))}</time><span class="metric-value">${Number(item.weightKg).toFixed(1)} ק״ג</span></div>`).join("")}</div>`
    : `<div class="chart-empty">המשקל נשמר במכשיר ומוצג לצד היומן.</div>`;
  const recent = sorted[0];
  view.innerHTML = `${pageHeading("משקל", "מעקב פשוט, יום אחרי יום.", `<label class="date-control"><span>תאריך</span><input id="weight-date" aria-label="בחירת תאריך למשקל" type="date" max="${today}" value="${state.weightDate}" /></label>`)}
    ${recent ? `<p class="summary-strip">הרישום האחרון: <strong>${Number(recent.weightKg).toFixed(1)} ק״ג</strong><span>·</span>${escapeHTML(formatLongDate(recent.date, false))}</p>` : ""}
    <form class="weight-entry" id="weight-form">
      <div class="weight-field"><label class="field-label" for="weight-value">משקל ביום ${escapeHTML(formatLongDate(state.weightDate, false))}</label><div class="weight-input-wrap"><input class="weight-input" id="weight-value" type="number" min="1" max="999.9" step="0.1" inputmode="decimal" placeholder="0.0" value="${record.weightKg ?? ""}" /><span class="weight-unit">ק״ג</span></div></div>
      <button class="primary-button" type="submit">שמירת משקל</button>
    </form>
    ${record.weightKg !== null && record.weightKg !== undefined ? `<button class="text-button" type="button" data-action="remove-weight">הסרת הרישום לתאריך הזה</button>` : ""}
    <div class="section-heading"><h2>רישומים קודמים</h2><span class="count-label">${weights.length} רישומים</span></div>
    ${history}`;
}

async function render() {
  view.setAttribute("aria-busy", "true");
  if (state.tab === "journal") await renderJournal();
  else if (state.tab === "trends") renderTrends();
  else if (state.tab === "habits") renderHabits();
  else renderWeight();
  view.removeAttribute("aria-busy");
}

async function loadEntryEditor(date) {
  state.draftDate = date;
  const record = recordFor(date);
  document.querySelector("#entry-date").value = date;
  document.querySelector("#entry-date").max = today;
  document.querySelector("#entry-date-label").textContent = formatLongDate(date);
  document.querySelector("#entry-note").value = record.note || "";
  document.querySelector("#note-count").textContent = `${(record.note || "").length}/180`;
  document.querySelector("#mood-enabled").checked = record.moodLow !== null && record.moodHigh !== null;
  document.querySelector("#mood-fields").disabled = !document.querySelector("#mood-enabled").checked;
  document.querySelector("#mood-low").value = record.moodLow ?? 3;
  document.querySelector("#mood-high").value = record.moodHigh ?? 7;
  document.querySelector("#mood-low-value").value = record.moodLow ?? 3;
  document.querySelector("#mood-high-value").value = record.moodHigh ?? 7;
  state.draftPhoto = null;
  state.draftHasPhoto = Boolean(record.hasPhoto);
  if (record.hasPhoto) state.draftPhoto = await dbRequest("photos", "get", date).then((item) => item?.blob || null);
  updatePhotoPreview(state.draftPhoto);
}

async function showEntryEditor(date = today) {
  await loadEntryEditor(date);
  entryDialog.showModal();
}

function updatePhotoPreview(blob) {
  if (state.draftPreviewURL) URL.revokeObjectURL(state.draftPreviewURL);
  state.draftPreviewURL = null;
  const preview = document.querySelector("#photo-preview");
  const remove = document.querySelector("#remove-photo");
  const label = document.querySelector("#photo-button-label");
  preview.innerHTML = "";
  if (blob) {
    state.draftPreviewURL = URL.createObjectURL(blob);
    preview.innerHTML = `<img src="${state.draftPreviewURL}" alt="תצוגה מקדימה של התמונה" />`;
    preview.hidden = false;
    remove.hidden = false;
    label.textContent = "בחירת תמונה אחרת";
  } else {
    preview.hidden = true;
    remove.hidden = true;
    label.textContent = "בחירת תמונה";
  }
}

async function imageAsJPEG(file) {
  const imageURL = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("לא ניתן לפתוח את התמונה."));
      element.src = imageURL;
    });
    const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("לא ניתן לשמור את התמונה.")), "image/jpeg", 0.8));
  } finally {
    URL.revokeObjectURL(imageURL);
  }
}

async function saveEntry(event) {
  event.preventDefault();
  const date = document.querySelector("#entry-date").value;
  if (!date || date > today) return showToast("אפשר לשמור רק היום או תאריך שעבר.");
  const previous = recordFor(date);
  const moodEnabled = document.querySelector("#mood-enabled").checked;
  const low = Number(document.querySelector("#mood-low").value);
  const high = Number(document.querySelector("#mood-high").value);
  const hasDraftPhoto = state.draftHasPhoto && state.draftPhoto;
  const record = {
    ...previous,
    date,
    note: document.querySelector("#entry-note").value.trim(),
    moodLow: moodEnabled ? Math.min(low, high) : null,
    moodHigh: moodEnabled ? Math.max(low, high) : null,
    hasPhoto: Boolean(hasDraftPhoto),
  };
  if (hasDraftPhoto) await dbRequest("photos", "put", { date, blob: state.draftPhoto });
  else await dbRequest("photos", "delete", date);
  await dbRequest("records", "put", record);
  await loadData();
  entryDialog.close();
  showToast("היום נשמר ביומן");
  await render();
}

async function saveHabit(event) {
  event.preventDefault();
  const name = document.querySelector("#habit-name").value.trim();
  if (!name) return;
  const habit = { id: crypto.randomUUID(), name };
  await dbRequest("habits", "put", habit);
  await loadData();
  habitDialog.close();
  habitForm.reset();
  await render();
  showToast("ההרגל נוסף");
}

async function toggleHabit(id, isChecked) {
  const record = recordFor(state.habitDate);
  const checked = new Set(record.checkedHabits || []);
  if (isChecked) checked.add(id);
  else checked.delete(id);
  record.checkedHabits = [...checked];
  await dbRequest("records", "put", record);
  await loadData();
  await render();
}

async function deleteHabit(id) {
  await dbRequest("habits", "delete", id);
  await loadData();
  await render();
  showToast("ההרגל הוסר");
}

async function saveWeight(event) {
  event.preventDefault();
  const input = document.querySelector("#weight-value");
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0 || value >= 1000) {
    input.focus();
    showToast("נא להזין משקל תקין בקילוגרמים");
    return;
  }
  const record = recordFor(state.weightDate);
  record.weightKg = Math.round(value * 10) / 10;
  await dbRequest("records", "put", record);
  await loadData();
  await render();
  showToast("המשקל נשמר");
}

async function removeWeight() {
  const record = recordFor(state.weightDate);
  record.weightKg = null;
  await dbRequest("records", "put", record);
  await loadData();
  await render();
  showToast("רישום המשקל הוסר");
}

function reportError(error) {
  console.error(error);
  showToast(error?.message || "משהו השתבש. נסו שוב.");
}

document.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) return setActiveTab(tabButton.dataset.tab);
  const action = event.target.closest("[data-action]");
  if (action) {
    if (action.dataset.action === "edit-entry") showEntryEditor(action.dataset.date).catch(reportError);
    if (action.dataset.action === "add-habit") habitDialog.showModal();
    if (action.dataset.action === "delete-habit") deleteHabit(action.dataset.id).catch(reportError);
    if (action.dataset.action === "remove-weight") removeWeight().catch(reportError);
  }
  if (event.target.closest("#header-add")) showEntryEditor(today).catch(reportError);
  if (event.target.closest("#add-selected")) showEntryEditor(state.selectedDate).catch(reportError);
  if (event.target.closest("#export-backup")) exportBackup().catch(reportError);
  if (event.target.closest("#import-backup-button")) backupInput.click();
  if (event.target.closest("#close-entry, #cancel-entry")) entryDialog.close();
  if (event.target.closest("#close-habit, #cancel-habit")) habitDialog.close();
  if (event.target.closest("#remove-photo")) {
    state.draftPhoto = null;
    state.draftHasPhoto = false;
    updatePhotoPreview(null);
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("#entry-date")) {
    if (!target.value || target.value > today) {
      target.value = state.draftDate;
      showToast("אפשר לבחור היום או תאריך שעבר.");
    } else {
      loadEntryEditor(target.value).catch(reportError);
    }
  }
  if (target.matches("#mood-enabled")) document.querySelector("#mood-fields").disabled = !target.checked;
  if (target.matches("#mood-low")) {
    const high = document.querySelector("#mood-high");
    if (Number(target.value) > Number(high.value)) high.value = target.value;
    document.querySelector("#mood-low-value").value = target.value;
    document.querySelector("#mood-high-value").value = high.value;
  }
  if (target.matches("#mood-high")) {
    const low = document.querySelector("#mood-low");
    if (Number(target.value) < Number(low.value)) low.value = target.value;
    document.querySelector("#mood-high-value").value = target.value;
    document.querySelector("#mood-low-value").value = low.value;
  }
  if (target.matches("#journal-date")) {
    state.selectedDate = target.value || today;
  }
  if (target.matches("#habit-date")) {
    state.habitDate = target.value || today;
    render().catch(reportError);
  }
  if (target.matches("#weight-date")) {
    state.weightDate = target.value || today;
    render().catch(reportError);
  }
  if (target.matches("[data-action='toggle-habit']")) toggleHabit(target.dataset.id, target.checked).catch(reportError);
  if (target.matches("#photo-input")) {
    const [file] = target.files || [];
    if (!file) return;
    imageAsJPEG(file).then((blob) => {
      state.draftPhoto = blob;
      state.draftHasPhoto = true;
      updatePhotoPreview(blob);
      target.value = "";
    }).catch(reportError);
  }
  if (target.matches("#backup-file")) {
    const [file] = target.files || [];
    importBackupFile(file).catch(reportError).finally(() => { target.value = ""; });
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#entry-note")) document.querySelector("#note-count").textContent = `${event.target.value.length}/180`;
  if (event.target.matches("#mood-low")) {
    const high = document.querySelector("#mood-high");
    if (Number(event.target.value) > Number(high.value)) high.value = event.target.value;
    document.querySelector("#mood-low-value").value = event.target.value;
    document.querySelector("#mood-high-value").value = high.value;
  }
  if (event.target.matches("#mood-high")) {
    const low = document.querySelector("#mood-low");
    if (Number(event.target.value) < Number(low.value)) low.value = event.target.value;
    document.querySelector("#mood-high-value").value = event.target.value;
    document.querySelector("#mood-low-value").value = low.value;
  }
});

entryForm.addEventListener("submit", (event) => saveEntry(event).catch(reportError));
habitForm.addEventListener("submit", (event) => saveHabit(event).catch(reportError));
document.addEventListener("submit", (event) => {
  if (event.target.matches("#weight-form")) saveWeight(event).catch(reportError);
});
entryDialog.addEventListener("close", () => {
  if (state.draftPreviewURL) URL.revokeObjectURL(state.draftPreviewURL);
  state.draftPreviewURL = null;
});

async function start() {
  try {
    await loadData();
    await render();
  } catch (error) {
    reportError(error);
    view.innerHTML = `<div class="empty-state"><h2>היומן לא נפתח</h2><p>בדקו שהדפדפן מאפשר אחסון מקומי, ונסו לטעון מחדש.</p></div>`;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline setup failed", error));
}

start();
