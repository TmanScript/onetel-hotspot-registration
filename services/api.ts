import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

/**
 * BRIDGE CONFIGURATION
 * AllOrigins is the primary "Shadow" because it allows us to turn POSTs into GETs
 * to bypass the CORS Preflight (OPTIONS) block shown in your console logs.
 */
export const BRIDGES = [
  { name: "Direct Cloud", proxy: "", type: "direct" },
  {
    name: "Rescue Shadow (AllOrigins)",
    proxy: "https://api.allorigins.win/get?url=",
    type: "tunnel",
  },
  {
    name: "Mirror Path (Codetabs)",
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
 * FETCH WITH SHADOW RESILIENCE v8.0
 * Redesigned to stop CORS Preflight (OPTIONS) blocks and handle Router Hijacking.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  // We try bridges one by one (Serial execution) to prevent browser-side network congestion
  for (const bridge of BRIDGES) {
    try {
      const isDirect = bridge.type === "direct";
      const isTunnel = bridge.type === "tunnel";

      // Cache busting ensures the router doesn't serve a cached login page
      const buster = `_ts=${Date.now()}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      let fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      let fetchOptions: RequestInit = {
        ...options,
        mode: "cors",
        credentials: "omit",
      };

      /**
       * BYPASSING CORS PREFLIGHT:
       * Your console logs showed "Response to preflight request doesn't pass access control".
       * To fix this, we avoid sending 'application/json' via bridges.
       */
      if (!isDirect) {
        if (isTunnel && options.method === "POST") {
          // AllOrigins Tunnel Strategy:
          // We attach the JSON body to the URL and use GET.
          // This is a "Simple Request" that does NOT trigger CORS Preflight.
          fullUrl += `&payload=${encodeURIComponent(options.body as string)}`;
          fetchOptions.method = "GET";
          delete fetchOptions.body;
          fetchOptions.headers = { Accept: "application/json" };
        } else {
          // Standard Proxy Strategy:
          // We use text/plain to avoid the "OPTIONS" preflight check.
          fetchOptions.headers = {
            "Content-Type": "text/plain",
            Accept: "application/json",
          };
        }
      } else {
        // Direct attempt uses standard JSON headers
        fetchOptions.headers = {
          ...options.headers,
          "Content-Type": "application/json",
        };
      }

      const response = await fetch(fullUrl, fetchOptions);

      // 1. Detect Router Hijacking (Status 200 but HTML content)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("PORTAL_HIJACK: Router is asking for login.");
      }

      // 2. Unwrap AllOrigins Bridge
      if (isTunnel) {
        const wrapper = await response.json();
        if (wrapper.contents) {
          // AllOrigins wraps the API response inside 'contents'
          return new Response(wrapper.contents, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // 3. Handle Standard Responses
      if (response.ok) return response;

      // Handle specific error codes
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Error ${response.status}`);
    } catch (err: any) {
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: err.message || "Connection Failed",
        timestamp: new Date().toLocaleTimeString(),
      });
      // Logic continues to loop to the next bridge in the BRIDGES array
    }
  }

  // If we reach here, all bridges failed
  const lastError =
    lastBridgeLogs[lastBridgeLogs.length - 1]?.error || "Network Blocked";
  throw new Error(lastError);
}

/**
 * EXPORTED API ACTIONS
 */

export const registerUser = async (
  data: RegistrationPayload,
): Promise<Response> => {
  return await fetchWithResilience(`${API_ENDPOINT}register/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const loginUser = async (data: {
  username: string;
  password: string;
}): Promise<Response> => {
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
