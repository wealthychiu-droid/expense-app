// app.js - UI logic for the expense tracker

let state = {
  categories: [],
  accounts: [],
  recipients: [],
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

function todayStr() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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

// ---------- Bottom sheet open/close ----------
function openSheet(editTxn) {
  state.editingId = editTxn ? editTxn.id : null;
  state.sheetType = editTxn ? editTxn.type : 'expense';
  state.selectedCategoryId = editTxn && editTxn.categoryId ? editTxn.categoryId : null;
  state.selectedRecipientIds = editTxn && editTxn.recipientIds ? editTxn.recipientIds.slice() : [];

  setSheetTypeButtons(state.sheetType);
  updateSheetFieldVisibility();
  renderCategoryGrid();
  renderRecipientRow();
  renderAccountSelect();

  if (editTxn) {
    $('#amountInput').value = editTxn.amount;
    $('#merchantInput').value = editTxn.merchant || '';
    $('#itemNameInput').value = editTxn.itemName || '';
    $('#noteInput').value = editTxn.note || '';
    $('#accountSelect').value = editTxn.accountId || '';
    $('#dateInput').value = editTxn.date || todayStr();
    $('#deleteBtn').hidden = false;
  } else {
    $('#amountInput').value = '';
    $('#merchantInput').value = '';
    $('#itemNameInput').value = '';
    $('#noteInput').value = '';
    $('#dateInput').value = todayStr();
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
  $$('#sheetTypeToggle .type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
}

function updateSheetFieldVisibility() {
  const t = state.sheetType;
  $('#recipientBlock').hidden = t !== 'expense';
  $('#merchantBlock').hidden = t !== 'expense';
  $('#itemNameBlock').hidden = t !== 'expense';
}

function initSheetTypeToggle() {
  $$('#sheetTypeToggle .type-btn').forEach((btn) => {
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
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'chip-cell' + (state.selectedCategoryId === cat.id ? ' selected' : '');
    cell.innerHTML = `<span class="chip-icon">${cat.name.charAt(0)}</span><span class="chip-name">${escapeHtml(cat.name)}</span>`;
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

function resetRecipientDefault() {
  const defaultR = state.recipients.find((r) => r.isDefault);
  state.selectedRecipientIds = defaultR ? [defaultR.id] : [];
}

async function refreshMerchantList() {
  const txns = await DB.getAll('transactions');
  const counts = {};
  txns.forEach((t) => {
    if (t.isDeleted || t.type !== 'expense' || !t.merchant) return;
    counts[t.merchant] = (counts[t.merchant] || 0) + 1;
  });
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 30);
  $('#merchantList').innerHTML = sorted.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
}

async function updateMonthSummary() {
  const txns = await DB.getAll('transactions');
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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

  const isNew = !state.editingId;
  const id = state.editingId || DB.uuid();
  if (!state.selectedCategoryId) return;

  const txn = {
    id, type: state.sheetType, amount,
    categoryId: state.selectedCategoryId,
    recipientIds: state.sheetType === 'expense' ? state.selectedRecipientIds.slice() : [],
    accountId: $('#accountSelect').value,
    merchant: state.sheetType === 'expense' ? $('#merchantInput').value.trim() : '',
    itemName: state.sheetType === 'expense' ? $('#itemNameInput').value.trim() : '',
    note: $('#noteInput').value.trim(),
    date: $('#dateInput').value || todayStr(),
    updatedAt: Date.now(), deviceId: DB.deviceId(), isDeleted: false,
  };

  await DB.put('transactions', txn);
  await refreshMerchantList();
  await updateMonthSummary();
  await renderHistory();

  const toast = $('#saveToast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1200);

  if (isNew) {
    // stay open, clear only the free-text fields, for fast consecutive entries
    $('#amountInput').value = '';
    $('#merchantInput').value = '';
    $('#itemNameInput').value = '';
    $('#noteInput').value = '';
    $('#amountInput').focus();
  } else {
    closeSheet();
  }
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
}

// ---------- Home feed ----------
async function renderHistory() {
  const txns = (await DB.getAll('transactions')).filter((t) => !t.isDeleted);
  txns.sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));

  const catMap = Object.fromEntries(state.categories.map((c) => [c.id, c]));
  const accMap = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  const recMap = Object.fromEntries(state.recipients.map((r) => [r.id, r]));

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
      label.textContent = t.date;
      list.appendChild(label);
    }

    const row = document.createElement('div');
    row.className = 'history-row';

    const cat = catMap[t.categoryId];
    const acc = accMap[t.accountId];
    const recipientNames = (t.recipientIds || []).map((id) => recMap[id] && recMap[id].name).filter(Boolean).join('、');
    const title = t.itemName || (cat ? cat.name : '');
    const subParts = [acc ? acc.name : '', recipientNames, t.merchant].filter(Boolean);
    row.innerHTML = `
      <div class="history-row-left">
        <div class="history-row-icon">${cat ? cat.name.charAt(0) : '?'}</div>
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
function renderManagerList(containerSel, storeName, items) {
  const container = $(containerSel);
  container.innerHTML = '';
  const sorted = items.slice().sort((a, b) => a.order - b.order);

  sorted.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'manager-row';

    const reorderBox = document.createElement('div');
    reorderBox.className = 'reorder-btns';
    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'reorder-btn'; upBtn.textContent = '▲';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', async () => {
      const other = sorted[idx - 1];
      const tmp = item.order; item.order = other.order; other.order = tmp;
      await DB.put(storeName, item); await DB.put(storeName, other);
      await refreshAllLists(); renderManagers();
    });
    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.className = 'reorder-btn'; downBtn.textContent = '▼';
    downBtn.disabled = idx === sorted.length - 1;
    downBtn.addEventListener('click', async () => {
      const other = sorted[idx + 1];
      const tmp = item.order; item.order = other.order; other.order = tmp;
      await DB.put(storeName, item); await DB.put(storeName, other);
      await refreshAllLists(); renderManagers();
    });
    reorderBox.appendChild(upBtn); reorderBox.appendChild(downBtn);

    const name = document.createElement('div');
    name.className = 'manager-row-name';
    name.contentEditable = 'true';
    name.textContent = item.name;
    name.addEventListener('blur', async () => {
      const newName = name.textContent.trim();
      if (newName && newName !== item.name) {
        item.name = newName;
        await DB.put(storeName, item);
        await refreshAllLists();
        renderManagers();
      } else {
        name.textContent = item.name;
      }
    });

    const defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'default-btn' + (item.isDefault ? ' is-default' : '');
    defaultBtn.textContent = item.isDefault ? '預設' : '設為預設';
    defaultBtn.addEventListener('click', async () => {
      for (const other of items) {
        if (other.isDefault && other.id !== item.id) {
          other.isDefault = false;
          await DB.put(storeName, other);
        }
      }
      item.isDefault = true;
      await DB.put(storeName, item);
      await refreshAllLists();
      renderManagers();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-btn';
    delBtn.textContent = '刪除';
    delBtn.addEventListener('click', async () => {
      if (items.length <= 1) {
        alert('至少要保留一個');
        return;
      }
      if (confirm(`刪除「${item.name}」？（已記錄的舊資料不會受影響）`)) {
        await DB.delete(storeName, item.id);
        await refreshAllLists();
        renderManagers();
      }
    });

    row.appendChild(reorderBox);
    row.appendChild(name);
    row.appendChild(defaultBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function renderManagers() {
  renderManagerList('#expenseCategoryManager', 'categories', state.categories.filter((c) => c.type === 'expense'));
  renderManagerList('#incomeCategoryManager', 'categories', state.categories.filter((c) => c.type === 'income'));
  renderManagerList('#accountManager', 'accounts', state.accounts);
  renderManagerList('#recipientManager', 'recipients', state.recipients);
}

function initAddButtons() {
  const addPairs = [
    ['#addExpenseCategoryBtn', '#newExpenseCategoryInput', 'categories', { type: 'expense' }],
    ['#addIncomeCategoryBtn', '#newIncomeCategoryInput', 'categories', { type: 'income' }],
    ['#addAccountBtn', '#newAccountInput', 'accounts', {}],
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
      await DB.put(storeName, { id: DB.uuid(), name, order: maxOrder + 1, isDefault: list.length === 0, ...extra });
      input.value = '';
      await refreshAllLists();
      renderManagers();
    });
  });
}

// ---------- Data loading ----------
async function loadLists() {
  const [categories, accounts, recipients] = await Promise.all([
    DB.getAll('categories'),
    DB.getAll('accounts'),
    DB.getAll('recipients'),
  ]);
  state.categories = categories;
  state.accounts = accounts;
  state.recipients = recipients;
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

// ---------- Init ----------
async function init() {
  await DB.seedDefaults();
  await loadLists();

  initTabs();
  initSheetTypeToggle();
  initAddButtons();
  updateSheetFieldVisibility();

  await refreshMerchantList();
  await updateMonthSummary();
  await renderHistory();

  $('#fabAdd').addEventListener('click', () => openSheet(null));
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  $('#saveBtn').addEventListener('click', handleSave);
  $('#deleteBtn').addEventListener('click', handleDelete);

  window.addEventListener('online', () => {
    $('#syncIndicator').classList.add('online');
    $('#syncStatusText').textContent = '線上';
  });
  window.addEventListener('offline', () => {
    $('#syncIndicator').classList.remove('online');
    $('#syncStatusText').textContent = '離線';
  });
  if (navigator.onLine) {
    $('#syncIndicator').classList.add('online');
    $('#syncStatusText').textContent = '線上';
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
