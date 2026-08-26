import type { FoundryVault } from './foundry-crypto';

const DATABASE = 'technocore-foundry';
const STORE = 'vaults';
const KEY = 'primary';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local vault database.'));
  });
}

export async function saveVault(vault: FoundryVault) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(vault, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the local vault.'));
  });
  database.close();
}

export async function loadVault() {
  const database = await openDatabase();
  const result = await new Promise<FoundryVault | undefined>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result as FoundryVault | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read the local vault.'));
  });
  database.close();
  return result;
}
