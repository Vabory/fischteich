"use strict";

(() => {
  const production = Object.freeze({
    name: "production",
    isProduction: true,
    isDevelopment: false,
    appName: "Fischteich",
    supabaseUrl: "https://qhgiqhuodkrevmmbwfeg.supabase.co",
    supabasePublishableKey: "sb_publishable_Ex5JLH1PpN-N1gGZPDcNtQ_RbO9y7P-",
  });
  // DEV uses its own exact origin and public browser configuration.
  // An incomplete configuration must never activate Development.
  const development = Object.freeze({
    origin: "https://fischteich-dev.pages.dev",
    supabaseUrl: "https://vifxrzecsvdfpdmzquom.supabase.co",
    supabasePublishableKey: "sb_publishable_zeT9WAdU2s75ve0M0uKhJA_J7hJ6uho",
  });
  const { origin, pathname } = window.location;
  const isProduction = origin === "https://vabory.github.io"
    && (pathname === "/fischteich" || pathname.startsWith("/fischteich/"));
  const isDevelopment = Boolean(development.origin && origin === development.origin
    && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(development.supabaseUrl ?? "")
    && /^sb_publishable_[A-Za-z0-9_-]+$/.test(development.supabasePublishableKey ?? ""));
  window.FischteichEnvironment = isProduction ? production : Object.freeze({
    name: isDevelopment ? "development" : "unknown",
    isProduction: false,
    isDevelopment,
    appName: isDevelopment ? "Fischteich DEV" : "Fischteich",
    supabaseUrl: isDevelopment ? development.supabaseUrl : null,
    supabasePublishableKey: isDevelopment ? development.supabasePublishableKey : null,
  });
  if (!isProduction && !isDevelopment) {
    // Keep the DOM available for existing scripts, but disable all app interaction.
    document.body.inert = true;
    const style = document.createElement("style");
    style.textContent = "body > :not(#environment-error) { display: none !important; }";
    document.head.append(style);
    const message = document.createElement("p");
    message.id = "environment-error";
    message.setAttribute("role", "alert");
    message.textContent = "Fischteich Environment konnte nicht bestimmt werden.";
    document.body.append(message);
  }
})();
