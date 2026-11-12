import React, { useState, useEffect } from "react";
import { X, CheckCircle2, AlertCircle, BookOpen, UserCheck, Sparkles, Loader2, Award, HelpCircle } from "lucide-react";
import { QuizSubmission, Quiz, DatabaseState } from "../types";
import { ApiService } from "../services/api";

interface ManualReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: QuizSubmission | null;
  quiz: Quiz | null;
  participantName: string;
  onGraded: (updatedDb: DatabaseState) => void;
}

export const ManualReviewModal: React.FC<ManualReviewModalProps> = ({
  isOpen,
  onClose,
  submission,
  quiz,
  participantName,
  onGraded,
}) => {
  const [grades, setGrades] = useState<Record<string, { score: number; feedback: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (submission && quiz) {
      const initial: Record<string, { score: number; feedback: string }> = {};
      const manualQuestions = (quiz.questions || []).filter(
        (q) => q.type === "essay" || q.type === "fill_in_the_blank" || q.type === "quote"
      );

      manualQuestions.forEach((q) => {
        const existingResult = submission.questionResults?.[q.id];
        const existingEssayGrade = submission.essayGrades?.[q.id];

        const score = existingEssayGrade
          ? existingEssayGrade.score
          : existingResult
          ? existingResult.pointsEarned ?? 0
          : 0;

        const feedback = existingEssayGrade
          ? existingEssayGrade.gradingReasoning
          : existingResult?.feedback || "";

        initial[q.id] = {
          score: Math.min(q.points, Math.max(0, score)),
          feedback: feedback || "تمت المراجعة والتصحيح اليدوي من قبل المشرف.",
        };
      });

      setGrades(initial);
      setErrorMsg(null);
    }
  }, [submission, quiz]);

  if (!isOpen || !submission || !quiz) return null;

  const essayQuestions = (quiz.questions || []).filter(
    (q) => q.type === "essay" || q.type === "fill_in_the_blank" || q.type === "quote"
  );

  const handleScoreChange = (questionId: string, maxPoints: number, val: number) => {
    const boundedScore = Math.max(0, Math.min(maxPoints, isNaN(val) ? 0 : val));
    setGrades((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        score: boundedScore,
      },
    }));
  };

  const handleFeedbackChange = (questionId: string, val: string) => {
    setGrades((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        feedback: val,
      },
    }));
  };

  const handleSubmitGrades = async () => {
    if (!submission) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    const questionGradesPayload: Record<string, { pointsEarned: number; feedback: string }> = {};

    for (const q of essayQuestions) {
      const g = grades[q.id];
      questionGradesPayload[q.id] = {
        pointsEarned: g ? g.score : 0,
        feedback: g?.feedback || "تم التصحيح والتقييم بنجاح.",
      };
    }

    try {
      const res = await ApiService.gradeEssay(submission.id, questionGradesPayload);
      onGraded(res.db);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ أثناء حفظ نتائج التصحيح اليدوي");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
      dir="rtl"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-700 via-teal-700 to-natural-green text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-xs shrink-0">
              <Award className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-base font-black flex items-center gap-2">
                مراجعة وتصحيح الأسئلة المقالية واليدوية
              </h3>
              <p className="text-xs text-white/80 font-medium">
                المشارك: <span className="font-bold underline text-amber-200">{participantName}</span> • الاختبار: {quiz.title}
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

        {/* Status Bar */}
        <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-natural-muted dark:text-slate-400">حالة التسليم:</span>
            <span
              className={`px-2.5 py-0.5 rounded-full font-black text-[11px] ${
                submission.status === "pending_manual_review"
                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                  : "bg-emerald-100 text-emerald-800 border border-emerald-300"
              }`}
            >
              {submission.status === "pending_manual_review" ? "⏳ بانتظار التصحيح اليدوي" : "✓ تم التصحيح والاعتماد"}
            </span>
          </div>

          <div className="flex items-center gap-3 font-bold text-[11px]">
            <span className="bg-white dark:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600">
              أسئلة المراجعة اليدوية: <b className="text-emerald-600 dark:text-emerald-400">{essayQuestions.length}</b>
            </span>
            <span className="bg-white dark:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600">
              تاريخ التسليم: <b>{new Date(submission.submittedAt).toLocaleDateString("ar-EG")}</b>
            </span>
          </div>
        </div>

        {/* Error notification */}
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

        {/* Body content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-6">
          {essayQuestions.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-bold text-xs">
              لا توجد أسئلة تتطلب مراجعة يدوية في هذا الاختبار.
            </div>
          ) : (
            essayQuestions.map((q, idx) => {
              const studentAns = submission.answers?.[q.id] || "لم يقدم إجابة";
              const currentGrade = grades[q.id] || { score: 0, feedback: "" };

              return (
                <div
                  key={q.id}
                  className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-700 space-y-4"
                >
                  {/* Question header */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-extrabold flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white text-xs flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      {q.questionText}
                    </h4>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 border border-teal-200 dark:border-teal-800">
                        {q.type === "quote" ? "📜 من القائل" : q.type === "fill_in_the_blank" ? "✏️ أكمل الفراغ" : "📝 سؤال مقالي"}
                      </span>
                      <span className="text-xs font-black bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 px-3 py-1 rounded-lg border border-amber-300 dark:border-amber-700">
                        الدرجة القصوى: {q.points} نقاط
                      </span>
                    </div>
                  </div>

                  {/* Side-by-side Answer & Model Guide Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Student Response */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 space-y-2 shadow-2xs">
                      <span className="text-xs font-black text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                        <UserCheck className="w-4 h-4" />
                        إجابة المشارك:
                      </span>
                      <p className="text-xs leading-relaxed font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800/80 p-3 rounded-lg border border-slate-200 dark:border-slate-700 min-h-[90px]">
                        {studentAns}
                      </p>
                    </div>

                    {/* Admin Model Answer / Grading Key */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 space-y-2 shadow-2xs">
                      <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <BookOpen className="w-4 h-4" />
                        نموذج الإجابة المرجعي (دليل التصحيح):
                      </span>
                      <p className="text-xs leading-relaxed font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap bg-emerald-50/50 dark:bg-emerald-950/30 p-3 rounded-lg border border-emerald-200/60 dark:border-emerald-800/50 min-h-[90px]">
                        {q.modelAnswer || q.correctAnswer || "لا يوجد نموذج إجابة مرجعي مسجل لهذا السؤال."}
                      </p>
                    </div>
                  </div>

                  {/* Numeric Score Input & Feedback */}
                  <div className="pt-2 grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="md:col-span-4 space-y-1">
                      <label className="block text-xs font-black text-slate-700 dark:text-slate-300">
                        الدرجة المستحقة (من 0 إلى {q.points}):
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={q.points}
                          step={0.5}
                          value={currentGrade.score}
                          onChange={(e) => handleScoreChange(q.id, q.points, parseFloat(e.target.value))}
                          className="w-28 text-center font-black text-sm p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 focus:bg-white focus:border-emerald-500 outline-hidden"
                        />
                        <span className="text-xs font-bold text-slate-500">من {q.points}</span>
                      </div>
                    </div>

                    <div className="md:col-span-8 space-y-1">
                      <label className="block text-xs font-black text-slate-700 dark:text-slate-300">
                        ملاحظات وتغذية راجعة للمشارك (اختر اختياري):
                      </label>
                      <input
                        type="text"
                        value={currentGrade.feedback}
                        onChange={(e) => handleFeedbackChange(q.id, e.target.value)}
                        placeholder="اكتب تعليقك أو إرشاداتك للمشارك..."
                        className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 focus:bg-white focus:border-emerald-500 outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold text-xs transition-colors cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmitGrades}
            disabled={isSubmitting || essayQuestions.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black py-2.5 px-6 rounded-xl text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري الحفظ والمزامنة...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                اعتماد وحفظ التصحيح اليدوي
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualReviewModal;
