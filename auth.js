"use strict";

const APP_AUTH_STATE_EVENT = "fischteich:auth-state-change";

const appAuthState = {
  currentAuthUser: null,
  currentProfile: null,
  isAdmin: false,
  isInitialized: false,
  lastError: null,
};

let authInitializationPromise = null;
let anonymousSignInPromise = null;
let anonymousSignInFailed = false;
let authStateSubscription = null;
let authReconcileQueue = Promise.resolve();

function getAppAuthState() {
  return Object.freeze({
    currentAuthUser: appAuthState.currentAuthUser,
    currentProfile: appAuthState.currentProfile,
    isAdmin: appAuthState.isAdmin,
    isInitialized: appAuthState.isInitialized,
    lastError: appAuthState.lastError,
  });
}

function publishAppAuthState() {
  window.dispatchEvent(new CustomEvent(APP_AUTH_STATE_EVENT, {
    detail: getAppAuthState(),
  }));
}

function reportAppAuthError(context, error) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  appAuthState.lastError = normalizedError;
  console.error(`[Auth] ${context}`, normalizedError);
  publishAppAuthState();
  return normalizedError;
}

function normalizeAppProfile(value) {
  const profile = Array.isArray(value) ? value[0] : value;

  if (
    !profile
    || typeof profile.user_id !== "string"
    || typeof profile.display_name !== "string"
    || !["user", "admin"].includes(profile.app_role)
  ) {
    return null;
  }

  return Object.freeze({
    userId: profile.user_id,
    displayName: profile.display_name,
    appRole: profile.app_role,
  });
}

async function loadAppProfile(userId) {
  const { data, error } = await supabaseClient
    .from("app_profiles")
    .select("user_id,display_name,app_role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const profile = normalizeAppProfile(data);

  if (!profile) {
    throw new Error("Authenticated user has no valid app_profiles row");
  }

  return profile;
}

async function updateAuthenticatedProfileDisplayName(displayName) {
  const { data, error } = await supabaseClient.rpc(
    "update_my_app_profile_display_name",
    { p_display_name: displayName },
  );

  if (error) {
    throw error;
  }

  const profile = normalizeAppProfile(data);

  if (!profile) {
    throw new Error("Profile update returned no valid app profile");
  }

  return profile;
}

async function applyAuthSession(
  session,
  { forceProfileReload = false, throwOnProfileError = false } = {},
) {
  const user = session?.user ?? null;

  if (!user) {
    appAuthState.currentAuthUser = null;
    appAuthState.currentProfile = null;
    appAuthState.isAdmin = false;
    appAuthState.lastError = null;
    publishAppAuthState();
    return getAppAuthState();
  }

  const userChanged = appAuthState.currentAuthUser?.id !== user.id;
  appAuthState.currentAuthUser = user;

  if (userChanged) {
    appAuthState.currentProfile = null;
    appAuthState.isAdmin = false;
  }

  if (!userChanged && appAuthState.currentProfile && !forceProfileReload) {
    appAuthState.lastError = null;
    publishAppAuthState();
    return getAppAuthState();
  }

  try {
    let profile = await loadAppProfile(user.id);
    const localDisplayName = getDisplayName();

    if (localDisplayName && profile.displayName !== localDisplayName) {
      profile = await updateAuthenticatedProfileDisplayName(localDisplayName);
    }

    appAuthState.currentProfile = profile;
    appAuthState.isAdmin = profile.appRole === "admin";
    appAuthState.lastError = null;
    publishAppAuthState();
    return getAppAuthState();
  } catch (error) {
    appAuthState.currentProfile = null;
    appAuthState.isAdmin = false;
    const normalizedError = reportAppAuthError("Profil konnte nicht geladen werden.", error);

    if (throwOnProfileError) {
      throw normalizedError;
    }

    return getAppAuthState();
  }
}

function queueAuthSessionReconciliation(session, options) {
  authReconcileQueue = authReconcileQueue
    .catch(() => undefined)
    .then(() => applyAuthSession(session, options));
  return authReconcileQueue;
}

function subscribeToAppAuthState(listener) {
  if (typeof listener !== "function") {
    throw new TypeError("Auth state listener must be a function");
  }

  const eventListener = (event) => listener(event.detail);
  window.addEventListener(APP_AUTH_STATE_EVENT, eventListener);
  listener(getAppAuthState());

  return () => window.removeEventListener(APP_AUTH_STATE_EVENT, eventListener);
}

async function ensureAnonymousAuthSession({ allowRetry = false } = {}) {
  if (appAuthState.currentAuthUser) {
    return getAppAuthState();
  }

  if (anonymousSignInPromise) {
    return anonymousSignInPromise;
  }

  if (anonymousSignInFailed && !allowRetry) {
    return getAppAuthState();
  }

  anonymousSignInPromise = (async () => {
    try {
      const { data, error } = await supabaseClient.auth.signInAnonymously();

      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("Anonymous sign-in returned no session");
      }

      anonymousSignInFailed = false;
      return await queueAuthSessionReconciliation(data.session, {
        forceProfileReload: true,
      });
    } catch (error) {
      anonymousSignInFailed = true;
      reportAppAuthError("Anonyme Anmeldung fehlgeschlagen; lokale Funktionen bleiben verfügbar.", error);
      return getAppAuthState();
    } finally {
      anonymousSignInPromise = null;
    }
  })();

  return anonymousSignInPromise;
}

function registerAuthStateListener() {
  if (authStateSubscription) {
    return;
  }

  const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      void queueAuthSessionReconciliation(session)
        .then(() => {
          if (!session && event === "SIGNED_OUT") {
            return ensureAnonymousAuthSession({ allowRetry: true });
          }
          return undefined;
        })
        .catch((error) => {
          reportAppAuthError(`Auth-Status ${event} konnte nicht verarbeitet werden.`, error);
        });
    }, 0);
  });

  authStateSubscription = data.subscription;
}

function initializeAppAuth() {
  if (authInitializationPromise) {
    return authInitializationPromise;
  }

  authInitializationPromise = (async () => {
    try {
      registerAuthStateListener();
      const { data, error } = await supabaseClient.auth.getSession();

      if (error) {
        throw error;
      }

      if (data.session) {
        await queueAuthSessionReconciliation(data.session, {
          forceProfileReload: true,
        });
      } else {
        await ensureAnonymousAuthSession();
      }
    } catch (error) {
      reportAppAuthError("Auth-Initialisierung fehlgeschlagen; lokale Funktionen bleiben verfügbar.", error);
    } finally {
      appAuthState.isInitialized = true;
      publishAppAuthState();
    }

    return getAppAuthState();
  })();

  return authInitializationPromise;
}

async function syncCurrentAuthProfileDisplayName(displayName = getDisplayName()) {
  const normalizedDisplayName = normalizeDisplayName(displayName);

  if (!normalizedDisplayName) {
    return false;
  }

  await initializeAppAuth();

  if (!appAuthState.currentAuthUser) {
    return false;
  }

  if (appAuthState.currentProfile?.displayName === normalizedDisplayName) {
    return true;
  }

  try {
    const profile = await updateAuthenticatedProfileDisplayName(normalizedDisplayName);
    appAuthState.currentProfile = profile;
    appAuthState.isAdmin = profile.appRole === "admin";
    appAuthState.lastError = null;
    publishAppAuthState();
    return true;
  } catch (error) {
    reportAppAuthError("Lokaler Anzeigename konnte nicht mit app_profiles synchronisiert werden.", error);
    return false;
  }
}

async function signInAdminWithPassword(email, password) {
  const normalizedEmail = typeof email === "string" ? email.trim() : "";

  if (!normalizedEmail || typeof password !== "string" || !password) {
    throw new TypeError("E-Mail und Passwort werden für den Admin-Login benötigt");
  }

  await initializeAppAuth();

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    throw reportAppAuthError("Admin-Anmeldung fehlgeschlagen.", error);
  }

  if (!data.session) {
    throw reportAppAuthError("Admin-Anmeldung lieferte keine Session.", new Error("Missing session"));
  }

  try {
    await queueAuthSessionReconciliation(data.session, {
      forceProfileReload: true,
      throwOnProfileError: true,
    });
  } catch (profileError) {
    const { error: signOutError } = await supabaseClient.auth.signOut({ scope: "local" });

    if (signOutError) {
      throw reportAppAuthError(
        "Adminprofil konnte nicht geprüft und die Session nicht zurückgesetzt werden.",
        signOutError,
      );
    }

    await queueAuthSessionReconciliation(null);
    await ensureAnonymousAuthSession({ allowRetry: true });
    throw profileError;
  }

  if (!appAuthState.isAdmin) {
    await supabaseClient.auth.signOut({ scope: "local" });
    await queueAuthSessionReconciliation(null);
    await ensureAnonymousAuthSession({ allowRetry: true });
    throw reportAppAuthError(
      "Angemeldetes Konto besitzt keine Adminrolle.",
      new Error("The authenticated account is not an admin"),
    );
  }

  return getAppAuthState();
}

async function signOutAdmin() {
  await initializeAppAuth();

  if (!appAuthState.currentAuthUser) {
    return ensureAnonymousAuthSession({ allowRetry: true });
  }

  if (appAuthState.currentAuthUser.is_anonymous === true) {
    return getAppAuthState();
  }

  const { error } = await supabaseClient.auth.signOut({ scope: "local" });

  if (error) {
    throw reportAppAuthError("Admin-Abmeldung fehlgeschlagen.", error);
  }

  await queueAuthSessionReconciliation(null);
  return ensureAnonymousAuthSession({ allowRetry: true });
}
