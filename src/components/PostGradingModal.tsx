import React, { useState, useMemo } from "react";
import { 
  X, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Sparkles, 
  Loader2, 
  HelpCircle, 
  Layers, 
  ChevronDown,
  Check
} from "lucide-react";
import { Quiz, QuizQuestion, DatabaseState } from "../types";
import { ApiService } from "../services/api";

export interface PostGradingModalProps {
  isOpen: boolean;
  onClose: () => void;
  quiz: Quiz | null;
  quizzes?: Quiz[];
  onGraded: (updatedDb: DatabaseState, message: string) => void;
}

export const PostGradingModal: React.FC<PostGradingModalProps> = ({
  isOpen,
  onClose,
  quiz,
  quizzes = [],
  onGraded,
}) => {
  const [activeQuizId, setActiveQuizId] = useState<string>(quiz?.id || "");
  const [answerKey, setAnswerKey] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync activeQuizId if quiz prop changes
  React.useEffect(() => {
    if (quiz?.id) {
      setActiveQuizId(quiz.id);
      setAnswerKey({});
      setErrorMessage(null);
    }
  }, [quiz?.id]);

  const currentQuiz = useMemo(() => {
    if (!activeQuizId) return quiz;
    return quizzes.find((q) => q.id === activeQuizId) || quiz;
  }, [activeQuizId, quizzes, quiz]);

  // Identify un-keyed / zero-answer questions (MCQ or Boolean without defined correctAnswer)
  const unkeyedQuestions = useMemo(() => {
    if (!currentQuiz?.questions) return [];
    return currentQuiz.questions.filter((q) => {
      const isChoice = q.type === "choice" || (q.type as string) === "mcq";
      const isBoolean = q.type === "boolean" || (q.type as string) === "true_false";
      if (!isChoice && !isBoolean) return false;
      const hasKey =
        q.correctAnswer !== undefined &&
        q.correctAnswer !== null &&
        q.correctAnswer !== "" &&
        q.correctAnswer !== "-1";
      return !hasKey;
    });
  }, [currentQuiz]);

  const totalUnkeyed = unkeyedQuestions.length;
  const answeredCount = unkeyedQuestions.filter((q) => answerKey[q.id] !== undefined).length;
  const isComplete = totalUnkeyed > 0 && answeredCount === totalUnkeyed;

  const handleSelectOption = (questionId: string, optionIndex: number) => {
    setAnswerKey((prev) => ({
      ...prev,
      [questionId]: optionIndex,
    }));
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentQuiz) return;

    if (!isComplete) {
      setErrorMessage(`يرجى تحديد الإجابة الصحيحة لكافة الأسئلة المتبقية (${totalUnkeyed - answeredCount} أسئلة)`);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await ApiService.attachAnswerKeyAndGrade(currentQuiz.id, answerKey);
      if (res && res.db) {
        onGraded(res.db, res.message || "تم اعتماد نموذج الإجابة وتصحيح التسليمات بنجاح!");
        onClose();
      } else {
        throw new Error("استجابة غير متوقعة من الخادم");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء اعتماد نموذج الإجابة وتصحيح التسليمات";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !currentQuiz) return null;

  const optionLetters = ["أ", "ب", "ج", "د", "هـ", "و"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto"
      dir="rtl"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                إرفاق نموذج الإجابة والتصحيح التلقائي 📝
                <span className="text-[10px] bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 px-2 py-0.5 rounded-full font-bold">
                  Phase 6.2
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تحديد الإجابات النموذجية للأسئلة بدون مفتاح وإعادة تقييم كافة التسليمات المعلقة تلقائياً
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quiz Selector & Progress Overview */}
        <div className="px-5 py-3.5 bg-slate-100/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {quizzes.length > 1 ? (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-400 shrink-0">
                الاختبار:
              </label>
              <select
                value={activeQuizId}
                onChange={(e) => {
                  setActiveQuizId(e.target.value);
                  setAnswerKey({});
                  setErrorMessage(null);
                }}
                disabled={isSubmitting}
                className="text-xs font-bold p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-hidden focus:border-amber-500 w-full sm:w-64"
              >
                {quizzes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">الاختبار المحدد:</span>
              <span className="text-xs font-black text-slate-900 dark:text-white">
                {currentQuiz.title}
              </span>
            </div>
          )}

          {/* Progress Indicator */}
          <div className="flex items-center gap-2.5 self-end sm:self-auto">
            <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
              تم تحديد {answeredCount} من {totalUnkeyed}
            </span>
            <div className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  isComplete ? "bg-emerald-500" : "bg-amber-500"
                }`}
                style={{ width: `${totalUnkeyed > 0 ? (answeredCount / totalUnkeyed) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Modal Body / Questions List */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {totalUnkeyed === 0 ? (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">
                لا توجد أسئلة اختيارية بدون إجابة في هذا الاختبار!
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                جميع أسئلة الاختيار من متعدد والصواب والخطأ تحتوي على مفاتيح إجابات معتمدة مسبقاً.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {unkeyedQuestions.map((q, idx) => {
                const isChoice = q.type === "choice" || (q.type as string) === "mcq";
                const isBoolean = q.type === "boolean" || (q.type as string) === "true_false";
                const selectedOption = answerKey[q.id];
                const hasSelected = selectedOption !== undefined;

                return (
                  <div
                    key={q.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      hasSelected
                        ? "bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-300 dark:border-emerald-800/60"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    {/* Question Header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-2.5">
                        <span className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div>
                          <h4 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white leading-relaxed">
                            {q.questionText}
                          </h4>
                          <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {isChoice ? "اختيار من متعدد" : "صح أم خطأ"} • {q.points} نقطة
                          </span>
                        </div>
                      </div>

                      {hasSelected ? (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1 shrink-0">
                          <Check className="w-3 h-3" />
                          تم التحديد
                        </span>
                      ) : (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0">
                          بانتظار الإجابة ⚠️
                        </span>
                      )}
                    </div>

                    {/* Options selection for MCQ */}
                    {isChoice && q.options && q.options.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                        {q.options.map((option, optIdx) => {
                          const isChosen = selectedOption === optIdx;
                          const letter = optionLetters[optIdx] || String(optIdx + 1);

                          return (
                            <button
                              key={optIdx}
                              type="button"
                              onClick={() => handleSelectOption(q.id, optIdx)}
                              disabled={isSubmitting}
                              className={`p-2.5 rounded-xl border text-right transition-all flex items-center justify-between gap-2.5 cursor-pointer ${
                                isChosen
                                  ? "bg-emerald-600 text-white border-emerald-700 shadow-sm"
                                  : "bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-5 h-5 rounded-md font-bold text-[11px] flex items-center justify-center shrink-0 ${
                                    isChosen
                                      ? "bg-emerald-800 text-white"
                                      : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  {letter}
                                </span>
                                <span className="text-xs font-bold leading-snug">{option}</span>
                              </div>
                              {isChosen && <Check className="w-4 h-4 text-white shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Options selection for Boolean (True / False) */}
                    {isBoolean && (
                      <div className="grid grid-cols-2 gap-3 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 max-w-md">
                        <button
                          type="button"
                          onClick={() => handleSelectOption(q.id, 0)}
                          disabled={isSubmitting}
                          className={`p-3 rounded-xl border text-center font-black text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
                            selectedOption === 0
                              ? "bg-emerald-600 text-white border-emerald-700 shadow-sm"
                              : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                          }`}
                        >
                          <span>صح (True)</span>
                          {selectedOption === 0 && <Check className="w-4 h-4" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSelectOption(q.id, 1)}
                          disabled={isSubmitting}
                          className={`p-3 rounded-xl border text-center font-black text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
                            selectedOption === 1
                              ? "bg-rose-600 text-white border-rose-700 shadow-sm"
                              : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                          }`}
                        >
                          <span>خطأ (False)</span>
                          {selectedOption === 1 && <Check className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400 text-center sm:text-right">
            <span>عند الحفظ، سيتم تحديث درجات كافة الطلاب الحاصلين على حالة </span>
            <b className="text-amber-600 dark:text-amber-400">pending_auto_grade</b>
            <span> فوراً في قاعدة البيانات.</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer w-full sm:w-auto"
            >
              إلغاء
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !isComplete || totalUnkeyed === 0}
              className={`px-5 py-2.5 rounded-xl text-white font-black text-xs flex items-center justify-center gap-2 transition-all shadow-md w-full sm:w-auto cursor-pointer ${
                isComplete && !isSubmitting
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-slate-400 dark:bg-slate-700 opacity-60 cursor-not-allowed"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جارٍ التصحيح التلقائي وتحديث الدرجات...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                  <span>اعتماد نموذج الإجابة وتصحيح التسليمات 🚀</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostGradingModal;
