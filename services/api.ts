import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
  { name: "Direct Path", proxy: "", type: "direct" },
  {
    name: "Stealth Bridge A",
    proxy: "https://corsproxy.io/?",
    type: "standard",
  },
  {
    name: "Stealth Bridge B",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
  },
  {
    name: "Rescue Tunnel",
    proxy: "https://api.allorigins.win/get?url=",
    type: "tunnel",
  },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH ADAPTIVE RESILIENCE v5.6
 * Smart method switching to prevent "Method Not Allowed" errors.
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
      const isPost = options.method === "POST";

      // High-entropy cache busting
      const buster = `_v=56_${Date.now()}_${Math.random().toString(36).substring(6)}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      let fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      const timeout = isDirect ? 6000 : 22000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
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
       * v5.6 ADAPTIVE STRATEGY:
       * 1. Never use GET-tunneling for POST requests to endpoints that strictly
       *    require POST (like login/token).
       * 2. Use 'text/plain' for POSTs on standard bridges to bypass router DPI.
       */
      if (isTunnel) {
        if (isPost) {
          // AllOrigins doesn't support POST well. We skip it for logins.
          throw new Error("Bridge incompatible with POST");
        }
        // For GET (Usage), use the tunnel.
        fullUrl = `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;
        fetchOptions = { method: "GET", signal: controller.signal };
      } else if (isPost) {
        // Use text/plain to bypass router inspection while staying as a POST
        headers["Content-Type"] = "text/plain";
        fetchOptions.headers = headers;
      }

      const response = await fetch(fullUrl, fetchOptions);
      clearTimeout(timeoutId);

      // Check for Router Hijacking
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Router Hijacked Connection");
      }

      // Handle Tunnel Unwrapping
      if (isTunnel) {
        const wrapper = await response.json();
        if (wrapper.contents) {
          return new Response(wrapper.contents, {
            status: wrapper.status?.http_code || 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (response.status === 405) {
        throw new Error("Method Not Allowed (Bridge Mismatch)");
      }

      if (response.status > 0) return response;
      throw new Error(`Path Rejected (${response.status})`);
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "DNS Timeout" : err.message;
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
          const errors = lastBridgeLogs.map((l) => l.error).join(" | ");
          reject(
            new Error(
              `Login Path Blocked. Common cause: Router uamallowed list is missing api.allorigins.win or corsproxy.io. [Trace: ${errors}]`,
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
