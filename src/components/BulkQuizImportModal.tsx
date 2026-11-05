import React, { useState } from "react";
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
  Layers,
  HelpCircle as QuestionMarkIcon,
  ToggleLeft,
  FileCheck
} from "lucide-react";
import { 
  parseBulkQuizText, 
  ParsedQuestionDraft, 
  SAMPLE_ARABIC_QUIZ_TEXT 
} from "../lib/quizParser";
import { QuizQuestion } from "../types";

interface BulkQuizImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (questions: QuizQuestion[]) => void;
  defaultMcqPoints: number;
  defaultTrueFalsePoints?: number;
  defaultEssayPoints?: number;
}

export const BulkQuizImportModal: React.FC<BulkQuizImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  defaultMcqPoints,
  defaultTrueFalsePoints = 1,
  defaultEssayPoints = 5,
}) => {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [rawText, setRawText] = useState<string>("");
  const [parsedDrafts, setParsedDrafts] = useState<ParsedQuestionDraft[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Handle parsing the raw text
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
      defaultEssayPoints
    );

    if (result.questions.length === 0) {
      setErrorMsg("لم نتمكن من استخراج أي سؤال صالح. يرجى التأكد من تنسيق الأسئلة وخياراتها.");
      return;
    }

    setParsedDrafts(result.questions);
    setStep("preview");
  };

  // Load sample 20-questions template
  const handleLoadSample = () => {
    setRawText(SAMPLE_ARABIC_QUIZ_TEXT);
    setErrorMsg(null);
  };

  // Update question text in preview
  const handleUpdateQuestionText = (index: number, text: string) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], questionText: text };
      return next;
    });
  };

  // Switch question type (choice | boolean | essay)
  const handleChangeQuestionType = (index: number, newType: "choice" | "boolean" | "essay") => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      const target = next[index];
      let defPts = defaultMcqPoints;
      let initialAns = "";

      if (newType === "boolean") {
        defPts = defaultTrueFalsePoints;
        initialAns = "true";
      } else if (newType === "essay") {
        defPts = defaultEssayPoints;
        initialAns = target.modelAnswer || "";
      } else {
        defPts = defaultMcqPoints;
        initialAns = "0";
      }

      next[index] = {
        ...target,
        type: newType,
        points: defPts,
        correctAnswer: initialAns
      };
      return next;
    });
  };

  // Update specific option text for MCQ
  const handleUpdateOption = (qIndex: number, optIndex: number, val: string) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      const opts = [...next[qIndex].options] as [string, string, string, string];
      opts[optIndex] = val;
      next[qIndex] = { ...next[qIndex], options: opts };
      return next;
    });
  };

  // Set correct answer (MCQ or Boolean or Essay model answer)
  const handleSetCorrectAnswer = (qIndex: number, answerVal: string) => {
    setParsedDrafts((prev) => {
      const next = [...prev];
      next[qIndex] = { 
        ...next[qIndex], 
        correctAnswer: answerVal,
        modelAnswer: next[qIndex].type === "essay" ? answerVal : next[qIndex].modelAnswer
      };
      return next;
    });
  };

  // Remove question draft
  const handleRemoveDraft = (index: number) => {
    setParsedDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  // Auto-fill unanswered questions with defaults
  const handleAutoFillAnswers = () => {
    setParsedDrafts((prev) =>
      prev.map((q) => {
        if (q.correctAnswer.trim()) return q;
        if (q.type === "choice") return { ...q, correctAnswer: "0" };
        if (q.type === "boolean") return { ...q, correctAnswer: "true" };
        if (q.type === "essay") return { ...q, correctAnswer: "نموذج إجابة قياسي" };
        return q;
      })
    );
  };

  // Final insertion of parsed questions into quiz
  const handleFinalImport = () => {
    if (parsedDrafts.length === 0) {
      setErrorMsg("لا توجد أسئلة لإضافتها");
      return;
    }

    // Verify all questions have complete text and correct answers
    for (let i = 0; i < parsedDrafts.length; i++) {
      const q = parsedDrafts[i];
      if (!q.questionText.trim()) {
        setErrorMsg(`السؤال رقم ${i + 1} لا يحتوي على نص سؤال`);
        return;
      }
      if (!q.correctAnswer.trim()) {
        setErrorMsg(`يرجى تحديد الإجابة الصحيحة أو النموذجية للسؤال رقم ${i + 1}`);
        return;
      }
      if (q.type === "choice") {
        if (q.options.some((opt) => !opt.trim())) {
          setErrorMsg(`السؤال رقم ${i + 1} به خيارات فارغة. يرجى ملء الخيارات الأربعة.`);
          return;
        }
      }
    }

    const finalizedQuestions: QuizQuestion[] = parsedDrafts.map((q) => {
      let rubricPoints: string[] | undefined = undefined;
      if (q.type === "essay") {
        const lines = q.correctAnswer
          .split(/[\r\n]+/)
          .map(l => l.trim().replace(/^[\s*•\-–—✔▪▫]+/, "").replace(/^[\d٠-٩]+[\.\-\)\:]\s*/, "").trim())
          .filter(Boolean);
        if (lines.length > 1) {
          rubricPoints = lines;
        }
      }

      return {
        id: q.id,
        type: q.type,
        questionText: q.questionText.trim(),
        options: q.type === "choice" ? [q.options[0].trim(), q.options[1].trim(), q.options[2].trim(), q.options[3].trim()] : [],
        correctAnswer: q.correctAnswer.trim(),
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
  const answeredCount = parsedDrafts.filter((q) => Boolean(q.correctAnswer.trim())).length;
  const missingCount = totalCount - answeredCount;
  const mcqCount = parsedDrafts.filter((q) => q.type === "choice").length;
  const trueFalseCount = parsedDrafts.filter((q) => q.type === "boolean").length;
  const essayCount = parsedDrafts.filter((q) => q.type === "essay").length;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
      dir="rtl"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-natural-border w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-natural-green to-natural-olive text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-xs">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-base font-black flex items-center gap-2">
                استيراد أسئلة بنص كامل (المحلل الشامل)
              </h3>
              <p className="text-[11px] text-white/80 font-medium">
                استيراد غير محدود لأسئلة الاختيار من متعدد، وصح/خطأ، والمقالي مع كشف الإجابات آلياً
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

        {/* Step Navigation Bar */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-natural-border flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-2.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStep("input")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                step === "input"
                  ? "bg-natural-green text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-200/70"
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
                  ? "bg-natural-green text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              2. المعاينة والتحقق ({parsedDrafts.length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-bold text-natural-muted">
            <span className="bg-white px-2 py-0.5 rounded border border-natural-border">
              MCQ: <b className="text-natural-green">{defaultMcqPoints}</b>
            </span>
            <span className="bg-white px-2 py-0.5 rounded border border-natural-border">
              صح/خطأ: <b className="text-natural-olive">{defaultTrueFalsePoints}</b>
            </span>
            <span className="bg-white px-2 py-0.5 rounded border border-natural-border">
              مقالي: <b className="text-natural-accent">{defaultEssayPoints}</b>
            </span>
          </div>
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="mx-5 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold flex items-center justify-between gap-2 shrink-0 animate-in fade-in">
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
            /* STEP 1: Text Area Input (No Length Limit, Full Vertical Scroll) */
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-black text-natural-green flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-natural-accent" />
                  الصق نص الأسئلة الكامل (يدعم 20+ سؤال دفعة واحدة وبدون حد للحروف):
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    className="text-[11px] font-bold text-natural-green hover:text-natural-olive bg-natural-green/10 hover:bg-natural-green/15 px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-natural-accent" />
                    تحميل نموذج شامل (20 سؤال: اختيارات، صح وخطأ، ومقالي)
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

              {/* Textarea without any maxLength constraint */}
              <textarea
                rows={14}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`--- الصق الأسئلة هنا بالتنسيق المرن ---

1. من هو كاتب الإنجيل الثاني في العهد الجديد؟
* أ) القديس مرقس الرسول
ب) القديس لوقا
ج) القديس متى
د) القديس يوحنا

2- أين أسس القديس مرقس أول كرسي رسولي في مصر؟
أ) القاهرة
ب) الإسكندرية
ج) بابلون
د) طيبة
الإجابة الصحيحة: ب

--- أسئلة الصواب والخطأ ---
3. ولد القديس مرقس في القيروان بليبيا.
* أ) صح
ب) خطأ

--- الأسئلة المقالية ---
4. ما هي أهم إنجازات مارمرقس في مصر؟
نموذج الإجابة: تأسيس الكنيسة وتكريس إنيانوس أسقفاً وتأسيس مدرسة الإسكندرية اللاهوتية.`}
                className="w-full min-h-[360px] max-h-[58vh] overflow-y-auto text-xs p-3.5 rounded-xl border border-natural-border bg-slate-50 focus:bg-white outline-hidden focus:border-natural-green font-mono leading-relaxed transition-colors resize-y"
              />

              {/* Supported Formats Card */}
              <div className="bg-natural-cream/35 border border-natural-border/70 rounded-xl p-3.5 text-[11px] text-slate-700 space-y-2">
                <span className="font-black text-natural-green block flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-natural-accent" />
                  القدرات المدعومة في المحلل التلقائي:
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-600 font-semibold pr-1">
                  <div>
                    <span className="text-natural-green font-bold block mb-0.5">📌 الترقيم وفواصل الأقسام:</span>
                    <p className="text-[10px] leading-relaxed">
                      يتجاهل الفواصل الزخرفية مثل <code className="bg-white px-1 py-0.5 rounded border border-slate-200">--- قسم كذا ---</code> تلقائياً، ويدعم <code className="bg-white px-1 py-0.5 rounded border border-slate-200">1.</code> أو <code className="bg-white px-1 py-0.5 rounded border border-slate-200">1-</code> أو <code className="bg-white px-1 py-0.5 rounded border border-slate-200">س1:</code> والأرقام المشرقية (<code className="bg-white px-1 py-0.5 rounded border border-slate-200">١، ٢</code>).
                    </p>
                  </div>
                  <div>
                    <span className="text-natural-green font-bold block mb-0.5">🎯 التعرف التلقائي على الإجابة:</span>
                    <p className="text-[10px] leading-relaxed">
                      سطر صريح (<code className="bg-white px-1 py-0.5 rounded border border-slate-200">الإجابة الصحيحة: ب</code> أو <code className="bg-white px-1 py-0.5 rounded border border-slate-200">الجواب: ب</code>) أو نجمة مضمنة (<code className="bg-white px-1 py-0.5 rounded border border-slate-200">* أ) النص</code> أو <code className="bg-white px-1 py-0.5 rounded border border-slate-200">أ) النص *</code>) أو مؤشر صح (<code className="bg-white px-1 py-0.5 rounded border border-slate-200">(صح)</code>).
                    </p>
                  </div>
                  <div>
                    <span className="text-natural-green font-bold block mb-0.5">⚡ تصنيف نوع السؤال آلياً:</span>
                    <p className="text-[10px] leading-relaxed">
                      يصنف أسئلة 4 اختيارات إلى MCQ، وأسئلة (صح/خطأ) إلى boolean، والأسئلة المتبوعة بـ <code className="bg-white px-1 py-0.5 rounded border border-slate-200">نموذج الإجابة:</code> إلى أسئلة مقالية.
                    </p>
                  </div>
                  <div>
                    <span className="text-natural-green font-bold block mb-0.5">🚀 سعة غير محدودة:</span>
                    <p className="text-[10px] leading-relaxed">
                      لا توجد قيود على عدد الحروف أو عدد الأسئلة (استيراد 20+ سؤال دفعة واحدة بكل أمان).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* STEP 2: Preview & Verification */
            <div className="space-y-4">
              {/* Stats Bar */}
              <div className="bg-slate-50 border border-natural-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-natural-green bg-white px-2.5 py-1 rounded-lg border border-natural-border">
                    <Layers className="w-4 h-4" />
                    <span>إجمالي الأسئلة: {totalCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-blue-700 bg-blue-50 px-2 py-1 rounded-lg border border-blue-200">
                    <span>اختيار من متعدد: {mcqCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-olive-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                    <span>صح/خطأ: {trueFalseCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                    <span>مقالي: {essayCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-600 font-extrabold mr-1">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{answeredCount} إجابة محددة</span>
                  </div>
                  {missingCount > 0 && (
                    <div className="flex items-center gap-1.5 text-amber-600 font-extrabold">
                      <AlertCircle className="w-4 h-4" />
                      <span>{missingCount} بانتظار التحديد</span>
                    </div>
                  )}
                </div>

                {missingCount > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoFillAnswers}
                    className="text-[11px] font-bold text-natural-green hover:text-natural-olive bg-white border border-natural-border px-3 py-1 rounded-lg transition-colors shadow-2xs cursor-pointer"
                  >
                    تعبئة افتراضية للمتبقي
                  </button>
                )}
              </div>

              {/* Questions Preview Cards */}
              <div className="space-y-4 max-h-[52vh] overflow-y-auto pl-1">
                {parsedDrafts.map((q, qIdx) => {
                  const hasAnswer = Boolean(q.correctAnswer.trim());
                  return (
                    <div
                      key={q.id}
                      className={`p-4 rounded-xl border transition-all ${
                        hasAnswer
                          ? "bg-white border-natural-border shadow-xs"
                          : "bg-amber-50/40 border-amber-300 ring-1 ring-amber-300/40"
                      }`}
                    >
                      {/* Question Card Header */}
                      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 mb-2 border-b border-natural-border/60">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-black bg-natural-green/10 text-natural-green px-2.5 py-0.5 rounded-md">
                            سؤال {qIdx + 1} من {totalCount}
                          </span>

                          {/* Question Type Switcher */}
                          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-bold">
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "choice")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "choice"
                                  ? "bg-natural-green text-white shadow-2xs"
                                  : "text-slate-600 hover:text-slate-900"
                              }`}
                            >
                              اختيار من متعدد
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "boolean")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "boolean"
                                  ? "bg-natural-olive text-white shadow-2xs"
                                  : "text-slate-600 hover:text-slate-900"
                              }`}
                            >
                              صح أم خطأ
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeQuestionType(qIdx, "essay")}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                q.type === "essay"
                                  ? "bg-natural-accent text-white shadow-2xs"
                                  : "text-slate-600 hover:text-slate-900"
                              }`}
                            >
                              مقالي
                            </button>
                          </div>

                          <span className="text-[10px] font-black text-natural-muted bg-slate-100 px-2 py-0.5 rounded-md">
                            {q.points} نقاط
                          </span>

                          {!hasAnswer && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              يرجى تحديد الإجابة
                            </span>
                          )}
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

                      {/* Question Text */}
                      <div className="mb-3">
                        <label className="block text-[10px] font-bold text-natural-muted mb-1">نص السؤال:</label>
                        <input
                          type="text"
                          value={q.questionText}
                          onChange={(e) => handleUpdateQuestionText(qIdx, e.target.value)}
                          className="w-full text-xs font-bold p-2 rounded-lg border border-natural-border bg-slate-50 focus:bg-white focus:border-natural-green outline-hidden"
                          placeholder="اكتب نص السؤال..."
                        />
                      </div>

                      {/* TYPE 1: Multiple Choice Options with 1-Click Selection */}
                      {q.type === "choice" && (
                        <div>
                          <label className="block text-[10px] font-bold text-natural-green mb-1.5">
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
                                      ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/20 text-emerald-900 shadow-2xs"
                                      : "bg-slate-50 border-natural-border hover:bg-slate-100/80 text-slate-800"
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
                                        : "bg-natural-cream border border-natural-border text-natural-green"
                                    }`}
                                  >
                                    {optionLetters[optIdx]}
                                  </span>
                                  <input
                                    type="text"
                                    value={optText}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => handleUpdateOption(qIdx, optIdx, e.target.value)}
                                    className={`flex-1 text-xs p-1 rounded-md border outline-hidden font-semibold transition-colors ${
                                      isSelected
                                        ? "bg-white border-emerald-300 focus:border-emerald-500"
                                        : "bg-white border-natural-border focus:border-natural-green"
                                    }`}
                                    placeholder={`الخيار (${optionLetters[optIdx]})`}
                                  />
                                  {isSelected && (
                                    <span className="text-[10px] font-black text-emerald-600 shrink-0">
                                      صحيحة ✓
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* TYPE 2: True / False Selection */}
                      {q.type === "boolean" && (
                        <div>
                          <label className="block text-[10px] font-bold text-natural-olive mb-1.5">
                            حدد الإجابة الصحيحة (صح أم خطأ):
                          </label>
                          <div className="grid grid-cols-2 gap-3 max-w-md">
                            <button
                              type="button"
                              onClick={() => handleSetCorrectAnswer(qIdx, "true")}
                              className={`p-3 rounded-xl border flex items-center justify-center gap-2 cursor-pointer font-black text-xs transition-all ${
                                q.correctAnswer === "true"
                                  ? "bg-emerald-500 text-white border-emerald-600 shadow-xs"
                                  : "bg-slate-50 border-natural-border text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              صح (True) {q.correctAnswer === "true" && "✓"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetCorrectAnswer(qIdx, "false")}
                              className={`p-3 rounded-xl border flex items-center justify-center gap-2 cursor-pointer font-black text-xs transition-all ${
                                q.correctAnswer === "false"
                                  ? "bg-rose-500 text-white border-rose-600 shadow-xs"
                                  : "bg-slate-50 border-natural-border text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <X className="w-4 h-4" />
                              خطأ (False) {q.correctAnswer === "false" && "✓"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* TYPE 3: Essay Model Answer */}
                      {q.type === "essay" && (
                        <div>
                          <label className="block text-[10px] font-bold text-natural-accent mb-1">
                            الإجابة النموذجية الصحيحة (للمراجعة والتقييم الذكي):
                          </label>
                          <textarea
                            rows={2}
                            value={q.correctAnswer}
                            onChange={(e) => handleSetCorrectAnswer(qIdx, e.target.value)}
                            placeholder="اكتب الإجابة النموذجية المرجعية بالتفصيل..."
                            className="w-full text-xs p-2 rounded-lg border border-natural-border bg-slate-50 focus:bg-white focus:border-natural-green outline-hidden font-medium"
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

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-natural-border flex items-center justify-between gap-3 shrink-0">
          {step === "input" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-natural-border text-slate-600 hover:bg-slate-200/60 font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleParse}
                className="bg-natural-green hover:bg-natural-olive text-white font-bold py-2.5 px-5 rounded-xl text-xs flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
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
                className="px-4 py-2.5 rounded-xl border border-natural-border text-slate-600 hover:bg-slate-200/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                رجوع لتعديل النص
              </button>
              <button
                type="button"
                onClick={handleFinalImport}
                disabled={totalCount === 0 || missingCount > 0}
                className={`font-black py-2.5 px-6 rounded-xl text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer ${
                  totalCount > 0 && missingCount === 0
                    ? "bg-natural-accent hover:bg-orange-600 text-white"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Check className="w-4 h-4 stroke-[3]" />
                إدراج كافة الأسئلة في الاختبار ({totalCount} سؤال)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
