import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

/**
 * CONFIGURATION FOR CAPTIVE PORTAL
 * Update ROUTER_IP if your OpenWISP setup uses a different gateway (e.g., 192.168.1.1)
 */
const ROUTER_IP = "10.1.0.1";
const CHILLI_JSON_API = `http://${ROUTER_IP}:3990/json/status`;

export const BRIDGES = [
  { name: "Direct Cloud", proxy: "", type: "direct" },
  {
    name: "Rescue Shadow (Raw)",
    proxy: "https://api.allorigins.win/raw?url=",
    type: "raw",
  },
  {
    name: "Mirror Path A",
    proxy: "https://corsproxy.io/?",
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
 * HELPER: Checks if we are actually connected to the Chilli Router
 * This works even without internet.
 */
export async function getChilliStatus() {
  try {
    const res = await fetch(CHILLI_JSON_API, { mode: "cors" });
    return await res.json();
  } catch (e) {
    return { clientState: -1, message: "Not on Portal Network" };
  }
}

/**
 * FETCH WITH SHADOW RESILIENCE v6.0
 * Handles "Secure Login Blocked" by detecting hijacking before SSL handshake.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  // STEP 1: PRE-FLIGHT CHECK (Prevent SSL Error Trap)
  // We fetch a non-secure URL. If it returns HTML, the router is hijacking us.
  try {
    const probe = await fetch(`http://neverssl.com?_=${Date.now()}`, {
      mode: "no-cors",
    });
    // If the probe fails or behaves weirdly, we proceed, but this is a hint.
  } catch (e) {
    console.warn("Portal redirect detected or network offline");
  }

  const attempts = BRIDGES.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";
      const isRaw = bridge.type === "raw";

      const buster = `_shadow=${Date.now()}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      let fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      const timeout = isDirect ? 6000 : 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const currentHeaders: Record<string, string> = {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        Accept: "application/json",
      };

      let fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
        mode: "cors",
      };

      // Handle POST tunneling for restrictive proxies
      if (isRaw && options.method === "POST") {
        // Some proxies only allow GET, so we tunnel POST body as a query param
        fullUrl += `&payload=${encodeURIComponent(options.body as string)}`;
        fetchOptions.method = "GET";
      } else {
        fetchOptions.headers = currentHeaders;
        if (options.method === "POST") {
          currentHeaders["Content-Type"] = "application/json";
        }
      }

      const response = await fetch(fullUrl, fetchOptions);
      clearTimeout(timeoutId);

      // STEP 2: CAPTIVE PORTAL DETECTION
      const contentType = response.headers.get("content-type") || "";

      // If the router sends HTML instead of JSON, it's the Login Page
      if (contentType.includes("text/html") || response.status === 302) {
        throw new Error(
          "PORTAL_REJECTION: Router is blocking access. Please log in to Wi-Fi.",
        );
      }

      if (response.ok || response.status < 500) return response;

      throw new Error(`Bridge Rejected (${response.status})`);
    } catch (err: any) {
      let friendlyError = err.message;
      if (err.name === "AbortError")
        friendlyError = "Connection Timeout (DNS Fail)";
      if (err.message.includes("Failed to fetch"))
        friendlyError = "SSL Blocked/Clock Error";

      lastBridgeLogs.push({
        bridge: bridge.name,
        error: friendlyError,
        timestamp: new Date().toLocaleTimeString(),
      });
      throw err;
    }
  });

  // Racing the bridges: First successful response wins
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
          const logs = lastBridgeLogs
            .map((l) => `${l.bridge}: ${l.error}`)
            .join(" | ");
          reject(new Error(`Network Blocked: ${logs}`));
        }
      });
    });
  });
}

/**
 * API EXPORTS
 */

export const registerUser = async (
  data: RegistrationPayload,
): Promise<Response> => {
  return await fetchWithResilience(`${API_ENDPOINT}register/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const loginUser = async (data: LoginPayload): Promise<Response> => {
  return await fetchWithResilience(`${API_ENDPOINT}token/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const getUsage = async (token: string): Promise<Response> => {
  return await fetchWithResilience(`${API_ENDPOINT}usage/`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
};

export const requestOtp = async (token: string): Promise<Response> => {
  return await fetchWithResilience(`${API_ENDPOINT}phone/token/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
};

export const verifyOtp = async (
  token: string,
  code: string,
): Promise<Response> => {
  return await fetchWithResilience(`${API_ENDPOINT}phone/verify/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
};
