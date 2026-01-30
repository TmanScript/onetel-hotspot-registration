
import { RegistrationPayload, LoginPayload } from '../types';
import { API_ENDPOINT } from '../constants';

export const BRIDGES = [
  { name: 'Direct Path', proxy: '', type: 'direct' },
  { name: 'Cloud Bridge A', proxy: 'https://corsproxy.io/?', type: 'standard' },
  { name: 'Cloud Bridge B', proxy: 'https://api.codetabs.com/v1/proxy/?quest=', type: 'standard' },
  { name: 'Backup Bridge', proxy: 'https://api.allorigins.win/raw?url=', type: 'allorigins' },
];

export interface BridgeError {
  bridge: string;
  error: string;
  timestamp: string;
}

export let lastBridgeLogs: BridgeError[] = [];

async function fetchWithResilience(targetUrl: string, options: RequestInit): Promise<Response> {
  lastBridgeLogs = [];
  let lastError: any;

  // Ensure headers include Accept for JSON
  const headers = {
    ...options.headers,
    'Accept': 'application/json',
  };

  for (const bridge of BRIDGES) {
    try {
      const isDirect = bridge.type === 'direct';
      const fullUrl = isDirect ? targetUrl : `${bridge.proxy}${encodeURIComponent(targetUrl)}`;
      
      if (bridge.type === 'allorigins' && options.method !== 'GET') continue;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), isDirect ? 4000 : 12000);
      
      const response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      
      clearTimeout(timeoutId);

      // CRITICAL CHECK: Detection of Walled Garden Interception
      // If the router intercepts the request, it returns an HTML page with status 200.
      // We must check if the content-type is actually JSON.
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error("Walled Garden Redirect: Received HTML instead of API data.");
      }

      // If we get here, we successfully hit an endpoint that isn't a redirect
      return response;
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Timed out' : err.message;
      console.warn(`Bridge [${bridge.name}] failed:`, errorMsg);
      lastBridgeLogs.push({
        bridge: bridge.name,
        error: errorMsg,
        timestamp: new Date().toLocaleTimeString()
      });
      lastError = err;
    }
  }
  
  throw new Error("Connection failed. Your device is trapped in the Walled Garden or all bridges are blocked.");
}

export const registerUser = async (data: RegistrationPayload): Promise<Response> => {
  return await fetchWithResilience(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const loginUser = async (data: LoginPayload): Promise<Response> => {
  const url = `${API_ENDPOINT}token/`;
  return await fetchWithResilience(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const getUsage = async (token: string): Promise<Response> => {
  const url = `${API_ENDPOINT}usage/`;
  return await fetchWithResilience(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
};

export const requestOtp = async (token: string): Promise<Response> => {
  const url = `${API_ENDPOINT}phone/token/`;
  return await fetchWithResilience(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: '',
  });
};

export const verifyOtp = async (token: string, code: string): Promise<Response> => {
  const url = `${API_ENDPOINT}phone/verify/`;
  return await fetchWithResilience(url, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code }),
  });
};
