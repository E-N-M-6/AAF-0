import { useState, useEffect, useRef, useCallback } from "react";

export type ProctoringMode = "OFF" | "WARN" | "STRICT";

export interface SecurityViolationDetails {
  type: "fullscreen_exit" | "visibility_hidden" | "window_blur" | "copy_paste_attempt" | "strict_immediate_kick" | string;
  timestamp: string;
  details?: string;
}

export interface UseExamSecurityOptions {
  active: boolean;
  proctoringMode?: ProctoringMode;
  graceSeconds?: number;
  maxLeaves?: number;
  strictImmediateKick?: boolean;
  isSubmitting?: boolean;
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
}

export function useExamSecurity({
  active,
  proctoringMode = "WARN",
  graceSeconds = 3,
  maxLeaves = 1,
  strictImmediateKick = false,
  isSubmitting = false,
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
  const leaveReasonTypeRef = useRef<string>("visibility_hidden");
  const isLeavingRef = useRef<boolean>(false);
  const incidentsRef = useRef<number>(0);
  const hasAutoSubmittedRef = useRef<boolean>(false);
  const hasEnteredFullscreenRef = useRef<boolean>(false);
  const wakeLockSentinelRef = useRef<any>(null);

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
        };

        if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
          onViolationRef.current(nextCount, 0, reason, violationDetails);
        }

        // Check if strict kick or incident limit breached
        if (strictImmediateKick || (proctoringMode === "STRICT" && nextCount > maxLeaves)) {
          hasAutoSubmittedRef.current = true;
          setWarningModalOpen(false);
          if (onAutoSubmitRef.current && activeRef.current && !isSubmittingRef.current) {
            onAutoSubmitRef.current(nextCount, 0, reason, violationDetails);
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
  }, [active, isSubmitting, proctoringMode, strictImmediateKick, maxLeaves, checkIsFullscreen]);

  // 3. Prevent text selection, copy/cut/paste, and contextmenu when proctoring is enabled or STRICT mode active
  useEffect(() => {
    if (!active || isSubmitting || proctoringMode === "OFF") return;

    const preventDefaultAndLog = (e: Event) => {
      if (!activeRef.current || isSubmittingRef.current) return;
      
      // In STRICT mode, prevent copying/pasting and right click context menu
      if (proctoringMode === "STRICT") {
        e.preventDefault();
        const typeStr = e.type;
        const reason = `محاولة ${typeStr === "contextmenu" ? "فتح القائمة الجانبية" : typeStr === "copy" ? "النسخ" : typeStr === "paste" ? "اللصق" : "تحديد النص"} أثناء الامتحان`;
        
        if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
          onViolationRef.current(incidentsRef.current, 0, reason, {
            type: "copy_paste_attempt",
            timestamp: new Date().toISOString(),
            details: reason,
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

  // 4. Focus Loss & Focus-Blur Tracking & Strict Immediate Kick
  useEffect(() => {
    if (!active || isSubmitting || proctoringMode === "OFF") {
      leaveStartTimeRef.current = null;
      isLeavingRef.current = false;
      setIsFocusLost(false);
      setWarningModalOpen(false);
      setWarnToastMessage(null);
      return;
    }

    // Evaluate focus status for canvas/content blurring
    const updateFocusLossState = () => {
      if (typeof document === "undefined" || !activeRef.current || isSubmittingRef.current) return;
      const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
      const isHidden = document.visibilityState === "hidden";
      setIsFocusLost(isHidden || !hasFocus);
    };

    const handleImmediateKick = (reason: string, type: string) => {
      if (!activeRef.current || isSubmittingRef.current || hasAutoSubmittedRef.current) return;
      hasAutoSubmittedRef.current = true;
      const nextCount = incidentsRef.current + 1;
      incidentsRef.current = nextCount;
      setIncidentCount(nextCount);
      setLastLeaveDuration(0);
      setWarningModalOpen(false);

      const violationDetails: SecurityViolationDetails = {
        type,
        timestamp: new Date().toISOString(),
        details: reason,
      };

      if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
        onViolationRef.current(nextCount, 0, reason, violationDetails);
      }
      if (onAutoSubmitRef.current && activeRef.current && !isSubmittingRef.current) {
        onAutoSubmitRef.current(nextCount, 0, reason, violationDetails);
      }
    };

    const handleLeave = (type: string) => {
      if (!activeRef.current || isSubmittingRef.current) return;
      updateFocusLossState();

      // STRICT IMMEDIATE KICK: Instant submission on the 1st trigger of visibilitychange or blur
      if (strictImmediateKick || (proctoringMode === "STRICT" && maxLeaves === 0)) {
        handleImmediateKick("مغادرة فورية لشاشة الاختبار (إنهاء فوري مفعل)", type);
        return;
      }

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
        return;
      }

      const leaveDurationMs = Date.now() - leaveStartTimeRef.current;
      const leaveDurationSeconds = Math.round(leaveDurationMs / 1000);
      const leaveType = leaveReasonTypeRef.current || "visibility_hidden";
      isLeavingRef.current = false;
      leaveStartTimeRef.current = null;

      // Ignore focus losses lasting less than graceSeconds threshold
      if (leaveDurationSeconds < graceSeconds) {
        return;
      }

      if (hasAutoSubmittedRef.current || isSubmittingRef.current) {
        return;
      }

      const nextCount = incidentsRef.current + 1;
      incidentsRef.current = nextCount;
      setIncidentCount(nextCount);
      setLastLeaveDuration(leaveDurationSeconds);

      const reason = `مغادرة شاشة الاختبار لمدة ${leaveDurationSeconds} ثوانٍ`;
      const violationDetails: SecurityViolationDetails = {
        type: leaveType,
        timestamp: new Date().toISOString(),
        details: reason,
      };

      if (onViolationRef.current && activeRef.current && !isSubmittingRef.current) {
        onViolationRef.current(nextCount, leaveDurationSeconds, reason, violationDetails);
      }

      if (proctoringMode === "WARN") {
        setWarnToastMessage(`⚠️ تنبيه: تم رصد مغادرة شاشة الاختبار لمدة ${leaveDurationSeconds} ثوانٍ. يرجى التركيز في صفحة الاختبار.`);
      } else if (proctoringMode === "STRICT") {
        if (nextCount > maxLeaves) {
          hasAutoSubmittedRef.current = true;
          setWarningModalOpen(false);
          if (onAutoSubmitRef.current && activeRef.current && !isSubmittingRef.current) {
            onAutoSubmitRef.current(nextCount, leaveDurationSeconds, reason, violationDetails);
          }
        } else {
          setWarningModalOpen(true);
        }
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

    const handleWindowBlur = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
      handleLeave("window_blur");
    };

    const handleWindowFocus = () => {
      if (!activeRef.current || isSubmittingRef.current) return;
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
  };
}

