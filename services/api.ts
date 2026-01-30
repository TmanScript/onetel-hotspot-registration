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
 * Converts an object to application/x-www-form-urlencoded string.
 * This format is a "Simple Request" type in CORS, which bypasses the preflight (OPTIONS) check.
 */
function toFormData(obj: any): string {
  return Object.keys(obj)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(obj[key]))
    .join("&");
}

/**
 * FETCH WITH RESILIENCE v5.0
 * Uses "Simple Requests" for Direct Connect to bypass router-level CORS preflight blocks.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];
  let lastError: any = new Error("Connection failed");

  for (const bridge of BRIDGES) {
    try {
      const isDirect = bridge.type === "direct";
      const fullUrl = isDirect
        ? targetUrl
        : `${bridge.proxy}${encodeURIComponent(targetUrl)}`;

      if (bridge.type === "allorigins" && options.method !== "GET") continue;

      const controller = new AbortController();
      const timeout = isDirect ? 4000 : 12000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // STRATEGY:
      // For Direct Connect, we use application/x-www-form-urlencoded to avoid the browser sending an OPTIONS request.
      // Hotspot routers (Chilli/OpenWISP) often block or fail OPTIONS requests unless perfectly configured.
      const useSimple = isDirect && options.method === "POST";

      const currentHeaders: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
      };

      let currentBody = options.body;

      if (useSimple && typeof options.body === "string") {
        try {
          const jsonBody = JSON.parse(options.body);
          currentBody = toFormData(jsonBody);
          currentHeaders["Content-Type"] = "application/x-www-form-urlencoded";
        } catch (e) {
          // Fallback if not JSON
          currentHeaders["Content-Type"] = "application/json";
        }
      } else {
        currentHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(fullUrl, {
        ...options,
        headers: currentHeaders,
        body: currentBody,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      });

      clearTimeout(timeoutId);

      // Interception Detection
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error(
          "Walled Garden Intercepted: Check your uamallowed settings.",
        );
      }

      // If we got a real status from the API server, return it immediately
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

      // If direct failed but it wasn't a timeout, it's likely a CORS preflight block
      // The proxies will attempt standard JSON POSTs
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
