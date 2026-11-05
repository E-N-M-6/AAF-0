import React, { useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, X, Copy, Check, Sparkles, UserCheck, WifiOff } from "lucide-react";
import { User } from "../types";

interface UserQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export default function UserQRModal({ isOpen, onClose, user }: UserQRModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const qrValue = `MARATHON_USER:${user.id}`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in transform-gpu">
      <div className="relative w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100 space-y-4 text-right overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
        
        {/* Background accent decor */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-natural-green/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full pointer-events-none" />

        {/* Header */}
        <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800 pr-8">
          <div className="flex items-center gap-2 mr-auto">
            <h3 className="text-base font-black text-natural-green dark:text-emerald-400">رمز كود الحضور (QR Code)</h3>
            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl text-natural-green dark:text-emerald-400">
              <QrCode className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* User Card Info */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-natural-green dark:text-emerald-400 text-xs font-black border border-slate-200 dark:border-slate-700">
            <UserCheck className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
            <span>{user.role === "admin" ? "حساب خادم / مسؤول" : "مشارك ماراثون Believe your belief"}</span>
          </div>
          <h4 className="text-xl font-black text-slate-900 dark:text-slate-100">{user.name}</h4>
          <p className="text-xs font-extrabold text-slate-600 dark:text-slate-400 dir-ltr">
            @{user.username || user.name}
          </p>
        </div>

        {/* Offline Ready Badge Banner */}
        <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 rounded-2xl flex items-center gap-2.5 text-right">
          <div className="p-1.5 bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 rounded-xl shrink-0">
            <WifiOff className="w-4 h-4 animate-pulse" />
          </div>
          <p className="text-xs font-bold text-rose-950 dark:text-rose-200 leading-snug">
            <span className="font-black bg-rose-600 text-white px-2.5 py-0.5 rounded-md inline-block mb-1 shadow-xs">
              وضع عدم الاتصال 🔴
            </span>
            <span className="block text-xs font-extrabold text-rose-950 dark:text-rose-200 mt-0.5">
              يعمل 100% بدون إنترنت! أظهر هذا الكود للخادم في القداس أو الاجتماع لتسجيل حضورك مباشرة، وتتحدث نقاطك فور الاتصال. ⚡
            </span>
          </p>
        </div>

        {/* QR Display Area */}
        <div className="bg-gradient-to-b from-slate-50 to-white dark:from-white dark:to-slate-50 p-5 rounded-2xl border-2 border-dashed border-natural-green/40 dark:border-natural-accent/40 flex flex-col items-center justify-center space-y-2.5 shadow-inner">
          <div className="p-3 bg-white rounded-xl shadow-md border border-slate-200">
            <QRCodeSVG
              value={qrValue}
              size={180}
              level="H"
              includeMargin={true}
              fgColor="#1E293B"
              bgColor="#FFFFFF"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-natural-green dark:text-slate-800 font-extrabold">
            <Sparkles className="w-3.5 h-3.5 text-natural-accent animate-pulse" />
            <span>امسح هذا الكود لتسجيل الحضور فوراً ⚡</span>
          </div>
        </div>

        {/* Manual User ID Option */}
        <div className="flex items-center justify-between p-3 bg-natural-cream/80 dark:bg-white/5 rounded-xl border border-natural-border dark:border-white/10 text-xs">
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-white/10 hover:bg-natural-green hover:text-white dark:hover:bg-natural-accent text-natural-green dark:text-white font-extrabold rounded-lg border border-natural-border dark:border-white/20 transition-all text-xs cursor-pointer shadow-xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "تم النسخ!" : "نسخ المعرف"}</span>
          </button>
          <div className="text-right">
            <span className="text-[10px] text-natural-muted font-bold block">معرّف المشارك (ID):</span>
            <span className="font-mono text-xs font-black text-natural-text dark:text-white dir-ltr">{user.id}</span>
          </div>
        </div>

        {/* Footer tip */}
        <p className="text-[11px] text-center text-natural-muted font-bold leading-relaxed">
          💡 يمكنك توجيه شاشة هاتفك نحو كاميرا الخادم أثناء أخذ الحضور بالقداس أو التسبحة أو الاجتماع لتسجيلك تلقائياً.
        </p>

      </div>
    </div>,
    document.body
  );
}
