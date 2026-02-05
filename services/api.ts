import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export interface Bridge {
  name: string;
  proxy: string;
  type: "local" | "direct" | "standard" | "tunnel";
  supportsPost: boolean;
}

/**
 * v6.1: Aligned with OpenWISP Umoja Template
 * Primary Bridge: wifi-auth.umoja.network (Local Alias)
 */
export const BRIDGES: Bridge[] = [
  {
    name: "Umoja Local",
    proxy:
      "https://wifi-auth.umoja.network/api/v1/radius/organization/umoja/account/",
    type: "local",
    supportsPost: true,
  },
  { name: "Direct Path", proxy: "", type: "direct", supportsPost: true },
  {
    name: "Bridge Alpha",
    proxy: "https://corsproxy.io/?",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Bridge Gamma",
    proxy: "https://thingproxy.freeboard.io/fetch/",
    type: "standard",
    supportsPost: true,
  },
  {
    name: "Bridge Delta",
    proxy: "https://api.codetabs.com/v1/proxy/?quest=",
    type: "standard",
    supportsPost: true,
  },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];
let successfulBridgeName: string | null = null;

/**
 * FETCH WITH UMOJA LOCAL-FIRST v6.1
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];
  const isPost = options.method === "POST";

  // Sort bridges: Priority to successful path, then Local Umoja bridge
  const sortedBridges = [...BRIDGES].sort((a, b) => {
    if (a.name === successfulBridgeName) return -1;
    if (b.name === successfulBridgeName) return 1;
    if (a.type === "local") return -1;
    return 0;
  });

  const compatibleBridges = sortedBridges.filter(
    (b) => !isPost || b.supportsPost,
  );

  const attempts = compatibleBridges.map(async (bridge) => {
    try {
      const isDirect = bridge.type === "direct";
      const isLocal = bridge.type === "local";

      let fullUrl: string;
      if (isLocal) {
        // Map direct Onetel endpoint to Umoja Proxy endpoint
        const pathSuffix = targetUrl.split("/account/")[1] || "";
        fullUrl = `${bridge.proxy}${pathSuffix}`;
      } else {
        const buster = `_umoja=${Date.now()}`;
        const urlWithBuster = targetUrl.includes("?")
          ? `${targetUrl}&${buster}`
          : `${targetUrl}?${buster}`;
        fullUrl = isDirect
          ? urlWithBuster
          : `${bridge.proxy}${encodeURIComponent(urlWithBuster)}`;
      }

      const controller = new AbortController();
      const timeout = isDirect || isLocal ? 4000 : 18000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      if (options.headers) {
        Object.entries(options.headers).forEach(
          ([k, v]) => (headers[k] = v as string),
        );
      }

      // v6.1 Strategy: Use 'text/plain' for POSTs on external bridges to skip OPTIONS check
      if (options.body) {
        headers["Content-Type"] =
          isDirect || isLocal ? "application/json" : "text/plain";
      }

      const response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
      });

      clearTimeout(timeoutId);

      // Detect Chilli Redirects
      if (response.status === 200) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          const text = await response.clone().text();
          if (
            text.toLowerCase().includes("chilli") ||
            text.toLowerCase().includes("uam")
          ) {
            throw new Error("Local Network Hijack");
          }
        }
      }

      if (response.ok || (response.status >= 400 && response.status < 500)) {
        successfulBridgeName = bridge.name;
        return response;
      }

      throw new Error(`Path Rejected (${response.status})`);
    } catch (err: any) {
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: err.message,
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
              `Umoja Path Error: The router firewall is blocking the auth tunnel. [Trace: ${summary}]`,
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
