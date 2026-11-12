import { useState, useEffect, useRef, useCallback } from "react";

export type ProctoringMode = "OFF" | "WARN" | "STRICT";

export interface SecurityViolationDetails {
  type: "fullscreen_exit" | "visibility_hidden" | "window_blur" | "copy_paste_attempt" | "strict_immediate_kick" | string;
  timestamp: string;
  details?: string;
  awaySeconds?: number;
}

export interface UseExamSecurityOptions {
  active: boolean;
  proctoringMode?: ProctoringMode;
  graceSeconds?: number;
  maxLeaves?: number;
  strictImmediateKick?: boolean;
  isSubmitting?: boolean;
  isOffline?: boolean;
  onViolation?: (
    incidentCount: number,
    leaveDuration: number,
    reason?: string,
    details?: SecurityViolationDetails
  ) => void;
  onAutoSubmit?: (
    incidentCount: number,
    leaveDuration: number,
    reason?: string,
    details?: SecurityViolationDetails
  ) => void;
}

export interface UseExamSecurityReturn {
  isWakeLockActive: boolean;
  incidentCount: number;
  warningModalOpen: boolean;
  closeWarningModal: () => void;
  lastLeaveDuration: number | null;
  warnToastMessage: string | null;
  clearWarnToast: () => void;
  activeProctoringMode: ProctoringMode;
  isFullscreen: boolean;
  isFocusLost: boolean;
  requestFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  unbindSecurity: () => void;
  lastAwaySeconds: number;
}

export function useExamSecurity({
  active,
  proctoringMode = "WARN",
  graceSeconds = 3,
  maxLeaves = 1,
  strictImmediateKick = false,
  isSubmitting = false,
  isOffline = false,
  onViolation,
  onAutoSubmit,
}: UseExamSecurityOptions): UseExamSecurityReturn {
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const [incidentCount, setIncidentCount] = useState<number>(0);
  const [warningModalOpen, setWarningModalOpen] = useState<boolean>(false);
  const [lastLeaveDuration, setLastLeaveDuration] = useState<number | null>(null);
  const [lastAwaySeconds, setLastAwaySeconds] = useState<number>(0);
  const [warnToastMessage, setWarnToastMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isFocusLost, setIsFocusLost] = useState<boolean>(false);

  const leaveStartTimeRef = useRef<number | null>(null);
  const leaveReasonTypeRef = useRef<string>("visibility_hidden");
  const isLeavingRef = useRef<boolean>(false);
  const graceTimerRef = useRef<any>(null);
  const incidentsRef = useRef<number>(0);
  const hasAutoSubmittedRef = useRef<boolean>(false);
  const hasEnteredFullscreenRef = useRef<boolean>(false);
  const wakeLockSentinelRef = useRef<any>(null);

  const isOfflineRef = useRef<boolean>(Boolean(isOffline));
  const recoveryWindowUntilRef = useRef<number>(0);

  useEffect(() => {
    const wasOffline = isOfflineRef.current;
    const isNowOffline = Boolean(isOffline);
    isOfflineRef.current = isNowOffline;

    if (isNowOffline) {
      setWarningModalOpen(false);
      setWarnToastMessage(null);
      setIsFocusLost(false);
    } else if (wasOffline && !isNowOffline) {
      // Transitioning from offline back to online: set a 5s recovery window to absorb network reconnection events
      recoveryWindowUntilRef.current = Date.now() + 5000;
      setIsFocusLost(false);
    }
  }, [isOffline]);

  const isExemptDueToOffline = useCallback((): boolean => {
    if (isOfflineRef.current) return true;
    if (typeof navigator !== "undefined" && !navigator.onLine) return true;
    if (Date.now() < recoveryWindowUntilRef.current) return true;
    return false;
  }, []);

  // Synchronous live refs to guarantee instant unbinding & short-circuiting during submit
  const activeRef = useRef<boolean>(active && !isSubmitting);
  activeRef.current = active && !isSubmitting;
  const isSubmittingRef = useRef<boolean>(Boolean(isSubmitting));
  isSubmittingRef.current = Boolean(isSubmitting);

  // Keep latest callbacks in refs to prevent unnecessary re-binding
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  // Helper to check active fullscreen element across vendor prefixes
  const checkIsFullscreen = useCallback((): boolean => {
    if (typeof document === "undefined") return false;
    const doc = document as any;
    return Boolean(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );
  }, []);

  // Request browser fullscreen mode
  const requestFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      const elem = document.documentElement as any;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        await elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        await elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        await elem.msRequestFullscreen();
      }
      hasEnteredFullscreenRef.current = true;
      setIsFullscreen(true);
    } catch (err) {
      console.debug("Fullscreen request prevented by browser or unsupported:", err);
    }
  }, []);

  // Safe exit from fullscreen
  const exitFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      const doc = document as any;
      if (
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      ) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      }
      setIsFullscreen(false);
    } catch {
      // Ignore exit error
    }
  }, []);

  // 1. Screen Wake Lock Integration
  useEffect(() => {
    if (!active || isSubmitting) {
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release().catch(() => {});
        wakeLockSentinelRef.current = null;
      }
      setIsWakeLockActive(false);
      return;
    }

    let isSubscribed = true;

    const requestWakeLock = async () => {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator) || !navigator.wakeLock) {
        return;
      }
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (!isSubscribed) {
          sentinel.release().catch(() => {});
          return;
        }
        wakeLockSentinelRef.current = sentinel;
        setIsWakeLockActive(true);

        sentinel.addEventListener("release", () => {
          if (isSubscribed) {
            setIsWakeLockActive(false);
            wakeLockSentinelRef.current = null;
          }
        });
      } catch (err) {
        console.debug("Screen Wake Lock request non-critical fallback:", err);
      }
    };

    requestWakeLock();

    const handleVisibilityChangeWakeLock = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
      if (document.visibilityState === "visible" && !wakeLockSentinelRef.current) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChangeWakeLock);

    return () => {
      isSubscribed = false;
      document.removeEventListener("visibilitychange", handleVisibilityChangeWakeLock);
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release().catch(() => {});
        wakeLockSentinelRef.current = null;
      }
      setIsWakeLockActive(false);
    };
  }, [active, isSubmitting]);

  // 2. Fullscreen Change & Split Screen Block Monitoring
  useEffect(() => {
    if (!active || isSubmitting || proctoringMode === "OFF") {
      return;
    }

    const handleFullscreenChange = () => {
      if (!activeRef.current || isSubmittingRef.current) return;

      const isCurrentlyFullscreen = checkIsFullscreen();
      setIsFullscreen(isCurrentlyFullscreen);

      // If user had entered fullscreen and now exited (or split screen forced exit):
      if (hasEnteredFullscreenRef.current && !isCurrentlyFullscreen) {
        if (hasAutoSubmittedRef.current || isSubmittingRef.current) return;

        const nextCount = incidentsRef.current + 1;
        incidentsRef.current = nextCount;
        setIncidentCount(nextCount);
        setLastLeaveDuration(0);

        const reason = "الخروج من وضع ملء الشاشة أو تفعيل الشاشة المنقسمة (Split Screen)";
        const violationDetails: SecurityViolationDetails = {
          type: "fullscreen_exit",
          timestamp: new Date().toISOString(),
          details: reason,
          awaySeconds: 0,
        };

        if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
          onViolationRef.current(nextCount, 0, reason, violationDetails);
        }

        // Check 2-strike policy (strike 2 auto-locks)
        if (strictImmediateKick || nextCount >= 2) {
          hasAutoSubmittedRef.current = true;
          setWarningModalOpen(false);
          if (onAutoSubmitRef.current && activeRef.current && !isSubmittingRef.current) {
            onAutoSubmitRef.current(nextCount, 0, reason, violationDetails);
          }
        } else {
          setWarningModalOpen(true);
        }
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [active, isSubmitting, proctoringMode, strictImmediateKick, maxLeaves, checkIsFullscreen]);

  // 3. Prevent text selection, copy/cut/paste, and contextmenu
  useEffect(() => {
    if (!active || isSubmitting || proctoringMode === "OFF") return;

    const preventDefaultAndLog = (e: Event) => {
      if (!activeRef.current || isSubmittingRef.current) return;
      
      if (proctoringMode === "STRICT") {
        e.preventDefault();
        const typeStr = e.type;
        const reason = `محاولة ${typeStr === "contextmenu" ? "فتح القائمة الجانبية" : typeStr === "copy" ? "النسخ" : typeStr === "paste" ? "اللصق" : "تحديد النص"} أثناء الامتحان`;
        
        if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
          onViolationRef.current(incidentsRef.current, 0, reason, {
            type: "copy_paste_attempt",
            timestamp: new Date().toISOString(),
            details: reason,
            awaySeconds: 0,
          });
        }
      }
    };

    document.addEventListener("contextmenu", preventDefaultAndLog);
    document.addEventListener("copy", preventDefaultAndLog);
    document.addEventListener("cut", preventDefaultAndLog);
    document.addEventListener("paste", preventDefaultAndLog);

    return () => {
      document.removeEventListener("contextmenu", preventDefaultAndLog);
      document.removeEventListener("copy", preventDefaultAndLog);
      document.removeEventListener("cut", preventDefaultAndLog);
      document.removeEventListener("paste", preventDefaultAndLog);
    };
  }, [active, isSubmitting, proctoringMode]);

  // 4. Focus Loss & Focus-Blur Tracking with 3-Second Grace Window & 2-Strike Enforcement
  useEffect(() => {
    if (!active || isSubmitting || proctoringMode === "OFF") {
      leaveStartTimeRef.current = null;
      isLeavingRef.current = false;
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      setIsFocusLost(false);
      setWarningModalOpen(false);
      setWarnToastMessage(null);
      return;
    }

    const updateFocusLossState = () => {
      if (typeof document === "undefined" || !activeRef.current || isSubmittingRef.current) return;
      const isHidden = document.visibilityState === "hidden";
      setIsFocusLost(isHidden);
    };

    const handleLeave = (type: string) => {
      if (!activeRef.current || isSubmittingRef.current) return;
      updateFocusLossState();

      if (!isLeavingRef.current) {
        isLeavingRef.current = true;
        leaveStartTimeRef.current = Date.now();
        leaveReasonTypeRef.current = type;
      }
    };

    const handleReturn = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
      updateFocusLossState();

      if (!isLeavingRef.current || leaveStartTimeRef.current === null) {
        isLeavingRef.current = false;
        leaveStartTimeRef.current = null;
        if (graceTimerRef.current) {
          clearTimeout(graceTimerRef.current);
          graceTimerRef.current = null;
        }
        return;
      }

      const leaveDurationMs = Date.now() - leaveStartTimeRef.current;
      const awaySecs = Math.max(1, Math.round(leaveDurationMs / 1000));
      const leaveType = leaveReasonTypeRef.current || "visibility_hidden";

      isLeavingRef.current = false;
      leaveStartTimeRef.current = null;
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }

      // If returned within 3 seconds grace period (e.g., declining incoming call/banner), ZERO penalty
      if (leaveDurationMs < 3000) {
        return;
      }

      if (hasAutoSubmittedRef.current || isSubmittingRef.current) {
        return;
      }

      const nextCount = incidentsRef.current + 1;
      incidentsRef.current = nextCount;
      setIncidentCount(nextCount);
      setLastLeaveDuration(awaySecs);
      setLastAwaySeconds(awaySecs);

      const reason = `مغادرة شاشة الامتحان لمدة ${awaySecs} ثانية`;
      const violationDetails: SecurityViolationDetails = {
        type: leaveType,
        timestamp: new Date().toISOString(),
        details: reason,
        awaySeconds: awaySecs,
      };

      if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
        onViolationRef.current(nextCount, awaySecs, reason, violationDetails);
      }

      // 2-Strike Policy: Strike 1 shows warning modal, Strike 2 locks exam & submits
      if (nextCount >= 2 || strictImmediateKick) {
        hasAutoSubmittedRef.current = true;
        setWarningModalOpen(false);
        if (onAutoSubmitRef.current && activeRef.current && !isSubmittingRef.current) {
          onAutoSubmitRef.current(nextCount, awaySecs, reason, violationDetails);
        }
      } else {
        setWarningModalOpen(true);
      }
    };

    const handleVisibilityChange = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
      if (document.visibilityState === "hidden") {
        handleLeave("visibility_hidden");
      } else if (document.visibilityState === "visible") {
        handleReturn();
      }
    };

    // Eliminate false positives: Only treat blur as leave IF document is actually hidden
    const handleWindowBlur = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        handleLeave("window_blur");
      }
    };

    const handleWindowFocus = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        handleReturn();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, [active, isSubmitting, proctoringMode, graceSeconds, maxLeaves, strictImmediateKick]);

  const closeWarningModal = useCallback(() => {
    setWarningModalOpen(false);
  }, []);

  const clearWarnToast = useCallback(() => {
    setWarnToastMessage(null);
  }, []);

  const unbindSecurity = useCallback(() => {
    isSubmittingRef.current = true;
    activeRef.current = false;
    isLeavingRef.current = false;
    leaveStartTimeRef.current = null;
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    setIsFocusLost(false);
    setWarningModalOpen(false);
    setWarnToastMessage(null);
    if (wakeLockSentinelRef.current) {
      wakeLockSentinelRef.current.release().catch(() => {});
      wakeLockSentinelRef.current = null;
    }
    setIsWakeLockActive(false);
  }, []);

  return {
    isWakeLockActive,
    incidentCount,
    warningModalOpen,
    closeWarningModal,
    lastLeaveDuration,
    warnToastMessage,
    clearWarnToast,
    activeProctoringMode: proctoringMode,
    isFullscreen,
    isFocusLost,
    requestFullscreen,
    exitFullscreen,
    unbindSecurity,
    lastAwaySeconds,
  };
}

