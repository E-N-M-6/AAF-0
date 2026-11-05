import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldAlert,
  ShieldCheck,
  BookOpen,
  Sun,
  Clock,
  Send,
  AlertTriangle,
  Lock,
  CheckCircle2,
  XCircle,
  FileText,
  Maximize2,
  EyeOff,
  Zap,
} from "lucide-react";
import { Quiz, User, DatabaseState } from "../types";
import { ApiService } from "../services/api";
import { useExamSecurity } from "../hooks/useExamSecurity";
import { triggerDazzlingCelebration } from "../lib/confetti";

export interface QuizRunnerProps {
  quiz: Quiz;
  currentUser: User;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onUpdateState: (newState: DatabaseState) => void;
  initialAnswers?: Record<string, string>;
}

export default function QuizRunner({
  quiz,
  currentUser,
  onClose,
  onSuccess,
  onError,
  onUpdateState,
  initialAnswers,
}: QuizRunnerProps) {
  // Proctored mode logic
  const proctoringMode = quiz.proctoringMode || "WARN";
  const isProctoringActive = proctoringMode !== "OFF";
  const isStrictImmediateKick = Boolean(
    quiz.strictImmediateKick || (proctoringMode === "STRICT" && quiz.maxLeaves === 0)
  );

  // Pre-exam rules modal state (only required if proctoring is enabled)
  const [hasAcceptedRules, setHasAcceptedRules] = useState<boolean>(!isProctoringActive);
  const [rulesCheckboxChecked, setRulesCheckboxChecked] = useState<boolean>(false);

  // Quiz solving states
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    if (initialAnswers) return initialAnswers;
    const init: Record<string, string> = {};
    quiz.questions.forEach((q) => {
      init[q.id] = q.type === "boolean" ? "true" : "";
    });
    return init;
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showExitConfirm, setShowExitConfirm] = useState<boolean>(false);
  const [pasteNotice, setPasteNotice] = useState<boolean>(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [terminatedByViolation, setTerminatedByViolation] = useState<boolean>(false);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  // Format time remaining
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Exam security hook for screen wake lock, focus loss monitoring, fullscreen enforcement & blurring
  const {
    isWakeLockActive,
    incidentCount,
    warningModalOpen,
    closeWarningModal,
    lastLeaveDuration,
    warnToastMessage,
    clearWarnToast,
    isFullscreen,
    isFocusLost,
    requestFullscreen,
    exitFullscreen,
  } = useExamSecurity({
    active: hasAcceptedRules && !isSubmitting && !terminatedByViolation,
    proctoringMode,
    graceSeconds: isStrictImmediateKick ? 0 : (quiz.graceSeconds || 3),
    maxLeaves: isStrictImmediateKick ? 0 : (quiz.maxLeaves !== undefined ? quiz.maxLeaves : 1),
    strictImmediateKick: isStrictImmediateKick,
    onViolation: async (count, duration, reason) => {
      try {
        await ApiService.logQuizViolation(
          quiz.id,
          currentUser.id,
          duration,
          reason ||
            (proctoringMode === "STRICT"
              ? `مخالفة رقم (${count}) في الوضع الصارم - مغادرة شاشة الاختبار لمدة ${duration} ثانية`
              : `مخالفة في وضع التنبيه - مغادرة شاشة الاختبار لمدة ${duration} ثانية`)
        );
      } catch (err) {
        console.warn("فشل تسجيل المخالفة بالخادم:", err);
      }
    },
    onAutoSubmit: async (_count, _duration, reason) => {
      // Immediate kick or incident limit breached -> auto-terminate
      handleViolationAutoSubmit(reason);
    },
  });

  // Ensure fullscreen is cleaned up on unmount
  useEffect(() => {
    return () => {
      exitFullscreen().catch(() => {});
    };
  }, [exitFullscreen]);

  // Handle auto-submit when violation limit is breached or strict kick triggered
  const handleViolationAutoSubmit = async (reason?: string) => {
    if (isSubmitting || terminatedByViolation) return;
    setTerminatedByViolation(true);
    setIsSubmitting(true);
    await exitFullscreen().catch(() => {});

    try {
      const data = await ApiService.submitQuiz(
        quiz.id,
        currentUser.id,
        answersRef.current,
        "VIOLATION_TERMINATED"
      );
      onUpdateState(data.db);
      onError(
        reason
          ? `⛔ تنبيه أمني: ${reason}! تم قفل الامتحان وتسليم إجاباتك الحالية تلقائياً مع إلغاء المحاولة.`
          : "⛔ تنبيه أمني: تم رصد مغادرة شاشة الاختبار! تم قفل الامتحان وتسليم إجاباتك الحالية تلقائياً مع إلغاء المحاولة."
      );
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء قفل الامتحان";
      onError(msg);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Regular auto-submit on timer expiration
  const handleTimerAutoSubmit = async () => {
    if (isSubmitting || terminatedByViolation) return;
    setIsSubmitting(true);
    await exitFullscreen().catch(() => {});
    onError("⏱️ انتهى الوقت المحدد للاختبار! جاري تسليم إجاباتك الحالية تلقائياً...");

    try {
      const data = await ApiService.submitQuiz(
        quiz.id,
        currentUser.id,
        answersRef.current
      );
      onUpdateState(data.db);
      const myScore = data.db.quizSubmissions?.find(
        (s) => s.quizId === quiz.id && s.userId === currentUser.id
      );
      if (myScore) {
        onSuccess(
          `⏱️ انتهى وقت الاختبار! تم حفظ إجاباتك وتسليم الكويز بنجاح. حصلت على: ${myScore.totalScore} نقطة من ${quiz.points}!`
        );
      } else {
        onSuccess("⏱️ انتهى وقت الاختبار! تم تسليم إجاباتك تلقائياً بنجاح.");
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء التسليم التلقائي";
      onError(msg);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Timer countdown
  useEffect(() => {
    if (!hasAcceptedRules || !quiz.timeLimit || quiz.timeLimit <= 0) {
      setRemainingSeconds(null);
      return;
    }

    const durationSeconds = quiz.timeLimit * 60;
    setRemainingSeconds(durationSeconds);

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          handleTimerAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [hasAcceptedRules, quiz.timeLimit]);

  // Submit action by student
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || terminatedByViolation) return;

    // Check if any unanswered question
    const unanswered = quiz.questions.some((q) => !answers[q.id]?.trim());
    if (unanswered) {
      onError("يرجى الإجابة على جميع الأسئلة قبل تسليم الكويز!");
      return;
    }

    setIsSubmitting(true);
    await exitFullscreen().catch(() => {});

    try {
      const data = await ApiService.submitQuiz(
        quiz.id,
        currentUser.id,
        answers
      );
      onUpdateState(data.db);

      const myScore = data.db.quizSubmissions?.find(
        (s) => s.quizId === quiz.id && s.userId === currentUser.id
      );

      triggerDazzlingCelebration();

      if (myScore) {
        onSuccess(
          `تم تسليم الكويز بنجاح وتقييمه تلقائياً! حصلت على: ${myScore.totalScore} نقطة من ${quiz.points}! 🎉`
        );
      } else {
        onSuccess("تم تسليم الكويز بنجاح! سيتم تقييمه وعرض نتيجتك فوراً. 🎉");
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ ما أثناء تسليم الكويز";
      onError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestExit = () => {
    const hasAnswers = Object.values(answers).some((val) => Boolean(typeof val === "string" ? val.trim() : val));
    if (!hasAnswers) {
      exitFullscreen().catch(() => {});
      onClose();
    } else {
      setShowExitConfirm(true);
    }
  };

  // Anti-paste handler
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    setPasteNotice(true);
    setTimeout(() => setPasteNotice(false), 2500);
  };

  // Handle start quiz with Fullscreen API request
  const handleStartExam = async () => {
    setHasAcceptedRules(true);
    if (isProctoringActive) {
      await requestFullscreen();
    }
  };

  if (typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 overflow-y-auto text-right select-none transform-gpu font-sans">
      {/* 1. QUIZ RULES ACCEPTANCE MODAL (shown before active attempt if proctoring is enabled) */}
      {!hasAcceptedRules && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 text-slate-900 dark:text-slate-100 my-auto"
        >
          <div className="text-center space-y-2 mb-5">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-inner">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">
              ضوابط وتعليمات الاختبار الأكاديمي 📖
            </h3>
            <p className="text-xs font-bold text-natural-accent">
              اختبار: {quiz.title} ({quiz.points} نقطة)
            </p>
          </div>

          <div className="space-y-3.5 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/70 text-xs font-semibold leading-relaxed">
            <div className="flex items-start gap-2.5">
              <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p>
                <strong className="text-emerald-700 dark:text-emerald-400 font-extrabold">امتحان بنظام الكتاب المفتوح (Open-Book):</strong>{" "}
                مسموح ومرحب بالقراءة والبحث في نسختك الورقية المطبوعة من الكتاب المقدس بحرية تامة طوال مدة الحل.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <Maximize2 className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
              <p>
                <strong className="text-purple-700 dark:text-purple-400 font-extrabold">فرض وضع ملء الشاشة (Fullscreen):</strong>{" "}
                سيبدأ الاختبار بوضع ملء الشاشة لمنع تشغيل النوافذ المنقسمة (Split Screen) أو التطبيقات العائمة، والخروج منه يسجل كمخالفة فورية.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <p>
                <strong className="text-rose-700 dark:text-rose-400 font-extrabold">مراقبة شاشة الاختبار:</strong>{" "}
                يتم رصد مغادرة صفحة الامتحان أو التبديل بين التطبيقات لمنع استخدام محركات البحث أو برامج الذكاء الاصطناعي ولضمان تكافؤ الفرص بين الجميع.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <EyeOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p>
                <strong className="text-indigo-700 dark:text-indigo-400 font-extrabold">حجب فوري عند فقدان التركيز:</strong>{" "}
                يتم تشويش وحجب محتوى الامتحان تلقائياً عند محاولة إنزال شريط الإشعارات أو التبديل بين التطبيقات لمنع أخذ لقطات شاشة.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <Sun className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p>
                <strong className="text-amber-700 dark:text-amber-400 font-extrabold">إبقاء الشاشة مضاءة (Screen Wake Lock):</strong>{" "}
                سيتم إبقاء إضاءة شاشة هاتفك نشطة تلقائياً لمنع قفل الشاشة أثناء قراءتك في الكتاب المقدس الورقي.
              </p>
            </div>

            {isStrictImmediateKick ? (
              <div className="p-3 bg-rose-100 dark:bg-rose-950/80 border-2 border-rose-400 dark:border-rose-700 rounded-xl text-rose-950 dark:text-rose-100 text-xs font-black shadow-xs space-y-1">
                <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                  <Zap className="w-4 h-4 fill-rose-600 dark:fill-rose-400" />
                  <span>تنبيه أمني صارم (إنهاء فوري عند أول خروج مفعل):</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  أي مغادرة لشاشة الاختبار أو خروج من وضع ملء الشاشة أو تقسيم الشاشة لمرة واحدة فقط ستتسبب فوراً في قفل وتسليم الاختبار تلقائياً وإلغاء المحاولة دون أي مهلة سماح أو إنذار مسبق!
                </p>
              </div>
            ) : proctoringMode === "STRICT" ? (
              <div className="p-2.5 bg-rose-100/70 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-200 text-[11px] font-bold">
                ⚠️ <span className="underline">الوضع الصارم مفعل:</span> مغادرة شاشة الاختبار لأكثر من {quiz.maxLeaves || 1} مرة ستتسبب في قفل الامتحان وتسليمه تلقائياً فوراً كإلغاء لمخالفة أمنية!
              </div>
            ) : (
              <div className="p-2.5 bg-amber-100/70 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 text-[11px] font-bold">
                ℹ️ <span className="underline">وضع التنبيه مفعل:</span> سيتم تسجيل أي مغادرة لشاشة الاختبار مع إظهار تنبيه توعوي للحفاظ على تركيزك.
              </div>
            )}
          </div>

          <div className="mt-5 space-y-4">
            <label className="flex items-center gap-2.5 cursor-pointer p-3 bg-natural-cream/40 dark:bg-slate-800 border border-natural-border/70 dark:border-slate-700 rounded-xl hover:bg-natural-cream/70 transition-colors">
              <input
                type="checkbox"
                checked={rulesCheckboxChecked}
                onChange={(e) => setRulesCheckboxChecked(e.target.checked)}
                className="w-4 h-4 rounded text-natural-green accent-natural-green cursor-pointer shrink-0"
              />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                أقر بأنني قرأت وفهمت التعليمات وأوافق على الالتزام بالقواعد والبقاء بوضع ملء الشاشة دون مغادرة شاشة الاختبار.
              </span>
            </label>

            <div className="flex gap-2.5">
              <button
                type="button"
                disabled={!rulesCheckboxChecked}
                onClick={handleStartExam}
                className="flex-1 bg-natural-green hover:bg-natural-olive disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold py-3.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                بدء الامتحان بملء الشاشة والالتزام بالقواعد 🚀
              </button>
              <button
                type="button"
                onClick={onClose}
                className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold py-3.5 px-5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* 2. ACTIVE QUIZ RUNNER INTERFACE */}
      {hasAcceptedRules && (
        <motion.div
          initial={{ scale: 0.93, y: 25, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 130, damping: 18 }}
          className="relative w-full max-w-xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* SCREEN BLUR OVERLAY ON FOCUS LOSS: Obscures questions instantly on notification drag / app switch / screenshot attempt */}
          {isFocusLost && (
            <div className="absolute inset-0 z-50 backdrop-blur-md bg-slate-950/85 flex flex-col items-center justify-center p-6 text-center text-white rounded-3xl animate-fade-in pointer-events-none select-none">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3 border border-rose-500/40 shadow-lg">
                <EyeOff className="w-8 h-8 animate-pulse text-rose-400" />
              </div>
              <h3 className="text-base font-black text-rose-300 mb-1.5">
                تم حجب شاشة الاختبار فوراً! 🔒
              </h3>
              <p className="text-xs font-bold text-slate-300 max-w-sm leading-relaxed">
                تم رصد فقدان التركيز أو محاولة تصوير الشاشة / التبديل بين التطبيقات. يرجى التركيز في صفحة الاختبار لمتابعة الحل.
              </p>
            </div>
          )}

          {/* Header */}
          <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3 mb-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black text-natural-accent">حل الكويز التفاعلي 📝</span>

                {isProctoringActive && (
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                      isStrictImmediateKick
                        ? "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-700"
                        : proctoringMode === "STRICT"
                        ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                    }`}
                  >
                    {isStrictImmediateKick
                      ? "إنهاء فوري ⚡"
                      : proctoringMode === "STRICT"
                      ? "وضع صارم 🛡️"
                      : "وضع مراقبة وتنبيه ⚠️"}
                  </span>
                )}

                {isProctoringActive && isFullscreen && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800 flex items-center gap-1">
                    <Maximize2 className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                    ملء الشاشة نشط
                  </span>
                )}

                {isProctoringActive && !isFullscreen && (
                  <button
                    type="button"
                    onClick={requestFullscreen}
                    className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700 flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                    title="تفعيل وضع ملء الشاشة المطلوب للاختبار"
                  >
                    <Maximize2 className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                    تفعيل ملء الشاشة ⛶
                  </button>
                )}

                {isWakeLockActive && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                    <Sun className="w-3 h-3 text-amber-500 animate-spin-slow" />
                    الشاشة مضاءة للقراءة
                  </span>
                )}
              </div>
              <h4 className="text-base font-black text-natural-green dark:text-emerald-400">
                {quiz.title}
              </h4>
            </div>

            <button
              type="button"
              onClick={handleRequestExit}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-base font-bold p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="إغلاق الاختبار"
            >
              ✕
            </button>
          </div>

          {/* Friendly Toast for WARN mode violations */}
          <AnimatePresence>
            {warnToastMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 p-2.5 rounded-xl flex items-center justify-between text-xs font-bold text-amber-800 dark:text-amber-200 shadow-sm"
              >
                <span>{warnToastMessage}</span>
                <button
                  type="button"
                  onClick={clearWarnToast}
                  className="text-amber-600 hover:text-amber-800 dark:text-amber-400 text-xs font-black mr-2 px-1 cursor-pointer"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Anti-Paste Alert Notice */}
          <AnimatePresence>
            {pasteNotice && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="mb-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 p-2.5 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 text-center shadow-xs"
              >
                ⚠️ خاصية اللصق معطلة لحماية نزاهة الامتحان. يرجى كتابة الإجابة يدوياً بلوحة المفاتيح.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Time Remaining Bar */}
          {remainingSeconds !== null && (
            <div className="mb-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 p-2.5 rounded-2xl flex justify-between items-center text-xs font-bold text-rose-700 dark:text-rose-300 animate-pulse">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> الوقت المتبقي لحل الكويز وتلقي التقييم:
              </span>
              <span className="text-sm font-black bg-rose-600 text-white px-3 py-0.5 rounded-lg font-mono">
                {formatTime(remainingSeconds)}
              </span>
            </div>
          )}

          {/* Questions Container with Anti-Copy safeguards and CSS backdrop / canvas blurring on focus loss */}
          <form
            onSubmit={handleSubmit}
            className={`flex-1 flex flex-col min-h-0 space-y-4 transition-all duration-150 ${
              isFocusLost ? "filter blur-md pointer-events-none select-none opacity-40" : ""
            }`}
            style={isFocusLost ? { filter: "blur(16px)" } : undefined}
          >
            <div className="flex-1 overflow-y-auto pr-1 space-y-4 max-h-[58vh]">
              {quiz.questions.map((q, idx) => (
                <div
                  key={q.id}
                  className="p-4 bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-2xl space-y-3 shadow-xs select-none"
                  style={{
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    MozUserSelect: "none",
                    msUserSelect: "none",
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onCopy={(e) => e.preventDefault()}
                >
                  <div className="flex justify-between items-start gap-2 border-b border-slate-200 dark:border-slate-700/70 pb-2.5">
                    <span className="text-xs md:text-sm font-black text-slate-900 dark:text-slate-100 leading-relaxed select-none">
                      س {idx + 1}: {q.questionText}
                    </span>
                    <span className="text-[11px] font-black text-amber-700 dark:text-amber-300 bg-amber-100/90 dark:bg-amber-950/80 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800/60 shrink-0">
                      {q.points} نقاط
                    </span>
                  </div>

                  {/* Multiple Choice */}
                  {q.type === "choice" && q.options && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                      {q.options.map((opt, optIdx) => {
                        const isSelected = answers[q.id] === optIdx.toString();
                        return (
                          <button
                            key={optIdx}
                            type="button"
                            onClick={() => setAnswers({ ...answers, [q.id]: optIdx.toString() })}
                            className={`p-3 rounded-xl border text-right text-xs md:text-sm font-semibold transition-all cursor-pointer flex items-center justify-start gap-2 ${
                              isSelected
                                ? "bg-natural-green text-white border-natural-green font-extrabold shadow-md ring-2 ring-natural-green/30"
                                : "bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700"
                            }`}
                          >
                            <span
                              className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-xs font-bold font-mono shrink-0 ${
                                isSelected
                                  ? "bg-white/20 text-white"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {optIdx + 1}
                            </span>
                            <span className="flex-1">{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* True / False */}
                  {q.type === "boolean" && (
                    <div className="flex gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setAnswers({ ...answers, [q.id]: "true" })}
                        className={`flex-1 p-3 rounded-xl border text-center text-xs md:text-sm font-extrabold transition-all cursor-pointer ${
                          answers[q.id] === "true"
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-500/30"
                            : "bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        صح (✓)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswers({ ...answers, [q.id]: "false" })}
                        className={`flex-1 p-3 rounded-xl border text-center text-xs md:text-sm font-extrabold transition-all cursor-pointer ${
                          answers[q.id] === "false"
                            ? "bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-500/30"
                            : "bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        خطأ (✕)
                      </button>
                    </div>
                  )}

                  {/* Essay Question with Anti-Paste */}
                  {q.type === "essay" && (
                    <div className="pt-1">
                      <textarea
                        rows={3}
                        required
                        placeholder="اكتب إجابتك المقالية بالتفصيل هنا... (سيتم مراجعتها من لجنة التقييم بدقة تشجيعية وعادلة!)"
                        value={answers[q.id] || ""}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        onPaste={handlePaste}
                        className="w-full text-xs md:text-sm p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-hidden focus:border-natural-green font-semibold leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom Actions */}
            <div className="flex gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-natural-green hover:bg-natural-olive disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 text-natural-accent" />
                {isSubmitting ? "جاري تسليم الإجابات للتصحيح الفوري ورصد النقاط..." : "إرسال الإجابات للتصحيح الفوري 🚀"}
              </button>
              <button
                type="button"
                onClick={handleRequestExit}
                className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold py-3.5 px-5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>

          {/* 3. NON-DISMISSABLE STRICT MODE WARNING MODAL (ExamWarningModal for non-immediate kick) */}
          {warningModalOpen && !isStrictImmediateKick && (
            <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-slate-950/90 text-right animate-fade-in transform-gpu">
              <div
                className="bg-white dark:bg-slate-900 border-2 border-rose-500 p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl text-slate-900 dark:text-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto text-2xl font-black shadow-inner animate-bounce">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <h4 className="text-base font-black text-rose-600 dark:text-rose-400">
                    تنبيه أمني: تم رصد الخروج من شاشة الامتحان!
                  </h4>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-bold">
                    التبديل بين التطبيقات أو الخروج من وضع ملء الشاشة غير مسموح. في حال التكرار سيتم قفل الامتحان وتطبيق التسليم التلقائي.
                  </p>
                  {lastLeaveDuration !== null && (
                    <div className="inline-block bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 px-3 py-1 rounded-lg text-[11px] font-black">
                      مدة الخروج المسجلة: {lastLeaveDuration} ثوانٍ (مخالفة {incidentCount} من {quiz.maxLeaves || 1})
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      closeWarningModal();
                      await requestFullscreen();
                    }}
                    className="w-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs transition-colors cursor-pointer shadow-md"
                  >
                    فهمت وسألتزم بملء الشاشة والبقاء داخل الامتحان ✋
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. CONFIRM EXIT OVERLAY */}
          {showExitConfirm && (
            <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4 bg-slate-950/85 text-right animate-fade-in transform-gpu">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto text-xl font-bold">
                    ⚠️
                  </div>
                  <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    هل تريد إلغاء حل الاختبار؟
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
                    سيتم إغلاق الاختبار ولن يتم حفظ أي إجابات قمت باختيارها حتى الآن.
                  </p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setShowExitConfirm(false);
                      await exitFullscreen().catch(() => {});
                      onClose();
                    }}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    نعم، تأكيد الخروج
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExitConfirm(false)}
                    className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    متابعة الحل
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>,
    document.body
  );
}
