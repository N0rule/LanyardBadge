/* Bounded artwork cache. Badge metadata remains authoritative; assets are immutable. */
(() => {
  'use strict';
  const database = 'lanyardbadge.artwork',
    storeName = 'images',
    maxEntries = 64;
  const digest = async (bytes) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  class ArtworkCache {
    constructor() {
      this.memory = new Map();
      this.opening = null;
      this.epochs = new Map();
    }
    async scope(device, credential) {
      // Never store the credential itself in the artwork database. Rotation/reflash
      // changes this namespace, even if a board reuses a card or artwork ID.
      return { device, key: device + ':' + (await digest(new TextEncoder().encode(credential))) };
    }
    open() {
      if (this.opening) return this.opening;
      this.opening = new Promise((resolve) => {
        if (!globalThis.indexedDB) return resolve(null);
        let request,
          finished = false;
        const finish = (db) => {
          if (finished) {
            db?.close();
            return;
          }
          finished = true;
          clearTimeout(timer);
          resolve(db);
        };
        const timer = setTimeout(() => finish(null), 500);
        try {
          request = indexedDB.open(database, 1);
          request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(storeName, { keyPath: 'key' });
            store.createIndex('used', 'at');
            store.createIndex('device', 'device');
          };
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => {
              db.close();
              this.opening = null;
            };
            finish(db);
          };
          request.onerror = request.onblocked = () => finish(null);
        } catch {
          finish(null);
        }
      });
      return this.opening;
    }
    async transaction(mode, work) {
      const db = await this.open().catch(() => null);
      if (!db) return undefined;
      return new Promise((resolve) => {
        let transaction,
          result,
          finished = false;
        const finish = (value) => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            resolve(value);
          }
        };
        const timer = setTimeout(() => {
          try {
            transaction?.abort();
          } catch {}
          finish(undefined);
        }, 500);
        try {
          transaction = db.transaction(storeName, mode);
          transaction.oncomplete = () => finish(result);
          transaction.onerror = transaction.onabort = () => finish(undefined);
          work(transaction.objectStore(storeName), (value) => {
            result = value;
          });
        } catch {
          finish(undefined);
        }
      });
    }
    remember(record) {
      this.memory.delete(record.key);
      this.memory.set(record.key, record);
      while (this.memory.size > 20) this.memory.delete(this.memory.keys().next().value);
    }
    async get(scope, id) {
      if (!scope || !/^[a-f0-9]{8}$/.test(id)) return undefined;
      const epoch = this.epochs.get(scope.device) || 0;
      const key = scope.key + '/' + id;
      if (this.memory.has(key)) {
        const record = this.memory.get(key);
        this.remember(record);
        return record.bytes.slice(0);
      }
      const record = await this.transaction('readonly', (store, result) => {
        const request = store.get(key);
        request.onsuccess = () => result(request.result);
      });
      if (!record) return undefined;
      try {
        BadgeCodec.validateArtwork(record.bytes);
        if (record.hash !== (await digest(record.bytes))) throw Error('Cached artwork is corrupt');
        if (epoch !== (this.epochs.get(scope.device) || 0)) return undefined;
        this.remember(record);
        if (Date.now() - record.at > 60_000) {
          record.at = Date.now();
          void this.transaction('readwrite', (store) => store.put(record));
        }
        return record.bytes.slice(0);
      } catch {
        await this.transaction('readwrite', (store) => store.delete(key));
        return undefined;
      }
    }
    async put(scope, id, bytes) {
      if (!scope || !/^[a-f0-9]{8}$/.test(id)) return;
      try {
        BadgeCodec.validateArtwork(bytes);
        const epoch = this.epochs.get(scope.device) || 0;
        const record = {
          key: scope.key + '/' + id,
          device: scope.device,
          at: Date.now(),
          bytes: bytes.slice(0),
          hash: await digest(bytes),
        };
        if (epoch !== (this.epochs.get(scope.device) || 0)) return;
        this.remember(record);
        await this.transaction('readwrite', (store) => {
          store.put(record);
          const count = store.count();
          count.onsuccess = () => {
            let excess = count.result - maxEntries;
            if (excess <= 0) return;
            const cursor = store.index('used').openCursor();
            cursor.onsuccess = () => {
              if (cursor.result && excess-- > 0) {
                cursor.result.delete();
                cursor.result.continue();
              }
            };
          };
        });
      } catch {
        /* Storage policy/quota cannot turn a successful transfer into a failure. */
      }
    }
    async clearDevice(device) {
      this.epochs.set(device, (this.epochs.get(device) || 0) + 1);
      for (const [key, record] of this.memory)
        if (record.device === device) this.memory.delete(key);
      await this.transaction('readwrite', (store) => {
        const request = store.index('device').openCursor(IDBKeyRange.only(device));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      });
    }
  }
  globalThis.BadgeArtworkCache = { ArtworkCache };
})();
