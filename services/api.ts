import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
  { name: "Direct Path", proxy: "", type: "direct" },
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
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * Converts an object to application/x-www-form-urlencoded string.
 */
function toFormData(obj: any): string {
  return Object.keys(obj)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(obj[key]))
    .join("&");
}

/**
 * FETCH WITH RESILIENCE v5.1 - BRIDGE RACE
 * Attempts multiple paths in parallel to bypass restrictive Hotspot Walled Gardens.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  // Define individual bridge attempts
  const attempts = BRIDGES.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";
      const fullUrl = isDirect
        ? targetUrl
        : `${bridge.proxy}${encodeURIComponent(targetUrl)}`;

      // AllOrigins is GET only for the raw proxy
      if (bridge.type === "allorigins" && options.method !== "GET") {
        throw new Error("Bridge incompatible with POST");
      }

      const controller = new AbortController();
      const timeout = isDirect ? 5000 : 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const currentHeaders: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
      };

      let currentBody = options.body;

      // Use "Simple Request" (Form Data) for Direct to avoid preflight OPTIONS block
      if (
        isDirect &&
        options.method === "POST" &&
        typeof options.body === "string"
      ) {
        try {
          const jsonBody = JSON.parse(options.body);
          currentBody = toFormData(jsonBody);
          currentHeaders["Content-Type"] = "application/x-www-form-urlencoded";
        } catch (e) {
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

      // Detection of Hotspot Interception
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Intercepted by Router");
      }

      if (response.status > 0) return response;
      throw new Error(`Status ${response.status}`);
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

  // RACE: Return the first successful response
  // We use a custom 'any' logic because we want the first OK response, not just the first settled one.
  return new Promise((resolve, reject) => {
    let finished = 0;
    attempts.forEach((p) => {
      p.then((res) => {
        if (!finished) {
          finished = 1;
          resolve(res);
        }
      }).catch((err) => {
        finished++;
        if (finished === attempts.length) {
          reject(
            new Error(
              "All connection paths are currently blocked by the router.",
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
