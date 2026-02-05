import React, { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  Zap,
  Loader2,
  Database,
  ShoppingCart,
  Copy,
  XCircle,
  ArrowLeft,
  Tag,
  ShieldCheck,
  ShieldAlert,
  Activity,
  History,
  RefreshCw,
  ServerCrash,
  Network,
  Signal,
  Cpu,
  Unplug,
  Lock,
  Phone,
  Mail,
  Wifi,
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
  BridgeError,
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showHelper, setShowHelper] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [bridgeHistory, setBridgeHistory] = useState<BridgeError[]>([]);

  const [diagnostics, setDiagnostics] = useState<BridgeStatus[]>(
    BRIDGES.map((b) => ({ name: b.name, status: "checking", latency: 0 })),
  );

  const [uamParams, setUamParams] = useState({
    uamip: "192.168.182.1",
    uamport: "3990",
    challenge: "",
  });

  const runDiagnostics = useCallback(async () => {
    const tests = BRIDGES.map(async (bridge) => {
      const start = Date.now();
      try {
        const target = "https://device.onetel.co.za/favicon.ico";
        let url: string;
        if (bridge.type === "local") {
          url = "https://wifi-auth.umoja.network/ping";
        } else {
          url = bridge.proxy
            ? `${bridge.proxy}${encodeURIComponent(target)}`
            : target;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-cache",
          mode: "cors",
        });
        clearTimeout(timeoutId);

        const cType = res.headers.get("content-type") || "";
        if (cType.includes("text/html") && res.status === 200) {
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
        return { name: bridge.name, status: "blocked" as const, latency: 0 };
      }
    });

    const results = await Promise.all(tests);
    setDiagnostics(results);
  }, []);

  const refreshUsage = async (token: string = authToken) => {
    if (!token) return;
    setIsRefreshing(true);
    try {
      const usageRes = await getUsage(token);
      const text = await usageRes.text();
      const usage: UsageResponse = JSON.parse(text);

      if (usage.checks && usage.checks.length > 0) {
        const check = usage.checks[0];
        const remainingBytes = check.value - check.result;
        const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(1);
        const percent = Math.max(
          0,
          Math.min(100, (remainingBytes / check.value) * 100),
        );
        const hasData = remainingBytes > 1024 * 5;
        setUsageData({ remainingMB, percent, hasData });
        setStep("USAGE_INFO");
      } else {
        setStep("SUCCESS");
      }
    } catch (err) {
      setStep("SUCCESS");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
    const interval = setInterval(runDiagnostics, 45000);
    return () => clearInterval(interval);
  }, [runDiagnostics]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uamip = params.get("uamip") || "192.168.182.1";
    const uamport = params.get("uamport") || "3990";
    const challenge = params.get("challenge") || "";
    setUamParams({ uamip, uamport, challenge });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "username" || name === "phone_number") {
      const sanitized = value.trim();
      setFormData((prev) => ({
        ...prev,
        username: sanitized,
        phone_number: sanitized,
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await loginUser(loginData);
      const text = await response.text();
      const data = JSON.parse(text);

      if (response.ok) {
        const token = data.token || data.key || data.token_key;
        setAuthToken(token);
        await refreshUsage(token);
      } else {
        setErrorMessage(
          data.detail || "Access denied. Please check your credentials.",
        );
        setBridgeHistory([...lastBridgeLogs]);
      }
    } catch (err: any) {
      setErrorMessage(err.message);
      setBridgeHistory([...lastBridgeLogs]);
      runDiagnostics();
    } finally {
      setIsSubmitting(false);
    }
  };

  const connectToRouter = () => {
    const loginUrl = `http://${uamParams.uamip}:${uamParams.uamport}/logon`;
    const form = document.createElement("form");
    form.method = "GET";
    form.action = loginUrl;
    form.appendChild(
      Object.assign(document.createElement("input"), {
        type: "hidden",
        name: "username",
        value: loginData.username,
      }),
    );
    form.appendChild(
      Object.assign(document.createElement("input"), {
        type: "hidden",
        name: "password",
        value: loginData.password,
      }),
    );
    document.body.appendChild(form);
    form.submit();
  };

  const WALLED_GARDEN =
    "wifi.umoja.network, wifi-auth.umoja.network, umoja.network, 192.168.182.1, device.onetel.co.za, corsproxy.io, thingproxy.freeboard.io";

  const renderContent = () => {
    if (step === "BUY_DATA") {
      return (
        <div className="max-w-2xl w-full bg-white rounded-[2.5rem] shadow-2xl p-10 border border-pink-100 animate-in zoom-in duration-300">
          <button
            onClick={() => setStep("USAGE_INFO")}
            className="flex items-center gap-2 text-pink-500 font-bold text-xs uppercase mb-8 hover:translate-x-[-4px] transition-transform"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
          <h2 className="text-3xl font-black text-gray-900 mb-8">
            Umoja Data Packs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-pink-50 p-6 rounded-3xl border-2 border-pink-100 flex flex-col items-center">
              <Signal className="w-8 h-8 text-pink-500 mb-4" />
              <span className="text-2xl font-black">1GB</span>
              <span className="text-pink-600 font-bold">R 5.00</span>
            </div>
            <div className="bg-pink-500 p-6 rounded-3xl border-2 border-pink-500 text-white flex flex-col items-center shadow-lg shadow-pink-100">
              <Wifi className="w-8 h-8 mb-4" />
              <span className="text-2xl font-black">10GB</span>
              <span className="text-pink-100 font-bold">R 50.00</span>
            </div>
          </div>
        </div>
      );
    }

    if (step === "SUCCESS" || (step === "USAGE_INFO" && usageData?.hasData)) {
      return (
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
          <div className="p-8 text-center bg-pink-50 border-b border-pink-100 relative">
            <div className="absolute top-4 right-4 flex gap-2">
              <button
                onClick={() => refreshUsage()}
                disabled={isRefreshing}
                className="p-2 text-pink-400 hover:text-pink-600 transition-colors"
              >
                <RefreshCw
                  className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-100">
              <ShieldCheck className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black text-gray-900">
              Umoja Connected
            </h2>
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mt-1">
              Template Core v6.1 Active
            </p>
          </div>

          <div className="p-8 space-y-8">
            {usageData && (
              <div className="space-y-6">
                <div className="flex items-center justify-center relative">
                  <svg className="w-44 h-44 transform -rotate-90">
                    <circle
                      cx="88"
                      cy="88"
                      r="75"
                      stroke="currentColor"
                      strokeWidth="12"
                      fill="transparent"
                      className="text-pink-50"
                    />
                    <circle
                      cx="88"
                      cy="88"
                      r="75"
                      stroke="currentColor"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={471}
                      strokeDashoffset={471 - (471 * usageData.percent) / 100}
                      className="text-pink-500 transition-all duration-1000 ease-out stroke-round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-black text-gray-900 leading-none">
                      {usageData.remainingMB}
                    </span>
                    <span className="text-[10px] font-black text-pink-500 uppercase tracking-widest mt-2">
                      MB REMAINING
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-3">
              <button
                onClick={connectToRouter}
                className="w-full py-5 bg-pink-500 text-white font-black rounded-2xl shadow-xl active:scale-95 flex items-center justify-center gap-3 text-lg transition-all"
              >
                AUTHORIZE WIFI <Zap className="w-6 h-6 fill-current" />
              </button>
              <button
                onClick={() => setStep("BUY_DATA")}
                className="w-full py-4 bg-white text-pink-500 border-2 border-pink-500 font-black rounded-2xl text-xs uppercase tracking-widest"
              >
                Recharge SIM
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
        <div className="hidden lg:flex flex-col justify-between p-12 bg-pink-500 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4 bg-white/20 w-fit px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
              <Cpu className="w-3 h-3" /> Umoja Network v6.1
            </div>
            <h2 className="text-4xl font-bold leading-tight mb-6 tracking-tight">
              Access Local
              <br />
              Auth Gateway
            </h2>
            <div className="p-4 bg-black/10 rounded-2xl border border-white/10 backdrop-blur-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-pink-100 mb-4 flex items-center justify-between">
                Real-time Bridges{" "}
                <RefreshCw
                  onClick={runDiagnostics}
                  className="w-3 h-3 cursor-pointer"
                />
              </p>
              <div className="space-y-3">
                {diagnostics.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center justify-between text-[11px] font-bold"
                  >
                    <span className="flex items-center gap-3">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${d.status === "ok" ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" : d.status === "intercepted" ? "bg-orange-400 animate-pulse" : "bg-red-400"}`}
                      />
                      {d.name}
                    </span>
                    <span className="text-[8px] opacity-60 uppercase">
                      {d.status === "ok"
                        ? `${d.latency}ms`
                        : d.status === "intercepted"
                          ? "HIJACKED"
                          : "BLOCKED"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <Signal className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest text-pink-100">
                  Hotspot ID
                </p>
                <p className="text-xs font-bold">Chilli-Umoja-01</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 sm:p-12 flex flex-col justify-center bg-white">
          <div className="mb-8">
            <h3 className="text-2xl font-black text-gray-900 tracking-tight">
              Network Sign-In
            </h3>
            <p className="text-gray-400 text-sm mt-1">
              Speak to the local gateway at umoja.network
            </p>
          </div>
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <Input
              label="Phone Number"
              name="username"
              type="tel"
              value={loginData.username}
              onChange={(e) =>
                setLoginData({ ...loginData, username: e.target.value.trim() })
              }
              placeholder="+27..."
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
              placeholder="••••••"
              icon={<Lock className="w-4 h-4" />}
              required
            />

            {errorMessage && (
              <div className="text-red-600 text-[11px] font-bold bg-red-50 p-4 rounded-xl border border-red-100 flex gap-3 items-start animate-in shake">
                <XCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <span className="leading-relaxed">{errorMessage}</span>
                  {(errorMessage.includes("Blocked") ||
                    errorMessage.includes("SSL") ||
                    errorMessage.includes("fetch")) && (
                    <div className="mt-2 p-3 bg-red-100 rounded-lg text-red-700 space-y-2 border border-red-200">
                      <div className="flex items-center gap-2 font-black uppercase text-[8px]">
                        <Unplug className="w-3 h-3" /> Path Resolution Error
                      </div>
                      <p className="text-[9px] leading-tight">
                        The router firewall is hijacking local SSL requests.
                        Ensure <b>wifi-auth.umoja.network</b> is added to your{" "}
                        <b>uamallowed</b> list.
                      </p>
                      <button
                        onClick={() => window.location.reload()}
                        className="text-[8px] font-black uppercase tracking-widest underline decoration-2"
                      >
                        Rescue Refresh
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-pink-500 text-white font-bold rounded-2xl shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Sign In & Track Data"
              )}
            </button>
          </form>
          <button
            onClick={() => setStep("REGISTRATION")}
            className="w-full mt-6 text-pink-500 font-black text-[10px] uppercase tracking-widest hover:underline"
          >
            New SIM Registration
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 bg-[#fdf2f8]">
      <div className="mb-8 text-center flex flex-col items-center">
        <h1 className="text-5xl font-black text-gray-900 tracking-tighter">
          UMOJA<span className="text-pink-500">.</span>
        </h1>
        <div className="mt-1 h-1 w-12 bg-pink-500 rounded-full"></div>
      </div>

      {renderContent()}

      {showHelper && (
        <div className="mt-8 max-w-xl w-full bg-white border-2 border-pink-100 rounded-[2rem] p-6 shadow-xl animate-in slide-in-from-bottom-8">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[10px] font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <ServerCrash className="w-4 h-4 text-pink-500" /> Walled Garden
              Kit v6.1
            </h4>
            <button
              onClick={() => setShowHelper(false)}
              className="text-gray-400 font-bold text-[9px] uppercase"
            >
              Hide
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-[10px] text-gray-500 font-medium">
              Synced with your OpenWISP Chilli Template:
            </p>
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex gap-2 items-center overflow-hidden">
              <code className="text-[9px] font-mono text-gray-500 truncate flex-1 leading-none">
                {WALLED_GARDEN}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(WALLED_GARDEN);
                  alert("Copied!");
                }}
                className="p-2 bg-pink-500 text-white rounded-lg shadow-sm"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-gray-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
        Umoja Network • Local Gateway Core v6.1 (Active Pathing)
      </p>
    </div>
  );
};

export default App;
