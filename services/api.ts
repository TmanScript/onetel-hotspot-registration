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
 * Tries multiple bridges and multiple request formats to find a path through the Walled Garden.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];
  let lastError: any = new Error("No bridges attempted");

  for (const bridge of BRIDGES) {
    // Stage 1: Standard JSON Request (with CORS preflight)
    // Stage 2: Simple Request (to bypass preflight if Stage 1 fails)
    const modes = ["json", "simple"];

    for (const mode of modes) {
      try {
        const isDirect = bridge.type === "direct";
        const fullUrl = isDirect
          ? targetUrl
          : `${bridge.proxy}${encodeURIComponent(targetUrl)}`;

        // Skip allorigins for POST
        if (bridge.type === "allorigins" && options.method !== "GET") continue;

        const controller = new AbortController();
        // Give direct requests less time to fail fast, proxies more time
        const timeout = isDirect ? 3000 : 8000;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const currentHeaders: Record<string, string> = {
          ...(options.headers as Record<string, string>),
          Accept: "application/json",
        };

        // Bypassing preflight: 'text/plain' is a "simple" content-type that doesn't trigger OPTIONS preflight.
        if (mode === "simple" && options.method === "POST") {
          currentHeaders["Content-Type"] = "text/plain";
        }

        const response = await fetch(fullUrl, {
          ...options,
          headers: currentHeaders,
          signal: controller.signal,
          mode: "cors",
          credentials: "omit",
        });

        clearTimeout(timeoutId);

        // Interception Detection
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html") && response.status === 200) {
          throw new Error("Walled Garden Intercepted (HTML returned)");
        }

        // We accept the response if it's from the API (even 4xx errors are "success" for the bridge)
        if (response.status > 0) return response;
      } catch (err: any) {
        const errorMsg = err.name === "AbortError" ? "Timed out" : err.message;
        lastBridgeLogs.push({
          bridge: `${bridge.name} (${mode})`,
          error: errorMsg,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        lastError = err;

        // If it was a timeout or interception, don't bother with 'simple' mode for this bridge, move to next bridge
        if (err.name === "AbortError" || err.message.includes("Intercepted"))
          break;
      }
    }
  }

  throw lastError;
}

export const registerUser = async (
  data: RegistrationPayload,
): Promise<Response> => {
  return await fetchWithResilience(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
};

export const loginUser = async (data: LoginPayload): Promise<Response> => {
  const url = `${API_ENDPOINT}token/`;
  return await fetchWithResilience(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    body: "",
  });
};

export const verifyOtp = async (
  token: string,
  code: string,
): Promise<Response> => {
  const url = `${API_ENDPOINT}phone/verify/`;
  return await fetchWithResilience(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
};
