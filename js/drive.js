// drive.js - Google Drive sync (OAuth via Google Identity Services + Drive API v3)

const GOOGLE_CLIENT_ID = '1007750699662-o6o4p1ksi99il2eem5p4q8fki0vca79t.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP_FOLDER_NAME = '記帳App 資料';
const DATA_FILE_NAME = 'data.json';
const SYNC_STORES = ['categories', 'accounts', 'recipients', 'merchants', 'transactions'];

let tokenClient = null;
let accessToken = null;
let accessTokenExpiry = 0;

function gisReady() {
  return new Promise((resolve) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        clearInterval(check);
        resolve();
      }
    }, 150);
  });
}

async function initTokenClient() {
  await gisReady();
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: () => {},
  });
  return tokenClient;
}

function requestToken(interactive) {
  return new Promise(async (resolve, reject) => {
    const client = await initTokenClient();
    client.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      accessToken = resp.access_token;
      accessTokenExpiry = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3500 * 1000);
      resolve(accessToken);
    };
    client.error_callback = (err) => reject(err);
    const opts = { prompt: interactive ? 'consent' : '' };
    const hint = localStorage.getItem('driveAccountEmail');
    if (hint) opts.hint = hint;
    try {
      client.requestAccessToken(opts);
    } catch (err) {
      reject(err);
    }
  });
}

async function ensureToken(interactive) {
  if (accessToken && Date.now() < accessTokenExpiry - 60000) return accessToken;
  return requestToken(interactive);
}

async function driveFetch(url, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + accessToken });
  if (!options.cache) options.cache = 'no-store';
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Drive API ' + res.status + ': ' + text);
  }
  return res;
}

async function findOrCreateFolder() {
  let folderId = localStorage.getItem('driveFolderId');
  if (folderId) return folderId;
  const q = encodeURIComponent(`name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    folderId = data.files[0].id;
  } else {
    const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    const created = await createRes.json();
    folderId = created.id;
  }
  localStorage.setItem('driveFolderId', folderId);
  return folderId;
}

async function uploadDataFile(folderId, fileId, jsonData) {
  const boundary = '-------314159265358979323846';
  const metadata = fileId ? {} : { name: DATA_FILE_NAME, parents: [folderId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(jsonData)}\r\n` +
    `--${boundary}--`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await driveFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  return data.id;
}

async function findOrCreateDataFile(folderId) {
  let fileId = localStorage.getItem('driveFileId');
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${DATA_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    fileId = data.files[0].id;
  } else {
    const empty = {};
    SYNC_STORES.forEach((s) => { empty[s] = []; });
    fileId = await uploadDataFile(folderId, null, empty);
  }
  localStorage.setItem('driveFileId', fileId);
  return fileId;
}

async function downloadDataFile(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.json();
}

// Merge remote snapshot into local IndexedDB (newest updatedAt per record id wins),
// write the merged result back to IndexedDB, and return the merged snapshot to upload.
async function mergeAndSaveLocal(remote) {
  const mergedSnapshot = {};
  for (const store of SYNC_STORES) {
    const local = await DB.getAll(store);
    const remoteArr = (remote && remote[store]) || [];
    const map = new Map();
    local.forEach((item) => map.set(item.id, item));
    const toWrite = [];
    remoteArr.forEach((item) => {
      const existing = map.get(item.id);
      if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
        map.set(item.id, item);
        toWrite.push(item); // only records where the remote copy actually wins need writing back
      }
    });
    for (const item of toWrite) {
      await DB.put(store, item);
    }
    mergedSnapshot[store] = Array.from(map.values());
  }
  return mergedSnapshot;
}

const Drive = {
  isConnected() {
    return localStorage.getItem('driveConnected') === '1';
  },
  lastSyncAt() {
    const v = localStorage.getItem('driveLastSync');
    return v ? parseInt(v, 10) : null;
  },
  accountEmail() {
    return localStorage.getItem('driveAccountEmail') || '';
  },
  async connect() {
    await ensureToken(true);
    try {
      const res = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
      const data = await res.json();
      if (data.user && data.user.emailAddress) {
        localStorage.setItem('driveAccountEmail', data.user.emailAddress);
      }
    } catch (e) { /* non-fatal — sync can still proceed without the hint */ }
    localStorage.setItem('driveConnected', '1');
    await this.sync();
  },
  disconnect() {
    localStorage.removeItem('driveConnected');
    localStorage.removeItem('driveFolderId');
    localStorage.removeItem('driveFileId');
    localStorage.removeItem('driveAccountEmail');
    accessToken = null;
    accessTokenExpiry = 0;
  },
  async sync() {
    if (!this.isConnected()) return null;
    try {
      await ensureToken(false);
    } catch (e) {
      await ensureToken(true);
    }
    const folderId = await findOrCreateFolder();
    const fileId = await findOrCreateDataFile(folderId);
    const remote = await downloadDataFile(fileId);
    const merged = await mergeAndSaveLocal(remote);
    await uploadDataFile(folderId, fileId, merged);
    localStorage.setItem('driveLastSync', String(Date.now()));
    return merged;
  },
};

window.Drive = Drive;
