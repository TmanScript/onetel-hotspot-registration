import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
  { name: "Direct Cloud", proxy: "", type: "direct" },
  {
    name: "Rescue Shadow (Raw)",
    proxy: "https://api.allorigins.win/raw?url=",
    type: "raw",
  },
  {
    name: "Tunnel Shadow (Get)",
    proxy: "https://api.allorigins.win/get?url=",
    type: "tunnel",
  },
  { name: "Mirror Path A", proxy: "https://corsproxy.io/?", type: "standard" },
  {
    name: "Mirror Path B",
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
 * FETCH WITH SHADOW RESILIENCE v5.4
 * Sophisticated unwrapping and multi-path execution.
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
      const isRaw = bridge.type === "raw";

      // Aggressive cache busting
      const buster = `_shadow=${Date.now()}_${Math.random().toString(36).substring(5)}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      let fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      // Increase timeout for slow hotspot DNS
      const timeout = isDirect ? 5000 : 25000;
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

      // v5.4 Strategy: GET-Tunneling for POSTs
      if ((isTunnel || isRaw) && options.method === "POST") {
        const tunnelUrl = `${bridge.proxy}${encodeURIComponent(urlWithBuster)}&payload=${encodeURIComponent(options.body as string)}`;
        fullUrl = tunnelUrl;
        fetchOptions = { method: "GET", signal: controller.signal };
      } else if (isDirect && options.method === "POST") {
        currentHeaders["Content-Type"] = "text/plain";
        fetchOptions.headers = currentHeaders;
      } else {
        currentHeaders["Content-Type"] = "application/json";
        fetchOptions.headers = currentHeaders;
      }

      const response = await fetch(fullUrl, fetchOptions);
      clearTimeout(timeoutId);

      // Detection of Hotspot Interception
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("Router Hijacked: Return HTML instead of Data");
      }

      /**
       * SHADOW UNWRAPPER:
       * If we used the 'tunnel' bridge, the response is a JSON object with a 'contents' key.
       * We need to "unwrap" it to get the actual Onetel API response.
       */
      if (isTunnel) {
        const wrapper = await response.json();
        if (wrapper.contents) {
          return new Response(wrapper.contents, {
            status: wrapper.status?.http_code || 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (response.status > 0) return response;
      throw new Error(`Path Rejected (${response.status})`);
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "DNS/Path Timeout" : err.message;
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
          const detailedErrors = lastBridgeLogs
            .map((l) => `[${l.bridge}: ${l.error}]`)
            .join(" ");
          reject(
            new Error(`All paths blocked by router. Logs: ${detailedErrors}`),
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
