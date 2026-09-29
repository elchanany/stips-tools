/**
 * Stips Download - IndexedDB Storage Manager
 * Resilient persistence, batch checkpointing, and job resume capability.
 */

const DB_NAME = 'stips_download';
const DB_VERSION = 1;

let dbInstance = null;

function openDb() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Conversations store
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'partnerId' });
      }

      // 2. Messages store: key is [partnerId, id]
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: ['partnerId', 'id'] });
        msgStore.createIndex('partnerId', 'partnerId', { unique: false });
        msgStore.createIndex('timestamp', 'timestamp', { unique: false });
        msgStore.createIndex('by_partner_time', ['partnerId', 'timestamp'], { unique: false });
      }

      // 3. Jobs store: key is partnerId
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'partnerId' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * Gets a job by partnerId
 */
async function getJob(partnerId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('jobs', 'readonly');
    const store = tx.objectStore('jobs');
    const req = store.get(Number(partnerId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves or updates a job
 */
async function saveJob(job) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('jobs', 'readwrite');
    const store = tx.objectStore('jobs');
    store.put({
      ...job,
      partnerId: Number(job.partnerId),
      updatedAt: Date.now()
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Saves a batch of messages and updates job checkpoint atomically
 */
async function saveBatch({ partnerId, partnerName, messages, cursor, batchesCount, status = 'downloading' }) {
  const db = await openDb();
  const pid = Number(partnerId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['messages', 'jobs', 'conversations'], 'readwrite');
    const msgStore = tx.objectStore('messages');
    const jobStore = tx.objectStore('jobs');
    const convStore = tx.objectStore('conversations');

    let insertedInBatch = 0;
    for (const msg of messages) {
      if (msg && msg.id) {
        msgStore.put({
          ...msg,
          partnerId: pid
        });
        insertedInBatch++;
      }
    }

    // Get current job to update count accurately
    const jobReq = jobStore.get(pid);
    jobReq.onsuccess = () => {
      const prevJob = jobReq.result || {};
      const newDownloaded = (prevJob.messagesDownloaded || 0) + insertedInBatch;

      jobStore.put({
        partnerId: pid,
        partnerName: partnerName || prevJob.partnerName || 'משתמש',
        cursor: cursor !== undefined ? cursor : prevJob.cursor,
        messagesDownloaded: newDownloaded,
        batchesCount: batchesCount !== undefined ? batchesCount : (prevJob.batchesCount || 0) + 1,
        startedAt: prevJob.startedAt || Date.now(),
        updatedAt: Date.now(),
        status,
        lastError: null
      });

      // Update conversation summary
      convStore.put({
        partnerId: pid,
        partnerName: partnerName || prevJob.partnerName || 'משתמש',
        totalMessages: newDownloaded,
        lastDownloadedAt: Date.now()
      });
    };

    tx.oncomplete = () => resolve({ insertedInBatch });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves all messages for a partner, sorted chronologically by timestamp and id
 */
async function getMessages(partnerId) {
  const db = await openDb();
  const pid = Number(partnerId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('partnerId');
    const req = index.getAll(pid);

    req.onsuccess = () => {
      const list = req.result || [];
      // Sort strictly by timestamp, then by id
      list.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return a.id - b.id;
      });
      resolve(list);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Validates downloaded messages and calculates health metrics
 */
async function getValidationReport(partnerId) {
  const messages = await getMessages(partnerId);
  const total = messages.length;
  let datedCount = 0;
  let undatedCount = 0;
  let oldest = null;
  let newest = null;

  const seenIds = new Set();
  let duplicateCount = 0;

  for (const m of messages) {
    if (seenIds.has(m.id)) {
      duplicateCount++;
    } else {
      seenIds.add(m.id);
    }

    if (m.timestamp && m.timestamp > 0) {
      datedCount++;
      if (!oldest || m.timestamp < oldest.timestamp) oldest = m;
      if (!newest || m.timestamp > newest.timestamp) newest = m;
    } else {
      undatedCount++;
    }
  }

  return {
    partnerId: Number(partnerId),
    total,
    uniqueCount: seenIds.size,
    duplicateCount,
    datedCount,
    undatedCount,
    isValid: total > 0 && undatedCount === 0 && duplicateCount === 0,
    oldestDate: oldest ? oldest.gregorianDate : null,
    newestDate: newest ? newest.gregorianDate : null,
    oldestTimestamp: oldest ? oldest.timestamp : null,
    newestTimestamp: newest ? newest.timestamp : null
  };
}

/**
 * Clears saved data for a partner
 */
async function clearPartnerData(partnerId) {
  const db = await openDb();
  const pid = Number(partnerId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['messages', 'jobs', 'conversations'], 'readwrite');
    const msgStore = tx.objectStore('messages');
    const index = msgStore.index('partnerId');
    const req = index.openCursor(pid);

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.objectStore('jobs').delete(pid);
    tx.objectStore('conversations').delete(pid);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns all conversations saved in the local database
 */
async function getAllConversations() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openDb,
    getJob,
    saveJob,
    saveBatch,
    getMessages,
    getValidationReport,
    clearPartnerData,
    getAllConversations
  };
}
