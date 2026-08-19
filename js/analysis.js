// analysis.js - 統計／趨勢分頁，含日期範圍選擇與明細下鑽
// Reuses globals from app.js: $, $$, fmtMoney, escapeHtml, categoryColor, todayStr, pad2, weekdayChar, state, DB, openSheet

const RANGE_PRESETS = [
  { key: 'all', label: '全部時間' },
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'thisWeek', label: '本週' },
  { key: 'lastWeek', label: '上週' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'thisQuarter', label: '本季' },
  { key: 'thisYear', label: '今年' },
];

const STATS_QUICK_PRESETS = ['thisWeek', 'thisMonth', 'thisQuarter', 'thisYear'];

const DIMENSION_LABELS = { category: '分類', recipient: '對象', merchant: '商家', account: '帳戶' };

function startOfWeekDate(d) {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const r = new Date(d);
  r.setDate(d.getDate() - diff);
  return r;
}

function fmtDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function presetRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'today': return { start: fmtDateStr(now), end: fmtDateStr(now) };
    case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); return { start: fmtDateStr(y), end: fmtDateStr(y) }; }
    case 'thisWeek': { const s = startOfWeekDate(now); return { start: fmtDateStr(s), end: fmtDateStr(now) }; }
    case 'lastWeek': { const s = startOfWeekDate(now); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return { start: fmtDateStr(s), end: fmtDateStr(e) }; }
    case 'thisMonth': { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: fmtDateStr(s), end: fmtDateStr(now) }; }
    case 'lastMonth': { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return { start: fmtDateStr(s), end: fmtDateStr(e) }; }
    case 'thisQuarter': { const q = Math.floor(now.getMonth() / 3); const s = new Date(now.getFullYear(), q * 3, 1); return { start: fmtDateStr(s), end: fmtDateStr(now) }; }
    case 'thisYear': { const s = new Date(now.getFullYear(), 0, 1); return { start: fmtDateStr(s), end: fmtDateStr(now) }; }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

async function actualDataBounds() {
  const txns = (await DB.getAll('transactions')).filter((t) => !t.isDeleted);
  if (txns.length === 0) return null;
  let min = txns[0].date, max = txns[0].date;
  txns.forEach((t) => { if (t.date < min) min = t.date; if (t.date > max) max = t.date; });
  return { min, max };
}

function formatRangeLabel(y, m, d) { return `${y}年${m}月${d}日`; }

async function describeRange(range) {
  if (range.preset === 'all') {
    const bounds = await actualDataBounds();
    if (!bounds) return { title: '全部時間', sub: '' };
    const [sy, sm, sd] = bounds.min.split('-').map(Number);
    const [ey, em, ed] = bounds.max.split('-').map(Number);
    return { title: '全部時間', sub: `${formatRangeLabel(sy, sm, sd)} ~ ${formatRangeLabel(ey, em, ed)}` };
  }
  const preset = RANGE_PRESETS.find((p) => p.key === range.preset);
  const [sy, sm, sd] = range.start.split('-').map(Number);
  const [ey, em, ed] = range.end.split('-').map(Number);
  const sub = `${formatRangeLabel(sy, sm, sd)} ~ ${formatRangeLabel(ey, em, ed)}`;
  return { title: preset ? preset.label : '自訂區間', sub };
}

function getItemColor(dimension, id, rankIndex) {
  if (dimension === 'category') {
    const cat = state.categories.find((c) => c.id === id);
    return categoryColor(cat ? cat.colorIndex : rankIndex);
  }
  return categoryColor(rankIndex);
}

function resolveDimensionName(dimension, id) {
  const list = dimension === 'category' ? state.categories
    : dimension === 'account' ? state.accounts
    : dimension === 'recipient' ? state.recipients
    : state.merchants;
  const found = list.find((x) => x.id === id);
  return found ? found.name : '（已刪除）';
}

const Analysis = (function () {
  let dimension = 'category';
  let statsRange = { preset: 'thisWeek', ...presetRange('thisWeek') };
  let trendRange = { preset: 'thisMonth', ...presetRange('thisMonth') };
  let trendGranularity = 'month';
  let rangeSheetTarget = null;
  let detailReturnTab = 'stats';

  async function getFilteredTransactions(range, extra) {
    const txns = (await DB.getAll('transactions')).filter((t) => !t.isDeleted);
    return txns.filter((t) => {
      if (range.start && t.date < range.start) return false;
      if (range.end && t.date > range.end) return false;
      if (extra && extra.type && t.type !== extra.type) return false;
      if (extra && extra.dimension && extra.dimId) {
        if (extra.dimension === 'recipient') {
          if (!(t.recipientIds || []).includes(extra.dimId)) return false;
        } else {
          const field = extra.dimension === 'category' ? 'categoryId' : extra.dimension === 'account' ? 'accountId' : 'merchantId';
          if (t[field] !== extra.dimId) return false;
        }
      }
      return true;
    });
  }

  function aggregate(txns, dim, type) {
    const buckets = new Map();
    txns.filter((t) => t.type === type).forEach((t) => {
      if (dim === 'recipient') {
        (t.recipientIds || []).forEach((rid) => bump(buckets, rid, t.amount));
      } else {
        const field = dim === 'category' ? 'categoryId' : dim === 'account' ? 'accountId' : 'merchantId';
        const id = t[field];
        if (id) bump(buckets, id, t.amount);
        else bump(buckets, '__none__', t.amount);
      }
    });
    return buckets;
  }
  function bump(buckets, id, amount) {
    if (!buckets.has(id)) buckets.set(id, { id, amount: 0, count: 0 });
    const b = buckets.get(id);
    b.amount += amount; b.count += 1;
  }

  function buildDonut(entries, total, elId, holeId) {
    const el = $(elId);
    if (!el) return;
    if (entries.length === 0 || total <= 0) {
      el.style.background = 'var(--surface-0)';
      if (holeId) $(holeId).textContent = `$${fmtMoney(total)}`;
      return;
    }
    let cursor = 0;
    const stops = [];
    entries.forEach((e) => {
      const pct = (e.amount / total) * 100;
      stops.push(`${e.color.bg} ${cursor}% ${cursor + pct}%`);
      cursor += pct;
    });
    el.style.background = `conic-gradient(${stops.join(', ')})`;
    if (holeId) $(holeId).textContent = `$${fmtMoney(total)}`;
  }

  function renderStatsList(containerId, entries, total, dim, type) {
    const container = $(containerId);
    container.innerHTML = '';
    entries.forEach((e) => {
      const pct = total > 0 ? (e.amount / total) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'stats-row';
      row.innerHTML = `
        <div class="stats-row-top">
          <span class="stats-row-dot" style="background:${e.color.bg};border:1px solid ${e.color.fg}22;"></span>
          <span class="stats-row-name">${escapeHtml(e.name)}</span>
          <span class="stats-row-pct">${pct.toFixed(1)}%</span>
          <span class="stats-row-amount">${fmtMoney(e.amount)}</span>
          <span class="stats-row-chevron">›</span>
        </div>
        <div class="stats-row-bar-track"><div class="stats-row-bar-fill" style="width:${pct}%;background:${e.color.bg};"></div><span class="stats-row-count">${e.count}</span></div>
      `;
      row.addEventListener('click', () => openDetailByDimension(dim, e.id, e.name, type, 'stats'));
      container.appendChild(row);
    });
  }

  function updateQuickButtons(containerId, currentPreset) {
    $$(`#${containerId} .quick-range-btn`).forEach((b) => b.classList.toggle('active', b.dataset.preset === currentPreset || (b.dataset.preset === 'custom' && currentPreset === 'custom')));
  }

  async function renderStats() {
    updateQuickButtons('statsQuickRange', statsRange.preset);
    const label = await describeRange(statsRange);
    $('#statsRangeSubDisplay').textContent = label.sub || '';

    const showIncome = dimension === 'category' || dimension === 'account';
    $('#statsIncomeBlock').hidden = !showIncome;

    const txns = await getFilteredTransactions(statsRange);
    $('#statsEmpty').hidden = txns.length > 0;

    const expenseBuckets = aggregate(txns, dimension, 'expense');
    const expenseEntries = Array.from(expenseBuckets.values())
      .map((b) => ({ ...b, name: b.id === '__none__' ? '（未分類）' : resolveDimensionName(dimension, b.id) }))
      .sort((a, b) => b.amount - a.amount)
      .map((e, i) => ({ ...e, color: getItemColor(dimension, e.id, i) }));
    const expenseTotal = expenseEntries.reduce((s, e) => s + e.amount, 0);
    buildDonut(expenseEntries, expenseTotal, '#statsExpenseDonut', '#statsExpenseTotal');
    renderStatsList('#statsExpenseList', expenseEntries, expenseTotal, dimension, 'expense');

    if (showIncome) {
      const incomeBuckets = aggregate(txns, dimension, 'income');
      const incomeEntries = Array.from(incomeBuckets.values())
        .map((b) => ({ ...b, name: b.id === '__none__' ? '（未分類）' : resolveDimensionName(dimension, b.id) }))
        .sort((a, b) => b.amount - a.amount)
        .map((e, i) => ({ ...e, color: getItemColor(dimension, e.id, i) }));
      const incomeTotal = incomeEntries.reduce((s, e) => s + e.amount, 0);
      buildDonut(incomeEntries, incomeTotal, '#statsIncomeDonut', '#statsIncomeTotal');
      renderStatsList('#statsIncomeList', incomeEntries, incomeTotal, dimension, 'income');
    }
  }

  // ---------- Trend ----------
  function bucketKeyFor(dateStr, granularity) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (granularity === 'day') return dateStr;
    if (granularity === 'month') return `${y}-${pad2(m)}`;
    if (granularity === 'year') return `${y}`;
    const dateObj = new Date(y, m - 1, d);
    const monday = startOfWeekDate(dateObj);
    return fmtDateStr(monday);
  }
  function bucketLabelFor(key, granularity) {
    if (granularity === 'day') return key;
    if (granularity === 'month') { const [y, m] = key.split('-'); return `${y}/${m}`; }
    if (granularity === 'year') return key;
    return `${key} 那週`;
  }

  async function renderTrend() {
    updateQuickButtons('trendQuickRange', trendRange.preset);
    const label = await describeRange(trendRange);
    $('#trendRangeSubDisplay').textContent = label.sub || '';

    const txns = await getFilteredTransactions(trendRange);
    $('#trendEmpty').hidden = txns.length > 0;

    const buckets = new Map();
    txns.forEach((t) => {
      const key = bucketKeyFor(t.date, trendGranularity);
      if (!buckets.has(key)) buckets.set(key, { key, expense: 0, income: 0 });
      const b = buckets.get(key);
      if (t.type === 'expense') b.expense += t.amount;
      else if (t.type === 'income') b.income += t.amount;
    });
    const sortedKeys = Array.from(buckets.keys()).sort();
    const rows = sortedKeys.map((k) => buckets.get(k));

    renderTrendChart(rows);
    renderTrendTable(rows);
  }

  function renderTrendChart(rows) {
    const wrap = $('#trendChartWrap');
    if (rows.length === 0) { wrap.innerHTML = ''; return; }
    const w = 340, h = 140, padL = 6, padR = 6, padT = 10, padB = 6;
    const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.expense, r.income)));
    const stepX = rows.length > 1 ? (w - padL - padR) / (rows.length - 1) : 0;
    const xAt = (i) => padL + stepX * i;
    const yAt = (v) => padT + (h - padT - padB) * (1 - v / maxVal);

    const expensePts = rows.map((r, i) => `${xAt(i)},${yAt(r.expense)}`).join(' ');
    const incomePts = rows.map((r, i) => `${xAt(i)},${yAt(r.income)}`).join(' ');
    const expenseArea = `${padL},${h - padB} ${expensePts} ${xAt(rows.length - 1)},${h - padB}`;
    const incomeArea = `${padL},${h - padB} ${incomePts} ${xAt(rows.length - 1)},${h - padB}`;

    wrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" class="trend-svg">
        <polygon points="${incomeArea}" fill="var(--success-bg)" opacity="0.6" />
        <polygon points="${expenseArea}" fill="var(--danger-bg)" opacity="0.5" />
        <polyline points="${incomePts}" fill="none" stroke="var(--success)" stroke-width="2" />
        <polyline points="${expensePts}" fill="none" stroke="var(--danger)" stroke-width="2" />
      </svg>
      <div class="trend-legend">
        <span class="legend-item"><span class="legend-dot" style="background:var(--danger);"></span>支出</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--success);"></span>收入</span>
      </div>
    `;
  }

  function renderTrendTable(rows) {
    const table = $('#trendTable');
    if (rows.length === 0) { table.innerHTML = ''; return; }
    const totalExpense = rows.reduce((s, r) => s + r.expense, 0);
    const totalIncome = rows.reduce((s, r) => s + r.income, 0);

    let html = `
      <div class="trend-table-row trend-table-header">
        <span>期間</span><span>支出</span><span>收入</span><span>結餘</span>
      </div>
      <div class="trend-table-row trend-table-total" data-key="__total__">
        <span>總計</span><span class="neg">-${fmtMoney(totalExpense)}</span><span class="pos">+${fmtMoney(totalIncome)}</span><span>${fmtMoney(totalIncome - totalExpense)}</span>
      </div>
    `;
    rows.slice().reverse().forEach((r) => {
      html += `
        <div class="trend-table-row" data-key="${r.key}">
          <span>${escapeHtml(bucketLabelFor(r.key, trendGranularity))}</span>
          <span class="neg">-${fmtMoney(r.expense)}</span>
          <span class="pos">+${fmtMoney(r.income)}</span>
          <span>${fmtMoney(r.income - r.expense)}</span>
        </div>
      `;
    });
    table.innerHTML = html;
    $$('.trend-table-row[data-key]').forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.dataset.key;
        if (key === '__total__') openDetailByRange(trendRange, '總計', 'trend');
        else openDetailByBucket(key, trendGranularity);
      });
    });
  }

  // ---------- Detail drill-down ----------
  async function openDetailByDimension(dim, id, name, type, fromTab) {
    detailReturnTab = fromTab;
    const label = await describeRange(statsRange);
    const extra = { type, dimension: dim, dimId: id === '__none__' ? null : id };
    const txns = await getFilteredTransactions(statsRange, extra);
    showDetail(`${DIMENSION_LABELS[dim]}：${name}`, label.sub, txns, type === 'expense' ? '-' : '+');
  }

  function bucketRangeFor(key, granularity) {
    if (granularity === 'day') return { start: key, end: key };
    if (granularity === 'month') { const [y, m] = key.split('-').map(Number); const s = new Date(y, m - 1, 1); const e = new Date(y, m, 0); return { start: fmtDateStr(s), end: fmtDateStr(e) }; }
    if (granularity === 'year') { const y = parseInt(key, 10); return { start: `${y}-01-01`, end: `${y}-12-31` }; }
    const [y, m, d] = key.split('-').map(Number);
    const s = new Date(y, m - 1, d); const e = new Date(s); e.setDate(s.getDate() + 6);
    return { start: fmtDateStr(s), end: fmtDateStr(e) };
  }

  async function openDetailByBucket(key, granularity) {
    detailReturnTab = 'trend';
    const range = bucketRangeFor(key, granularity);
    const txns = await getFilteredTransactions(range);
    showDetail(bucketLabelFor(key, granularity), `${range.start} ~ ${range.end}`, txns, null);
  }

  async function openDetailByRange(range, title, fromTab) {
    detailReturnTab = fromTab;
    const txns = await getFilteredTransactions(range);
    const label = await describeRange(range);
    showDetail(title || label.title, label.sub, txns, null);
  }

  function showDetail(title, sub, txns, sign) {
    $('#analysisDetail').hidden = false;

    $('#analysisDetailTitle').innerHTML = `${escapeHtml(title)}${sub ? `<span class="range-sub">${escapeHtml(sub)}</span>` : ''}`;

    const totalExpense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalIncome = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    $('#analysisDetailSummary').textContent = sign
      ? `共 ${txns.length} 筆，合計 $${fmtMoney(totalExpense || totalIncome)}`
      : `共 ${txns.length} 筆，支出 $${fmtMoney(totalExpense)}／收入 $${fmtMoney(totalIncome)}`;

    const list = $('#analysisDetailList');
    list.innerHTML = '';
    $('#analysisDetailEmpty').hidden = txns.length > 0;

    const catMap = Object.fromEntries(state.categories.map((c) => [c.id, c]));
    const accMap = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
    const recMap = Object.fromEntries(state.recipients.map((r) => [r.id, r]));
    const merchMap = Object.fromEntries(state.merchants.map((m) => [m.id, m]));

    const sorted = txns.slice().sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));
    let lastDate = null;
    sorted.forEach((t) => {
      if (t.date !== lastDate) {
        lastDate = t.date;
        const dl = document.createElement('div');
        dl.className = 'history-date-label';
        dl.textContent = `${t.date}（星期${weekdayChar(t.date)}）`;
        list.appendChild(dl);
      }
      const cat = catMap[t.categoryId];
      const acc = accMap[t.accountId];
      const merchant = merchMap[t.merchantId];
      const recipientNames = (t.recipientIds || []).map((id) => recMap[id] && recMap[id].name).filter(Boolean).join('、');
      const rowTitle = t.itemName || (cat ? cat.name : '');
      const subParts = [acc ? acc.name : '', recipientNames, merchant ? merchant.name : ''].filter(Boolean);
      const color = categoryColor(cat ? cat.colorIndex : 0);
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `
        <div class="history-row-left">
          <div class="history-row-icon" style="background:${color.bg};color:${color.fg};">${cat ? cat.name.charAt(0) : '?'}</div>
          <div>
            <div class="history-row-title">${escapeHtml(rowTitle)}</div>
            <div class="history-row-sub">${escapeHtml(subParts.join(' · '))}</div>
          </div>
        </div>
        <div class="history-row-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${fmtMoney(t.amount)}</div>
      `;
      row.addEventListener('click', () => openSheet(t));
      list.appendChild(row);
    });
  }

  function closeDetail() {
    $('#analysisDetail').hidden = true;
  }

  // ---------- Range picker sheet ----------
  function openRangeSheet(target, hidePresets) {
    rangeSheetTarget = target;
    const current = target === 'stats' ? statsRange : trendRange;
    const grid = $('#rangePresetGrid');
    grid.hidden = !!hidePresets;
    grid.innerHTML = '';
    if (!hidePresets) {
      RANGE_PRESETS.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'range-preset-btn' + (current.preset === p.key ? ' selected' : '');
        btn.textContent = p.label;
        btn.addEventListener('click', () => applyPreset(p.key));
        grid.appendChild(btn);
      });
    }
    $('#rangeStartInput').value = current.start || '';
    $('#rangeEndInput').value = current.end || '';
    delete $('#rangeStartInput').dataset.pendingPreset;
    $('#rangeSheetBackdrop').hidden = false;
    $('#rangeSheet').hidden = false;
  }
  function closeRangeSheet() {
    $('#rangeSheetBackdrop').hidden = true;
    $('#rangeSheet').hidden = true;
  }
  function applyPreset(key) {
    const r = presetRange(key);
    $('#rangeStartInput').value = r.start || '';
    $('#rangeEndInput').value = r.end || '';
    $$('.range-preset-btn').forEach((b) => b.classList.toggle('selected', b.textContent === (RANGE_PRESETS.find((p) => p.key === key) || {}).label));
    $('#rangeStartInput').dataset.pendingPreset = key;
  }
  async function confirmRange() {
    const start = $('#rangeStartInput').value || null;
    const end = $('#rangeEndInput').value || null;
    const pendingPreset = $('#rangeStartInput').dataset.pendingPreset;
    const preset = pendingPreset || 'custom';
    delete $('#rangeStartInput').dataset.pendingPreset;
    const result = { preset, start, end };
    if (rangeSheetTarget === 'stats') { statsRange = result; await renderStats(); }
    else { trendRange = result; await renderTrend(); }
    closeRangeSheet();
  }

  // ---------- Init & show hooks ----------
  let initialized = false;
  function initOnce() {
    if (initialized) return;
    initialized = true;

    $$('#statsQuickRange .quick-range-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const preset = btn.dataset.preset;
        if (preset === 'custom') { openRangeSheet('stats', true); return; }
        statsRange = { preset, ...presetRange(preset) };
        await renderStats();
      });
    });
    $$('#trendQuickRange .quick-range-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const preset = btn.dataset.preset;
        if (preset === 'custom') { openRangeSheet('trend', true); return; }
        trendRange = { preset, ...presetRange(preset) };
        await renderTrend();
      });
    });
    $$('.dim-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        dimension = btn.dataset.dim;
        $$('.dim-btn').forEach((b) => b.classList.toggle('active', b === btn));
        await renderStats();
      });
    });
    $$('.gran-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        trendGranularity = btn.dataset.g;
        $$('.gran-btn').forEach((b) => b.classList.toggle('active', b === btn));
        await renderTrend();
      });
    });
    $('#rangeSheetBackdrop').addEventListener('click', closeRangeSheet);
    $('#rangeConfirmBtn').addEventListener('click', confirmRange);
    $('#analysisDetailBack').addEventListener('click', closeDetail);
  }

  async function onShowStats() {
    initOnce();
    closeDetail();
    await renderStats();
  }
  async function onShowTrend() {
    initOnce();
    closeDetail();
    await renderTrend();
  }

  return { onShowStats, onShowTrend };
})();

window.Analysis = Analysis;
