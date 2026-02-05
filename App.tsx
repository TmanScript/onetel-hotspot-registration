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
  Signal,
} from "lucide-react";
import CryptoJS from "crypto-js";
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
        const url = bridge.proxy
          ? `${bridge.proxy}${encodeURIComponent(target)}`
          : target;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

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
      const usage: UsageResponse = await parseResponse(usageRes);

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
    const interval = setInterval(runDiagnostics, 60000);
    return () => clearInterval(interval);
  }, [runDiagnostics]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginUrl = params.get("loginurl");
    let targetParams = params;

    if (loginUrl) {
      try {
        const decodedUrl = new URL(decodeURIComponent(loginUrl));
        targetParams = decodedUrl.searchParams;
      } catch (e) {}
    }

    const uamip =
      targetParams.get("uamip") || params.get("uamip") || "192.168.182.1";
    const uamport =
      targetParams.get("uamport") || params.get("uamport") || "3990";
    const challenge =
      targetParams.get("challenge") || params.get("challenge") || "";

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

  const handleLoginChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLoginData((prev) => ({ ...prev, [name]: value.trim() }));
  };

  const parseResponse = async (response: Response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { detail: text || `Status ${response.status}` };
    }
  };

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password1 !== formData.password2) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await registerUser(formData);
      const data = await parseResponse(response);

      if (response.ok) {
        const token = data.token || data.key || data.token_key;
        setAuthToken(token);
        await requestOtp(token);
        setStep("OTP_VERIFY");
      } else {
        setErrorMessage(
          data.detail || data.username?.[0] || "Registration failed.",
        );
      }
    } catch (err: any) {
      setErrorMessage(err.message);
      setBridgeHistory([...lastBridgeLogs]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await verifyOtp(authToken, otpCode);
      const data = await parseResponse(response);

      if (response.ok) {
        setLoginData({
          username: formData.username,
          password: formData.password1,
        });
        setStep("LOGIN");
        setErrorMessage("Verification successful! Please sign in.");
      } else {
        setErrorMessage(data.detail || "Invalid code.");
      }
    } catch (err) {
      setErrorMessage("Failed to verify OTP.");
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
      const data = await parseResponse(response);

      if (response.ok) {
        const token = data.token || data.key || data.token_key;
        setAuthToken(token);
        await refreshUsage(token);
      } else {
        setErrorMessage(data.detail || "Incorrect phone number or password.");
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("List copied to clipboard!");
  };

  const WALLED_GARDEN =
    "device.onetel.co.za, tmanscript.github.io, allorigins.win, api.allorigins.win, corsproxy.io, api.codetabs.com, esm.sh, cdn.tailwindcss.com, fonts.googleapis.com, fonts.gstatic.com";

  const renderContent = () => {
    if (step === "BUY_DATA") {
      return (
        <div className="max-w-2xl w-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100 animate-in zoom-in duration-300">
          <div className="p-8 sm:p-12">
            <button
              onClick={() => setStep("USAGE_INFO")}
              className="flex items-center gap-2 text-pink-500 font-bold text-xs uppercase mb-8 hover:translate-x-[-4px] transition-transform"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="text-center mb-10">
              <h2 className="text-3xl font-black text-gray-900 mb-2">
                Data Plans
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border-2 border-pink-50 p-6 rounded-3xl text-left hover:border-pink-500 hover:shadow-xl transition-all">
                <Tag className="w-6 h-6 text-pink-500 mb-4" />
                <h4 className="text-2xl font-black text-gray-900 mb-1">1GB</h4>
                <p className="text-pink-500 font-black">R 5</p>
              </div>
              <div className="bg-pink-500 border-2 border-pink-500 p-6 rounded-3xl text-left hover:shadow-pink-200 hover:shadow-2xl transition-all text-white">
                <h4 className="text-2xl font-black mb-1">10GB</h4>
                <p className="font-black text-pink-100">R 50</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (step === "REGISTRATION") {
      return (
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
          <div className="hidden lg:flex flex-col justify-between p-12 bg-pink-500 text-white relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4 bg-white/20 w-fit px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                <ShieldCheck className="w-3 h-3 animate-pulse" /> Adaptive Path
                v5.6
              </div>
              <h2 className="text-4xl font-bold leading-tight mb-6">
                Join Onetel
              </h2>
            </div>
            <div className="relative z-10 space-y-4">
              <div className="bg-black/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest mb-3 text-pink-100 flex items-center justify-between">
                  Live Diagnostics{" "}
                  <RefreshCw
                    onClick={runDiagnostics}
                    className="w-2.5 h-2.5 cursor-pointer"
                  />
                </p>
                <div className="space-y-2">
                  {diagnostics.map((d) => (
                    <div
                      key={d.name}
                      className="flex items-center justify-between text-[10px] font-bold"
                    >
                      <span className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${d.status === "ok" ? "bg-green-400" : d.status === "intercepted" ? "bg-orange-400 animate-pulse" : "bg-red-400"}`}
                        />
                        {d.name}
                      </span>
                      <span className="text-[8px] opacity-70">
                        {d.status === "ok"
                          ? `${d.latency}ms`
                          : d.status === "intercepted"
                            ? "TRAPPED"
                            : "BLOCKED"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="p-8 overflow-y-auto max-h-[85vh]">
            <button
              onClick={() => setStep("LOGIN")}
              className="flex items-center gap-2 text-pink-500 font-bold text-xs uppercase mb-6 hover:translate-x-[-4px] transition-transform"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <form onSubmit={handleRegistrationSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleInputChange}
                  placeholder="First Name"
                  required
                />
                <Input
                  label="Last Name"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleInputChange}
                  placeholder="Last Name"
                  required
                />
              </div>
              <Input
                label="Phone Number"
                name="username"
                type="tel"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="+27..."
                icon={<Phone className="w-4 h-4" />}
                required
              />
              <Input
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="email@address.com"
                icon={<Mail className="w-4 h-4" />}
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Password"
                  name="password1"
                  type="password"
                  value={formData.password1}
                  onChange={handleInputChange}
                  placeholder="••••••"
                  icon={<Lock className="w-4 h-4" />}
                  required
                />
                <Input
                  label="Confirm"
                  name="password2"
                  type="password"
                  value={formData.password2}
                  onChange={handleInputChange}
                  placeholder="••••••"
                  icon={<Lock className="w-4 h-4" />}
                  required
                />
              </div>
              {errorMessage && (
                <div className="text-red-600 text-[11px] font-bold bg-red-50 p-3 rounded-xl border border-red-100 flex gap-2 items-start">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />{" "}
                  <span>{errorMessage}</span>
                </div>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-4 bg-pink-500 text-white font-bold rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-70"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Create Account"
                )}
              </button>
            </form>
          </div>
        </div>
      );
    }

    if (step === "OTP_VERIFY") {
      return (
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-8 border border-pink-100">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">
              Verify Identity
            </h2>
            <p className="text-sm text-gray-500 mt-2">
              Check your phone for a code
            </p>
          </div>
          <form onSubmit={handleOtpSubmit} className="space-y-6">
            <Input
              label="OTP Code"
              name="otp"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="000000"
              className="text-center text-2xl tracking-[0.5em] font-black"
              required
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-pink-500 text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 active:scale-95 disabled:opacity-70"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Verify Code"
              )}
            </button>
          </form>
        </div>
      );
    }

    if (step === "SUCCESS" || (step === "USAGE_INFO" && usageData?.hasData)) {
      return (
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100 animate-in fade-in zoom-in duration-500">
          {/* Header Section */}
          <div className="p-8 text-center bg-pink-50 border-b border-pink-100 relative">
            <div className="absolute top-4 right-4">
              <button
                onClick={() => refreshUsage()}
                disabled={isRefreshing}
                className="p-2 text-pink-400 hover:text-pink-600 transition-colors disabled:opacity-30"
              >
                <RefreshCw
                  className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-100">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black text-gray-900">Dashboard</h2>
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mt-1">
              Status: Session Optimized
            </p>
          </div>

          {/* Usage Dashboard */}
          <div className="p-8 space-y-8">
            {usageData ? (
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col items-center">
                    <Signal className="w-4 h-4 text-pink-500 mb-2" />
                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">
                      Stability
                    </p>
                    <p className="text-base font-black text-gray-900">High</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col items-center">
                    <TrendingUp className="w-4 h-4 text-pink-500 mb-2" />
                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">
                      Percentage
                    </p>
                    <p className="text-base font-black text-pink-600">
                      {usageData.percent.toFixed(0)}%
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 text-pink-200 animate-spin" />
                <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                  Updating Balance...
                </p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={connectToRouter}
                className="w-full py-5 bg-pink-500 text-white font-black rounded-2xl shadow-xl active:scale-95 flex items-center justify-center gap-3 text-lg transition-all hover:shadow-pink-200"
              >
                CONNECT NOW <Zap className="w-6 h-6 fill-current" />
              </button>
              <button
                onClick={() => setStep("BUY_DATA")}
                className="w-full py-4 bg-white text-pink-500 border-2 border-pink-500 font-black rounded-2xl active:scale-95 text-xs uppercase tracking-widest transition-colors hover:bg-pink-50"
              >
                Get More Data
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (step === "USAGE_INFO" && !usageData?.hasData) {
      return (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 text-center border-t-8 border-orange-500">
          <div className="mb-6 flex justify-center text-orange-500">
            <Database className="w-16 h-16" />
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-2">
            Out of Data
          </h2>
          <p className="text-gray-500 mb-8">
            You need a bundle to start browsing.
          </p>
          <button
            onClick={() => setStep("BUY_DATA")}
            className="w-full py-5 bg-orange-500 text-white font-black rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 text-lg"
          >
            Buy Data <ShoppingCart className="w-6 h-6" />
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-pink-100">
        <div className="hidden lg:flex flex-col justify-between p-12 bg-pink-500 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4 bg-white/20 w-fit px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
              <Network className="w-3 h-3 animate-pulse" /> Adaptive Protocol
              v5.6
            </div>
            <h2 className="text-4xl font-bold leading-tight mb-6">
              Fast WiFi
              <br />
              Everywhere
            </h2>
          </div>

          <div className="relative z-10 space-y-4">
            <div className="bg-black/10 backdrop-blur-md rounded-2xl p-5 border border-white/10 shadow-inner">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-pink-100 flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Adaptive Routing
                </p>
                {bridgeHistory.length > 0 && (
                  <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="text-[9px] font-black uppercase tracking-widest text-white underline flex items-center gap-1"
                  >
                    <History className="w-3 h-3" />{" "}
                    {showLogs ? "Back" : "Debug Log"}
                  </button>
                )}
              </div>

              {showLogs ? (
                <div className="max-h-40 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                  {bridgeHistory.map((log, i) => (
                    <div
                      key={i}
                      className="text-[9px] bg-red-900/40 p-2 rounded-lg border border-red-500/30 font-mono"
                    >
                      <div className="text-red-200 font-bold flex justify-between">
                        <span>{log.bridge}</span>
                        <span className="opacity-50 text-[7px]">
                          {log.timestamp}
                        </span>
                      </div>
                      <div className="text-white/80 mt-1 break-all">
                        {log.error}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {diagnostics.map((d) => (
                    <div
                      key={d.name}
                      className="flex items-center justify-between text-[11px] font-bold"
                    >
                      <span className="flex items-center gap-3">
                        <div
                          className={`w-2.5 h-2.5 rounded-full ${d.status === "ok" ? "bg-green-400" : d.status === "intercepted" ? "bg-orange-400 animate-pulse" : "bg-red-400"}`}
                        />
                        {d.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[8px] uppercase tracking-tighter ${d.status === "ok" ? "text-green-200" : "text-red-200"}`}
                        >
                          {d.status === "ok"
                            ? `${d.latency}ms`
                            : d.status === "intercepted"
                              ? "TRAPPED"
                              : "BLOCKED"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-8 sm:p-12 flex flex-col justify-center bg-white">
          <h3 className="text-2xl font-bold mb-8 text-gray-900">Sign In</h3>
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <Input
              label="Phone Number"
              name="username"
              type="tel"
              value={loginData.username}
              onChange={handleLoginChange}
              placeholder="+27..."
              icon={<Phone className="w-4 h-4" />}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              value={loginData.password}
              onChange={handleLoginChange}
              placeholder="••••••"
              icon={<Lock className="w-4 h-4" />}
              required
            />

            {errorMessage && (
              <div className="text-red-600 text-[11px] font-bold bg-red-50 p-4 rounded-xl border border-red-100 flex gap-3 items-start animate-in shake duration-500">
                <XCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <span className="leading-relaxed">{errorMessage}</span>
                  {(errorMessage.includes("Blocked") ||
                    errorMessage.includes("failed")) && (
                    <div className="mt-2 p-3 bg-red-100 rounded-lg text-red-700 space-y-2 border border-red-200 shadow-sm">
                      <div className="flex items-center gap-2 font-black uppercase text-[8px]">
                        <ZapOff className="w-3 h-3" /> Protocol Warning
                      </div>
                      <p className="text-[9px] leading-tight font-medium">
                        The router is hijacking encrypted paths. Ensure{" "}
                        <b>corsproxy.io</b> is added to your <b>uamallowed</b>{" "}
                        list.
                      </p>
                      <button
                        onClick={() => window.location.reload()}
                        className="text-[8px] font-black uppercase tracking-widest underline decoration-2"
                      >
                        Emergency Refresh
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
                "Sign In & Connect"
              )}
            </button>
          </form>
          <button
            onClick={() => setStep("REGISTRATION")}
            className="w-full mt-6 text-pink-500 font-bold text-xs uppercase tracking-widest hover:underline"
          >
            Create New Account
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 bg-[#fdf2f8]">
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-black text-gray-900 tracking-tighter">
          ONETEL<span className="text-pink-500">.</span>
        </h1>
      </div>

      {renderContent()}

      {showHelper && (
        <div className="mt-8 max-w-xl w-full bg-white border-2 border-pink-100 rounded-[2rem] p-6 shadow-xl animate-in slide-in-from-bottom-8">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[10px] font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <ServerCrash className="w-4 h-4 text-pink-500" /> Walled Garden
              Kit
            </h4>
            <button
              onClick={() => setShowHelper(false)}
              className="text-gray-400 font-bold text-[9px] uppercase"
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
              Ensure these domains are allowed in your <b>uamallowed</b> list:
            </p>
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex gap-2 items-center">
              <code className="text-[9px] font-mono text-gray-500 truncate flex-1 leading-none">
                {WALLED_GARDEN}
              </code>
              <button
                onClick={() => copyToClipboard(WALLED_GARDEN)}
                className="p-2 bg-pink-500 text-white rounded-lg shadow-sm hover:bg-pink-600 transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-gray-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
        Onetel Network • Adaptive v5.6 (Optimization Active)
      </p>
    </div>
  );
};

export default App;
