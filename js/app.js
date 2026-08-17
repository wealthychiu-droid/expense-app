// app.js - UI logic for the expense tracker

const APP_VERSION = 'v16';

const CATEGORY_COLORS = [
  { bg: '#fde2e2', fg: '#8f2020' }, // red
  { bg: '#fde9d2', fg: '#8a4a06' }, // orange
  { bg: '#fdf3c4', fg: '#7a5f00' }, // yellow
  { bg: '#e0f3df', fg: '#1f6b2b' }, // green
  { bg: '#dcefee', fg: '#0e6b63' }, // teal
  { bg: '#dce8fb', fg: '#1c4c9c' }, // blue
  { bg: '#e6def8', fg: '#4b2e83' }, // purple
  { bg: '#fbdff0', fg: '#92195e' }, // pink
  { bg: '#ece4d8', fg: '#5c4a30' }, // brown
  { bg: '#e2e2e2', fg: '#3a3a3a' }, // gray
];

let state = {
  categories: [],
  accounts: [],
  recipients: [],
  merchants: [],
  sheetType: 'expense',
  selectedCategoryId: null,
  selectedRecipientIds: [],
  editingId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmtMoney(n) {
  return Math.round(n).toLocaleString('zh-Hant-TW');
}

function pad2(x) { return String(x).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateStrForOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function weekdayChar(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];
}

function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = weekdayChar(dateStr);
  let suffix = '';
  if (dateStr === todayStr()) suffix = '（今天）';
  else if (dateStr === dateStrForOffset(-1)) suffix = '（昨天）';
  else if (dateStr === dateStrForOffset(-2)) suffix = '（前天）';
  return `${y}年${m}月${d}日 星期${weekday}${suffix}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function categoryColor(colorIndex) {
  if (colorIndex === undefined || colorIndex === null) colorIndex = 0;
  return CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length];
}

// ---------- Tab navigation ----------
function initTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + tab));
      if (tab === 'settings') renderManagers();
    });
  });
}

// ---------- Date picker ----------
function setSelectedDate(dateStr) {
  $('#dateInput').value = dateStr;
  $('#dateSelectedLabel').textContent = formatDateLabel(dateStr);
  updateDateChipHighlight();
}

function updateDateChipHighlight() {
  const val = $('#dateInput').value;
  $$('.date-chip[data-offset]').forEach((btn) => {
    const off = parseInt(btn.dataset.offset, 10);
    btn.classList.toggle('selected', dateStrForOffset(off) === val);
  });
  const isQuickPick = [0, -1, -2].some((off) => dateStrForOffset(off) === val);
  $('#dateCalendarLabel').classList.toggle('selected', !isQuickPick);
}

function initDatePicker() {
  $$('.date-chip[data-offset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSelectedDate(dateStrForOffset(parseInt(btn.dataset.offset, 10)));
    });
  });
  $('#dateCalendarInput').addEventListener('change', (e) => {
    if (e.target.value) setSelectedDate(e.target.value);
  });
}

// ---------- Bottom sheet open/close ----------
function openSheet(editTxn) {
  $('#sheetConfirmArea').hidden = true;
  $('#sheetFormArea').hidden = false;

  state.editingId = editTxn ? editTxn.id : null;
  state.sheetType = editTxn ? editTxn.type : 'expense';
  state.selectedCategoryId = editTxn && editTxn.categoryId ? editTxn.categoryId : null;
  state.selectedRecipientIds = editTxn && editTxn.recipientIds ? editTxn.recipientIds.slice() : [];

  setSheetTypeButtons(state.sheetType);
  updateSheetFieldVisibility();
  renderCategoryGrid();
  renderRecipientRow();
  renderAccountSelect();
  renderMerchantSelect();

  if (editTxn) {
    $('#amountInput').value = editTxn.amount;
    $('#itemNameInput').value = editTxn.itemName || '';
    $('#noteInput').value = editTxn.note || '';
    $('#accountSelect').value = editTxn.accountId || '';
    $('#merchantSelect').value = editTxn.merchantId || '';
    setSelectedDate(editTxn.date || todayStr());
    $('#deleteBtn').hidden = false;
  } else {
    $('#amountInput').value = '';
    $('#itemNameInput').value = '';
    $('#noteInput').value = '';
    $('#merchantSelect').value = '';
    setSelectedDate(todayStr());
    resetRecipientDefault();
    renderRecipientRow();
    renderAccountSelect();
    $('#deleteBtn').hidden = true;
  }

  $('#sheetBackdrop').hidden = false;
  $('#entrySheet').hidden = false;
  if (!editTxn) $('#amountInput').focus();
}

function closeSheet() {
  $('#sheetBackdrop').hidden = true;
  $('#entrySheet').hidden = true;
  state.editingId = null;
}

function setSheetTypeButtons(type) {
  $$('#sheetTypeToggle .type-btn-v').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
}

function updateSheetFieldVisibility() {
  const t = state.sheetType;
  $('#recipientBlock').hidden = t !== 'expense';
  $('#merchantBlock').hidden = t !== 'expense';
  $('#itemNameBlock').hidden = t !== 'expense';
}

function initSheetTypeToggle() {
  $$('#sheetTypeToggle .type-btn-v').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sheetType = btn.dataset.type;
      state.selectedCategoryId = null;
      setSheetTypeButtons(state.sheetType);
      updateSheetFieldVisibility();
      renderCategoryGrid();
    });
  });
}

// ---------- Field rendering ----------
function renderCategoryGrid() {
  const grid = $('#categoryGrid');
  grid.innerHTML = '';

  const list = state.categories
    .filter((c) => c.type === state.sheetType)
    .slice()
    .sort((a, b) => a.order - b.order);

  list.forEach((cat) => {
    const color = categoryColor(cat.colorIndex);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'chip-cell' + (state.selectedCategoryId === cat.id ? ' selected' : '');
    cell.innerHTML = `<span class="chip-icon" style="background:${color.bg};color:${color.fg};">${cat.name.charAt(0)}</span><span class="chip-name">${escapeHtml(cat.name)}</span>`;
    cell.addEventListener('click', () => {
      state.selectedCategoryId = cat.id;
      renderCategoryGrid();
    });
    grid.appendChild(cell);
  });

  if (!state.selectedCategoryId && list.length > 0) {
    state.selectedCategoryId = list[0].id;
    renderCategoryGrid();
  }
}

function renderRecipientRow() {
  const row = $('#recipientRow');
  row.innerHTML = '';
  state.recipients
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((r) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'chip-pill' + (state.selectedRecipientIds.includes(r.id) ? ' selected' : '');
      pill.textContent = r.name;
      pill.addEventListener('click', () => {
        const idx = state.selectedRecipientIds.indexOf(r.id);
        if (idx >= 0) state.selectedRecipientIds.splice(idx, 1);
        else state.selectedRecipientIds.push(r.id);
        renderRecipientRow();
      });
      row.appendChild(pill);
    });
}

function renderAccountSelect() {
  const sel = $('#accountSelect');
  const prevValue = sel.value;
  sel.innerHTML = '';
  state.accounts
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      sel.appendChild(opt);
    });
  const defaultAcc = state.accounts.find((a) => a.isDefault);
  if (prevValue && state.accounts.some((a) => a.id === prevValue)) sel.value = prevValue;
  else if (defaultAcc) sel.value = defaultAcc.id;
}

function renderMerchantSelect() {
  const sel = $('#merchantSelect');
  const prevValue = sel.value;
  const options = state.merchants
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
    .join('');
  sel.innerHTML = `<option value="">商家（選填）</option>${options}`;
  if (prevValue && state.merchants.some((m) => m.id === prevValue)) sel.value = prevValue;
}

function resetRecipientDefault() {
  const defaultR = state.recipients.find((r) => r.isDefault);
  state.selectedRecipientIds = defaultR ? [defaultR.id] : [];
}

async function updateMonthSummary() {
  const txns = await DB.getAll('transactions');
  const now = new Date();
  const ym = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  let expense = 0, income = 0;
  txns.forEach((t) => {
    if (t.isDeleted) return;
    if (!t.date || !t.date.startsWith(ym)) return;
    if (t.type === 'expense') expense += t.amount;
    if (t.type === 'income') income += t.amount;
  });
  $('#sumExpense').textContent = `$${fmtMoney(expense)}`;
  $('#sumIncome').textContent = `$${fmtMoney(income)}`;
  $('#sumBalance').textContent = `$${fmtMoney(income - expense)}`;
}

// ---------- Save / Delete ----------
async function handleSave() {
  const amount = parseFloat($('#amountInput').value);
  if (!amount || amount <= 0) {
    $('#amountInput').focus();
    return;
  }
  if (!state.selectedCategoryId) return;

  const isNew = !state.editingId;
  const id = state.editingId || DB.uuid();

  const txn = {
    id, type: state.sheetType, amount,
    categoryId: state.selectedCategoryId,
    recipientIds: state.sheetType === 'expense' ? state.selectedRecipientIds.slice() : [],
    accountId: $('#accountSelect').value,
    merchantId: state.sheetType === 'expense' ? $('#merchantSelect').value : '',
    itemName: state.sheetType === 'expense' ? $('#itemNameInput').value.trim() : '',
    note: $('#noteInput').value.trim(),
    date: $('#dateInput').value || todayStr(),
    updatedAt: Date.now(), deviceId: DB.deviceId(), isDeleted: false,
  };

  await DB.put('transactions', txn);
  await updateMonthSummary();
  await renderHistory();
  maybeSync();

  if (isNew) {
    $('#sheetFormArea').hidden = true;
    $('#sheetConfirmArea').hidden = false;
  } else {
    closeSheet();
  }
}

function continueEntering() {
  $('#sheetConfirmArea').hidden = true;
  $('#sheetFormArea').hidden = false;
  // clear the fields that change every time; keep date/category/account/recipients/merchant
  // sticky so consecutive entries of a similar kind are fast
  $('#amountInput').value = '';
  $('#itemNameInput').value = '';
  $('#noteInput').value = '';
  $('#amountInput').focus();
}

async function handleDelete() {
  if (!state.editingId) return;
  if (!confirm('刪除這筆紀錄嗎？')) return;
  const txn = await DB.get('transactions', state.editingId);
  if (txn) {
    txn.isDeleted = true;
    txn.updatedAt = Date.now();
    await DB.put('transactions', txn);
  }
  closeSheet();
  await updateMonthSummary();
  await renderHistory();
  maybeSync();
}

// ---------- Home feed ----------
async function renderHistory() {
  const txns = (await DB.getAll('transactions')).filter((t) => !t.isDeleted);
  txns.sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));

  const catMap = Object.fromEntries(state.categories.map((c) => [c.id, c]));
  const accMap = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  const recMap = Object.fromEntries(state.recipients.map((r) => [r.id, r]));
  const merchMap = Object.fromEntries(state.merchants.map((m) => [m.id, m]));

  const list = $('#historyList');
  const empty = $('#historyEmpty');
  list.innerHTML = '';

  if (txns.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  let lastDate = null;
  txns.forEach((t) => {
    if (t.date !== lastDate) {
      lastDate = t.date;
      const label = document.createElement('div');
      label.className = 'history-date-label';
      label.textContent = `${t.date}（星期${weekdayChar(t.date)}）`;
      list.appendChild(label);
    }

    const cat = catMap[t.categoryId];
    const acc = accMap[t.accountId];
    const merchant = merchMap[t.merchantId];
    const recipientNames = (t.recipientIds || []).map((id) => recMap[id] && recMap[id].name).filter(Boolean).join('、');
    const title = t.itemName || (cat ? cat.name : '');
    const subParts = [acc ? acc.name : '', recipientNames, merchant ? merchant.name : ''].filter(Boolean);
    const color = categoryColor(cat ? cat.colorIndex : 0);

    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <div class="history-row-left">
        <div class="history-row-icon" style="background:${color.bg};color:${color.fg};">${cat ? cat.name.charAt(0) : '?'}</div>
        <div>
          <div class="history-row-title">${escapeHtml(title)}</div>
          <div class="history-row-sub">${escapeHtml(subParts.join(' · '))}</div>
        </div>
      </div>
      <div class="history-row-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${fmtMoney(t.amount)}</div>
    `;
    row.addEventListener('click', () => openSheet(t));
    list.appendChild(row);
  });
}

// ---------- Settings managers ----------
function renderManagerList(containerSel, storeName, items, opts) {
  opts = opts || {};
  const showDefault = opts.showDefault !== false;
  const container = $(containerSel);
  container.innerHTML = '';
  const sorted = items.slice().sort((a, b) => a.order - b.order);

  sorted.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'manager-row';

    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'reorder-btn'; upBtn.textContent = '▲';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', async () => {
      try {
        await moveItemOrder(storeName, sorted, idx, idx - 1);
        await refreshAllLists(); renderManagers();
      } catch (err) {
        alert('排序發生錯誤（上移）：' + (err && err.message ? err.message : err));
      }
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.className = 'reorder-btn'; downBtn.textContent = '▼';
    downBtn.disabled = idx === sorted.length - 1;
    downBtn.addEventListener('click', async () => {
      try {
        await moveItemOrder(storeName, sorted, idx, idx + 1);
        await refreshAllLists(); renderManagers();
      } catch (err) {
        alert('排序發生錯誤（下移）：' + (err && err.message ? err.message : err));
      }
    });

    const name = document.createElement('div');
    name.className = 'manager-row-name';
    name.contentEditable = 'true';
    name.textContent = item.name;
    name.addEventListener('blur', async () => {
      const newName = name.textContent.trim();
      if (newName && newName !== item.name) {
        item.name = newName;
        item.updatedAt = Date.now();
        await DB.put(storeName, item);
        await refreshAllLists();
        renderManagers();
      } else {
        name.textContent = item.name;
      }
    });

    row.appendChild(upBtn);
    row.appendChild(name);
    row.appendChild(downBtn);

    if (showDefault) {
      const defaultBtn = document.createElement('button');
      defaultBtn.type = 'button';
      defaultBtn.className = 'default-btn' + (item.isDefault ? ' is-default' : '');
      defaultBtn.textContent = item.isDefault ? '預設' : '設為預設';
      defaultBtn.addEventListener('click', async () => {
        for (const other of items) {
          if (other.isDefault && other.id !== item.id) {
            other.isDefault = false;
            other.updatedAt = Date.now();
            await DB.put(storeName, other);
          }
        }
        item.isDefault = true;
        item.updatedAt = Date.now();
        await DB.put(storeName, item);
        await refreshAllLists();
        renderManagers();
      });
      row.appendChild(defaultBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-btn';
    delBtn.textContent = '刪除';
    delBtn.addEventListener('click', async () => {
      if (showDefault && items.length <= 1) {
        alert('至少要保留一個');
        return;
      }
      if (confirm(`刪除「${item.name}」？（已記錄的舊資料不會受影響）`)) {
        item.isDeleted = true;
        item.updatedAt = Date.now();
        await DB.put(storeName, item);
        await refreshAllLists();
        renderManagers();
      }
    });
    row.appendChild(delBtn);

    container.appendChild(row);
  });
}

function renderManagers() {
  renderManagerList('#expenseCategoryManager', 'categories', state.categories.filter((c) => c.type === 'expense'));
  renderManagerList('#incomeCategoryManager', 'categories', state.categories.filter((c) => c.type === 'income'));
  renderManagerList('#accountManager', 'accounts', state.accounts);
  renderManagerList('#merchantManager', 'merchants', state.merchants, { showDefault: false });
  renderManagerList('#recipientManager', 'recipients', state.recipients);
}

function initAddButtons() {
  const addPairs = [
    ['#addExpenseCategoryBtn', '#newExpenseCategoryInput', 'categories', { type: 'expense' }],
    ['#addIncomeCategoryBtn', '#newIncomeCategoryInput', 'categories', { type: 'income' }],
    ['#addAccountBtn', '#newAccountInput', 'accounts', {}],
    ['#addMerchantBtn', '#newMerchantInput', 'merchants', {}],
    ['#addRecipientBtn', '#newRecipientInput', 'recipients', {}],
  ];
  addPairs.forEach(([btnSel, inputSel, storeName, extra]) => {
    $(btnSel).addEventListener('click', async () => {
      const input = $(inputSel);
      const name = input.value.trim();
      if (!name) return;
      const list = storeName === 'categories'
        ? state.categories.filter((c) => c.type === extra.type)
        : state[storeName];
      const maxOrder = list.reduce((m, x) => Math.max(m, x.order), -1);
      const record = { id: DB.uuid(), name, order: maxOrder + 1, updatedAt: Date.now(), isDeleted: false, ...extra };
      if (storeName === 'categories') {
        const totalCatCount = state.categories.length;
        record.colorIndex = totalCatCount % CATEGORY_COLORS.length;
      }
      if (storeName !== 'merchants') record.isDefault = list.length === 0;
      await DB.put(storeName, record);
      input.value = '';
      await refreshAllLists();
      renderManagers();
    });
  });
}

// ---------- Data loading & migration ----------
async function loadLists() {
  const [categories, accounts, recipients, merchants] = await Promise.all([
    DB.getAll('categories'),
    DB.getAll('accounts'),
    DB.getAll('recipients'),
    DB.getAll('merchants'),
  ]);
  state.categories = categories.filter((c) => !c.isDeleted);
  state.accounts = accounts.filter((a) => !a.isDeleted);
  state.recipients = recipients.filter((r) => !r.isDeleted);
  state.merchants = merchants.filter((m) => !m.isDeleted);
}

async function refreshAllLists() {
  await loadLists();
  if (state.selectedCategoryId && !state.categories.some((c) => c.id === state.selectedCategoryId)) {
    state.selectedCategoryId = null;
  }
  state.selectedRecipientIds = state.selectedRecipientIds.filter((id) =>
    state.recipients.some((r) => r.id === id)
  );
}

async function migrateCategoryColors() {
  const categories = await DB.getAll('categories');
  const sorted = categories.slice().sort((a, b) => a.order - b.order);
  let idx = 0;
  for (const c of sorted) {
    if (c.colorIndex === undefined || c.colorIndex === null) {
      c.colorIndex = idx % CATEGORY_COLORS.length;
      c.updatedAt = Date.now();
      await DB.put('categories', c);
    }
    idx++;
  }
}

async function migrateMerchantsFromLegacyField() {
  const merchants = await DB.getAll('merchants');
  const merchantByName = new Map(merchants.map((m) => [m.name, m]));
  let maxOrder = merchants.reduce((m, x) => Math.max(m, x.order), -1);
  const txns = await DB.getAll('transactions');
  for (const t of txns) {
    if (t.merchantId !== undefined) continue; // already migrated
    if (t.merchant && String(t.merchant).trim()) {
      const name = String(t.merchant).trim();
      let rec = merchantByName.get(name);
      if (!rec) {
        rec = { id: DB.uuid(), name, order: ++maxOrder, updatedAt: Date.now(), isDeleted: false };
        merchantByName.set(name, rec);
        await DB.put('merchants', rec);
      }
      t.merchantId = rec.id;
    } else {
      t.merchantId = '';
    }
    await DB.put('transactions', t);
  }
}

async function mergeDuplicatesForStore(storeName, items) {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.name)) groups.set(item.name, []);
    groups.get(item.name).push(item);
  });
  const idRemap = new Map();
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => (a.order - b.order) || ((a.updatedAt || 0) - (b.updatedAt || 0)));
    const keeper = group[0];
    for (let i = 1; i < group.length; i++) {
      const dup = group[i];
      idRemap.set(dup.id, keeper.id);
      dup.isDeleted = true;
      dup.updatedAt = Date.now();
      await DB.put(storeName, dup);
    }
  }
  return idRemap;
}

async function cleanupDuplicates() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.isDeleted);
  const accounts = (await DB.getAll('accounts')).filter((a) => !a.isDeleted);
  const recipients = (await DB.getAll('recipients')).filter((r) => !r.isDeleted);
  const merchants = (await DB.getAll('merchants')).filter((m) => !m.isDeleted);

  const remapExpense = await mergeDuplicatesForStore('categories', categories.filter((c) => c.type === 'expense'));
  const remapIncome = await mergeDuplicatesForStore('categories', categories.filter((c) => c.type === 'income'));
  const catRemap = new Map([...remapExpense, ...remapIncome]);
  const accRemap = await mergeDuplicatesForStore('accounts', accounts);
  const recRemap = await mergeDuplicatesForStore('recipients', recipients);
  const merRemap = await mergeDuplicatesForStore('merchants', merchants);

  const mergedCount = catRemap.size + accRemap.size + recRemap.size + merRemap.size;

  const txns = await DB.getAll('transactions');
  let txnChangedCount = 0;
  for (const t of txns) {
    let changed = false;
    if (t.categoryId && catRemap.has(t.categoryId)) { t.categoryId = catRemap.get(t.categoryId); changed = true; }
    if (t.accountId && accRemap.has(t.accountId)) { t.accountId = accRemap.get(t.accountId); changed = true; }
    if (t.merchantId && merRemap.has(t.merchantId)) { t.merchantId = merRemap.get(t.merchantId); changed = true; }
    if (t.recipientIds && t.recipientIds.length) {
      const newIds = Array.from(new Set(t.recipientIds.map((id) => (recRemap.has(id) ? recRemap.get(id) : id))));
      if (JSON.stringify(newIds) !== JSON.stringify(t.recipientIds)) { t.recipientIds = newIds; changed = true; }
    }
    if (changed) {
      t.updatedAt = Date.now();
      await DB.put('transactions', t);
      txnChangedCount++;
    }
  }

  await refreshAllLists();
  renderManagers();
  await updateMonthSummary();
  await renderHistory();
  return { mergedCount, txnChangedCount };
}

async function moveItemOrder(storeName, sortedArr, fromIdx, toIdx) {
  const reordered = sortedArr.slice();
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  const now = Date.now();
  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].order !== i) {
      reordered[i].order = i;
      reordered[i].updatedAt = now;
      await DB.put(storeName, reordered[i]);
    }
  }
}

async function normalizeOrderForList(storeName, items) {
  const sorted = items.slice().sort((a, b) =>
    (a.order - b.order) || ((a.updatedAt || 0) - (b.updatedAt || 0)) || String(a.id).localeCompare(String(b.id))
  );
  const now = Date.now();
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].order !== i) {
      sorted[i].order = i;
      sorted[i].updatedAt = now;
      await DB.put(storeName, sorted[i]);
    }
  }
}

async function normalizeAllOrders() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.isDeleted);
  const accounts = (await DB.getAll('accounts')).filter((a) => !a.isDeleted);
  const recipients = (await DB.getAll('recipients')).filter((r) => !r.isDeleted);
  const merchants = (await DB.getAll('merchants')).filter((m) => !m.isDeleted);
  await normalizeOrderForList('categories', categories.filter((c) => c.type === 'expense'));
  await normalizeOrderForList('categories', categories.filter((c) => c.type === 'income'));
  await normalizeOrderForList('accounts', accounts);
  await normalizeOrderForList('recipients', recipients);
  await normalizeOrderForList('merchants', merchants);
}

// ---------- Google Drive sync UI ----------
function updateDriveStatusUI() {
  const connected = Drive.isConnected();
  $('#driveConnectBtn').hidden = connected;
  $('#driveSyncBtn').hidden = !connected;
  $('#driveDisconnectBtn').hidden = !connected;
  $('#driveStatusBadge').textContent = connected ? '已連接' : '尚未連接';
  $('#driveStatusBadge').classList.toggle('badge-muted', !connected);
  const last = Drive.lastSyncAt();
  $('#driveLastSync').textContent = last ? '上次同步：' + new Date(last).toLocaleString('zh-Hant-TW') : '';
  $('#driveAccountEmail').textContent = connected ? Drive.accountEmail() : '';
  $('#syncStatusText').textContent = navigator.onLine ? (connected ? '線上' : '離線儲存') : '離線';
}

async function afterSyncRefresh() {
  await refreshAllLists();
  if (!$('#pane-settings').classList.contains('active')) {
    renderManagers();
  }
  await updateMonthSummary();
  await renderHistory();
  updateDriveStatusUI();
}

async function performSync(silent) {
  if (!Drive.isConnected() || !navigator.onLine) return;
  $('#syncIndicator').classList.add('syncing');
  $('#syncStatusText').textContent = '同步中…';
  try {
    await Drive.sync();
    await afterSyncRefresh();
  } catch (err) {
    console.error('sync failed', err);
    if (!silent) alert('同步失敗，稍後會自動再試一次');
  } finally {
    $('#syncIndicator').classList.remove('syncing');
    updateDriveStatusUI();
  }
}

let syncDebounceTimer = null;
function maybeSync() {
  if (!Drive.isConnected() || !navigator.onLine) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => performSync(true), 900);
}

function initDriveUI() {
  updateDriveStatusUI();

  $('#driveConnectBtn').addEventListener('click', async () => {
    $('#driveConnectBtn').disabled = true;
    $('#driveConnectBtn').textContent = '連接中…';
    try {
      await Drive.connect();
      await afterSyncRefresh();
    } catch (err) {
      alert('連接失敗，請再試一次：' + (err && err.message ? err.message : err));
    } finally {
      $('#driveConnectBtn').disabled = false;
      $('#driveConnectBtn').textContent = '連接 Google Drive';
    }
  });

  $('#driveSyncBtn').addEventListener('click', async () => {
    const btn = $('#driveSyncBtn');
    const original = '立即同步';
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      await performSync(false);
      btn.textContent = '已同步 ✓';
    } catch (e) {
      btn.textContent = original;
    } finally {
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
    }
  });

  $('#driveDisconnectBtn').addEventListener('click', () => {
    if (confirm('解除連接後，這台裝置不會再自動同步，但已同步過的資料不會被刪除。確定嗎？')) {
      Drive.disconnect();
      updateDriveStatusUI();
    }
  });

  window.addEventListener('online', () => performSync(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) performSync(true);
  });

  $('#cleanupDuplicatesBtn').addEventListener('click', async () => {
    if (!confirm('這會合併分類/帳戶/對象/商家裡名稱完全相同的重複項目（保留最早新增的那一筆），並自動修正受影響的交易紀錄。確定要執行嗎？')) return;
    const btn = $('#cleanupDuplicatesBtn');
    btn.disabled = true;
    btn.textContent = '整理中…';
    try {
      const result = await cleanupDuplicates();
      alert(result.mergedCount > 0
        ? `已合併 ${result.mergedCount} 個重複項目，並更新了 ${result.txnChangedCount} 筆交易紀錄。`
        : '沒有找到重複的項目。');
    } finally {
      btn.disabled = false;
      btn.textContent = '清除重複項目';
    }
  });
}

function initPullToRefresh() {
  const indicator = $('#pullIndicator');
  const text = $('#pullIndicatorText');
  const threshold = 60;
  const maxPull = 90;
  let startY = 0;
  let pulling = false;
  let dragging = false;

  document.addEventListener('touchstart', (e) => {
    if (!$('#pane-home').classList.contains('active')) { pulling = false; return; }
    if ((document.scrollingElement || document.documentElement).scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      dragging = false;
    } else {
      pulling = false;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0 && (document.scrollingElement || document.documentElement).scrollTop <= 0) {
      dragging = true;
      e.preventDefault();
      const dist = Math.min(dy * 0.5, maxPull);
      indicator.style.height = dist + 'px';
      text.textContent = dist >= threshold ? '放開以同步' : '下拉重新整理';
    }
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (!pulling || !dragging) { pulling = false; dragging = false; return; }
    const dist = parseInt(indicator.style.height || '0', 10);
    pulling = false;
    dragging = false;
    if (dist >= threshold) {
      indicator.style.height = '40px';
      text.textContent = Drive.isConnected() ? '同步中…' : '離線儲存，無法同步';
      if (Drive.isConnected()) {
        await performSync(false);
        text.textContent = '已同步 ✓';
      }
      setTimeout(() => { indicator.style.height = '0px'; }, 700);
    } else {
      indicator.style.height = '0px';
    }
  });
}

// ---------- Init ----------
async function init() {
  await DB.seedDefaults();
  await migrateCategoryColors();
  await migrateMerchantsFromLegacyField();
  await normalizeAllOrders();
  await loadLists();

  initTabs();
  initDatePicker();
  initSheetTypeToggle();
  initAddButtons();
  initDriveUI();
  initPullToRefresh();
  updateSheetFieldVisibility();
  $('#appVersionText').textContent = APP_VERSION;

  await updateMonthSummary();
  await renderHistory();

  if (Drive.isConnected()) performSync(true);

  $('#fabAdd').addEventListener('click', () => openSheet(null));
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  $('#saveBtn').addEventListener('click', handleSave);
  $('#deleteBtn').addEventListener('click', handleDelete);
  $('#confirmHomeBtn').addEventListener('click', closeSheet);
  $('#confirmAgainBtn').addEventListener('click', continueEntering);

  window.addEventListener('online', () => {
    $('#syncIndicator').classList.add('online');
    updateDriveStatusUI();
  });
  window.addEventListener('offline', () => {
    $('#syncIndicator').classList.remove('online');
    updateDriveStatusUI();
  });
  if (navigator.onLine) $('#syncIndicator').classList.add('online');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('service-worker.js')
      .then((reg) => reg.update())
      .catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
