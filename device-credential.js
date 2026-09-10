"use strict";

const DEVICE_CREDENTIAL_DATABASE = "fischteich-device-credentials";
const DEVICE_CREDENTIAL_STORE = "buffalo-shortcut-management";
const DEVICE_CREDENTIAL_VERSION = 1;
const DEVICE_MANAGEMENT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_CREDENTIAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deviceCredentialRequests = new Map();

function openDeviceCredentialDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DEVICE_CREDENTIAL_DATABASE, DEVICE_CREDENTIAL_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(DEVICE_CREDENTIAL_STORE)) {
        request.result.createObjectStore(DEVICE_CREDENTIAL_STORE, { keyPath: "deviceId" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Device credential database unavailable")));
    request.addEventListener("blocked", () => reject(new Error("Device credential database blocked")));
  });
}

function runDeviceCredentialTransaction(mode, operation) {
  return openDeviceCredentialDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_CREDENTIAL_STORE, mode);
    const store = transaction.objectStore(DEVICE_CREDENTIAL_STORE);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.addEventListener("complete", () => {
      database.close();
      resolve(result?.result ?? null);
    });
    transaction.addEventListener("abort", () => {
      database.close();
      reject(transaction.error ?? new Error("Device credential transaction aborted"));
    });
    transaction.addEventListener("error", () => {
      database.close();
      reject(transaction.error ?? new Error("Device credential transaction failed"));
    });
  }));
}

function encodeDeviceManagementKey(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function createDeviceManagementKey() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return encodeDeviceManagementKey(bytes);
}

async function readDeviceManagementKey(deviceId) {
  const record = await runDeviceCredentialTransaction("readonly", (store) => store.get(deviceId));
  return record?.deviceId === deviceId && DEVICE_MANAGEMENT_KEY_PATTERN.test(record.managementKey)
    ? record.managementKey
    : null;
}

async function createStoredDeviceManagementKey(deviceId) {
  const managementKey = createDeviceManagementKey();
  await runDeviceCredentialTransaction("readwrite", (store) => store.put({
    deviceId,
    managementKey,
    createdAt: new Date().toISOString(),
  }));
  return managementKey;
}

function getOrCreateDeviceManagementKey(deviceId) {
  if (!DEVICE_CREDENTIAL_UUID_PATTERN.test(deviceId)) {
    return Promise.reject(new TypeError("A valid device id is required"));
  }
  if (!window.indexedDB || !window.crypto?.getRandomValues) {
    return Promise.reject(new Error("Secure device credential storage is unavailable"));
  }
  if (deviceCredentialRequests.has(deviceId)) return deviceCredentialRequests.get(deviceId);

  const request = readDeviceManagementKey(deviceId)
    .then((storedKey) => storedKey ?? createStoredDeviceManagementKey(deviceId))
    .finally(() => deviceCredentialRequests.delete(deviceId));
  deviceCredentialRequests.set(deviceId, request);
  return request;
}

window.getOrCreateDeviceManagementKey = getOrCreateDeviceManagementKey;
