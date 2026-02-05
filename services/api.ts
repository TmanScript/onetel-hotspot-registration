import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export interface Bridge {
  name: string;
  proxy: string;
  type: "direct" | "standard" | "tunnel" | "raw";
  supportsPost: boolean;
}

export const BRIDGES: Bridge[] = [
  { name: "Direct Cloud", proxy: "", type: "direct", supportsPost: true },
  {
    name: "Bridge Alpha",
    proxy: "https://corsproxy.io/?",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Bridge Gamma",
    proxy: "https://thingproxy.freeboard.io/fetch/",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Bridge Delta",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Data Tunnel",
    proxy: "https://api.allorigins.win/raw?url=",
    type: "raw",
    supportsPost: true,
  },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH ENGINE X RESILIENCE v5.8
 * Aggressive multi-path race with header optimization to bypass router OPTIONS blocking.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];
  const isPost = options.method === "POST";

  // Filter compatible bridges
  const compatibleBridges = BRIDGES.filter((b) => !isPost || b.supportsPost);

  const attempts = compatibleBridges.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";

      // Dynamic Cache Busting to force router re-evaluation
      const buster = `_ex8=${Date.now()}_${Math.random().toString(36).substring(8)}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      const fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      const timeout = isDirect ? 4000 : 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
      };

      // v5.8 Optimization: Only add JSON content-type if there is a body.
      // Hotspots often block 'application/json' in pre-flights.
      if (options.body) {
        headers["Content-Type"] = "application/json";
      }

      const fetchOptions: RequestInit = {
        ...options,
        headers,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      };

      const response = await fetch(fullUrl, fetchOptions);
      clearTimeout(timeoutId);

      // Check for Router Interception (Captive Portal Redirects)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        const text = await response.clone().text();
        if (
          text.toLowerCase().includes("chilli") ||
          text.toLowerCase().includes("login") ||
          text.toLowerCase().includes("uam")
        ) {
          throw new Error("Router Intercepted Bridge");
        }
      }

      // Handle common proxy errors
      if (response.status === 403) throw new Error("Bridge Forbidden (403)");
      if (response.status === 405) throw new Error("Method Not Allowed (405)");
      if (response.status === 429) throw new Error("Bridge Rate Limited (429)");

      // If we got a response from the Onetel server (even a 400/401), the path is clear
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      throw new Error(`Path Error (${response.status})`);
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "Path Timeout" : err.message;
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: msg,
        timestamp: new Date().toLocaleTimeString(),
      });
      throw err;
    }
  });

  return new Promise((resolve, reject) => {
    let failedCount = 0;
    let resolved = false;

    attempts.forEach((p) => {
      p.then((res) => {
        if (!resolved) {
          resolved = true;
          resolve(res);
        }
      }).catch(() => {
        failedCount++;
        if (failedCount === attempts.length && !resolved) {
          const summary = lastBridgeLogs
            .map((l) => `${l.bridge}: ${l.error}`)
            .join(" | ");
          reject(
            new Error(
              `Security Alert: The hotspot is blocking the secure authentication tunnel. Ensure 'thingproxy.freeboard.io' is added to your uamallowed list. [Trace: ${summary}]`,
            ),
          );
        }
      });
    });
  });
}

export const registerUser = async (
  data: RegistrationPayload,
): Promise<Response> => {
  return await fetchWithResilience(API_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const loginUser = async (data: LoginPayload): Promise<Response> => {
  const url = `${API_ENDPOINT}token/`;
  return await fetchWithResilience(url, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const getUsage = async (token: string): Promise<Response> => {
  const url = `${API_ENDPOINT}usage/`;
  return await fetchWithResilience(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
};

export const requestOtp = async (token: string): Promise<Response> => {
  const url = `${API_ENDPOINT}phone/token/`;
  return await fetchWithResilience(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
};

export const verifyOtp = async (
  token: string,
  code: string,
): Promise<Response> => {
  const url = `${API_ENDPOINT}phone/verify/`;
  return await fetchWithResilience(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
};
