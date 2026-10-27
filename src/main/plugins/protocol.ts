import { protocol, type Session } from "electron";
import { randomUUID } from "node:crypto";

// Registered while main modules are loaded, before app.whenReady.
protocol.registerSchemesAsPrivileged([{
  scheme: "terraforge-plugin",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const CSP = "default-src 'none'; script-src blob:; worker-src blob:; connect-src 'none';";
const HTML = '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + CSP + '"><title>TerraForge plugin runner</title>';

/** Serve one inert page only. A fresh origin isolates each run's browser storage. */
export function configurePluginProtocol(pluginSession: Session): {
  createHostUrl: () => string;
} {
  const approved = new Set<string>();
  pluginSession.protocol.handle("terraforge-plugin", (request) =>
    approved.has(request.url)
      ? new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP } })
      : new Response("Not found", { status: 404 }),
  );
  pluginSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !approved.has(details.url) && !details.url.startsWith("blob:") });
  });
  return {
    createHostUrl: () => {
      approved.clear();
      const url = "terraforge-plugin://" + randomUUID() + "/host";
      approved.add(url);
      return url;
    },
  };
}
