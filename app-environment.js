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
  // Later fill in the real DEV origin, URL and browser publishable key here.
  // An incomplete configuration must never activate Development.
  const development = Object.freeze({
    origin: null,
    supabaseUrl: null,
    supabasePublishableKey: null,
  });
  const { origin, pathname } = window.location;
  const isProduction = origin === "https://vabory.github.io"
    && (pathname === "/fischteich" || pathname.startsWith("/fischteich/"));
  const isDevelopment = Boolean(development.origin && development.supabaseUrl
    && development.supabasePublishableKey && origin === development.origin);
  window.FischteichEnvironment = isProduction ? production : Object.freeze({
    name: isDevelopment ? "development" : "unknown",
    isProduction: false,
    isDevelopment,
    appName: "Fischteich",
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
