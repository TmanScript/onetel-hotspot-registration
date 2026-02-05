import React, { useState, useEffect, useCallback } from "react";
import {
  User,
  Mail,
  Phone,
  Lock,
  CheckCircle2,
  Zap,
  Loader2,
  Database,
  ShoppingCart,
  Copy,
  Info,
  XCircle,
  ArrowLeft,
  Tag,
  ShieldCheck,
  ShieldAlert,
  Activity,
  History,
  RefreshCw,
  AlertTriangle,
  Fingerprint,
  WifiOff,
  ServerCrash,
  Radio,
  ZapOff,
  Network,
  EyeOff,
  Gauge,
  TrendingUp,
  Globe,
  ExternalLink,
} from "lucide-react";
import Input from "./components/Input";
import { RegistrationPayload, UsageResponse } from "./types";
import { DEFAULT_PLAN_UUID } from "./constants";
import {
  registerUser,
  requestOtp,
  verifyOtp,
  loginUser,
  getUsage,
  BRIDGES,
  lastBridgeLogs,
} from "./services/api";

type Step =
  | "REGISTRATION"
  | "OTP_VERIFY"
  | "LOGIN"
  | "USAGE_INFO"
  | "SUCCESS"
  | "BUY_DATA";

interface BridgeStatus {
  name: string;
  status: "checking" | "ok" | "blocked" | "intercepted";
  latency: number;
}

const App: React.FC = () => {
  const [step, setStep] = useState<Step>("LOGIN");
  const [formData, setFormData] = useState<RegistrationPayload>({
    username: "",
    email: "",
    password1: "",
    password2: "",
    first_name: "",
    last_name: "",
    phone_number: "",
    method: "mobile_phone",
    plan_pricing: DEFAULT_PLAN_UUID,
  });

  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [usageData, setUsageData] = useState<{
    remainingMB: string;
    percent: number;
    hasData: boolean;
  } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showHelper, setShowHelper] = useState(true);
  const [showLogs, setShowLogs] = useState(false);

  const [diagnostics, setDiagnostics] = useState<BridgeStatus[]>(
    BRIDGES.map((b) => ({ name: b.name, status: "checking", latency: 0 })),
  );

  const [uamParams, setUamParams] = useState({
    uamip: "192.168.182.1",
    uamport: "3990",
    challenge: "",
  });

  /**
   * DIAGNOSTICS: Optimized for HTTPS -> HTTP Hijack detection
   */
  const runDiagnostics = useCallback(async () => {
    const tests = BRIDGES.map(async (bridge) => {
      const start = Date.now();
      try {
        const target = "https://device.onetel.co.za/favicon.ico";
        const url = bridge.proxy
          ? `${bridge.proxy}${encodeURIComponent(target)}`
          : target;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-cache",
        });
        clearTimeout(timeoutId);

        if (
          res.status === 200 &&
          res.headers.get("content-type")?.includes("text/html")
        ) {
          return {
            name: bridge.name,
            status: "intercepted" as const,
            latency: Date.now() - start,
          };
        }
        return {
          name: bridge.name,
          status: "ok" as const,
          latency: Date.now() - start,
        };
      } catch (e: any) {
        // Since we are on HTTPS, a 'Failed to fetch' usually means
        // the router hijacked the request to an HTTP page.
        return {
          name: bridge.name,
          status: "intercepted" as const,
          latency: 0,
        };
      }
    });

    const results = await Promise.all(tests);
    setDiagnostics(results);
  }, []);

  /**
   * AUTH FLOW: Refresh Usage Data
   */
  const refreshUsage = async (token: string = authToken) => {
    if (!token) return;
    try {
      const usageRes = await getUsage(token);
      const usage: UsageResponse = await usageRes.json();

      if (usage.checks?.length > 0) {
        const check = usage.checks[0];
        const remainingBytes = check.value - check.result;
        const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(2);
        const percent = Math.max(
          0,
          Math.min(100, (remainingBytes / check.value) * 100),
        );
        setUsageData({
          remainingMB,
          percent,
          hasData: remainingBytes > 1024 * 10,
        });
        setStep("USAGE_INFO");
      } else {
        setStep("SUCCESS");
      }
    } catch (err) {
      setStep("SUCCESS");
    }
  };

  useEffect(() => {
    runDiagnostics();
    const interval = setInterval(runDiagnostics, 30000);

    const params = new URLSearchParams(window.location.search);
    setUamParams({
      uamip: params.get("uamip") || "192.168.182.1",
      uamport: params.get("uamport") || "3990",
      challenge: params.get("challenge") || "",
    });

    return () => clearInterval(interval);
  }, [runDiagnostics]);

  /**
   * FORM HANDLERS
   */
  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password1 !== formData.password2)
      return setErrorMessage("Passwords do not match.");

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await registerUser(formData);
      const data = await response.json();
      if (response.ok) {
        setAuthToken(data.token || data.key);
        await requestOtp(data.token || data.key);
        setStep("OTP_VERIFY");
      } else {
        setErrorMessage(data.detail || "Registration failed.");
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await loginUser(loginData);
      if (response.ok) {
        const data = await response.json();
        const token = data.token || data.key;
        setAuthToken(token);
        await refreshUsage(token);
      } else {
        const data = await response.json();
        setErrorMessage(data.detail || "Login failed. Check credentials.");
      }
    } catch (err: any) {
      setErrorMessage(`SECURE_BLOCK: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * ROUTER HANDOFF: This connects the device to the internet
   */
  const connectToRouter = () => {
    const loginUrl = `http://${uamParams.uamip}:${uamParams.uamport}/logon`;

    // We use a standard form GET to avoid HTTPS/CORS issues
    const form = document.createElement("form");
    form.method = "GET";
    form.action = loginUrl;

    const inputs = {
      username: loginData.username,
      password: loginData.password,
      challenge: uamParams.challenge,
      userurl: "http://neverssl.com", // Redirect here after login
    };

    Object.entries(inputs).forEach(([k, v]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = v;
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Walled Garden list copied!");
  };

  const WALLED_GARDEN =
    "device.onetel.co.za, tmanscript.github.io, allorigins.win, api.allorigins.win, corsproxy.io, api.codetabs.com";

  /**
   * RENDER LOGIC
   */
  const renderContent = () => {
    if (step === "BUY_DATA") {
      return (
        <div className="max-w-2xl w-full bg-white rounded-[2.5rem] shadow-2xl p-12 border border-pink-100">
          <button
            onClick={() => setStep("USAGE_INFO")}
            className="flex items-center gap-2 text-pink-500 font-bold text-xs uppercase mb-8"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <h2 className="text-3xl font-black mb-8 text-center">Top Up Data</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-8 border-2 border-pink-100 rounded-3xl hover:border-pink-500 transition-all cursor-pointer">
              <Tag className="text-pink-500 mb-2" />
              <h4 className="text-xl font-black">1GB Bundle</h4>
              <p className="text-pink-500 font-black text-2xl">R 5</p>
            </div>
            <div className="p-8 bg-pink-500 text-white rounded-3xl shadow-xl cursor-pointer">
              <h4 className="text-xl font-black">10GB Bundle</h4>
              <p className="text-pink-100 font-black text-2xl">R 50</p>
            </div>
          </div>
        </div>
      );
    }

    if (step === "SUCCESS" || (step === "USAGE_INFO" && usageData?.hasData)) {
      return (
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
          <div className="p-8 text-center bg-pink-50 relative">
            <RefreshCw
              onClick={() => refreshUsage()}
              className="absolute top-6 right-6 w-5 h-5 text-pink-300 cursor-pointer hover:rotate-180 transition-transform"
            />
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black">Account Active</h2>
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest">
              Resilience Node v5.5
            </p>
          </div>
          <div className="p-8">
            {usageData && (
              <div className="mb-8 text-center">
                <div className="text-5xl font-black text-gray-900">
                  {usageData.remainingMB}
                  <span className="text-lg ml-1">MB</span>
                </div>
                <div className="w-full bg-gray-100 h-3 rounded-full mt-4 overflow-hidden">
                  <div
                    className="bg-pink-500 h-full transition-all duration-1000"
                    style={{ width: `${usageData.percent}%` }}
                  />
                </div>
                <p className="text-[10px] font-bold text-gray-400 mt-2 uppercase">
                  Remaining Data Balance
                </p>
              </div>
            )}
            <button
              onClick={connectToRouter}
              className="w-full py-5 bg-pink-500 text-white font-black rounded-2xl shadow-xl flex items-center justify-center gap-3 text-lg active:scale-95 transition-transform"
            >
              CONNECT TO INTERNET <Zap className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={() => setStep("BUY_DATA")}
              className="w-full mt-4 py-3 text-pink-500 font-bold text-xs uppercase tracking-widest"
            >
              Buy More Data
            </button>
          </div>
        </div>
      );
    }

    if (step === "REGISTRATION") {
      return (
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
          <div className="hidden lg:flex flex-col justify-between p-12 bg-pink-500 text-white">
            <div>
              <div className="flex items-center gap-2 mb-4 bg-white/20 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest w-fit">
                <Radio className="w-3 h-3 animate-pulse" /> Shadow Tunnel Active
              </div>
              <h2 className="text-4xl font-bold leading-tight">
                Create your
                <br />
                Onetel Account
              </h2>
            </div>
            <div className="bg-black/10 p-4 rounded-2xl border border-white/10">
              <p className="text-[10px] font-black uppercase mb-3 text-pink-100">
                Bridge Status
              </p>
              {diagnostics.map((d) => (
                <div
                  key={d.name}
                  className="flex justify-between text-[10px] mb-1 font-bold"
                >
                  <span>{d.name}</span>
                  <span
                    className={
                      d.status === "ok" ? "text-green-300" : "text-orange-300"
                    }
                  >
                    {d.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-8 sm:p-12">
            <button
              onClick={() => setStep("LOGIN")}
              className="flex items-center gap-2 text-pink-500 font-bold text-xs uppercase mb-6"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <form onSubmit={handleRegistrationSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  name="first_name"
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData({ ...formData, first_name: e.target.value })
                  }
                  required
                />
                <Input
                  label="Last Name"
                  name="last_name"
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData({ ...formData, last_name: e.target.value })
                  }
                  required
                />
              </div>
              <Input
                label="Phone"
                name="username"
                type="tel"
                value={formData.username}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    username: e.target.value,
                    phone_number: e.target.value,
                  })
                }
                icon={<Phone className="w-4 h-4" />}
                required
              />
              <Input
                label="Password"
                name="password1"
                type="password"
                value={formData.password1}
                onChange={(e) =>
                  setFormData({ ...formData, password1: e.target.value })
                }
                icon={<Lock className="w-4 h-4" />}
                required
              />
              <Input
                label="Confirm"
                name="password2"
                type="password"
                value={formData.password2}
                onChange={(e) =>
                  setFormData({ ...formData, password2: e.target.value })
                }
                icon={<Lock className="w-4 h-4" />}
                required
              />
              {errorMessage && (
                <div className="p-3 bg-red-50 text-red-600 text-[10px] font-bold rounded-xl border border-red-100">
                  {errorMessage}
                </div>
              )}
              <button
                disabled={isSubmitting}
                className="w-full py-4 bg-pink-500 text-white font-bold rounded-2xl shadow-xl"
              >
                {isSubmitting ? (
                  <Loader2 className="animate-spin mx-auto" />
                ) : (
                  "Sign Up"
                )}
              </button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
        <div className="hidden lg:flex flex-col justify-between p-12 bg-pink-500 text-white">
          <div>
            <h2 className="text-4xl font-bold leading-tight">
              Fast WiFi
              <br />
              Everywhere
            </h2>
          </div>
          <div className="bg-black/10 p-5 rounded-2xl border border-white/10 shadow-inner">
            <div className="flex justify-between items-center mb-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-pink-100">
                Network Diagnostics
              </p>
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="text-[9px] underline"
              >
                Logs
              </button>
            </div>
            {showLogs ? (
              <div className="text-[8px] font-mono h-24 overflow-y-auto">
                {lastBridgeLogs.map((l, i) => (
                  <div key={i}>
                    {l.bridge}: {l.error}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {diagnostics.map((d) => (
                  <div
                    key={d.name}
                    className="flex justify-between text-[11px] font-bold"
                  >
                    <span className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${d.status === "ok" ? "bg-green-400" : "bg-orange-400 animate-pulse"}`}
                      />{" "}
                      {d.name}
                    </span>
                    <span className="opacity-60">
                      {d.status === "ok" ? `${d.latency}ms` : "TRAPPED"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="p-8 sm:p-12 flex flex-col justify-center">
          <h3 className="text-2xl font-bold mb-8">Sign In</h3>
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <Input
              label="Phone"
              name="username"
              type="tel"
              value={loginData.username}
              onChange={(e) =>
                setLoginData({ ...loginData, username: e.target.value })
              }
              icon={<Phone className="w-4 h-4" />}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              value={loginData.password}
              onChange={(e) =>
                setLoginData({ ...loginData, password: e.target.value })
              }
              icon={<Lock className="w-4 h-4" />}
              required
            />
            {errorMessage && (
              <div className="p-4 bg-red-50 text-red-600 text-[11px] font-bold rounded-xl border border-red-100">
                <div className="flex gap-2">
                  <XCircle className="w-4 h-4" /> {errorMessage}
                </div>
                {errorMessage.includes("SECURE_BLOCK") && (
                  <div className="mt-2 text-[9px] text-red-400 leading-tight">
                    The router is hijacking the secure login. Try opening{" "}
                    <span className="underline">http://neverssl.com</span>{" "}
                    first, then come back.
                  </div>
                )}
              </div>
            )}
            <button
              disabled={isSubmitting}
              className="w-full py-4 bg-pink-500 text-white font-bold rounded-2xl shadow-xl active:scale-95"
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin mx-auto" />
              ) : (
                "Sign In & Connect"
              )}
            </button>
          </form>
          <button
            onClick={() => setStep("REGISTRATION")}
            className="mt-6 text-pink-500 font-bold text-xs uppercase tracking-widest text-center"
          >
            New Account
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#fdf2f8]">
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-black text-gray-900 tracking-tighter">
          ONETEL<span className="text-pink-500">.</span>
        </h1>
      </div>
      {renderContent()}
      {showHelper && (
        <div className="mt-8 max-w-xl w-full bg-white border-2 border-pink-100 rounded-[2rem] p-6 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
              <ServerCrash className="w-4 h-4 text-pink-500" /> Portal Rescue
              Kit
            </h4>
            <button
              onClick={() => setShowHelper(false)}
              className="text-[9px] font-bold uppercase"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mb-3">
            Ensure these are in your <b>uamallowed</b> list:
          </p>
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex gap-2 items-center">
            <code className="text-[9px] font-mono text-gray-500 flex-1 truncate">
              {WALLED_GARDEN}
            </code>
            <button
              onClick={() => copyToClipboard(WALLED_GARDEN)}
              className="p-2 bg-pink-500 text-white rounded-lg"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      <p className="mt-8 text-gray-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>{" "}
        Hyper-Path v5.5 Active
      </p>
    </div>
  );
};

export default App;
