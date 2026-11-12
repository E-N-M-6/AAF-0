import React, { useState, useEffect, lazy, Suspense } from "react";
import { User, DatabaseState, AppNotification, BeforeInstallPromptEvent } from "./types";
import { ApiService, getSession, clearSession, processOfflineSubmissionsQueue } from "./services/api";
import { triggerDazzlingCelebration } from "./lib/confetti";

const Leaderboard = lazy(() => import("./components/Leaderboard"));
const AdminBoard = lazy(() => import("./components/AdminBoard"));
const ParticipantBoard = lazy(() => import("./components/ParticipantBoard"));
const UserQRModal = lazy(() => import("./components/UserQRModal"));
const AvatarUploadModal = lazy(() => import("./components/AvatarUploadModal"));

const ComponentLoader = () => (
  <div className="p-8 text-center flex flex-col items-center justify-center space-y-3 bg-white/50 dark:bg-slate-900/50 rounded-3xl border border-slate-200 dark:border-slate-800 my-6">
    <div className="w-8 h-8 border-3 border-[#c51f26] border-t-transparent rounded-full animate-spin" />
    <p className="text-xs font-bold text-natural-muted">جاري تحميل المحتوى...</p>
  </div>
);
import { 
  Trophy, 
  Sparkles, 
  Lock, 
  LogOut, 
  LayoutDashboard, 
  HelpCircle, 
  CheckCircle2, 
  AlertCircle,
  Users,
  Key,
  Megaphone,
  Bell,
  Sun,
  Moon,
  RotateCw,
  QrCode,
  Wifi,
  WifiOff
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "motion/react";

// Synthesizer to play a sweet notification sound
const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    const playNote = (frequency: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, startTime);
      
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    
    const now = ctx.currentTime;
    playNote(880, now, 0.4);       // A5
    playNote(1318.51, now + 0.12, 0.5); // E6
  } catch (e) {
    console.error("Failed to play notification sound:", e);
  }
};

export default function App() {
  const APP_VERSION = "v1.1.0";
  const playedNotifIdsRef = React.useRef<Set<string>>(new Set());

  const [state, setState] = useState<DatabaseState | null>(() => {
    if (typeof window !== "undefined") {
      if (localStorage.getItem("byb_app_version") !== APP_VERSION) {
        return null;
      }
      const cached = localStorage.getItem("cached_state");
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  });

  // Keep state cached in localStorage whenever it changes with a 1500ms debounce to prevent UI stuttering
  useEffect(() => {
    if (state) {
      const timer = setTimeout(() => {
        try {
          localStorage.setItem("cached_state", JSON.stringify(state));
        } catch (e) {
          console.error("Failed to cache state to localStorage:", e);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const handleLogout = async () => {
    try {
      await ApiService.logout();
    } catch {}
    setCurrentUser(null);
    setSuccess("تم تسجيل الخروج بنجاح. في رعاية الله وحفظه 👋");
    setTimeout(() => setSuccess(null), 5000);
  };

  // Listen for 401 unauthorized / session expiry event
  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser(null);
      setError("انتهت الجلسة أو الرمز غير صالح، يرجى إعادة تسجيل الدخول.");
    };
    window.addEventListener("marathon_unauthorized", handleUnauthorized);
    return () => window.removeEventListener("marathon_unauthorized", handleUnauthorized);
  }, []);

  // Auto-login & sync session once state is loaded
  useEffect(() => {
    if (state) {
      const session = getSession();
      if (session?.userId) {
        const foundUser = state.users.find((u) => u.id === session.userId);
        if (foundUser) {
          setCurrentUser(foundUser);
        } else {
          handleLogout();
        }
      }
    }
  }, [state]);

  // Keep current user state synchronized with fresh state from server
  useEffect(() => {
    if (state && currentUser) {
      const freshUser = state.users.find(u => u.id === currentUser.id);
      if (freshUser) {
        if (JSON.stringify(freshUser) !== JSON.stringify(currentUser)) {
          setCurrentUser(freshUser);
        }
      } else {
        handleLogout();
      }
    }
  }, [state, currentUser]);

  // First-entry Avatar Modal trigger logic
  const [showFirstEntryAvatarModal, setShowFirstEntryAvatarModal] = useState(false);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && !currentUser.hasAvatar) {
      const isRequired = Boolean((import.meta as any).env?.VITE_AVATAR_REQUIRED === "true" || process.env.AVATAR_REQUIRED === "true");
      if (isRequired) {
        setShowFirstEntryAvatarModal(true);
        return;
      }
      const snoozeCount = currentUser.avatarSnoozeCount || 0;
      const snoozedAt = currentUser.avatarSnoozedAt || 0;
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

      if (snoozeCount < 3) {
        if (!snoozedAt || Date.now() - snoozedAt > THREE_DAYS_MS) {
          setShowFirstEntryAvatarModal(true);
        } else {
          setShowFirstEntryAvatarModal(false);
        }
      } else {
        setShowFirstEntryAvatarModal(false);
      }
    } else {
      setShowFirstEntryAvatarModal(false);
    }
  }, [currentUser]);

  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dark_mode") === "true";
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (isDarkMode) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("dark_mode", "true");
        localStorage.setItem("theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("dark_mode", "false");
        localStorage.setItem("theme", "light");
      }
    }
  }, [isDarkMode]);
  
  // Navigation tabs (persisted in localStorage across page reloads)
  const [activeMenu, setActiveMenu] = useState<"leaderboard" | "dashboard">(() => {
    if (typeof window !== "undefined") {
      const savedTab = localStorage.getItem("lastActiveTab");
      if (savedTab === "leaderboard" || savedTab === "dashboard") {
        return savedTab;
      }
    }
    return "leaderboard";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lastActiveTab", activeMenu);
    }
  }, [activeMenu]);
  
  // User QR Modal state
  const [isUserQRModalOpen, setIsUserQRModalOpen] = useState(false);
  
  // Login form state
  const [loginUsername, setLoginUsername] = useState<string>("");
  const [pinCode, setPinCode] = useState<string>("");

  // Network Online/Offline state tracking for seamless Offline QR functionality
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return true;
  });

  // Save offline_user_qr persistently whenever user changes
  useEffect(() => {
    if (currentUser) {
      try {
        const offlineData = {
          id: currentUser.id,
          name: currentUser.name,
          username: currentUser.username,
          role: currentUser.role
        };
        localStorage.setItem("offline_user_qr", JSON.stringify(offlineData));
      } catch (e) {
        console.error("Failed to save offline_user_qr to localStorage:", e);
      }
    }
  }, [currentUser]);

  // Offline fallback user for instant QR code viewing even if logged out or offline
  const savedUserForOffline = React.useMemo(() => {
    if (typeof window !== "undefined") {
      const offlineQR = localStorage.getItem("offline_user_qr");
      if (offlineQR) {
        try {
          const parsed = JSON.parse(offlineQR);
          if (parsed && parsed.id && parsed.name) return parsed;
        } catch (e) {}
      }
      const saved = localStorage.getItem("saved_user");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.id && parsed.name) return parsed;
        } catch (e) {}
      }
    }
    return null;
  }, [currentUser]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      triggerSuccess("تم استعادة الاتصال بالإنترنت ومزامنة نقاطك وحضورك الجديد بنجاح! 🟢");
      processOfflineSubmissionsQueue(() => {
        fetchState(true);
      });
      fetchState(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
      triggerError("أنت الآن تعمل بدون إنترنت (Offline) 🔌 - كود الـ QR الخاص بك متاح ومتوفر لتسجيل الحضور، وستُضاف نقاطك فور الاتصال.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Auto-flush pending offline submissions queue on mount
    processOfflineSubmissionsQueue(() => {
      fetchState(true);
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Notifications
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      if (localStorage.getItem("byb_app_version") !== APP_VERSION) {
        return true;
      }
      return !localStorage.getItem("cached_state");
    }
    return true;
  });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);

  // PWA & Push Notification Reminders states
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(false);
  const [showPushBanner, setShowPushBanner] = useState<boolean>(false);
  const [isPushLoading, setIsPushLoading] = useState<boolean>(false);

  // Helper function to check PWA install status and snooze
  const checkInstallReminder = () => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
    if (isStandalone) {
      setShowInstallBanner(false);
      return false;
    }
    const snoozedUntil = localStorage.getItem("pwa_install_snoozed_until");
    if (!snoozedUntil || Date.now() > Number(snoozedUntil)) {
      setShowInstallBanner(true);
      return true;
    } else {
      setShowInstallBanner(false);
      return false;
    }
  };

  // Helper function to check Push Notification status and snooze
  const checkPushReminder = async () => {
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch (e) {
      inIframe = true;
    }
    if (inIframe) {
      setShowPushBanner(false);
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setShowPushBanner(false);
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const subscribed = !!sub && Notification.permission === "granted";

      if (subscribed) {
        setShowPushBanner(false);
        return;
      }

      const snoozedUntil = localStorage.getItem("push_snoozed_until");
      if (!snoozedUntil || Date.now() > Number(snoozedUntil)) {
        setShowPushBanner(true);
      } else {
        setShowPushBanner(false);
      }
    } catch (e) {
      console.warn("Error checking push state in App:", e);
    }
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      checkInstallReminder();
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    const isShowingInstall = checkInstallReminder();
    if (!isShowingInstall) {
      checkPushReminder();
    }

    const interval = setInterval(() => {
      const installShowing = checkInstallReminder();
      if (!installShowing) {
        checkPushReminder();
      } else {
        setShowPushBanner(false);
      }
    }, 30000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      clearInterval(interval);
    };
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === "accepted") {
        setShowInstallBanner(false);
        localStorage.setItem("pwa_installed", "true");
        triggerSuccess("شكراً لتثبيت التطبيق على هاتفك! 🎉");
        setTimeout(checkPushReminder, 1000);
      }
    } else {
      triggerSuccess("لمتابعة التثبيت:\n• للآيفون (Safari): اضغط مشاركة ⎘ ثم 'إضافة للشاشة الرئيسية'\n• للأندرويد: اضغط القائمة ⠇ ثم 'تثبيت التطبيق'");
    }
  };

  const handleSnoozeInstall = () => {
    const snoozeMs = 2 * 60 * 60 * 1000; // 2 hours snooze
    localStorage.setItem("pwa_install_snoozed_until", (Date.now() + snoozeMs).toString());
    setShowInstallBanner(false);
    triggerSuccess("سوف نذكرك بتثبيت التطبيق لاحقاً ⏳");
    setTimeout(checkPushReminder, 500);
  };

  const handleEnablePush = async () => {
    setIsPushLoading(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        triggerSuccess("يرجى السماح بالتنبيهات من إعدادات المتصفح تابعة للموقع.");
        return;
      }
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js");
      }
      await navigator.serviceWorker.ready;

      const { publicKey } = await ApiService.getVapidPublicKey();
      if (!publicKey) {
        throw new Error("مفتاح VAPID غير متوفر على السيرفر");
      }

      function urlBase64ToUint8Array(base64String: string) {
        const padding = "=".repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      }

      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        try {
          await existingSub.unsubscribe();
        } catch (e) {}
      }

      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      let res;
      try {
        res = await ApiService.subscribeToPush(subscription);
      } catch (subErr: any) {
        if (subErr.status === 401 || (subErr.message && subErr.message.includes("تسجيل الدخول"))) {
          await ApiService.getState(true);
          res = await ApiService.subscribeToPush(subscription);
        } else {
          throw subErr;
        }
      }

      if (res && res.success) {
        setShowPushBanner(false);
        triggerSuccess("تم تفعيل وتجديد تنبيهات الهاتف المباشرة بنجاح! 🎉");
      } else {
        throw new Error(res ? res.message : "فشل التسجيل على الخادم");
      }
    } catch (err: any) {
      console.error("Failed to enable push from banner:", err);
      triggerSuccess("حدث خطأ أثناء تفعيل التنبيهات: " + (err.message || err));
    } finally {
      setIsPushLoading(false);
    }
  };

  const handleSnoozePush = () => {
    const snoozeMs = 2 * 60 * 60 * 1000; // 2 hours snooze
    localStorage.setItem("push_snoozed_until", (Date.now() + snoozeMs).toString());
    setShowPushBanner(false);
    triggerSuccess("سوف نذكرك بتفعيل التنبيهات لاحقاً ⏳");
  };

  // Fetch initial database state from server
  const fetchState = async (forceRefresh = false, silent = false) => {
    if (!state) {
      setIsLoading(true);
    }
    if (forceRefresh && !silent) {
      setIsRefreshing(true);
    }
    try {
      const data = await ApiService.getState(forceRefresh);
      
      // Ensure the fetched data is valid and has users to prevent caching empty/corrupt states during Quota Exceeded errors
      if (data && Array.isArray(data.users) && data.users.length > 0) {
        setState(data);
        if (forceRefresh && !silent) {
          triggerSuccess("تم تحديث وجلب البيانات الحية من قاعدة البيانات السحابية (Firestore) بنجاح! 🔄");
          triggerDazzlingCelebration();
        }
      } else {
        console.warn("Received empty or invalid state from server. Preserving current client-side cached state.");
        if (forceRefresh && !silent) {
          throw new Error("فشل المزامنة: الاستجابة المستلمة من السيرفر فارغة أو غير مكتملة.");
        }
      }
    } catch (err: any) {
      if (forceRefresh && silent) {
        try {
          const fallbackData = await ApiService.getState(false);
          if (fallbackData && Array.isArray(fallbackData.users) && fallbackData.users.length > 0) {
            setState(fallbackData);
            return;
          }
        } catch {}
      }
      if (forceRefresh && !silent) {
        triggerError(err.message || "فشل الاتصال بقاعدة البيانات السحابية (Firestore). يرجى التحقق من حالة الخدمة أو الحصة اليومية.");
      } else {
        setError(err.message || "حدث خطأ غير متوقع");
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let hasCacheMismatch = false;
    if (typeof window !== "undefined") {
      const storedVersion = localStorage.getItem("byb_app_version");
      if (storedVersion !== APP_VERSION) {
        hasCacheMismatch = true;
        console.log(`[App Version Check] New version detected: ${APP_VERSION} (was: ${storedVersion || "none"}). Clearing stale cache...`);

        // Preserve critical auth tokens, offline queue, dark mode, and active exam drafts
        const shouldPreserveKey = (key: string): boolean =>
          key.startsWith("firebase:authUser:") ||
          key === "pending_offline_submissions" ||
          key === "marathon_session" ||
          key === "dark_mode" ||
          key === "theme" ||
          key === "offline_user_qr" ||
          key === "byb_app_version" ||
          key.startsWith("active_quiz_session_") ||
          key.startsWith("quiz_answers_backup_");

        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && !shouldPreserveKey(key)) {
            localStorage.removeItem(key);
          }
        }

        localStorage.setItem("byb_app_version", APP_VERSION);
        setState(null);

        // Invalidate old SW caches
        if ("caches" in window) {
          caches.keys().then((cacheNames) => {
            cacheNames.forEach((name) => {
              if (name !== "APP_CACHE_V3") {
                caches.delete(name);
              }
            });
          }).catch(() => {});
        }
      }
    }

    // Non-blocking background fetch: force fresh Firestore pull on version/cache mismatch
    const timer = setTimeout(() => {
      fetchState(hasCacheMismatch, hasCacheMismatch);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Helper to request notification permissions
  const requestNotificationPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        try {
          const res = await Notification.requestPermission();
          if (res === "granted") {
            triggerSuccess("تم تفعيل إشعارات المتصفح بنجاح! 🔔");
            new Notification("ماراثون Believe your belief", {
              body: "أهلاً بك! ستصلك تنبيهات الكويزات والنتائج مباشرة على جهازك.",
              icon: "/logo.png"
            });
          }
        } catch (err) {
          console.error("Error requesting notification permission:", err);
        }
      }
    }
  };

  // Trigger permission request on login
  useEffect(() => {
    if (currentUser) {
      requestNotificationPermission();
    }
  }, [currentUser]);

  // Trigger check on state changes
  useEffect(() => {
    if (state?.notifications && state.notifications.length > 0) {
      // Defensive client-side check: filter notifications relevant to this user
      const myNotifs = state.notifications.filter(notif => 
        notif && (!notif.userId || (currentUser && notif.userId === currentUser.id))
      );

      if (myNotifs.length > 0) {
        const latest = myNotifs[myNotifs.length - 1];
        const storedId = localStorage.getItem("last_seen_notif_id");
        if (storedId !== latest.id) {
          setActiveNotification(latest);

          // Play the chime notification sound (once per notification)!
          if (!playedNotifIdsRef.current.has(latest.id)) {
            playedNotifIdsRef.current.add(latest.id);
            playNotificationSound();
          }

          // Push actual native system/browser notification if permitted (only if deliveryType is not "in_app")
          if (latest.deliveryType !== "in_app" && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("تنبيه جديد من ماراثون Believe your belief! 🔔", {
                body: latest.message,
                icon: "/logo.png"
              });
            } catch (e) {
              console.error("System notification error:", e);
            }
          }
        }
      }
    }
  }, [state?.notifications, currentUser?.id]);

  // Polling state updates silently every 30 seconds (hardened & optimized to save over 60% of daily Firebase read quota)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await ApiService.getState();
        // Defensive check: Only commit the fetched state if it contains actual data to prevent corrupting local caches during limits or drops
        if (data && Array.isArray(data.users) && data.users.length > 0) {
          setState((prev) => {
            if (prev) {
              // Rapid JSON string comparison to determine if any real changes occurred. 
              // Returning the previous state reference prevents React from triggering any child re-renders.
              const prevStr = JSON.stringify(prev);
              const nextStr = JSON.stringify(data);
              if (prevStr === nextStr) {
                return prev;
              }
            }
            return data;
          });
        }
      } catch (err) {
        // Only log to console if it is not a common transient network failure or content-type mismatch during container/server restarts
        const isTransient = err instanceof Error && 
          (err.message.includes("Failed to fetch") || 
           err.message.includes("fetch") || 
           err.message.includes("Expected JSON response") || 
           err.message.includes("Unexpected token"));
        if (!isTransient) {
          console.error("Silent sync error:", err);
        } else {
          console.log("Background sync skipped (server temporarily offline, restarting, or returning html)...");
        }
      }
    }, 30000); // 30 seconds polling optimized for performance & quota!

    return () => clearInterval(interval);
  }, []);

  // Helper to show success/error alerts with auto-dismissal
  const triggerSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  };

  const triggerError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  };

  const dismissNotification = () => {
    if (activeNotification) {
      localStorage.setItem("last_seen_notif_id", activeNotification.id);
      setActiveNotification(null);
    }
  };

  // Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;

    if (!loginUsername || !loginUsername.trim()) {
      triggerError("يرجى إدخال اسم المستخدم أولاً");
      return;
    }

    if (!pinCode || !pinCode.trim()) {
      triggerError("يرجى إدخال كلمة المرور");
      return;
    }

    try {
      const res = await ApiService.login(loginUsername, pinCode);
      const user = res.user;

      localStorage.setItem("offline_user_qr", JSON.stringify({ id: user.id, name: user.name, username: user.username, role: user.role }));
      setCurrentUser(user);
      setPinCode("");
      setLoginUsername("");
      
      // Set default menu view
      if (user.role === "admin") {
        setActiveMenu("dashboard"); // admin views dashboards by default
      } else {
        setActiveMenu("dashboard"); // participants view tasks by default
      }
      triggerSuccess(`مرحباً بك يا ${user.name} في ماراثون الصيف! 🎉`);
    } catch (err: any) {
      triggerError(err.message || "فشل تسجيل الدخول. يرجى التأكد من البيانات والمحاولة مرة أخرى.");
    }
  };

  // Logout Handler (re-defined dynamically below state declarations)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-natural-bg flex flex-col items-center justify-center gap-4 p-4 text-center">
        <img
          src="/logo.png"
          alt="A.A.F Logo"
          width={154}
          height={159}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          className="w-24 h-24 rounded-full object-cover border-4 border-natural-accent shadow-md animate-pulse"
        />
        <div>
          <h2 className="text-base font-extrabold text-natural-green">أسرة الأنبا إبرام الجامعية</h2>
          <p className="text-xs font-bold text-natural-text/70 animate-pulse mt-1">جاري تحميل ماراثون Believe your belief (A.A.F)...</p>
        </div>
      </div>
    );
  }

  // Handle offline fallback when state is not reachable from server or cache
  if (!state) {
    if (savedUserForOffline) {
      return (
        <div className="min-h-screen animated-gradient-bg bg-natural-bg text-natural-text flex flex-col items-center justify-center p-4 text-right">
          <div className="bg-white dark:bg-natural-card border-2 border-rose-500 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl relative overflow-hidden">
            {/* Header / Offline Badge */}
            <div className="flex items-center justify-between border-b border-natural-border dark:border-natural-border-dark pb-3">
              <span className="bg-rose-600 text-white font-black text-xs px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                <WifiOff className="w-3.5 h-3.5 animate-pulse" />
                وضع عدم الاتصال 🔴
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-natural-green dark:text-natural-accent">أسرة الأنبا إبرام</span>
                <img src="/logo.png" alt="Logo" className="w-9 h-9 rounded-xl object-cover border border-natural-border" />
              </div>
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-sm font-black text-natural-green dark:text-natural-accent">كود الحضور (QR Code) - بدون إنترنت</h3>
              <h4 className="text-lg font-black text-natural-text dark:text-white">{savedUserForOffline.name}</h4>
              <p className="text-xs font-semibold text-natural-muted dir-ltr">@{savedUserForOffline.username || savedUserForOffline.name}</p>
            </div>

            {/* Inline QR Display */}
            <div className="bg-gradient-to-b from-slate-50 to-white dark:from-white dark:to-slate-50 p-5 rounded-2xl border-2 border-dashed border-natural-green/40 dark:border-natural-accent/40 flex flex-col items-center justify-center space-y-2.5 shadow-inner">
              <div className="p-3 bg-white rounded-xl shadow-md border border-slate-100">
                <QRCodeSVG
                  value={`MARATHON_USER:${savedUserForOffline.id}`}
                  size={180}
                  level="H"
                  includeMargin={true}
                  fgColor="#2C3A2C"
                  bgColor="#FFFFFF"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-natural-green dark:text-slate-800">
                <Sparkles className="w-3.5 h-3.5 text-natural-accent animate-pulse" />
                <span>امسح هذا الكود لتسجيل الحضور فوراً ⚡</span>
              </div>
            </div>

            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-xs font-extrabold text-rose-950 dark:text-rose-100 leading-relaxed text-center">
              كود الـ QR الخاص بك يعمل 100% بدون إنترنت! يمكنك إظهاره للخدمة في القداس أو الاجتماع وسيتم تسجيلك ومزامنة نقاطك فور عودة الاتصال بالشبكة.
            </div>

            <button
              onClick={() => fetchState(true)}
              disabled={isRefreshing}
              className="w-full bg-natural-green hover:bg-natural-olive text-white font-bold py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md hover:shadow-lg"
            >
              <RotateCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
              إعادة محاولة الاتصال بالسيرفر 🔄
            </button>
          </div>
        </div>
      );
    } else {
      return (
        <div className="min-h-screen bg-natural-bg text-natural-text flex flex-col items-center justify-center p-4 text-center">
          <div className="bg-white dark:bg-natural-card border border-natural-border rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-xl">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto">
              <WifiOff className="w-8 h-8" />
            </div>
            <h3 className="text-base font-black text-natural-green dark:text-white">أنت غير متصل بالإنترنت</h3>
            <p className="text-xs font-bold text-natural-muted leading-relaxed">
              يرجى الاتصال بالإنترنت مرة واحدة فقط لتفعيل كود الحضور.
            </p>
            <button
              onClick={() => fetchState(true)}
              className="w-full bg-natural-green hover:bg-natural-olive text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
            >
              <RotateCw className="w-4 h-4" />
              إعادة المحاولة
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen animated-gradient-bg bg-natural-bg text-natural-text flex flex-col transition-colors duration-500">
      {/* Header Banner */}
      <header className="bg-gradient-to-r from-[#881337] via-[#c51f26] to-[#1b4393] text-white py-3 px-4 md:py-4 md:px-6 sticky top-0 z-40 shadow-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4">
          
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5 md:gap-3 cursor-pointer group" onClick={() => setActiveMenu("leaderboard")}>
            <img
              src="/logo.png"
              alt="A.A.F Logo"
              width={154}
              height={159}
              fetchPriority="high"
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-10 h-10 md:w-12 md:h-12 rounded-xl object-cover border-2 border-white/40 shadow-md group-hover:scale-105 transition-all duration-300 shrink-0"
            />
            <div>
              <h1 className="text-sm md:text-lg font-extrabold text-white flex items-center gap-1.5 leading-tight flex-wrap">
                Believe your belief
                <span className="bg-amber-400 text-slate-950 text-[9px] md:text-[10px] font-black px-1.5 py-0.5 rounded-md mr-1 shadow-xs">
                  A.A.F
                </span>
                <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4 text-amber-300 fill-amber-300 animate-pulse" />
              </h1>
              <p className="text-[9px] md:text-[10px] text-white/90 font-bold leading-relaxed mt-0.5 max-w-xs md:max-w-none">أسرة الأنبا إبرام الجامعية</p>
            </div>
          </div>

          {/* Quick Stats & Auth details */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-end">
            {/* Cloud Force Sync Button */}
            <button
              onClick={() => fetchState(true)}
              disabled={isRefreshing}
              className="bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white p-2 rounded-xl transition-all border border-white/10 shrink-0 flex items-center justify-center cursor-pointer"
              title="مزامنة فورية وتحديث البيانات من السحاب (Force Refresh)"
            >
              <RotateCw className={`w-4 h-4 text-white ${isRefreshing ? "animate-spin text-amber-300" : ""}`} />
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl transition-all border border-white/10 shrink-0 flex items-center justify-center cursor-pointer"
              title={isDarkMode ? "الوضع المضيء" : "الوضع المظلم"}
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-white" />}
            </button>

            {currentUser ? (
              <div className="flex items-center gap-1.5 bg-white/15 p-1 rounded-2xl border border-white/25 w-full md:w-auto justify-between md:justify-start">
                {currentUser.role !== "admin" && (
                  <button
                    onClick={() => setIsUserQRModalOpen(true)}
                    className="bg-amber-400 hover:bg-amber-500 text-slate-950 px-2.5 py-1 rounded-xl text-[10px] md:text-xs font-black transition-all flex items-center gap-1 shadow-xs cursor-pointer shrink-0"
                    title="عرض كود الـ QR الخاص بك للحضور"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>كود الحضور QR</span>
                  </button>
                )}

                <span className="text-[11px] md:text-xs font-bold text-white px-1.5 py-1 leading-relaxed">
                  مرحباً: <span className="text-[#fdfcf8] underline decoration-amber-400 underline-offset-4">{currentUser.name}</span>{" "}
                  <span className="text-[9px] md:text-[10px] text-slate-950 font-black bg-amber-400 px-1.5 py-0.5 rounded-md mr-1 shadow-sm whitespace-nowrap">
                    {currentUser.role === "admin" ? "خادم (آدمن)" : "مشارك"}
                  </span>
                </span>
                
                <button
                  onClick={handleLogout}
                  className="bg-white/10 hover:bg-rose-600 hover:text-white text-white p-1.5 rounded-xl transition-all border border-white/10 shrink-0 cursor-pointer"
                  title="تسجيل الخروج"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-[10px] md:text-xs text-white/90 font-bold bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 text-center w-full md:w-auto">الموقع تفاعلي، يرجى تسجيل الدخول لرؤية مهامك وتسليمها</p>
            )}
          </div>

        </div>
      </header>

      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="bg-amber-600 dark:bg-amber-700 text-white px-4 py-2 text-xs font-extrabold text-center flex items-center justify-center gap-2 shadow-sm border-b border-amber-700">
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
          <span>
            أنت الآن تعمل في وضع عدم الاتصال بالإنترنت (Offline Mode). كود الـ QR الخاص بك متاح ومتوفر لتسجيل الحضور، وستُضاف نقاطك لحسابك فور الاتصال بالشبكة! ⚡
          </span>
        </div>
      )}

      {/* Main Content Arena */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        
        {/* Floating Success & Error Toast Alerts */}
        <div className="fixed bottom-4 left-4 z-50 max-w-sm w-full space-y-3 p-4 pointer-events-none text-right">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="pointer-events-auto bg-rose-600 border border-rose-700 text-white p-4 rounded-2xl flex items-start gap-3 text-xs font-bold shadow-2xl"
              >
                <AlertCircle className="w-5 h-5 text-white shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">
                  <div>{error}</div>
                  <button
                    onClick={() => {
                      setError(null);
                      fetchState(true);
                    }}
                    className="mt-2.5 bg-white text-rose-600 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm hover:bg-rose-50 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    إعادة المحاولة (Retry)
                  </button>
                </div>
                <button 
                  onClick={() => setError(null)} 
                  className="text-white/80 hover:text-white font-bold text-xs shrink-0 mr-1.5 cursor-pointer"
                >
                  ✕
                </button>
              </motion.div>
            )}

            {success && (
              <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="pointer-events-auto bg-emerald-600 border border-emerald-700 text-white p-4 rounded-2xl flex items-start gap-3 text-xs font-bold shadow-2xl"
              >
                <CheckCircle2 className="w-5 h-5 text-white shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{success}</div>
                <button 
                  onClick={() => setSuccess(null)} 
                  className="text-white/80 hover:text-white font-bold text-xs shrink-0 mr-1.5 cursor-pointer"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Auth Barrier Screen (If not logged in, they can view Leaderboard or Log in) */}
        {!currentUser ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left side: Login Area */}
            <motion.div
              initial={{ opacity: 0, x: -40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 85, damping: 15 }}
              className="lg:col-span-5 card-premium p-6 md:p-8 space-y-6 shadow-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-3xl"
            >
              {/* Brand Header */}
              <div className="flex flex-col items-center text-center p-6 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700">
                <img
                  src="/logo.png"
                  alt="A.A.F Logo"
                  width={154}
                  height={159}
                  fetchPriority="high"
                  loading="eager"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-slate-900 shadow-md mb-3 hover:scale-105 transition-transform duration-200"
                />
                <h2 className="text-base font-extrabold text-[#c51f26] dark:text-amber-400 leading-tight">أسرة الأنبا إبرام الجامعية</h2>
                <span className="text-[10px] font-black bg-amber-400 text-slate-950 px-2.5 py-0.5 rounded-full mt-1.5 shadow-xs">A.A.F</span>
                <p className="text-xs text-slate-800 dark:text-slate-200 font-bold mt-2 border-t border-slate-200 dark:border-slate-700 pt-2 w-full">ماراثون الكورس الصيفي: Believe your belief</p>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-[#c51f26] dark:text-amber-400 flex items-center gap-2">
                  <Lock className="w-5 h-5 text-amber-500 shrink-0" />
                  تسجيل الدخول الآمن للخدمة
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">اكتب اسم المستخدم الخاص بك (أو اسمك بالكامل) وكلمة المرور للدخول إلى حسابك ومتابعة النقاط.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">اسم المستخدم أو الاسم بالكامل:</label>
                  <input
                    type="text"
                    required
                    placeholder="أدخل اسم المستخدم"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    className="w-full text-center text-sm p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-hidden focus:border-[#c51f26] dark:focus:border-amber-400 focus:bg-white dark:focus:bg-slate-800 transition-all font-bold text-slate-900 dark:text-slate-100 duration-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">كلمة المرور الخاصة بك:</label>
                  <input
                    type="password"
                    required
                    placeholder="أدخل كلمة المرور"
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value)}
                    className="w-full text-center tracking-normal text-sm p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-hidden focus:border-[#c51f26] dark:focus:border-amber-400 focus:bg-white dark:focus:bg-slate-800 transition-all font-bold text-slate-900 dark:text-slate-100 duration-200"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#c51f26] hover:bg-[#a7181e] text-white font-bold py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all duration-200 shadow-md hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
                >
                  <Key className="w-4 h-4 text-amber-300" /> دخول آمن للوحة التحكم
                </button>

                {/* Offline QR Code Quick Action */}
                {savedUserForOffline && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setIsUserQRModalOpen(true)}
                      className="w-full bg-[#1b4393] hover:bg-[#163574] text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
                    >
                      <QrCode className="w-4 h-4 text-amber-300 animate-pulse" />
                      <span>عرض كود الحضور QR الخاص بي بدون إنترنت (Offline) 📱</span>
                    </button>
                    <p className="text-[10px] text-center text-slate-600 dark:text-slate-400 font-medium mt-1">
                      💡 يمكنك إظهار هذا الكود للخادم في القداس أو الاجتماع لتسجيلك فوراً حتى لو لم يكن لديك إنترنت!
                    </p>
                  </div>
                )}
              </form>

            </motion.div>

            {/* Right side: Public Leaderboard Preview */}
            <motion.div
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 85, damping: 15, delay: 0.15 }}
              className="lg:col-span-7 space-y-4"
            >
              <div className="bg-gradient-to-r from-[#1b4393] to-[#1e3a8a] text-white p-6 rounded-3xl shadow-md border border-[#1b4393]/30">
                <h3 className="text-base font-bold flex items-center gap-2 leading-tight">
                  🏆 لوحة الشرف وصدارة ماراثون Believe your belief
                </h3>
                <p className="text-xs text-white/90 mt-1 leading-relaxed">
                  لوحة الصدارة عامة ومفتوحة لجميع طلاب أسرة الأنبا إبرام الجامعية (A.A.F) لتشجيع التنافس الشريف! سجل دخولك لرؤية تفاصيل حسابك.
                </p>
              </div>

              {state && (
                <Suspense fallback={<ComponentLoader />}>
                  <Leaderboard
                    users={state.users}
                    attendance={state.attendance}
                    tasks={state.tasks}
                    config={state.config}
                    quizzes={state.quizzes || []}
                    quizSubmissions={state.quizSubmissions || []}
                    quizTotals={state.quizTotals}
                    quizCounts={state.quizCounts}
                    bonuses={state.bonuses || []}
                    confessions={state.confessions || {}}
                  />
                </Suspense>
              )}
            </motion.div>

          </div>
        ) : (
          /* Logged In Workspace */
          <div className="space-y-6">
            {/* Non-blocking avatar prompt home banner for users with snoozeCount >= 3 */}
            {currentUser && !currentUser.hasAvatar && (currentUser.avatarSnoozeCount || 0) >= 3 && (
              <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 p-4 rounded-2xl shadow-md flex items-center justify-between gap-3 text-right">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">📸</span>
                  <span className="text-xs font-black">
                    أضف صورتك الشخصية علشان تظهر في عيلة الماراثون وترتيب الصدارة!
                  </span>
                </div>
                <button
                  onClick={() => setShowFirstEntryAvatarModal(true)}
                  className="bg-slate-950 text-amber-400 font-extrabold px-3.5 py-1.5 rounded-xl text-xs hover:bg-slate-900 transition-all cursor-pointer shrink-0"
                >
                  إضافة صورة 📸
                </button>
              </div>
            )}

            {/* Logged in Navigation Sub-header */}
            <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-200 dark:border-slate-800 w-fit gap-1 shadow-xs">
              <button
                onClick={() => setActiveMenu("dashboard")}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  activeMenu === "dashboard"
                    ? "bg-[#c51f26] text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:text-[#c51f26] dark:hover:text-amber-400"
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                {currentUser.role === "admin" ? "لوحة الخادم ومراجعة التسليمات" : "مهامي الخاصة ولوحتي الروحية"}
              </button>

              <button
                onClick={() => setActiveMenu("leaderboard")}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  activeMenu === "leaderboard"
                    ? "bg-[#c51f26] text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:text-[#c51f26] dark:hover:text-amber-400"
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                لوحة الصدارة والترتيب العام
              </button>
            </div>

            {/* Ultra-fast instant tab switching container with keep-alive state retention */}
            {state && (
              <Suspense fallback={<ComponentLoader />}>
                <div className={activeMenu === "leaderboard" ? "block animate-fadeIn" : "hidden"}>
                  <Leaderboard
                    users={state.users}
                    attendance={state.attendance}
                    tasks={state.tasks}
                    config={state.config}
                    quizzes={state.quizzes || []}
                    quizSubmissions={state.quizSubmissions || []}
                    quizTotals={state.quizTotals}
                    quizCounts={state.quizCounts}
                    bonuses={state.bonuses || []}
                    confessions={state.confessions || {}}
                  />
                </div>

                <div className={activeMenu === "dashboard" ? "block animate-fadeIn" : "hidden"}>
                  {currentUser.role === "admin" ? (
                    <AdminBoard
                      state={state}
                      onUpdateState={(ns) => setState(ns)}
                      setError={triggerError}
                      setSuccess={triggerSuccess}
                    />
                  ) : (
                    <ParticipantBoard
                      currentUser={currentUser}
                      state={state}
                      onUpdateState={(ns) => setState(ns)}
                      onUpdateCurrentUser={setCurrentUser}
                      setError={triggerError}
                      setSuccess={triggerSuccess}
                    />
                  )}
                </div>
              </Suspense>
            )}

          </div>
        )}

      </main>

      {/* Footer copyright */}
      <footer className="bg-slate-100 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 py-4 text-center text-[10px] text-slate-600 dark:text-slate-400 font-semibold mt-12 pb-24 md:pb-6">
        <div className="max-w-7xl mx-auto px-4">
          © 2026 أسرة الأنبا إبرام الجامعية (A.A.F) • ماراثون الكورس الصيفي Believe your belief • مصمم بحرص وعناية للخدمة والتشجيع
        </div>
      </footer>

      {/* Premium PWA Install Prompt / Bottom Sheet */}
      <AnimatePresence>
        {showInstallBanner && (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed bottom-0 inset-x-0 mx-auto max-w-md z-50 p-5 bg-white dark:bg-slate-900 border-t sm:border-2 border-natural-green/40 dark:border-natural-accent/40 shadow-2xl rounded-t-3xl sm:rounded-3xl sm:bottom-4 flex flex-col gap-4 text-right overflow-hidden"
          >
            <div className="flex items-start gap-3.5">
              <img
                src="/logo.png"
                alt="A.A.F Logo"
                className="w-12 h-12 rounded-2xl object-cover border-2 border-natural-green/20 shrink-0 shadow-md"
              />
              <div className="flex-1 space-y-1">
                <h4 className="text-sm md:text-base font-black text-natural-green dark:text-natural-accent leading-tight flex items-center gap-1.5">
                  تثبيت التطبيق على الهاتف 📱
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-200 font-bold leading-relaxed">
                  قم بتثبيت التطبيق على شاشتك الرئيسية للوصول السريع، ومتابعة نقاطك والمهام اليومية وتلقي التنبيهات بسهولة!
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                onClick={handleInstallApp}
                className="flex-1 bg-gradient-to-r from-natural-green to-emerald-700 hover:from-natural-olive hover:to-emerald-800 text-white font-extrabold py-3 px-4 rounded-2xl text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
                <span>التثبيت الآن 📲</span>
              </button>
              <button
                onClick={handleSnoozeInstall}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold rounded-2xl text-xs sm:text-sm transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
              >
                ذكّرني لاحقاً ⏳
              </button>
            </div>
            
            {/* Helper for Safari iOS users */}
            {!deferredPrompt && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-extrabold text-center border-t border-slate-100 dark:border-slate-800 pt-2.5 leading-relaxed">
                💡 لمستخدمي الآيفون (iOS Safari): اضغط على زر <span className="font-bold text-natural-green dark:text-natural-accent">"مشاركة" ⎘</span> ثم اختر <span className="font-bold text-natural-green dark:text-natural-accent">"إضافة إلى الشاشة الرئيسية"</span>.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Push Notification Reminder / Bottom Sheet */}
      <AnimatePresence>
        {!showInstallBanner && showPushBanner && (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed bottom-0 inset-x-0 mx-auto max-w-md z-50 p-5 bg-white dark:bg-slate-900 border-t sm:border-2 border-emerald-400 dark:border-emerald-700 shadow-2xl rounded-t-3xl sm:rounded-3xl sm:bottom-4 flex flex-col gap-4 text-right overflow-hidden"
          >
            <div className="flex items-start gap-3.5">
              <div className="bg-emerald-600 text-white p-3 rounded-2xl shrink-0 shadow-md">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <div className="flex-1 space-y-1">
                <h4 className="text-sm md:text-base font-black text-emerald-950 dark:text-emerald-100 leading-tight">
                  تفعيل تنبيهات الهاتف المباشرة 🔔
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-200 font-bold leading-relaxed">
                  احرص على تفعيل التنبيهات لتصلك رسائل الخدام المهمة والمهام الفردية الموجهة إليك مباشرة على شاشة هاتفك أولاً بأول!
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                onClick={handleEnablePush}
                disabled={isPushLoading}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white font-extrabold py-3 px-4 rounded-2xl text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Bell className="w-4 h-4" />
                <span>{isPushLoading ? "جاري التفعيل..." : "تفعيل الآن 🔔"}</span>
              </button>
              <button
                onClick={handleSnoozePush}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold rounded-2xl text-xs sm:text-sm transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
              >
                ذكّرني لاحقاً ⏳
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Broadcast Notifications Banner */}
      <AnimatePresence>
        {activeNotification && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 180 }}
            className="fixed top-4 inset-x-4 md:left-auto md:right-4 md:max-w-md z-50 p-5 bg-white border-2 border-natural-accent rounded-3xl shadow-2xl flex flex-col gap-4 text-right"
          >
            <div className="flex items-start gap-3.5">
              <div className="bg-natural-accent/10 p-2.5 rounded-2xl shrink-0 text-natural-accent animate-bounce">
                <Megaphone className="w-5 h-5 fill-natural-accent" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black bg-amber-800 text-white dark:bg-amber-900 dark:text-amber-100 px-2.5 py-0.5 rounded-full shadow-xs">بث مباشر للشباب</span>
                  <span className="text-[9px] text-natural-muted font-mono">{new Date(activeNotification.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <h4 className="text-xs md:text-sm font-black text-natural-green leading-tight">
                  تنبيه هام من خدمات أسرة الأنبا إبرام ⛪
                </h4>
                <p className="text-xs md:text-sm text-natural-text font-bold leading-relaxed pt-1">
                  {activeNotification.message}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={dismissNotification}
                className="flex-1 bg-natural-green hover:bg-natural-olive text-white font-bold py-2 px-4 rounded-xl text-xs transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                قرأت وفهمت الإشعار ✓
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* User QR Code Modal */}
      {(currentUser || savedUserForOffline) && (
        <Suspense fallback={null}>
          <UserQRModal
            isOpen={isUserQRModalOpen}
            onClose={() => setIsUserQRModalOpen(false)}
            user={currentUser || savedUserForOffline}
          />
        </Suspense>
      )}

      {/* First-Entry Avatar Prompt Modal */}
      {currentUser && (
        <Suspense fallback={null}>
          <AvatarUploadModal
            isOpen={showFirstEntryAvatarModal}
            onClose={() => setShowFirstEntryAvatarModal(false)}
            currentUser={currentUser}
            onUpdateState={(ns) => setState(ns)}
            onUpdateCurrentUser={(u) => setCurrentUser(u)}
            setError={triggerError}
            setSuccess={triggerSuccess}
            isRequired={Boolean((import.meta as any).env?.VITE_AVATAR_REQUIRED === "true" || process.env.AVATAR_REQUIRED === "true")}
          />
        </Suspense>
      )}
    </div>
  );
}
