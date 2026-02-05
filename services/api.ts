import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export interface Bridge {
  name: string;
  proxy: string;
  type: "direct" | "standard" | "tunnel";
  supportsPost: boolean;
}

export const BRIDGES: Bridge[] = [
  { name: "Direct Path", proxy: "", type: "direct", supportsPost: true },
  {
    name: "Bridge Alpha",
    proxy: "https://corsproxy.io/?",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Bridge Beta",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Data Tunnel",
    proxy: "https://api.allorigins.win/get?url=",
    type: "tunnel",
    supportsPost: false,
  },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH UNIVERSAL RESILIENCE v5.7
 * Intelligent bridge filtering based on HTTP Method capability.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];
  const isPost = options.method === "POST";

  // Filter bridges: If we are doing a POST (Login), remove bridges that don't support it.
  const compatibleBridges = BRIDGES.filter((b) => !isPost || b.supportsPost);

  const attempts = compatibleBridges.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";
      const isTunnel = bridge.type === "tunnel";

      // Cache busting to force router to re-evaluate the path
      const buster = `_uv=57_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      const fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      const timeout = isDirect ? 5000 : 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
        "Content-Type": "application/json", // Fixed: Back to JSON to resolve 415 error
      };

      const fetchOptions: RequestInit = {
        ...options,
        headers,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      };

      const response = await fetch(fullUrl, fetchOptions);
      clearTimeout(timeoutId);

      // Detect Router Hijacking (HTML instead of JSON)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Router Hijack Detected");
      }

      // Handle Tunnel Unwrapping (AllOrigins)
      if (isTunnel) {
        const wrapper = await response.json();
        if (wrapper.contents) {
          return new Response(wrapper.contents, {
            status: wrapper.status?.http_code || 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // If server specifically says method not allowed, this bridge is dead for this request type
      if (response.status === 405) throw new Error("Method Not Allowed");
      if (response.status === 415) throw new Error("Unsupported Media Type");

      if (response.status > 0) return response;
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
              `All Login Paths Blocked. Check uamallowed for: corsproxy.io, api.codetabs.com. [Details: ${summary}]`,
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
