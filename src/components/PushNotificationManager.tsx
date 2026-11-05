import React, { useState, useEffect } from "react";
import { Bell, BellOff, Smartphone, CheckCircle, AlertTriangle, ExternalLink, RefreshCw, X } from "lucide-react";
import { motion } from "motion/react";
import { ApiService } from "../services/api";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushNotificationManager({ onClose }: { onClose?: () => void }) {
  const [isIframe, setIsIframe] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check support and iframe status
  useEffect(() => {
    // Detect iframe
    try {
      if (window.self !== window.top) {
        setIsIframe(true);
      }
    } catch (e) {
      setIsIframe(true);
    }

    // Detect Service Worker and Push support
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setIsSupported(false);
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission);

    // Check active subscription
    checkSubscriptionState();
  }, []);

  const checkSubscriptionState = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.ready;
      }
      if (reg && reg.pushManager) {
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      }
    } catch (err) {
      console.warn("Error checking push subscription state:", err);
    }
  };

  const handleOpenExternal = () => {
    window.open(window.location.href, "_blank");
  };

  const handleSnoozePush = () => {
    const snoozeMs = 2 * 60 * 60 * 1000;
    try {
      localStorage.setItem("push_snoozed_until", (Date.now() + snoozeMs).toString());
    } catch (e) {}
    setIsDismissed(true);
    if (onClose) onClose();
  };

  const handleDismiss = () => {
    handleSnoozePush();
  };

  const handleSubscribe = async () => {
    if (isIframe) {
      setStatusMsg("يرجى فتح التطبيق في علامة تبويب جديدة أولاً للتفعيل على جهازك!");
      return;
    }

    setLoading(true);
    setStatusMsg("");

    try {
      // 1. Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        setLoading(false);
        setStatusMsg("لم يتم السماح بالصلاحية. يرجى تفعيل التنبيهات من إعدادات المتصفح بجوار عنوان الموقع.");
        return;
      }

      // 2. Get service worker registration
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }
      await navigator.serviceWorker.ready;

      // 3. Fetch VAPID public key
      const { publicKey } = await ApiService.getVapidPublicKey();
      if (!publicKey) {
        throw new Error("لم يتم العثور على مفتاح التنبيهات على الخادم.");
      }

      // 4. Unsubscribe any existing subscription to ensure fresh clean binding with current server VAPID key
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        try {
          await existingSub.unsubscribe();
        } catch (unsubErr) {
          console.warn("Old push subscription cleanup notice:", unsubErr);
        }
      }

      // 5. Subscribe
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // 6. Send to server
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
        setIsSubscribed(true);
        setStatusMsg("تم تفعيل وتجديد التنبيهات المباشرة على هاتفك بنجاح! 🎉 يرجى تجربة الضغط على زر 'إرسال تنبيه تجريبي للهاتف'.");
      } else {
        throw new Error((res && res.message) || "فشل التسجيل في الخادم");
      }
    } catch (err: any) {
      console.error("Push registration failed:", err);
      setStatusMsg(`حدث خطأ أثناء تفعيل التنبيهات: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendTest = async () => {
    setTestLoading(true);
    setStatusMsg("");
    try {
      let res;
      try {
        res = await ApiService.sendTestPush();
      } catch (testErr: any) {
        if (testErr.status === 401 || (testErr.message && testErr.message.includes("تسجيل الدخول"))) {
          await ApiService.getState(true);
          res = await ApiService.sendTestPush();
        } else {
          throw testErr;
        }
      }

      if (res && res.success) {
        setStatusMsg("تم إرسال التنبيه التجريبي! تفحص شريط التنبيهات في جهازك أو أعلى الشاشة. 📲");
      } else {
        throw new Error(res ? res.message : "فشل الإرسال");
      }
    } catch (err: any) {
      setStatusMsg(`فشل إرسال التنبيه التجريبي: ${err.message || err}`);
    } finally {
      setTestLoading(false);
    }
  };

  if (isDismissed) {
    return null;
  }

  // Render warning if in iframe
  if (isIframe) {
    return (
      <div id="push_notif_manager" className="bg-white dark:bg-slate-900 border-2 border-indigo-300 dark:border-indigo-700/80 shadow-md rounded-3xl p-5 text-right space-y-4 relative overflow-hidden">
        <button 
          onClick={handleDismiss} 
          className="absolute left-4 top-4 text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="إخفاء هذه البطاقة"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex gap-3.5 items-start pl-6">
          <div className="bg-indigo-600 text-white p-3 rounded-2xl shrink-0 shadow-md">
            <Smartphone className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="space-y-1.5">
            <h4 className="text-base font-black text-indigo-950 dark:text-indigo-100 flex items-center gap-2">
              نظام إشعارات الهاتف والأجهزة 📱
            </h4>
            <p className="text-xs sm:text-sm text-indigo-950 dark:text-indigo-200 leading-relaxed font-bold">
              لتلقي إشعارات الخدام الهامة والمهام الفردية الموجهة إليك مباشرة على شاشة هاتفك (حتى ولو كان المتصفح مغلقاً)، يجب تشغيل التطبيق خارج مستعرض المعاينة المدمج.
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenExternal}
          className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 active:scale-[0.98] text-white font-extrabold py-3 px-5 rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
        >
          <ExternalLink className="w-4 h-4" />
          <span>افتح التطبيق في صفحة مستقلة لتفعيل التنبيهات ↗️</span>
        </button>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div id="push_notif_manager" className="bg-white dark:bg-slate-900 border-2 border-red-200 dark:border-red-950/60 rounded-3xl p-5 text-right space-y-2 relative shadow-md">
        <button 
          onClick={handleDismiss} 
          className="absolute left-4 top-4 text-red-400 hover:text-red-600 p-1 rounded-full hover:bg-red-500/10 transition-colors cursor-pointer"
          title="إخفاء"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex gap-3 items-center pl-6">
          <div className="bg-red-500/20 text-red-600 p-2.5 rounded-xl shrink-0">
            <BellOff className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-black text-red-950 dark:text-red-300">التنبيهات غير مدعومة على هذا الجهاز</h4>
            <p className="text-xs text-red-900 dark:text-red-400 font-bold leading-relaxed mt-1">
              هذا المتصفح أو نظام التشغيل لا يدعم التنبيهات الفورية (Web Push). يرجى تجربة متصفح Google Chrome أو Safari الحديث.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="push_notif_manager" className="bg-white dark:bg-slate-900 border-2 border-emerald-400 dark:border-emerald-700/80 rounded-3xl p-5 text-right space-y-4 shadow-md relative overflow-hidden">
      <div className="absolute left-0 top-0 w-2 h-full bg-emerald-500" />
      
      <button 
        onClick={handleDismiss} 
        className="absolute left-4 top-4 text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        title="إغلاق وإخفاء هذه اللوحة نهائياً"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex gap-3.5 items-start pl-6">
        <div className="bg-emerald-600 text-white p-3 rounded-2xl shrink-0 shadow-md">
          <Bell className="w-5 h-5 sm:w-6 sm:h-6 animate-bounce" />
        </div>
        <div className="space-y-1.5">
          <h4 className="text-base font-black text-emerald-950 dark:text-emerald-100 flex items-center gap-2 flex-wrap">
            تنبيهات الهاتف الفورية والموجهة 📱
            {isSubscribed && (
              <span className="bg-emerald-600 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-xs">
                نشط ومفعل 🟢
              </span>
            )}
          </h4>
          <p className="text-xs sm:text-sm text-emerald-950 dark:text-emerald-200 leading-relaxed font-bold">
            استقبل التنبيهات الهامة والتعليمات الفردية الموجهة لحسابك مباشرة على هاتفك أو حاسوبك فور إرسالها من قبل الخدام لتكون أول من يعلم!
          </p>
        </div>
      </div>

      {statusMsg && (
        <div className="bg-emerald-50 dark:bg-slate-950 p-3.5 rounded-2xl text-xs sm:text-sm font-bold text-center border-2 border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100 shadow-xs">
          {statusMsg}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
        {permission === "denied" ? (
          <div className="flex-1 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700/60 rounded-2xl p-3.5 flex gap-2.5 items-center text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              تم حظر التنبيهات من المتصفح. يرجى السماح بها بالنقر على رمز القفل بجوار عنوان الموقع ثم اختيار (سماح بالإشعارات / Allow Notifications).
            </span>
          </div>
        ) : isSubscribed ? (
          <>
            <button
              onClick={handleSendTest}
              disabled={testLoading}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 active:scale-[0.98] text-white font-extrabold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
            >
              <Smartphone className="w-4 h-4" />
              <span>{testLoading ? "جاري الإرسال للهاتف..." : "📱 إرسال تنبيه تجريبي لتجربة هاتفك"}</span>
            </button>
            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="bg-emerald-50 hover:bg-emerald-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-emerald-950 dark:text-emerald-200 font-extrabold py-3 px-4 rounded-xl text-xs sm:text-sm border-2 border-emerald-300 dark:border-emerald-700 transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              title="إعادة مزامنة وتجديد الاشتراك مع الخادم"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>تحديث التفعيل</span>
            </button>
          </>
        ) : (
          <div className="flex-1 flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 active:scale-[0.98] text-white font-black py-3 px-5 rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{loading ? "جاري التفعيل..." : "تفعيل الآن 🔔"}</span>
            </button>
            <button
              onClick={handleSnoozePush}
              className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold rounded-2xl text-xs sm:text-sm transition-all cursor-pointer border border-slate-200 dark:border-slate-700 flex items-center justify-center"
            >
              <span>ذكّرني لاحقاً ⏳</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
