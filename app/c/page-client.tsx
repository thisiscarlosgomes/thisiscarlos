"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PrivyProvider, useLogout, usePrivy, useWallets } from "@privy-io/react-auth";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import type { ClientEvmSigner } from "@x402/evm";
import { toast } from "sonner";
import { SiteHeader } from "@/app/components/site-header";

type CallStatusResponse = {
  freeCallsEnabled?: boolean;
  dailyLimit: number;
  callsMadeToday: number;
  callsInFlight: number;
  callsLeftToday: number;
  freePoolSecondsLeft: number;
  freePoolSecondsTotal: number;
  maxFreeCallSeconds: number;
  resetsAt: string;
  agentNumber: string | null;
};

type CreditsPricingResponse = {
  creditsPerDollar: number;
  creditsPerMinute: number;
  minPurchaseUsd: number;
  maxPurchaseUsd: number;
};

type CallMomentResponse = {
  moment: {
    summary: string;
    durationSeconds: number;
    endedAtIso: string;
  } | null;
};

type CallHistoryResponse = {
  history: Array<{
    summary: string;
    durationSeconds: number;
    createdAtIso: string;
    phoneLabel: string;
  }>;
};

type RecentCallersResponse = {
  callers: Array<{
    label: string;
    highlight: string;
    lastCallAtIso: string;
  }>;
};

type CallUiState = "ready" | "opening" | "in_call" | "returned";
const SHOW_LAST_CALL_MOMENT = false;

function getOrCreateUserId(): string {
  const key = "call_user_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `user_${Date.now()}`;

  window.localStorage.setItem(key, next);
  return next;
}

const WALLET_MANUAL_DISCONNECT_KEY = "call_wallet_manually_disconnected";

function CallPageWithPrivy() {
  const { ready: privyReady, authenticated, login } = usePrivy();
  const { logout: logoutPrivy } = useLogout();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0];
  const walletAddress = connectedWallet?.address?.toLowerCase() ?? "";
  const walletClientType = connectedWallet?.walletClientType ?? "";

  const [anonymousUserId, setAnonymousUserId] = useState("");
  const [userId, setUserId] = useState("");
  const [credits, setCredits] = useState(0);
  const [pin, setPin] = useState("");
  const [selectedAmountUsd, setSelectedAmountUsd] = useState(1);
  const [buying, setBuying] = useState(false);
  const [freeStatus, setFreeStatus] = useState<CallStatusResponse | null>(null);
  const [callMoment, setCallMoment] = useState<CallMomentResponse["moment"]>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryResponse["history"]>([]);
  const [recentCallers, setRecentCallers] = useState<RecentCallersResponse["callers"]>([]);
  const [shareFeedback, setShareFeedback] = useState("");
  const [pinCopyFeedback, setPinCopyFeedback] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [callStatusLoaded, setCallStatusLoaded] = useState(false);
  const [callMomentLoaded, setCallMomentLoaded] = useState(false);
  const [callHistoryLoaded, setCallHistoryLoaded] = useState(false);
  const [recentCallersLoaded, setRecentCallersLoaded] = useState(false);
  const [pricingLoaded, setPricingLoaded] = useState(false);
  const [pricing, setPricing] = useState<CreditsPricingResponse>({
    creditsPerDollar: 100,
    creditsPerMinute: 20,
    minPurchaseUsd: 1,
    maxPurchaseUsd: 500,
  });
  const [callUiState, setCallUiState] = useState<CallUiState>("ready");
  const [nowMs, setNowMs] = useState(Date.now());
  const [walletDetached, setWalletDetached] = useState(false);
  const [callSessionStartedAtMs, setCallSessionStartedAtMs] = useState<number | null>(null);
  const [callSessionBalanceSecondsAtStart, setCallSessionBalanceSecondsAtStart] = useState<number | null>(
    null
  );
  const hadHiddenRef = useRef(false);
  const walletToastIntentRef = useRef(false);
  const walletDisconnectIntentRef = useRef(false);
  const previousAuthWalletRef = useRef<boolean | null>(null);
  const inCallToastIdRef = useRef<string | number | null>(null);
  const previousCallsInFlightRef = useRef<number | null>(null);
  const waitingForHistoryAfterCallRef = useRef(false);
  const latestHistoryCreatedAtRef = useRef<string>("");
  const hasInitializedHistoryRef = useRef(false);
  const activeWalletAddress = walletDetached ? "" : walletAddress;
  const activeWalletClientType = walletDetached ? "" : walletClientType;
  const activeWallet = walletDetached ? null : connectedWallet;
  const hasAuthenticatedWallet = Boolean(privyReady && authenticated && activeWalletAddress);

  useEffect(() => {
    const nextUserId = getOrCreateUserId();
    setAnonymousUserId(nextUserId);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WALLET_MANUAL_DISCONNECT_KEY);
      if (stored === "1") {
        setWalletDetached(true);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    if (hasAuthenticatedWallet) {
      setUserId(`wallet:${activeWalletAddress}`);
      return;
    }
    if (anonymousUserId) {
      setUserId(anonymousUserId);
    }
  }, [anonymousUserId, activeWalletAddress, hasAuthenticatedWallet]);

  useEffect(() => {
    setCallHistory([]);
    setCallHistoryLoaded(false);
  }, [userId]);

  useEffect(() => {
    const previous = previousAuthWalletRef.current;
    if (previous === null) {
      previousAuthWalletRef.current = hasAuthenticatedWallet;
      return;
    }

    if (!previous && hasAuthenticatedWallet && walletToastIntentRef.current) {
      toast.success("wallet connected");
      walletToastIntentRef.current = false;
    } else if (previous && !hasAuthenticatedWallet && walletDisconnectIntentRef.current) {
      toast.success("wallet disconnected");
      walletDisconnectIntentRef.current = false;
    }

    previousAuthWalletRef.current = hasAuthenticatedWallet;
  }, [hasAuthenticatedWallet]);

  useEffect(() => {
    if (!callHistoryLoaded) return;
    const latestCreatedAt = callHistory[0]?.createdAtIso ?? "";

    if (!hasInitializedHistoryRef.current) {
      hasInitializedHistoryRef.current = true;
      latestHistoryCreatedAtRef.current = latestCreatedAt;
      return;
    }

    if (
      waitingForHistoryAfterCallRef.current &&
      latestCreatedAt &&
      latestHistoryCreatedAtRef.current &&
      latestCreatedAt !== latestHistoryCreatedAtRef.current
    ) {
      toast.success("new call history added");
      waitingForHistoryAfterCallRef.current = false;
    }

    latestHistoryCreatedAtRef.current = latestCreatedAt;
  }, [callHistory, callHistoryLoaded]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/credits/me?userId=${encodeURIComponent(userId)}`);
      const data = (await response.json()) as { credits: number; pin?: string };
      setCredits(data.credits ?? 0);
      setPin(data.pin ?? "");
    } finally {
      setProfileLoaded(true);
    }
  }, [userId]);

  const loadCallStatus = useCallback(async (): Promise<CallStatusResponse | null> => {
    try {
      const response = await fetch("/api/call/status", { cache: "no-store" });
      const data = (await response.json()) as CallStatusResponse;
      setFreeStatus(data);
      return data;
    } finally {
      setCallStatusLoaded(true);
    }
    return null;
  }, []);

  const loadCallMoment = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/call/moment?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as CallMomentResponse;
      setCallMoment(data.moment ?? null);
    } finally {
      setCallMomentLoaded(true);
    }
  }, [userId]);

  const loadCallHistory = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/call/history?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as CallHistoryResponse;
      setCallHistory(data.history ?? []);
    } finally {
      setCallHistoryLoaded(true);
    }
  }, [userId]);

  const loadRecentCallers = useCallback(async () => {
    try {
      const response = await fetch("/api/call/recent-callers?limit=5", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as RecentCallersResponse;
      setRecentCallers(data.callers ?? []);
    } finally {
      setRecentCallersLoaded(true);
    }
  }, []);

  useEffect(() => {
    const callsInFlight = freeStatus?.callsInFlight ?? 0;
    const hasInFlightCall = callsInFlight > 0;
    const hasActiveCallState = callUiState === "opening" || callUiState === "in_call";
    const shouldShowInCallToast = hasInFlightCall || hasActiveCallState;
    const inCallToastLabel = hasActiveCallState ? "on the call" : "someone is on the call";

    if (shouldShowInCallToast && !inCallToastIdRef.current) {
      inCallToastIdRef.current = toast.success(inCallToastLabel, {
        duration: Infinity,
      });
    }

    if (!shouldShowInCallToast && inCallToastIdRef.current) {
      toast.dismiss(inCallToastIdRef.current);
      inCallToastIdRef.current = null;
    }

    const previousCallsInFlight = previousCallsInFlightRef.current;
    if (previousCallsInFlight !== null && previousCallsInFlight > 0 && callsInFlight === 0) {
      toast.success("call ended");
      waitingForHistoryAfterCallRef.current = true;
      void loadProfile();
      void loadCallHistory();
    }
    previousCallsInFlightRef.current = callsInFlight;
  }, [freeStatus?.callsInFlight, callUiState, loadCallHistory, loadProfile]);

  useEffect(() => {
    const isLikelyUserOnCall =
      callUiState === "opening" || callUiState === "in_call" || (freeStatus?.callsInFlight ?? 0) > 0;
    if (isLikelyUserOnCall && callSessionStartedAtMs === null) {
      setCallSessionStartedAtMs(Date.now());
      setCallSessionBalanceSecondsAtStart(
        Math.max(0, Math.floor((credits / Math.max(1, pricing.creditsPerMinute)) * 60))
      );
      return;
    }
    if (!isLikelyUserOnCall && callSessionStartedAtMs !== null) {
      setCallSessionStartedAtMs(null);
      setCallSessionBalanceSecondsAtStart(null);
      void loadProfile();
    }
  }, [
    callUiState,
    freeStatus?.callsInFlight,
    callSessionStartedAtMs,
    credits,
    pricing.creditsPerMinute,
    loadProfile,
  ]);

  useEffect(() => {
    void loadProfile();
    void loadCallMoment();
    void loadCallHistory();
    void loadRecentCallers();
  }, [loadProfile, loadCallMoment, loadCallHistory, loadRecentCallers]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      void loadCallMoment();
      void loadCallHistory();
      void loadRecentCallers();
    }, 5000);

    return () => {
      window.clearInterval(refresh);
    };
  }, [loadCallMoment, loadCallHistory, loadRecentCallers]);

  useEffect(() => {
    let active = true;

    async function sync() {
      if (!active) return;
      await Promise.all([loadCallStatus(), loadProfile(), loadCallHistory(), loadRecentCallers()]);
    }

    void sync();
    const refresh = window.setInterval(() => {
      void sync();
    }, 5_000);

    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [loadCallStatus, loadProfile, loadCallHistory, loadRecentCallers]);

  useEffect(() => {
    let active = true;

    async function loadPricing() {
      try {
        const response = await fetch("/api/credits/pricing", { cache: "no-store" });
        const data = (await response.json()) as CreditsPricingResponse;
        if (active) setPricing(data);
      } finally {
        if (active) setPricingLoaded(true);
      }
    }

    void loadPricing();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    async function syncCallUiAfterForeground() {
      const status = await loadCallStatus();
      void loadProfile();
      void loadCallMoment();
      void loadCallHistory();
      void loadRecentCallers();

      if (!status) return;
      if (status.callsInFlight > 0) {
        setCallUiState("in_call");
        return;
      }

      if (hadHiddenRef.current || callUiState === "opening" || callUiState === "in_call") {
        hadHiddenRef.current = false;
        setCallUiState("returned");
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && callUiState === "opening") {
        hadHiddenRef.current = true;
        setCallUiState("in_call");
      }

      if (document.visibilityState === "visible") {
        void syncCallUiAfterForeground();
      }
    }

    function onWindowFocus() {
      void syncCallUiAfterForeground();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [callUiState, loadCallMoment, loadCallStatus, loadProfile, loadCallHistory, loadRecentCallers]);

  useEffect(() => {
    if (callUiState !== "opening" && callUiState !== "in_call") return;

    const refresh = window.setInterval(() => {
      void loadProfile();
      void loadCallStatus();
      void loadCallMoment();
      void loadCallHistory();
      void loadRecentCallers();
    }, 5000);

    return () => {
      window.clearInterval(refresh);
    };
  }, [callUiState, loadCallMoment, loadCallStatus, loadProfile, loadCallHistory, loadRecentCallers]);

  function formatRecentTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "recently";
    const diffSeconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
    if (diffSeconds < 5) return "just now";
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  function wrapCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines: string[] = [];
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const next = `${current} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
    return lines;
  }

  function normalizeMaskedPhoneLabel(value: string): string {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    const last4 = digits.slice(-4).padStart(4, "*");
    return `***-***-${last4}`;
  }

  async function checkoutCredits() {
    if (!userId || buying) return;
    if (!hasAuthenticatedWallet) {
      setCheckoutStatus("connect wallet first.");
      return;
    }
    const normalizedWalletType = activeWalletClientType.toLowerCase();
    const unsupportedSmartWalletTypes = new Set([
      "safe",
      "kernel",
      "biconomy",
      "light_account",
      "coinbase_smart_wallet",
      "base_account",
    ]);
    const looksLikeSmartWallet =
      unsupportedSmartWalletTypes.has(normalizedWalletType) ||
      normalizedWalletType.includes("smart");
    if (looksLikeSmartWallet) {
      setCheckoutStatus(
        "this wallet type is not supported for usdc x402 yet. use an eoa wallet (metamask/coinbase wallet)."
      );
      return;
    }

    const amountUsd = Math.min(
      pricing.maxPurchaseUsd,
      Math.max(pricing.minPurchaseUsd, Math.floor(selectedAmountUsd))
    );
    setBuying(true);

    try {
      if (!activeWallet?.getEthereumProvider) {
        setCheckoutStatus("connected wallet does not expose an ethereum provider.");
        return;
      }

      const provider = await activeWallet.getEthereumProvider();
      const baseChainHex = `0x${base.id.toString(16)}`;
      try {
        const currentChainHex = (await provider.request({
          method: "eth_chainId",
        })) as string;
        if (typeof currentChainHex === "string" && currentChainHex.toLowerCase() !== baseChainHex) {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: baseChainHex }],
          });
        }
      } catch {
        setCheckoutStatus("switch wallet network to base and try again.");
        return;
      }

      const client = new x402Client();
      const maxValueAtomic = BigInt(amountUsd * 1_200_000);
      const walletClient = createWalletClient({
        account: activeWalletAddress as `0x${string}`,
        chain: base,
        transport: custom(provider),
      });
      const signer: ClientEvmSigner = {
        address: activeWalletAddress as `0x${string}`,
        signTypedData: async (message) =>
          walletClient.signTypedData({
            account: activeWalletAddress as `0x${string}`,
            ...(message as Parameters<typeof walletClient.signTypedData>[0]),
          }),
      };
      registerExactEvmScheme(client, {
        signer,
        policies: [
          (_version, requirements) =>
            requirements.filter((requirement) => {
              const candidateAmount =
                "maxAmountRequired" in requirement
                  ? requirement.maxAmountRequired
                  : requirement.amount;
              if (!candidateAmount || typeof candidateAmount !== "string") return false;
              try {
                return BigInt(candidateAmount) <= maxValueAtomic;
              } catch {
                return false;
              }
            }),
        ],
      });

      const fetchWithPayment = wrapFetchWithPayment(fetch, client);

      const x402Response = await fetchWithPayment("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amountUsd, provider: "x402" }),
      });
      const x402Data = (await x402Response.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
        granted?: boolean;
        balance?: number;
        provider?: "x402" | "stripe";
      };

      if (x402Response.ok && x402Data.provider === "x402") {
        if (x402Data.granted) {
          toast.success("payment received. minutes updated.");
        } else {
          toast.success("payment processed.");
        }
        setCheckoutStatus("");
        await loadProfile();
        return;
      }

      if (x402Response.ok && x402Data.checkoutUrl) {
        window.location.href = x402Data.checkoutUrl;
        return;
      }

      setCheckoutStatus(x402Data.error ?? "could not process payment.");
    } catch (error) {
      setCheckoutStatus(error instanceof Error ? error.message : "payment failed.");
    } finally {
      setBuying(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout");
    const sessionId = params.get("session_id");
    if (status === "success") {
      toast.success("payment received. minutes updated.");
      setCheckoutStatus("");
      if (sessionId && userId) {
        void (async () => {
          try {
            await fetch("/api/credits/confirm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, sessionId }),
            });
            await loadProfile();
          } catch {
            // Keep optimistic status text; polling/future refresh can still reconcile.
          }
        })();
      }
      return;
    }
    if (status === "cancel") {
      setCheckoutStatus("Checkout canceled.");
      return;
    }
    setCheckoutStatus("");
  }, [loadProfile, userId]);

  const freePoolSecondsLeft = Math.max(0, freeStatus?.freePoolSecondsLeft ?? 0);
  const hasFreeCapacity = freePoolSecondsLeft > 0;
  const freeCallsEnabled = freeStatus?.freeCallsEnabled ?? true;
  const hasPaidCredits = credits > 0;
  const shouldShowAccessCode = callStatusLoaded && hasPaidCredits;
  const purchaseUsd = Math.min(
    pricing.maxPurchaseUsd,
    Math.max(pricing.minPurchaseUsd, Math.floor(selectedAmountUsd))
  );
  const presetAmountsUsd = [1, 2, 8, 12];
  const currentMinutes = credits / Math.max(1, pricing.creditsPerMinute);
  const currentSeconds = Math.floor(currentMinutes * 60);
  const elapsedCallSeconds =
    callSessionStartedAtMs === null ? 0 : Math.max(0, Math.floor((nowMs - callSessionStartedAtMs) / 1000));
  const liveBalanceSeconds =
    callSessionBalanceSecondsAtStart === null
      ? currentSeconds
      : Math.max(0, callSessionBalanceSecondsAtStart - elapsedCallSeconds);
  const hasPaidHistory = callHistory.length > 0;
  const isAnyCallInFlight = (freeStatus?.callsInFlight ?? 0) > 0;
  const isLikelyUserOnCall = callUiState === "opening" || callUiState === "in_call";
  const canDial =
    callStatusLoaded &&
    Boolean(freeStatus?.agentNumber) &&
    !isAnyCallInFlight &&
    ((freeCallsEnabled && hasFreeCapacity) || hasPaidCredits);
  const resetAtMs = freeStatus?.resetsAt ? new Date(freeStatus.resetsAt).getTime() : null;
  const msUntilReset = resetAtMs ? Math.max(0, resetAtMs - nowMs) : null;
  const resetHours = msUntilReset === null ? 0 : Math.floor(msUntilReset / 3_600_000);
  const resetMinutes = msUntilReset === null ? 0 : Math.floor((msUntilReset % 3_600_000) / 60_000);
  const resetSeconds = msUntilReset === null ? 0 : Math.floor((msUntilReset % 60_000) / 1000);
  const resetCountdown =
    msUntilReset === null
      ? null
      : `${String(resetHours).padStart(2, "0")}:${String(resetMinutes).padStart(2, "0")}:${String(
          resetSeconds
        ).padStart(2, "0")}`;
  const freeMinutesLeft = Math.floor(freePoolSecondsLeft / 60);
  const freeSecondsLeft = freePoolSecondsLeft % 60;
  const freeTimeLabel =
    freeSecondsLeft === 0
      ? `${freeMinutesLeft}m`
      : freeMinutesLeft > 0
      ? `${freeMinutesLeft}m ${freeSecondsLeft}s`
      : `${freeSecondsLeft}s left`;
  const buttonLabel = !callStatusLoaded
    ? "Checking availability..."
    : isAnyCallInFlight
      ? "On the call"
      : !hasPaidCredits && (!freeCallsEnabled || !hasFreeCapacity)
      ? "free calls unavailable"
      : callUiState === "opening"
      ? "Opening..."
      : callUiState === "in_call"
        ? "On the call"
        : freeStatus?.agentNumber
          ? `Call ${freeStatus.agentNumber}`
          : "Call now";
  const callStatusText = !callStatusLoaded
    ? ""
    : isAnyCallInFlight
    ? "Someone is currently on a call. Try again shortly."
    : !freeCallsEnabled && !hasPaidCredits
    ? "free calls are disabled. connect wallet and buy minutes."
    : !hasFreeCapacity && !hasPaidCredits
    ? resetCountdown
      ? `Resets in ${resetCountdown}`
      : "Free calls are currently unavailable."
    : !freeCallsEnabled && hasPaidCredits
    ? "paid mode active. call and use your access code."
    : !hasFreeCapacity && hasPaidCredits
    ? "free pool is used up. paid mode active with your access code."
    : callUiState === "opening"
      ? "Opening your phone app..."
      : callUiState === "in_call"
        ? "On the call."
        : callUiState === "returned"
          ? "You are back. Start another call anytime."
          : "";

  function startPhoneCall() {
    if (!freeStatus?.agentNumber) return;
    setShareFeedback("");
    setCallUiState("opening");
    window.location.href = `tel:${freeStatus.agentNumber}`;
  }

  async function copyAccessCode() {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setPinCopyFeedback("copied");
      window.setTimeout(() => {
        setPinCopyFeedback("");
      }, 1500);
    } catch {
      setPinCopyFeedback("");
    }
  }

  async function disconnectCurrentWallet() {
    if (!connectedWallet && !activeWalletAddress) return;
    setWalletDetached(true);
    try {
      window.localStorage.setItem(WALLET_MANUAL_DISCONNECT_KEY, "1");
    } catch {
      // ignore storage failures
    }
    walletDisconnectIntentRef.current = true;
    const normalizedWalletType = activeWalletClientType.toLowerCase();
    const skipProgrammaticDisconnect =
      normalizedWalletType.includes("metamask") || normalizedWalletType.includes("injected");

    if (privyReady && authenticated) {
      try {
        await logoutPrivy();
      } catch {
        // Keep local detach behavior even if session logout fails.
      }
    }

    try {
      const maybeDisconnect =
        connectedWallet &&
        (connectedWallet as unknown as { disconnect?: () => void | Promise<void> }).disconnect;
      if (!skipProgrammaticDisconnect && connectedWallet && typeof maybeDisconnect === "function") {
        await Promise.resolve(maybeDisconnect());
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const unsupported = /does not support programmatic disconnect/i.test(message);

      if (!unsupported) {
        walletDisconnectIntentRef.current = false;
        toast.error("could not disconnect wallet");
        return;
      }
    }

    return;
  }

  async function shareCallMoment() {
    if (!callMoment) return;

    const shareText = `My last call with Carlos AI: ${callMoment.summary}`;
    const nav = typeof window !== "undefined" ? window.navigator : undefined;

    try {
      if (nav && typeof nav.share === "function") {
        await nav.share({
          title: "My Carlos AI Call",
          text: shareText,
        });
        setShareFeedback("Shared.");
        return;
      }

      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(shareText);
        setShareFeedback("Copied to clipboard.");
      }
    } catch {
      setShareFeedback("Could not share right now.");
    }
  }

  async function shareCallHistoryItem(item: CallHistoryResponse["history"][number]) {
    const when = new Date(item.createdAtIso);
    const whenLabel = Number.isNaN(when.getTime())
      ? "recently"
      : `${when.getDate()}/${when.getMonth() + 1}/${when.getFullYear()}`;
    const footerLabel = whenLabel;
    const cleanSummary = item.summary.trim() || "we had a quick call.";
    const phoneLabel = normalizeMaskedPhoneLabel(item.phoneLabel);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#111111";
      ctx.font = "500 52px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(phoneLabel, 84, 140);

      ctx.font = "400 82px Inter, Arial, sans-serif";
      const summaryLines = wrapCanvasText(ctx, cleanSummary, canvas.width - 168);
      const visibleSummaryLines = summaryLines.slice(0, 6);
      const lineHeight = 108;
      const summaryBlockHeight = visibleSummaryLines.length * lineHeight;
      let y = canvas.height - 210 - summaryBlockHeight;
      y = Math.max(260, y);
      for (const line of visibleSummaryLines) {
        ctx.fillText(line, 84, y);
        y += lineHeight;
      }

      ctx.fillStyle = "#6b7280";
      ctx.font = "500 52px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(footerLabel, 84, canvas.height - 96);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("image generation failed");

      const file = new File([blob], "carlos-call-card.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: "Carlos AI call card",
          files: [file],
        });
        toast.success("shared");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "carlos-call-card.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("card downloaded");
    } catch {
      toast.error("could not generate card");
    }
  }

  async function shareRecentCallerItem(item: RecentCallersResponse["callers"][number]) {
    await shareCallHistoryItem({
      summary: item.highlight,
      durationSeconds: 0,
      createdAtIso: item.lastCallAtIso,
      phoneLabel: item.label,
    });
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 pb-20 pt-10 sm:px-10">
      <SiteHeader showCallButton={false} showPitchButton />

      <section className="rounded-lg border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Call Carlitos</h2>
        <p className="mt-2 text-sm text-zinc-700">
          basically a digital mini-me that loves to chat about tech, life, ideas, and anything in between.
          It&apos;s like calling me, but with zero social anxiety.
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          use cases: pitch me, latest thesis + thoughts, projects, personal or casual talk.
        </p>
        {isLikelyUserOnCall ? (
          <p className="mt-2 text-xs font-semibold text-emerald-600 animate-pulse">on the call</p>
        ) : isAnyCallInFlight ? (
          <p className="mt-2 text-xs font-semibold text-emerald-600 animate-pulse">someone is on the call</p>
        ) : null}
        {/* {callStatusLoaded ? (
          <>
            <p className="mt-2 text-xs text-zinc-600">
              Daily free pool: {Math.floor(freePoolSecondsTotal / 60)} mins, max {""}
              {Math.floor(maxFreeCallSeconds / 60)} mins/call
            </p>
          </>
        ) : (
          <div className="mt-3 animate-pulse space-y-2">
            <div className="h-4 w-44 rounded bg-zinc-200" />
            <div className="h-3 w-64 rounded bg-zinc-200" />
          </div>
        )} */}

        <button
          type="button"
          onClick={startPhoneCall}
          disabled={!canDial || callUiState === "opening" || callUiState === "in_call"}
          className={`hidden mt-4 mb-2 block w-full rounded-full px-3 py-3 text-center text-sm font-semibold text-white transition disabled:cursor-not-allowed ${
            isAnyCallInFlight
              ? "bg-emerald-600 shadow-[0_0_0_2px_rgba(16,185,129,0.28),0_0_28px_rgba(16,185,129,0.55)] animate-pulse"
              : "bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60"
          }`}
        >
          {buttonLabel}
        </button>

        {callStatusLoaded && freePoolSecondsLeft > 0 ? (
          <p className="mt-2 text-xs text-zinc-700">
            Today timeslots: <span className="font-semibold text-zinc-900">{freeTimeLabel}</span>
          </p>
        ) : null}

        {callStatusLoaded && callStatusText ? (
          <p className={`hidden mt-2 text-xs text-zinc-500 ${callUiState === "returned" ? "text-left" : "text-left"}`}>
            {callStatusText}
          </p>
        ) : null}

        {shouldShowAccessCode ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-700">Access code</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-900">{pin || "------"}</p>
              <button
                type="button"
                onClick={copyAccessCode}
                disabled={!pin}
                className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pinCopyFeedback === "copied" ? "copied" : "copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              time left:{" "}
              <span className="font-semibold text-zinc-900">
                {currentSeconds < 60 ? `${currentSeconds}s` : `${Math.floor(currentMinutes)} minutes`}
              </span>
            </p>
            {freeStatus?.agentNumber ? (
              <p className="mt-2 text-xs text-zinc-600">
                Call{" "}
                <a href={`tel:${freeStatus.agentNumber}`} className="font-semibold text-zinc-900">
                  {freeStatus.agentNumber}
                </a>{" "}
                and enter this code when prompted.
              </p>
            ) : null}
            <p className="hidden mt-2 text-xs text-zinc-600">Use this code when phone flow asks for paid access.</p>
          </div>
        ) : null}

      </section>

      <section className="mt-4 rounded-lg border border-zinc-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900">purchase calls</h2>
          <p className="text-xs font-mono text-zinc-500">powered by x402</p>
        </div>
        {!profileLoaded || !pricingLoaded ? (
          <div className="mt-3 animate-pulse space-y-2">
            <div className="h-4 w-40 rounded bg-zinc-200" />
            <div className="h-11 rounded-full bg-zinc-100" />
            <div className="h-11 rounded-full bg-zinc-100" />
          </div>
        ) : (
          <div>
            {hasAuthenticatedWallet && liveBalanceSeconds > 0 ? (
              <p className="mt-2 text-sm text-zinc-700">
                balance:{" "}
                {liveBalanceSeconds < 60
                  ? `${liveBalanceSeconds}s`
                  : `${Math.floor(liveBalanceSeconds / 60)}m ${liveBalanceSeconds % 60}s`}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {presetAmountsUsd.map((usdAmount) => {
                const clampedUsd = Math.min(
                  pricing.maxPurchaseUsd,
                  Math.max(pricing.minPurchaseUsd, usdAmount)
                );
                const selected = selectedAmountUsd === clampedUsd;
                const creditsForPack = clampedUsd * pricing.creditsPerDollar;
                const minutesForPack = creditsForPack / Math.max(1, pricing.creditsPerMinute);
                const secondsForPack = Math.floor(minutesForPack * 60);
                return (
                  <button
                    key={usdAmount}
                    type="button"
                    onClick={() => {
                      setSelectedAmountUsd(clampedUsd);
                    }}
                    className={`rounded-full border px-3 py-2 text-center text-xs uppercase font-semibold font-mono transition ${
                      selected
                        ? "border-zinc-900 bg-white text-zinc-900"
                        : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400"
                    }`}
                  >
                    <span className="block">
                      {secondsForPack < 60 ? `${secondsForPack}s` : `${Math.floor(minutesForPack)}min`}
                    </span>
                    <span className="block text-xs font-normal text-zinc-600">
                      ${clampedUsd}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                if (!hasAuthenticatedWallet) {
                  walletToastIntentRef.current = true;
                  walletDisconnectIntentRef.current = false;
                  setWalletDetached(false);
                  try {
                    window.localStorage.removeItem(WALLET_MANUAL_DISCONNECT_KEY);
                  } catch {
                    // ignore storage failures
                  }
                  const maybeLoginOrLink =
                    activeWallet &&
                    (activeWallet as unknown as { loginOrLink?: () => void | Promise<void> })
                      .loginOrLink;
                  if (activeWallet && typeof maybeLoginOrLink === "function" && !authenticated) {
                    void Promise.resolve(maybeLoginOrLink());
                  } else {
                    login();
                  }
                  return;
                }
                void checkoutCredits();
              }}
              disabled={
                !hasAuthenticatedWallet
                  ? !privyReady
                  : buying || purchaseUsd < pricing.minPurchaseUsd || !authenticated
              }
              className={`mt-3 block w-full rounded-full px-3 py-3 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                hasAuthenticatedWallet
                  ? "bg-zinc-900 text-white hover:bg-zinc-800"
                  : "border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400"
              }`}
            >
              {!hasAuthenticatedWallet
                ? privyReady
                  ? "connect wallet"
                  : "loading wallet..."
                : buying
                  ? "processing..."
                  : "pay with usdc"}
            </button>

            {hasAuthenticatedWallet ? (
              <div className="mt-2 flex items-center gap-2">
                <p className="text-xs text-zinc-500">
                  {`wallet: ${activeWalletAddress.slice(0, 3)}...${activeWalletAddress.slice(-3)}`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void disconnectCurrentWallet();
                  }}
                  className="text-xs italic underline text-zinc-500 hover:text-zinc-700"
                >
                  disconnect
                </button>
              </div>
            ) : null}

            {checkoutStatus ? <p className="mt-2 text-xs text-zinc-500">{checkoutStatus}</p> : null}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">recent calls (anonymous)</h2>
        {!recentCallersLoaded ? (
          <div className="mt-3 animate-pulse space-y-2">
            <div className="h-14 rounded-md bg-zinc-100" />
            <div className="h-14 rounded-md bg-zinc-100" />
            <div className="h-14 rounded-md bg-zinc-100" />
          </div>
        ) : recentCallers.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">no recent calls yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentCallers.map((caller, index) => (
              <li
                key={`${caller.label}-${caller.lastCallAtIso}-${index}`}
                className="rounded-md border border-zinc-100 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-900 font-mono tabular-nums tracking-wide">
                    {caller.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{formatRecentTime(caller.lastCallAtIso)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void shareRecentCallerItem(caller);
                      }}
                      className="hidden text-xs underline text-zinc-500 hover:text-zinc-700"
                    >
                      share
                    </button>
                  </div>
                </div>
                <p
                  className={`mt-1 text-xs ${
                    caller.highlight.trim().toLowerCase() === "on the call"
                      ? "font-semibold text-emerald-600 animate-pulse"
                      : "text-zinc-600"
                  }`}
                >
                  {caller.highlight}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasPaidHistory ? (
        <section className="mt-4 rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">call history</h2>
          <ul className="mt-3 space-y-2">
            {callHistory.map((item, index) => (
              <li
                key={`${item.createdAtIso}-${index}`}
                className="rounded-md border border-zinc-100 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-900">
                    {item.durationSeconds < 60
                      ? `${item.durationSeconds}s`
                      : `${Math.floor(item.durationSeconds / 60)}m ${item.durationSeconds % 60}s`}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{formatRecentTime(item.createdAtIso)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void shareCallHistoryItem(item);
                      }}
                      className="text-xs underline text-zinc-500 hover:text-zinc-700"
                    >
                      share
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-zinc-600">{item.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {SHOW_LAST_CALL_MOMENT && !callMomentLoaded ? (
        <section className="mt-4 rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Last Call Moment</h2>
          <div className="mt-3 animate-pulse space-y-2">
            <div className="h-4 w-4/5 rounded bg-zinc-200" />
            <div className="h-3 w-24 rounded bg-zinc-200" />
            <div className="h-10 rounded-full bg-zinc-100" />
          </div>
        </section>
      ) : SHOW_LAST_CALL_MOMENT && callMoment ? (
        <section className="mt-4 rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Last Call Moment</h2>
          <p className="mt-2 text-sm text-zinc-700">{callMoment.summary}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {Math.floor(callMoment.durationSeconds / 60)}m {callMoment.durationSeconds % 60}s
          </p>
          <button
            type="button"
            onClick={shareCallMoment}
            className="mt-3 block w-full rounded-full border border-zinc-900 bg-white px-3 py-3 text-center text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            Share This Moment
          </button>
          {shareFeedback ? <p className="mt-2 text-xs text-zinc-500">{shareFeedback}</p> : null}
        </section>
      ) : null}
    </main>
  );
}

export default function CallPageClient() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  if (!appId) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-6 pb-20 pt-10 sm:px-10">
        <SiteHeader showCallButton={false} showPitchButton />
        <section className="rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">wallet payments unavailable</h2>
          <p className="mt-2 text-sm text-zinc-700">
            set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to enable wallet connect and x402 payments.
          </p>
        </section>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet"],
      }}
    >
      <CallPageWithPrivy />
    </PrivyProvider>
  );
}
