import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

/**
 * BRIDGES CONFIGURATION
 * We use 'tunnel' for AllOrigins because it wraps the response to bypass CORS entirely.
 * We use 'standard' for others that just act as a relay.
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
 * SHADOW UNWRAPPER
 * AllOrigins wraps the API response in a JSON object. This extracts the real data.
 */
async function unwrapResponse(
  response: Response,
  type: string,
): Promise<Response> {
  if (type === "tunnel") {
    const json = await response.json();
    if (json.contents) {
      // Reconstruct a standard Response object from the tunneled contents
      return new Response(json.contents, {
        status: json.status?.http_code || 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  return response;
}

/**
 * FETCH WITH SHADOW RESILIENCE v7.0
 * Bypasses CORS Preflight and handles Captive Portal Hijacking.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  // Track failures to try next bridge
  const attempts = BRIDGES.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";
      const isTunnel = bridge.type === "tunnel";

      // Aggressive cache busting to prevent router from serving cached 302s
      const buster = `_ts=${Date.now()}`;
      const urlWithBuster = targetUrl.includes("?")
        ? `${targetUrl}&${buster}`
        : `${targetUrl}?${buster}`;

      let fullUrl = isDirect
        ? urlWithBuster
        : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        isDirect ? 5000 : 15000,
      );

      /**
       * CORS PREFLIGHT BYPASS STRATEGY:
       * If using a bridge, we avoid "application/json" content-type because it triggers
       * a CORS OPTIONS request which many proxies/routers block.
       * Instead, for Tunnels, we move the payload to the URL.
       */
      let fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
        mode: "cors",
      };

      if (!isDirect) {
        // Simple request optimization: strip custom headers
        fetchOptions.headers = { Accept: "application/json" };

        if (options.method === "POST") {
          if (isTunnel) {
            // AllOrigins Tunnel: Convert POST to GET to bypass CORS Preflight
            fullUrl += `&payload=${encodeURIComponent(options.body as string)}`;
            fetchOptions.method = "GET";
            delete fetchOptions.body;
          } else {
            // Standard Proxy: keep POST but use simple content type
            (fetchOptions.headers as any)["Content-Type"] = "text/plain";
          }
        }
      } else {
        // Direct attempt: Standard headers
        fetchOptions.headers = {
          ...options.headers,
          "Content-Type": "application/json",
        };
      }

      const response = await fetch(fullUrl, fetchOptions);
      clearTimeout(timeoutId);

      // Check for Captive Portal hijacking (returns HTML instead of JSON)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") && response.status === 200) {
        throw new Error("PORTAL_BLOCK: Router intercepted request");
      }

      // Handle Proxy wrapping
      const finalResponse = await unwrapResponse(response, bridge.type);

      if (finalResponse.ok || finalResponse.status < 500) {
        return finalResponse;
      }

      throw new Error(`Status ${finalResponse.status}`);
    } catch (err: any) {
      const errorMsg = err.name === "AbortError" ? "Timeout" : err.message;
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: errorMsg,
        timestamp: new Date().toLocaleTimeString(),
      });
      throw err;
    }
  });

  // Racing the bridges: Return the first one that succeeds
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
          const details = lastBridgeLogs
            .map((l) => `${l.bridge}: ${l.error}`)
            .join(" | ");
          reject(new Error(`All paths blocked by router. Details: ${details}`));
        }
      });
    });
  });
}

/**
 * EXPORTED API FUNCTIONS
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
