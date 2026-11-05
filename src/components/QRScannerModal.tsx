import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X, CheckCircle2, AlertCircle, RefreshCw, Volume2, VolumeX, Sparkles, User, Search, Upload, ExternalLink } from "lucide-react";
import { User as UserType } from "../types";

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanUser: (userId: string) => Promise<{ success: boolean; userName?: string; message?: string }>;
  activityName: string;
  weekNum: number;
  participants: UserType[];
}

interface ScanLog {
  id: string;
  userName: string;
  time: string;
  status: "success" | "error";
  message: string;
}

export default function QRScannerModal({
  isOpen,
  onClose,
  onScanUser,
  activityName,
  weekNum,
  participants,
}: QRScannerModalProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [lastScannedUser, setLastScannedUser] = useState<{ id: string; name: string } | null>(null);
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [manualInput, setManualInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isProcessingRef = useRef(false);
  const lastScannedTimeRef = useRef<{ [key: string]: number }>({});

  // Web Audio API Audio Chime synthesized
  const playBeep = useCallback((isSuccess = true) => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (isSuccess) {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else {
        osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // Ignore audio autoplay restrictions
    }
  }, [soundEnabled]);

  const processScannedCode = useCallback(async (rawText: string) => {
    if (isProcessingRef.current) return;

    let targetUserId = rawText.trim();
    if (targetUserId.startsWith("MARATHON_USER:")) {
      targetUserId = targetUserId.replace("MARATHON_USER:", "");
    }

    if (!targetUserId) return;

    // Prevent double scanning same user within 2 seconds
    const now = Date.now();
    const lastTime = lastScannedTimeRef.current[targetUserId] || 0;
    if (now - lastTime < 2000) {
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);
    lastScannedTimeRef.current[targetUserId] = now;

    // Find user name locally for quick display
    const matchedUser = participants.find(p => p.id === targetUserId || p.username === targetUserId || p.name === targetUserId);
    const displayName = matchedUser ? matchedUser.name : targetUserId;

    try {
      const res = await onScanUser(matchedUser ? matchedUser.id : targetUserId);
      
      const newLog: ScanLog = {
        id: Date.now().toString(),
        userName: res.userName || displayName,
        time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        status: res.success ? "success" : "error",
        message: res.message || (res.success ? "تم تسجيل الحضور بنجاح!" : "فشل تسجيل الحضور"),
      };

      setScanLogs(prev => [newLog, ...prev.slice(0, 15)]);

      if (res.success) {
        playBeep(true);
        setLastScannedUser({ id: targetUserId, name: res.userName || displayName });
      } else {
        playBeep(false);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "خطأ غير متوقع";
      playBeep(false);
      setScanLogs(prev => [
        {
          id: Date.now().toString(),
          userName: displayName,
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
          status: "error",
          message: errorMsg,
        },
        ...prev.slice(0, 15),
      ]);
    } finally {
      // Brief cooldown before accepting next scan
      setTimeout(() => {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }, 400);
    }
  }, [onScanUser, participants, playBeep]);

  // Start QR Camera Reader
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setIsPermissionDenied(false);
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode("qr-reader-viewport");
      } else if (scannerRef.current.isScanning) {
        try {
          await scannerRef.current.stop();
        } catch {
          // ignore cleanup error
        }
      }

      await scannerRef.current.start(
        { facingMode: "environment" }, // Prefer back camera on mobile
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          processScannedCode(decodedText);
        },
        () => {
          // Frame parse error (ignored)
        }
      );
      setIsScanning(true);
    } catch (err: unknown) {
      console.warn("Camera start suppressed error:", err);
      setIsScanning(false);
      const errName = err instanceof Error ? err.name : "";
      const errStr = String(err);
      if (
        errName === "NotAllowedError" ||
        errStr.includes("NotAllowedError") ||
        errStr.includes("Permission denied") ||
        errStr.includes("Permission") ||
        errStr.includes("NotAllowed")
      ) {
        setIsPermissionDenied(true);
        setCameraError("تم رفض أو تقييد إذن الوصول للكاميرا داخل المعاينة. يمكنك إما فتح التطبيق في تبويب جديد للسماح بالكاميرا فوراً، أو اختيار صورة الـ QR، أو التسجيل يدويًا بالأسفل.");
      } else {
        setCameraError("تعذر فتح الكاميرا حالياً. يرجى التأكد من السماح بالوصول للكاميرا أو استخدام خيار رفع صورة الـ QR أو الإدخال اليدوي.");
      }
    }
  }, [processScannedCode]);

  // Handle QR code scan from uploaded image file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    try {
      setIsProcessing(true);
      const tempScanner = new Html5Qrcode("qr-reader-viewport-file-temp");
      const decodedText = await tempScanner.scanFile(file, true);
      try { await tempScanner.clear(); } catch {}
      if (decodedText) {
        processScannedCode(decodedText);
      }
    } catch (err) {
      console.error("Failed to parse QR from image file:", err);
      playBeep(false);
      setScanLogs(prev => [
        {
          id: Date.now().toString(),
          userName: "صورة غير صالحة",
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
          status: "error",
          message: "لم يتم العثور على رمز QR واضح في الصورة المختارة.",
        },
        ...prev.slice(0, 15),
      ]);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Stop Camera
  const stopCamera = useCallback(async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch (err) {
        console.error("Failed to stop scanner:", err);
      }
    }
    setIsScanning(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM element '#qr-reader-viewport' is rendered
      const timer = setTimeout(() => {
        startCamera();
      }, 300);
      return () => {
        clearTimeout(timer);
        stopCamera();
      };
    } else {
      stopCamera();
    }
  }, [isOpen, startCamera, stopCamera]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    processScannedCode(manualInput.trim());
    setManualInput("");
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in transform-gpu">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100 space-y-4 text-right flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Hidden temp element for file scanning */}
        <div id="qr-reader-viewport-file-temp" className="hidden" />

        {/* Top Header */}
        <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800 shrink-0 pr-8">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                soundEnabled 
                  ? "bg-emerald-50 dark:bg-emerald-950/50 text-natural-green dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" 
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700"
              }`}
              title={soundEnabled ? "كتم الصوت" : "تشغيل الصوت"}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-right">
            <h3 className="text-sm font-extrabold text-natural-green dark:text-emerald-400 flex items-center gap-1.5 justify-end">
              <Camera className="w-4 h-4" />
              ماسح الـ QR لحضور {activityName}
            </h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">الأسبوع رقم {weekNum}</p>
          </div>
        </div>

        {/* Live Feedback banner */}
        {lastScannedUser && (
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300 font-bold shrink-0 animate-bounce">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              تم تسجيل حضور: <span className="underline">{lastScannedUser.name}</span> ✨
            </span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
        )}

        {/* Main Camera Scanner Container */}
        <div className="relative rounded-2xl overflow-hidden border-2 border-natural-green/30 bg-black min-h-[220px] sm:min-h-[260px] flex items-center justify-center shrink-0">
          <div id="qr-reader-viewport" className="w-full h-full text-white text-center" />

          {/* Processing overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
              <div className="px-4 py-2 bg-natural-green text-white rounded-full text-xs font-bold flex items-center gap-2 shadow-lg animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                جاري تسجيل الحضور...
              </div>
            </div>
          )}

          {/* Camera Error Message fallback */}
          {cameraError && (
            <div className="p-4 text-center space-y-3 max-w-sm z-10 bg-black/80 rounded-2xl">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="text-xs text-white/90 font-medium leading-relaxed">{cameraError}</p>
              
              <div className="flex flex-wrap gap-2 justify-center pt-1">
                <button
                  onClick={startCamera}
                  className="px-3 py-1.5 bg-natural-green hover:bg-natural-green/90 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  محاولة الكاميرا مجدداً
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-natural-accent hover:bg-natural-accent/90 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  رفع صورة QR
                </button>

                {isPermissionDenied && (
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, "_blank")}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    فتح التطبيق في تبويب مستقل
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Hidden File Input for Image Scanning */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Actions bar: Upload image option & Manual input */}
        <div className="space-y-2 shrink-0">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-bold">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-natural-green dark:text-emerald-400 hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>اختر صورة تحتوي على كود QR من الجهاز</span>
            </button>
            <span>أو تسجيل يدوي سريع:</span>
          </div>

          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-natural-green hover:bg-natural-olive text-white font-bold text-xs rounded-xl transition-all shrink-0 cursor-pointer flex items-center gap-1 shadow-sm"
            >
              <Search className="w-3.5 h-3.5" />
              تسجيل
            </button>
            <input
              type="text"
              placeholder="ادخل اسم أو كود المشارك هنا للغلق والتحضير..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:outline-hidden focus:border-natural-green text-right"
            />
          </form>
        </div>

        {/* Recent Scan History Log */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs max-h-[140px] border-t border-slate-200 dark:border-slate-800 pt-2">
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-1">📋 سجل المسح الأخير بالجلسة الحالية:</span>
          {scanLogs.length === 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center py-2 font-medium">وجه الكاميرا أو اختر صورة QR أو اكتب اسم المشارك لبدء التسجيل...</p>
          ) : (
            scanLogs.map((log) => (
              <div
                key={log.id}
                className={`p-2 rounded-xl flex justify-between items-center text-[11px] font-bold transition-all ${
                  log.status === "success"
                    ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800"
                    : "bg-rose-50 dark:bg-rose-950/50 text-rose-950 dark:text-rose-200 border border-rose-200 dark:border-rose-800"
                }`}
              >
                <span className="font-mono text-[9px] text-slate-500 dark:text-slate-400 dir-ltr">{log.time}</span>
                <div className="flex items-center gap-1.5">
                  <span>{log.message}</span>
                  <User className="w-3 h-3 text-natural-green dark:text-emerald-400" />
                  <span className="font-black underline">{log.userName}</span>
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
