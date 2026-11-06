import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Camera, Image as ImageIcon, Upload, X, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ApiService, compressAvatarImageToBase64 } from "../services/api";
import { isInvalidAvatarSrc } from "./Avatar";
import { User, DatabaseState } from "../types";

interface AvatarUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUpdateState: (newState: DatabaseState) => void;
  onUpdateCurrentUser: (user: User) => void;
  setError: (msg: string) => void;
  setSuccess: (msg: string) => void;
  isRequired?: boolean;
}

export default function AvatarUploadModal({
  isOpen,
  onClose,
  currentUser,
  onUpdateState,
  onUpdateCurrentUser,
  setError,
  setSuccess,
  isRequired = false,
}: AvatarUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [consentGiven, setConsentGiven] = useState<boolean>(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setError("حجم الصورة كبير جداً! الحد الأقصى المسموح به هو 25 ميجابايت.");
      return;
    }

    try {
      // 1. Draw and resize the image to exactly 300x300 pixels on canvas
      // 2. Export canvas as a WebP Base64 Data URL string (0.85 quality)
      const compressedWebP = await compressAvatarImageToBase64(file, 300, 0.85);
      setPreviewUrl(compressedWebP);
      setSelectedFile(null);
    } catch {
      setError("تعذر قراءة هذه الصورة، يرجى اختيار صورة أخرى أو التقاط صورة جديدة");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile && !previewUrl) {
      setError("يرجى اختيار صورة أولاً قبل الحفظ.");
      return;
    }

    setIsUploading(true);
    try {
      const payload = previewUrl || selectedFile!;
      const res = await ApiService.uploadAvatar(payload);

      if (res.success) {
        onUpdateCurrentUser(res.user);
        onUpdateState(res.db);
        setSuccess("تم تحديث وحفظ صورتك الشخصية بنجاح! 📸🎉");
        setSelectedFile(null);
        setPreviewUrl(null);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء رفع الصورة الشخصية.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSnooze = async () => {
    if (isRequired) return;
    try {
      const res = await ApiService.snoozeAvatarPrompt();
      if (res.success) {
        onUpdateCurrentUser(res.user);
        onUpdateState(res.db);
      }
    } catch (e) {
      console.warn("Failed to record snooze:", e);
    } finally {
      onClose();
    }
  };

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: "spring", stiffness: 120, damping: 15 }}
          className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 text-slate-900 dark:text-slate-100 text-right overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top accent bar */}
          <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-[#c51f26] via-amber-400 to-[#1b4393]" />

          {/* Close button if not required */}
          {!isRequired && (
            <button
              onClick={onClose}
              className="absolute top-4 left-4 p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Header */}
          <div className="flex flex-col items-center text-center mt-2 space-y-2">
            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-inner">
              <Camera className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-black text-[#c51f26] dark:text-amber-400 flex items-center justify-center gap-1.5 leading-tight">
              <span>أضف صورتك علشان تظهر في عيلة الماراثون</span>
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-bold leading-relaxed px-2">
              صوّتك وجديدك بيكمّل عيلتنا! اختار صورة واضحة لتظهر بجوار اسمك وفي لوحة الشرف والصدارة.
            </p>
          </div>

          {/* Circular Image Preview / Picker */}
          <div className="my-6 flex flex-col items-center justify-center space-y-4">
            <div className="relative w-32 h-32 rounded-full border-4 border-amber-400 dark:border-amber-500/80 shadow-lg overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center group">
              {previewUrl || (currentUser.photoURL && !isInvalidAvatarSrc(currentUser.photoURL)) ? (
                <img
                  src={previewUrl || currentUser.photoURL}
                  alt="معاينة الصورة"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                  <ImageIcon className="w-10 h-10 mb-1" />
                  <span className="text-[10px] font-bold">لا يوجد صورة</span>
                </div>
              )}
            </div>

            {/* Selection Action Buttons */}
            <div className="flex items-center justify-center gap-3 w-full">
              {/* Gallery button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold py-2.5 px-3 rounded-2xl text-xs border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              >
                <ImageIcon className="w-4 h-4 text-[#1b4393] dark:text-blue-400" />
                <span>اختر من المعرض</span>
              </button>

              {/* Camera button */}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold py-2.5 px-3 rounded-2xl text-xs border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              >
                <Camera className="w-4 h-4 text-[#c51f26] dark:text-rose-400" />
                <span>التقاط بالكاميرا</span>
              </button>
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,image/heic,image/heif,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*,image/heic,image/heif,image/jpeg,image/png,image/webp"
              capture="user"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Privacy Consent Box */}
          <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3 rounded-2xl mb-6 text-xs text-amber-950 dark:text-amber-200 font-semibold space-y-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 rounded border-amber-400 text-[#c51f26] focus:ring-[#c51f26]"
              />
              <span className="leading-relaxed">
                أوافق على إظهار صورتي لأصدقائي وللخدام في لوحة صدارة الماراثون. (يمكنك تعديل خصوصية الصورة دائماً من إعدادات حسابك).
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={isUploading || !consentGiven}
              className="w-full sm:flex-1 bg-gradient-to-r from-[#c51f26] to-[#881337] hover:from-[#a7181e] hover:to-[#6b0f2b] disabled:opacity-50 text-white font-extrabold py-3 rounded-2xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>جاري المعالجة والحفظ...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-amber-300" />
                  <span>حفظ الصورة الشخصية 📸</span>
                </>
              )}
            </button>

            {!isRequired && (
              <button
                type="button"
                onClick={handleSnooze}
                disabled={isUploading}
                className="w-full sm:w-auto px-5 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-all cursor-pointer border border-slate-300 dark:border-slate-700"
              >
                لاحقاً ⏳
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
