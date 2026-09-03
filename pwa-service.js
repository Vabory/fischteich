"use strict";

const FISCHTEICH_SERVICE_WORKER_URL = "./service-worker.js?v=1";
const FISCHTEICH_SERVICE_WORKER_SCOPE = "./";
const FISCHTEICH_VERSION_CHECK_INTERVAL = 5 * 60 * 1000;
const FISCHTEICH_VERSION_CHECK_TIMEOUT = 8000;

const currentBuildVersion = document
  .querySelector('meta[name="fischteich-build"]')
  ?.getAttribute("content")
  ?.trim() ?? "";
const updateModal = document.querySelector("#app-update-modal");
const updateLaterButton = document.querySelector("#app-update-later");
const updateNowButton = document.querySelector("#app-update-now");
const updateAppElement = document.querySelector("#app");

let serviceWorkerRegistrationPromise = null;
let versionCheckPromise = null;
let lastVersionCheckStartedAt = 0;
let availableBuildVersion = null;
let updateModalOpen = false;
let updateModalPreviousFocus = null;
let updateModalPreviousAppInert = false;
const dismissedBuildVersions = new Set();

function isValidBuildVersion(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

async function registerFischteichServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;

  serviceWorkerRegistrationPromise = navigator.serviceWorker.register(
    FISCHTEICH_SERVICE_WORKER_URL,
    { scope: FISCHTEICH_SERVICE_WORKER_SCOPE, updateViaCache: "none" },
  ).then(async (registration) => {
    try {
      await registration.update();
    } catch {
      // A failed update probe must not affect the already loaded app.
    }
    return registration;
  }).catch((error) => {
    serviceWorkerRegistrationPromise = null;
    console.warn("Fischteich Service Worker konnte nicht registriert werden.", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  });

  return serviceWorkerRegistrationPromise;
}

async function getExistingFischteichServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.getRegistration(FISCHTEICH_SERVICE_WORKER_SCOPE);
}

function closeUpdateModal({ dismiss = false } = {}) {
  if (!updateModalOpen || !updateModal) return;
  if (dismiss && availableBuildVersion) {
    dismissedBuildVersions.add(availableBuildVersion);
  }
  updateModal.hidden = true;
  updateModalOpen = false;
  if (updateAppElement) updateAppElement.inert = updateModalPreviousAppInert;
  updateModalPreviousFocus?.focus?.({ preventScroll: true });
  updateModalPreviousFocus = null;
}

function showUpdateModal(buildVersion) {
  if (
    !updateModal
    || updateModalOpen
    || dismissedBuildVersions.has(buildVersion)
  ) return false;

  availableBuildVersion = buildVersion;
  updateModalPreviousFocus = document.activeElement;
  updateModalPreviousAppInert = updateAppElement?.inert === true;
  if (updateAppElement) updateAppElement.inert = true;
  updateModal.hidden = false;
  updateModalOpen = true;
  updateNowButton?.focus?.({ preventScroll: true });
  return true;
}

function navigateToAvailableBuild() {
  if (!isValidBuildVersion(availableBuildVersion)) return;
  const updateUrl = new URL(window.location.href);
  updateUrl.searchParams.set("app-build", availableBuildVersion);
  window.location.replace(updateUrl.href);
}

async function requestLatestBuildVersion() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FISCHTEICH_VERSION_CHECK_TIMEOUT);
  try {
    const versionUrl = new URL("./version.json", document.baseURI);
    versionUrl.searchParams.set("check", String(Date.now()));
    const response = await window.fetch(versionUrl.href, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const version = await response.json();
    return isValidBuildVersion(version?.build) ? version.build.trim() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function checkForFischteichUpdate({ force = false } = {}) {
  if (!currentBuildVersion) return Promise.resolve(null);
  if (versionCheckPromise) return versionCheckPromise;

  const now = Date.now();
  if (!force && now - lastVersionCheckStartedAt < FISCHTEICH_VERSION_CHECK_INTERVAL) {
    return Promise.resolve(null);
  }
  lastVersionCheckStartedAt = now;

  versionCheckPromise = requestLatestBuildVersion()
    .then((latestBuildVersion) => {
      if (!latestBuildVersion || latestBuildVersion === currentBuildVersion) return null;
      availableBuildVersion = latestBuildVersion;
      showUpdateModal(latestBuildVersion);
      return latestBuildVersion;
    })
    .finally(() => {
      versionCheckPromise = null;
    });
  return versionCheckPromise;
}

updateLaterButton?.addEventListener("click", () => closeUpdateModal({ dismiss: true }));
updateNowButton?.addEventListener("click", navigateToAvailableBuild);
document.addEventListener("keydown", (event) => {
  if (!updateModalOpen || event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeUpdateModal({ dismiss: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkForFischteichUpdate();
});

window.fischteichPwa = Object.freeze({
  currentBuildVersion,
  registerServiceWorker: registerFischteichServiceWorker,
  getExistingServiceWorkerRegistration: getExistingFischteichServiceWorkerRegistration,
  checkForUpdate: checkForFischteichUpdate,
  getUpdateState: () => Object.freeze({
    currentBuildVersion,
    availableBuildVersion,
    updateModalOpen,
  }),
});

const pwaStartupRegistration = registerFischteichServiceWorker();
const pwaStartupVersionCheck = checkForFischteichUpdate({ force: true });
window.fischteichPwaStartup = Promise.allSettled([
  pwaStartupRegistration,
  pwaStartupVersionCheck,
]);
