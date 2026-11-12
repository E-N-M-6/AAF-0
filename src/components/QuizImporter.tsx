import React, { useState } from "react";
import { createPortal } from "react-dom";
import { 
  X, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Trash2, 
  ArrowRight, 
  ArrowLeft, 
  Check, 
  HelpCircle,
  Layers
} from "lucide-react";
import { 
  parseBulkQuizText, 
  ParsedQuestionDraft, 
  SAMPLE_ARABIC_QUIZ_TEXT 
} from "../lib/quizParser";
import { QuizQuestion, QuestionType } from "../types";

export interface QuizImporterProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (questions: QuizQuestion[]) => void;
  defaultMcqPoints?: number;
  defaultTrueFalsePoints?: number;
  defaultEssayPoints?: number;
  defaultFillBlankPoints?: number;
  defaultQuotePoints?: number;
}

export const QuizImporter: React.FC<QuizImporterProps> = ({
  isOpen,
  onClose,
  onImport,
  defaultMcqPoints = 2,
  defaultTrueFalsePoints = 1,
  defaultEssayPoints = 5,
  defaultFillBlankPoints = 3,
  defaultQuotePoints = 4,
}) => {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [rawText, setRawText] = useState<string>("");
  const [parsedDrafts, setParsedDrafts] = useState<ParsedQuestionDraft[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleParse = () => {
    if (!rawText.trim()) {
      setErrorMsg("يرجى لصق نص الأسئلة أولاً لتحليله واستخراجه");
      return;
    }

    setErrorMsg(null);
    const result = parseBulkQuizText(
      rawText,
      defaultMcqPoints,
      defaultTrueFalsePoints,
      defaultEssayPoints,
      defaultFillBlankPoints,
      defaultQuotePoints
    );

    if (result.questions.length === 0) {
      setErrorMsg("لم نتمكن من استخراج أي سؤال صالح. يرجى التأكد من تنسيق الأسئلة وخياراتها.");
      return;
    }

    setParsedDrafts(result.questions);
    setStep("preview");
  };

  const handleLoadSample = () => {
    setRawText(SAMPLE_ARABIC_QUIZ_TEXT);
    setErrorMsg(null);
  };

  const handleUpdateQuestionText = (index: number, text: string) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], questionText: text };
      return next;
    });
  };

  const handleChangeQuestionType = (index: number, newType: QuestionType) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      const target = next[index];
      let defPts = defaultMcqPoints;
      let initialAns = "";

      if (newType === "boolean") {
        defPts = defaultTrueFalsePoints;
        initialAns = "true";
      } else if (newType === "fill_in_the_blank") {
        defPts = defaultFillBlankPoints;
        initialAns = target.modelAnswer || "";
      } else if (newType === "quote") {
        defPts = defaultQuotePoints;
        initialAns = target.modelAnswer || "";
      } else if (newType === "essay") {
        defPts = defaultEssayPoints;
        initialAns = target.modelAnswer || "";
      } else {
        defPts = defaultMcqPoints;
        initialAns = "";
      }

      next[index] = {
        ...target,
        type: newType,
        points: defPts,
        correctAnswer: initialAns,
      };
      return next;
    });
  };

  const handleUpdateOption = (qIndex: number, optIndex: number, val: string) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      const opts = [...next[qIndex].options] as [string, string, string, string];
      opts[optIndex] = val;
      next[qIndex] = { ...next[qIndex], options: opts };
      return next;
    });
  };

  const handleSetCorrectAnswer = (qIndex: number, answerVal: string) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      next[qIndex] = { 
        ...next[qIndex], 
        correctAnswer: answerVal,
        modelAnswer: (next[qIndex].type === "essay" || next[qIndex].type === "fill_in_the_blank" || next[qIndex].type === "quote")
          ? answerVal
          : next[qIndex].modelAnswer
      };
      return next;
    });
  };

  const handleRemoveDraft = (index: number) => {
    setParsedDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAutoFillAnswers = () => {
    setParsedDrafts((prev) =>
      prev.map((q) => {
        if (q.correctAnswer && q.correctAnswer.trim()) return q;
        if (q.type === "choice") return { ...q, correctAnswer: "0" };
        if (q.type === "boolean") return { ...q, correctAnswer: "true" };
        if (q.type === "essay") return { ...q, correctAnswer: "نموذج إجابة قياسي" };
        if (q.type === "fill_in_the_blank") return { ...q, correctAnswer: "كلمة الفراغ" };
        if (q.type === "quote") return { ...q, correctAnswer: "القائل المرجعي" };
        return q;
      })
    );
  };

  const handleFinalImport = () => {
    if (parsedDrafts.length === 0) {
      setErrorMsg("لا توجد أسئلة لإضافتها");
      return;
    }

    for (let i = 0; i < parsedDrafts.length; i++) {
      const q = parsedDrafts[i];
      if (!q.questionText.trim()) {
        setErrorMsg(`السؤال رقم ${i + 1} لا يحتوي على نص سؤال`);
        return;
      }
      if (q.type === "choice") {
        if (q.options.some((opt) => !opt.trim())) {
          setErrorMsg(`السؤال رقم ${i + 1} به خيارات فارغة. يرجى ملء الخيارات الأربعة.`);
          return;
        }
        // Delayed answer keys allowed: no error if no option is marked with asterisk
      }
    }

    const finalizedQuestions: QuizQuestion[] = parsedDrafts.map((q) => {
      let rubricPoints: string[] | undefined = undefined;
      const cleanAnswer = q.correctAnswer && q.correctAnswer.trim() ? q.correctAnswer.trim() : undefined;

      if (q.type === "essay" && cleanAnswer) {
        const lines = cleanAnswer
          .split(/[\r\n]+/)
          .map((l) => l.trim().replace(/^[\s*•\-–—✔▪▫]+/, "").replace(/^[\d٠-٩]+[\.\-\)\:]\s*/, "").trim())
          .filter(Boolean);
        if (lines.length > 1) {
          rubricPoints = lines;
        }
      }

      const modelAns = q.modelAnswer && q.modelAnswer.trim()
        ? q.modelAnswer.trim()
        : (q.type !== "choice" && q.type !== "boolean" ? cleanAnswer : undefined);

      return {
        id: q.id,
        type: q.type,
        questionText: q.questionText.trim(),
        options: q.type === "choice" ? [q.options[0].trim(), q.options[1].trim(), q.options[2].trim(), q.options[3].trim()] : [],
        correctAnswer: cleanAnswer,
        modelAnswer: modelAns,
        rubricPoints,
        points: q.points,
        isCustomPoints: false
      };
    });

    onImport(finalizedQuestions);
    onClose();
  };

  const optionLetters = ["أ", "ب", "ج", "د"];
  const totalCount = parsedDrafts.length;
  const answeredCount = parsedDrafts.filter((q) => Boolean(q.correctAnswer && q.correctAnswer.trim())).length;
  const missingCount = totalCount - answeredCount;
  const mcqCount = parsedDrafts.filter((q) => q.type === "choice").length;
  const trueFalseCount = parsedDrafts.filter((q) => q.type === "boolean").length;
  const essayCount = parsedDrafts.filter((q) => q.type === "essay").length;
  const fillBlankCount = parsedDrafts.filter((q) => q.type === "fill_in_the_blank").length;
  const quoteCount = parsedDrafts.filter((q) => q.type === "quote").length;
  const delayedMcqCount = parsedDrafts.filter((q) => q.type === "choice" && (!q.correctAnswer || !q.correctAnswer.trim())).length;

  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] w-screen h-screen flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-800 via-teal-700 to-natural-green text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-xs">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-base font-black flex items-center gap-2">
                مُستورد الأسئلة الذكي (Quiz Importer)
              </h3>
              <p className="text-[11px] text-white/80 font-medium">
                تحليل تلقائي للنصوص، رصد النجمة (*) للخيارات الصحيحة، واستخراج الأسئلة المقالية مع معاينة فورية
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Bar */}
        <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-2.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStep("input")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                step === "input"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              1. إدخال ولصق النص
            </button>
            <span className="text-slate-300 font-normal">←</span>
            <button
              type="button"
              onClick={() => {
                if (parsedDrafts.length > 0) setStep("preview");
                else handleParse();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                step === "preview"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              2. المعاينة والتحقق ({parsedDrafts.length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-bold flex-wrap">
            <span className="bg-white dark:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
              MCQ: <b className="text-emerald-600 dark:text-emerald-400">{defaultMcqPoints}</b>
            </span>
            <span className="bg-white dark:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
              صح/خطأ: <b className="text-teal-600 dark:text-teal-400">{defaultTrueFalsePoints}</b>
            </span>
            <span className="bg-white dark:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
              أكمل: <b className="text-indigo-600 dark:text-indigo-400">{defaultFillBlankPoints}</b>
            </span>
            <span className="bg-white dark:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
              من القائل: <b className="text-purple-600 dark:text-purple-400">{defaultQuotePoints}</b>
            </span>
            <span className="bg-white dark:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
              مقالي: <b className="text-amber-600 dark:text-amber-400">{defaultEssayPoints}</b>
            </span>
          </div>
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="mx-5 mt-3 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-400 hover:text-red-700 text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {step === "input" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-amber-500" />
                  الصق نص الأسئلة الكامل (يتم كشف الإجابات بواسطة النجمة * أو السطور التلخيصية تلقائياً):
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    تحميل نموذج اختبار كامل (20 سؤال)
                  </button>
                  {rawText && (
                    <button
                      type="button"
                      onClick={() => setRawText("")}
                      className="text-[11px] font-bold text-red-600 hover:text-red-700 px-2 py-1 transition-colors cursor-pointer"
                    >
                      مسح
                    </button>
                  )}
                </div>
              </div>

              <textarea
                rows={14}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`الصق الأسئلة هنا بالصيغة المرنة...

1. من هو كاتب الإنجيل الثاني؟
* أ) القديس مرقس
ب) القديس لوقا
ج) القديس متى
د) القديس يوحنا

2. ما هي المعجزة الشهيرة؟
أ) معجزة 1
ب) معجزة 2 *
ج) معجزة 3
د) معجزة 4

--- الأسئلة المقالية ---
3. ما هي إنجازات القديس مرقس في مصر؟
نموذج الإجابة: تأسيس الكنيسة وتكريس إنيانوس وتأسيس المدرسة اللاهوتية.`}
                className="w-full min-h-[340px] max-h-[56vh] overflow-y-auto text-xs p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 outline-hidden focus:border-emerald-500 font-mono leading-relaxed transition-colors resize-y"
              />

              <div className="bg-emerald-50/60 dark:bg-slate-800/60 border border-emerald-200 dark:border-slate-700 rounded-xl p-3.5 text-[11px] text-slate-700 dark:text-slate-300 space-y-2">
                <span className="font-black text-emerald-800 dark:text-emerald-400 block flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-amber-500" />
                  قواعد التحليل المتقدمة للكشف التلقائي:
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-600 dark:text-slate-400 font-semibold pr-1">
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold block mb-0.5">⭐ كشف الخيار الصحيح بـ (*):</span>
                    <p className="text-[10px] leading-relaxed">
                      ضع علامة النجمة <code className="bg-white dark:bg-slate-700 px-1 py-0.5 rounded border border-slate-300 dark:border-slate-600">* أ)</code> أو <code className="bg-white dark:bg-slate-700 px-1 py-0.5 rounded border border-slate-300 dark:border-slate-600">أ) الخيار *</code> لتحديد الخيار الصحيح آلياً.
                    </p>
                  </div>
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold block mb-0.5">✍️ استخراج الأسئلة المقالية:</span>
                    <p className="text-[10px] leading-relaxed">
                      الأسئلة بدون خيارات أو المتبوعة بـ <code className="bg-white dark:bg-slate-700 px-1 py-0.5 rounded border border-slate-300 dark:border-slate-600">نموذج الإجابة:</code> تُستخرج تلقائياً كـ Essay مع حفظ دليل التصحيح.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stats Bar */}
              <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600">
                    <Layers className="w-4 h-4" />
                    <span>إجمالي: {totalCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800">
                    <span>MCQ: {mcqCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 px-2 py-1 rounded-lg border border-teal-200 dark:border-teal-800">
                    <span>صح/خطأ: {trueFalseCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <span>أكمل: {fillBlankCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800">
                    <span>من القائل: {quoteCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-lg border border-amber-200 dark:border-amber-800">
                    <span>مقالي: {essayCount}</span>
                  </div>
                  {delayedMcqCount > 0 && (
                    <div className="flex items-center gap-1 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 px-2 py-1 rounded-lg border border-orange-200 dark:border-orange-800">
                      <span>مفتاح مؤجل: {delayedMcqCount}</span>
                    </div>
                  )}
                </div>

                {missingCount > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoFillAnswers}
                    className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-3 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    تعبئة افتراضية للمتبقي
                  </button>
                )}
              </div>

              {/* Questions Draft Preview Cards */}
              <div className="space-y-4 max-h-[52vh] overflow-y-auto pl-1">
                {parsedDrafts.map((q, qIdx) => {
                  const hasAnswer = Boolean(q.correctAnswer && q.correctAnswer.trim());
                  const isDelayedMcq = q.type === "choice" && !hasAnswer;
                  return (
                    <div
                      key={q.id}
                      className={`p-4 rounded-xl border transition-all ${
                        hasAnswer
                          ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                          : isDelayedMcq
                          ? "bg-blue-50/40 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                          : "bg-amber-50/40 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700"
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 mb-2 border-b border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-2.5 py-0.5 rounded-md">
                            سؤال {qIdx + 1} من {totalCount}
                          </span>

                          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[10px] font-bold flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "choice")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "choice"
                                  ? "bg-emerald-600 text-white"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              اختيار من متعدد
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "boolean")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "boolean"
                                  ? "bg-teal-600 text-white"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              صح أم خطأ
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "fill_in_the_blank")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "fill_in_the_blank"
                                  ? "bg-indigo-600 text-white"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              أكمل
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "quote")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "quote"
                                  ? "bg-purple-600 text-white"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              من القائل
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "essay")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "essay"
                                  ? "bg-amber-600 text-white"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              مقالي
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveDraft(qIdx)}
                          className="text-slate-400 hover:text-red-600 p-1 rounded-md transition-colors cursor-pointer"
                          title="حذف هذا السؤال"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="mb-3">
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">نص السؤال:</label>
                        <input
                          type="text"
                          value={q.questionText}
                          onChange={(e) => handleUpdateQuestionText(qIdx, e.target.value)}
                          className="w-full text-xs font-bold p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 outline-hidden"
                          placeholder="اكتب نص السؤال..."
                        />
                      </div>

                      {q.type === "choice" && (
                        <div>
                          <label className="block text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mb-1.5">
                            الاختيارات (انقر على أي خيار لتحديده كإجابة صحيحة 🎯):
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {q.options.map((optText, optIdx) => {
                              const isSelected = q.correctAnswer === String(optIdx);
                              return (
                                <div
                                  key={optIdx}
                                  onClick={() => handleSetCorrectAnswer(qIdx, String(optIdx))}
                                  className={`p-2 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${
                                    isSelected
                                      ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400 text-emerald-900 dark:text-emerald-200"
                                      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`correctAnswer_${q.id}`}
                                    checked={isSelected}
                                    onChange={() => handleSetCorrectAnswer(qIdx, String(optIdx))}
                                    className="w-4 h-4 text-emerald-600 accent-emerald-600 cursor-pointer shrink-0"
                                  />
                                  <span
                                    className={`w-6 h-6 rounded-lg text-xs font-black flex items-center justify-center shrink-0 ${
                                      isSelected
                                        ? "bg-emerald-600 text-white"
                                        : "bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                                    }`}
                                  >
                                    {optionLetters[optIdx]}
                                  </span>
                                  <input
                                    type="text"
                                    value={optText}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => handleUpdateOption(qIdx, optIdx, e.target.value)}
                                    className={`flex-1 text-xs p-1 rounded-md border outline-hidden font-semibold ${
                                      isSelected
                                        ? "bg-white dark:bg-slate-900 border-emerald-300 dark:border-emerald-700"
                                        : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                                    }`}
                                    placeholder={`الخيار (${optionLetters[optIdx]})`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {q.type === "boolean" && (
                        <div>
                          <label className="block text-[10px] font-bold text-teal-700 dark:text-teal-400 mb-1.5">
                            حدد الإجابة الصحيحة (صح أم خطأ):
                          </label>
                          <div className="grid grid-cols-2 gap-3 max-w-md">
                            <button
                              type="button"
                              onClick={() => handleSetCorrectAnswer(qIdx, "true")}
                              className={`p-3 rounded-xl border flex items-center justify-center gap-2 cursor-pointer font-black text-xs transition-all ${
                                q.correctAnswer === "true"
                                  ? "bg-emerald-600 text-white border-emerald-700"
                                  : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              صح (True) {q.correctAnswer === "true" && "✓"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetCorrectAnswer(qIdx, "false")}
                              className={`p-3 rounded-xl border flex items-center justify-center gap-2 cursor-pointer font-black text-xs transition-all ${
                                q.correctAnswer === "false"
                                  ? "bg-rose-600 text-white border-rose-700"
                                  : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              خطأ (False) {q.correctAnswer === "false" && "✓"}
                            </button>
                          </div>
                        </div>
                      )}

                      {q.type === "fill_in_the_blank" && (
                        <div>
                          <label className="block text-[10px] font-bold text-indigo-700 dark:text-indigo-400 mb-1">
                            نموذج الإجابة لإكمال الفراغ (دليل تصحيح المشرف - اختياري):
                          </label>
                          <input
                            type="text"
                            value={q.correctAnswer || ""}
                            onChange={(e) => handleSetCorrectAnswer(qIdx, e.target.value)}
                            placeholder="اكتب الكلمة أو العبارة المتوقعة لإكمال الفراغ..."
                            className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 outline-hidden font-semibold"
                          />
                        </div>
                      )}

                      {q.type === "quote" && (
                        <div>
                          <label className="block text-[10px] font-bold text-purple-700 dark:text-purple-400 mb-1">
                            نموذج إسناد القول والسياق (دليل تصحيح المشرف - اختياري):
                          </label>
                          <textarea
                            rows={2}
                            value={q.correctAnswer || ""}
                            onChange={(e) => handleSetCorrectAnswer(qIdx, e.target.value)}
                            placeholder="اكتب القائل ومناسبة أو سياق العبارة بالتفصيل..."
                            className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 outline-hidden font-medium"
                          />
                        </div>
                      )}

                      {q.type === "essay" && (
                        <div>
                          <label className="block text-[10px] font-bold text-amber-700 dark:text-amber-400 mb-1">
                            الإجابة النموذجية الصحيحة (دليل تصحيح المشرف):
                          </label>
                          <textarea
                            rows={2}
                            value={q.correctAnswer || ""}
                            onChange={(e) => handleSetCorrectAnswer(qIdx, e.target.value)}
                            placeholder="اكتب الإجابة النموذجية المرجعية بالتفصيل..."
                            className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 outline-hidden font-medium"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 shrink-0">
          {step === "input" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleParse}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                تحليل ومعاينة الأسئلة
                <ArrowLeft className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep("input")}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                رجوع لتعديل النص
              </button>
              <button
                type="button"
                onClick={handleFinalImport}
                disabled={totalCount === 0}
                className={`font-black py-2.5 px-6 rounded-xl text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer ${
                  totalCount > 0
                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Check className="w-4 h-4 stroke-[3]" />
                إدراج كافة الأسئلة في الاختبار ({totalCount} سؤال)
                {delayedMcqCount > 0 && (
                  <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-md font-bold">
                    (منها {delayedMcqCount} بمفتاح مؤجل)
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QuizImporter;
