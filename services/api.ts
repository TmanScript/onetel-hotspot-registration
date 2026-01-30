import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
  { name: "Direct Connect", proxy: "", type: "direct" },
  { name: "Fast Bridge", proxy: "https://corsproxy.io/?", type: "standard" },
  {
    name: "Secure Bridge",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
  },
  {
    name: "JSON Bridge",
    proxy: "https://api.allorigins.win/raw?url=",
    type: "allorigins",
  },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH RESILIENCE
 * Optimized for Onetel API which requires strict JSON parsing.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];
  let lastError: any = new Error("No bridges attempted");

  for (const bridge of BRIDGES) {
    try {
      const isDirect = bridge.type === "direct";
      const fullUrl = isDirect
        ? targetUrl
        : `${bridge.proxy}${encodeURIComponent(targetUrl)}`;

      // AllOrigins is GET only for the raw proxy
      if (bridge.type === "allorigins" && options.method !== "GET") continue;

      const controller = new AbortController();
      const timeout = isDirect ? 3000 : 10000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // We MUST use application/json or the server won't see the body
      const currentHeaders: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
        "Content-Type": "application/json",
      };

      const response = await fetch(fullUrl, {
        ...options,
        headers: currentHeaders,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      });

      clearTimeout(timeoutId);

      // Detect if we hit the router login page instead of the API
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Walled Garden: Router intercepted request.");
      }

      // If we got a 401/403, the server definitely received the request
      if (response.status === 401 || response.status === 403) {
        lastBridgeLogs.push({
          bridge: bridge.name,
          error: "Server Reached: Credentials Rejected (401)",
          timestamp: new Date().toLocaleTimeString(),
        });
        return response;
      }

      if (response.status > 0) return response;
    } catch (err: any) {
      const errorMsg = err.name === "AbortError" ? "Timed out" : err.message;
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: errorMsg,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
      lastError = err;

      if (err.name === "AbortError" || err.message.includes("intercepted"))
        continue;
    }
  }

  throw lastError;
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
