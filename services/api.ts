import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
  { name: "Direct Path (Secure)", proxy: "", type: "direct" },
  { name: "Direct Path (Fast)", proxy: "", type: "direct_http" },
  { name: "Cloud Bridge A", proxy: "https://corsproxy.io/?", type: "standard" },
  {
    name: "Cloud Bridge B",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
  },
  {
    name: "Rescue Bridge",
    proxy: "https://api.allorigins.win/raw?url=",
    type: "allorigins",
  },
  { name: "Stealth Bridge", proxy: "https://proxy.cors.sh/", type: "cors_sh" },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH HYPER-RESILIENCE v5.2
 * Uses stealth techniques to bypass hotspot router interceptions.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  const attempts = BRIDGES.map(async (bridge) => {
    try {
      let finalUrl = targetUrl;
      const isDirect = bridge.type.startsWith("direct");

      // Protocol Fallback for Direct
      if (bridge.type === "direct_http") {
        finalUrl = targetUrl.replace("https://", "http://");
      }

      // Add cache buster to prevent router from serving old "blocked" responses
      const urlWithBuster = new URL(finalUrl);
      urlWithBuster.searchParams.set("_cb", Date.now().toString());
      const processedUrl = urlWithBuster.toString();

      const fullUrl = isDirect
        ? processedUrl
        : `${bridge.proxy}${encodeURIComponent(processedUrl)}`;

      if (bridge.type === "allorigins" && options.method !== "GET")
        throw new Error("GET only");

      const controller = new AbortController();
      const timeout = isDirect ? 4000 : 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const currentHeaders: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
      };

      /**
       * STEALTH STRATEGY:
       * We send content as 'text/plain' for direct paths.
       * This makes the request a "Simple Request" in CORS terms.
       * Simple Requests do NOT trigger the 'OPTIONS' preflight check which
       * is what most hotspot routers block.
       */
      if (isDirect && options.method === "POST") {
        currentHeaders["Content-Type"] = "text/plain";
      } else {
        currentHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(fullUrl, {
        ...options,
        headers: currentHeaders,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      });

      clearTimeout(timeoutId);

      // Interception Detection (200 OK but HTML content)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Router Hijacked Connection");
      }

      if (response.status > 0) return response;
      throw new Error(`Err ${response.status}`);
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "Timeout" : err.message;
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: msg,
        timestamp: new Date().toLocaleTimeString(),
      });
      throw err;
    }
  });

  return new Promise((resolve, reject) => {
    let finishedCount = 0;
    let hasResolved = false;

    attempts.forEach((p) => {
      p.then((res) => {
        if (!hasResolved) {
          hasResolved = true;
          resolve(res);
        }
      }).catch(() => {
        finishedCount++;
        if (finishedCount === attempts.length && !hasResolved) {
          reject(
            new Error(
              "Connection failed: The hotspot router is blocking all access to the Onetel login server.",
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
