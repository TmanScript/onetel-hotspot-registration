import { RegistrationPayload, LoginPayload } from "../types";
import { API_ENDPOINT } from "../constants";

export const BRIDGES = [
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
  { name: "Direct Cloud", proxy: "", type: "direct" }, // Moved to last
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

/**
 * FETCH WITH SHADOW RESILIENCE v9.0
 * Specifically designed to bypass the CORS blocks shown in your console.
 */
async function fetchWithResilience(
  targetUrl: string,
  options: RequestInit,
): Promise<Response> {
  lastBridgeLogs = [];

  for (const bridge of BRIDGES) {
    try {
      const isDirect = bridge.type === "direct";
      const isTunnel = bridge.type === "tunnel";

      // Cache busting
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

      if (!isDirect) {
        // BYPASS CORS PREFLIGHT:
        // We avoid sending 'application/json' which triggers the 'OPTIONS' preflight check.
        if (isTunnel && options.method === "POST") {
          // Convert POST body to a URL parameter for AllOrigins
          fullUrl += `&payload=${encodeURIComponent(options.body as string)}`;
          fetchOptions.method = "GET";
          delete fetchOptions.body;
          fetchOptions.headers = { Accept: "application/json" };
        } else {
          // Use text/plain to stay as a "Simple Request"
          fetchOptions.headers = { "Content-Type": "text/plain" };
        }
      } else {
        fetchOptions.headers = {
          ...options.headers,
          "Content-Type": "application/json",
        };
      }

      console.log(`🚀 Attempting bridge: ${bridge.name}`);
      const response = await fetch(fullUrl, fetchOptions);

      // Handle AllOrigins Wrapper
      if (isTunnel) {
        const wrapper = await response.json();
        if (wrapper.contents) {
          console.log(`✅ Success via ${bridge.name}`);
          return new Response(wrapper.contents, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (response.ok) {
        console.log(`✅ Success via ${bridge.name}`);
        return response;
      }

      throw new Error(`Status ${response.status}`);
    } catch (err: any) {
      console.warn(`❌ ${bridge.name} failed:`, err.message);
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: err.message,
        timestamp: new Date().toLocaleTimeString(),
      });
    }
  }

  throw new Error(
    "All access paths blocked. Please check Walled Garden settings.",
  );
}

/**
 * EXPORTS
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
