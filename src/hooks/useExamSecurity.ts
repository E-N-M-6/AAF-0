import { useState, useEffect, useRef, useCallback } from "react";

export type ProctoringMode = "OFF" | "WARN" | "STRICT";

export interface UseExamSecurityOptions {
  active: boolean;
  proctoringMode?: ProctoringMode;
  graceSeconds?: number;
  maxLeaves?: number;
  strictImmediateKick?: boolean;
  onViolation?: (incidentCount: number, leaveDuration: number, reason?: string) => void;
  onAutoSubmit?: (incidentCount: number, leaveDuration: number, reason?: string) => void;
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
}

export function useExamSecurity({
  active,
  proctoringMode = "WARN",
  graceSeconds = 3,
  maxLeaves = 1,
  strictImmediateKick = false,
  onViolation,
  onAutoSubmit,
}: UseExamSecurityOptions): UseExamSecurityReturn {
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const [incidentCount, setIncidentCount] = useState<number>(0);
  const [warningModalOpen, setWarningModalOpen] = useState<boolean>(false);
  const [lastLeaveDuration, setLastLeaveDuration] = useState<number | null>(null);
  const [warnToastMessage, setWarnToastMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isFocusLost, setIsFocusLost] = useState<boolean>(false);

  const leaveStartTimeRef = useRef<number | null>(null);
  const isLeavingRef = useRef<boolean>(false);
  const incidentsRef = useRef<number>(0);
  const hasAutoSubmittedRef = useRef<boolean>(false);
  const hasEnteredFullscreenRef = useRef<boolean>(false);
  const wakeLockSentinelRef = useRef<any>(null);

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
    if (!active) {
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
  }, [active]);

  // 2. Fullscreen Change & Split Screen Block Monitoring
  useEffect(() => {
    if (!active || proctoringMode === "OFF") {
      return;
    }

    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = checkIsFullscreen();
      setIsFullscreen(isCurrentlyFullscreen);

      // If user had entered fullscreen and now exited (or split screen forced exit):
      if (hasEnteredFullscreenRef.current && !isCurrentlyFullscreen) {
        if (hasAutoSubmittedRef.current) return;

        const nextCount = incidentsRef.current + 1;
        incidentsRef.current = nextCount;
        setIncidentCount(nextCount);
        setLastLeaveDuration(0);

        const reason = "الخروج من وضع ملء الشاشة أو تفعيل الشاشة المنقسمة (Split Screen)";
        if (onViolationRef.current) {
          onViolationRef.current(nextCount, 0, reason);
        }

        // Check if strict kick or incident limit breached
        if (strictImmediateKick || (proctoringMode === "STRICT" && nextCount > maxLeaves)) {
          hasAutoSubmittedRef.current = true;
          setWarningModalOpen(false);
          if (onAutoSubmitRef.current) {
            onAutoSubmitRef.current(nextCount, 0, reason);
          }
        } else if (proctoringMode === "STRICT") {
          setWarningModalOpen(true);
        } else if (proctoringMode === "WARN") {
          setWarnToastMessage(`⚠️ تنبيه: تم الخروج من وضع ملء الشاشة! يرجى البقاء في وضع ملء الشاشة طوال فترة الاختبار.`);
        }
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [active, proctoringMode, strictImmediateKick, maxLeaves, checkIsFullscreen]);

  // 3. Focus Loss & Focus-Blur Tracking & Strict Immediate Kick
  useEffect(() => {
    if (!active || proctoringMode === "OFF") {
      leaveStartTimeRef.current = null;
      isLeavingRef.current = false;
      setIsFocusLost(false);
      return;
    }

    // Evaluate focus status for canvas/content blurring
    const updateFocusLossState = () => {
      if (typeof document === "undefined") return;
      const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
      const isHidden = document.visibilityState === "hidden";
      setIsFocusLost(isHidden || !hasFocus);
    };

    const handleImmediateKick = (reason: string) => {
      if (hasAutoSubmittedRef.current) return;
      hasAutoSubmittedRef.current = true;
      const nextCount = incidentsRef.current + 1;
      incidentsRef.current = nextCount;
      setIncidentCount(nextCount);
      setLastLeaveDuration(0);
      setWarningModalOpen(false);

      if (onViolationRef.current) {
        onViolationRef.current(nextCount, 0, reason);
      }
      if (onAutoSubmitRef.current) {
        onAutoSubmitRef.current(nextCount, 0, reason);
      }
    };

    const handleLeave = () => {
      updateFocusLossState();

      // STRICT IMMEDIATE KICK: Instant submission on the 1st trigger of visibilitychange or blur
      // with zero grace window or second chances
      if (strictImmediateKick || (proctoringMode === "STRICT" && maxLeaves === 0)) {
        handleImmediateKick("مغادرة فورية لشاشة الاختبار (إنهاء فوري مفعل)");
        return;
      }

      if (!isLeavingRef.current) {
        isLeavingRef.current = true;
        leaveStartTimeRef.current = Date.now();
      }
    };

    const handleReturn = () => {
      updateFocusLossState();

      if (!isLeavingRef.current || leaveStartTimeRef.current === null) {
        isLeavingRef.current = false;
        leaveStartTimeRef.current = null;
        return;
      }

      const leaveDurationMs = Date.now() - leaveStartTimeRef.current;
      const leaveDurationSeconds = Math.round(leaveDurationMs / 1000);
      isLeavingRef.current = false;
      leaveStartTimeRef.current = null;

      // Ignore focus losses lasting less than graceSeconds threshold (when strictImmediateKick is false)
      if (leaveDurationSeconds < graceSeconds) {
        return;
      }

      if (hasAutoSubmittedRef.current) {
        return;
      }

      const nextCount = incidentsRef.current + 1;
      incidentsRef.current = nextCount;
      setIncidentCount(nextCount);
      setLastLeaveDuration(leaveDurationSeconds);

      if (onViolationRef.current) {
        onViolationRef.current(
          nextCount,
          leaveDurationSeconds,
          `مغادرة شاشة الاختبار لمدة ${leaveDurationSeconds} ثوانٍ`
        );
      }

      if (proctoringMode === "WARN") {
        setWarnToastMessage(`⚠️ تنبيه: تم رصد مغادرة شاشة الاختبار لمدة ${leaveDurationSeconds} ثوانٍ. يرجى التركيز في صفحة الاختبار.`);
      } else if (proctoringMode === "STRICT") {
        if (nextCount > maxLeaves) {
          hasAutoSubmittedRef.current = true;
          setWarningModalOpen(false);
          if (onAutoSubmitRef.current) {
            onAutoSubmitRef.current(nextCount, leaveDurationSeconds);
          }
        } else {
          setWarningModalOpen(true);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleLeave();
      } else if (document.visibilityState === "visible") {
        handleReturn();
      }
    };

    const handleWindowBlur = () => {
      handleLeave();
    };

    const handleWindowFocus = () => {
      handleReturn();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [active, proctoringMode, graceSeconds, maxLeaves, strictImmediateKick]);

  const closeWarningModal = useCallback(() => {
    setWarningModalOpen(false);
  }, []);

  const clearWarnToast = useCallback(() => {
    setWarnToastMessage(null);
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
  };
}
