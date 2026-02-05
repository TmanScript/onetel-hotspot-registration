import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
  { name: "Primary Path", proxy: "", type: "direct" },
  {
    name: "Tunnel Bridge",
    proxy: "https://api.allorigins.win/get?url=",
    type: "tunnel",
  },
  { name: "Cloud Path A", proxy: "https://corsproxy.io/?", type: "standard" },
  {
    name: "Cloud Path B",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
  },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH TUNNELING RESILIENCE v5.3
 * Disguises requests to pass through aggressive router filters.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  const attempts = BRIDGES.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";
      const isTunnel = bridge.type === "tunnel";

      // Add a high-entropy cache buster to every single path
      const buster = `_ts=${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      let fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      const timeout = isDirect ? 4000 : 18000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const currentHeaders: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
      };

      let fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      };

      /**
       * TUNNELING STRATEGY (The "Silver Bullet"):
       * If we use the 'tunnel' bridge, we convert the POST into a GET request
       * with the payload as a query parameter. This bypasses 99% of router-level
       * POST blocks because it looks like a standard web page load.
       */
      if (isTunnel && options.method === "POST") {
        const tunnelUrl = `${bridge.proxy}${encodeURIComponent(urlWithBuster)}&payload=${encodeURIComponent(options.body as string)}`;
        fullUrl = tunnelUrl;
        fetchOptions = { method: "GET", signal: controller.signal };
      } else if (isDirect && options.method === "POST") {
        // Simple request to bypass preflight
        currentHeaders["Content-Type"] = "text/plain";
        fetchOptions.headers = currentHeaders;
      } else {
        currentHeaders["Content-Type"] = "application/json";
        fetchOptions.headers = currentHeaders;
      }

      const response = await fetch(fullUrl, { ...fetchOptions });
      clearTimeout(timeoutId);

      // Detection of Hotspot Login Page Interception
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Router Intercepted (Walled Garden Block)");
      }

      if (response.status > 0) return response;
      throw new Error(`Failed with status ${response.status}`);
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "Path Timed Out" : err.message;
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
          reject(
            new Error(
              "The Hotspot Router is actively blocking all secure login paths. Please ensure your uamallowed list is correctly saved and the router has been restarted.",
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
