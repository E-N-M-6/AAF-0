import React, { useState, useEffect } from "react";
import { 
  RotateCw, 
  Filter, 
  Search, 
  Award, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Plus, 
  Sparkles, 
  BookOpen, 
  UserCheck, 
  ChevronLeft,
  ChevronRight,
  Layers,
  HelpCircle,
  ShieldAlert,
  ShieldCheck,
  Lock,
  EyeOff,
  Maximize2,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { DatabaseState, QuizSubmission, Quiz, User, QuizViolationRecord, AdminSecurityLogItem } from "../types";
import { ApiService } from "../services/api";
import { ManualReviewModal } from "./ManualReviewModal";
import { QuizImporter } from "./QuizImporter";

interface AdminDashboardProps {
  state: DatabaseState;
  onUpdateState: (newState: DatabaseState) => void;
  onRefreshData?: () => void;
  isLoading?: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  state,
  onUpdateState,
  onRefreshData,
  isLoading = false,
}) => {
  const [activeMainTab, setActiveMainTab] = useState<"submissions" | "security_logs">("submissions");
  const [filterTab, setFilterTab] = useState<"all" | "pending_review" | "graded">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [logTypeFilter, setLogTypeFilter] = useState<string>("all");
  const [selectedSubmissionForReview, setSelectedSubmissionForReview] = useState<QuizSubmission | null>(null);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [securityLogs, setSecurityLogs] = useState<AdminSecurityLogItem[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);

  const submissions = state?.quizSubmissions || [];
  const quizzes = state?.quizzes || [];
  const users = state?.users || [];
  const violationsFromState = state?.quizViolations || [];

  const getUserName = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    return user ? user.name : "مشارك غير معروف";
  };

  const getQuiz = (quizId: string) => {
    return quizzes.find((q) => q.id === quizId) || null;
  };

  // Fetch security audit logs from backend API
  const fetchSecurityLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const data = await ApiService.getSecurityLogs();
      if (data && data.success && Array.isArray(data.logs)) {
        setSecurityLogs(data.logs);
      }
    } catch (err) {
      console.warn("تعذر إحضار سجل الأمان عبر الـ API، سيتم الاعتماد على بيانات الحالة المحلية:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeMainTab === "security_logs") {
      fetchSecurityLogs();
    }
  }, [activeMainTab]);

  // Build full combined list of security log items from local state + fetched logs
  const combinedSecurityLogs: AdminSecurityLogItem[] = React.useMemo(() => {
    const itemsMap = new Map<string, AdminSecurityLogItem>();

    // 1. Logs fetched from backend API
    securityLogs.forEach((l) => itemsMap.set(l.id, l));

    // 2. Local state violations fallback
    violationsFromState.forEach((v) => {
      const id = v.id || `local_viol_${v.quizId}_${v.userId}_${v.timestamp}`;
      if (!itemsMap.has(id)) {
        itemsMap.set(id, {
          id,
          userId: v.userId,
          userName: getUserName(v.userId),
          quizId: v.quizId,
          quizTitle: getQuiz(v.quizId)?.title || "اختبار محذوف",
          timestamp: v.timestamp,
          leaveDuration: v.leaveDuration || 0,
          reason: v.reason || "مغادرة شاشة الاختبار",
          type: v.type || "visibility_hidden",
          details: v.details || v.reason,
        });
      }
    });

    // 3. Embedded violations inside submissions
    submissions.forEach((sub) => {
      if (sub.violations && Array.isArray(sub.violations)) {
        sub.violations.forEach((v) => {
          const id = v.id || `sub_viol_${sub.id}_${v.timestamp}`;
          if (!itemsMap.has(id)) {
            itemsMap.set(id, {
              id,
              userId: sub.userId,
              userName: getUserName(sub.userId),
              quizId: sub.quizId,
              quizTitle: getQuiz(sub.quizId)?.title || "اختبار محذوف",
              timestamp: v.timestamp,
              leaveDuration: v.leaveDuration || 0,
              reason: v.reason || "مغادرة شاشة الاختبار",
              type: v.type || "visibility_hidden",
              details: v.details || v.reason,
              violationCount: sub.violationCount,
              status: sub.status,
            });
          }
        });
      }
    });

    const list = Array.from(itemsMap.values());
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }, [securityLogs, violationsFromState, submissions, users, quizzes]);

  // Filter submissions by tab and search query
  const filteredSubmissions = submissions.filter((sub) => {
    const quiz = getQuiz(sub.quizId);
    const userName = getUserName(sub.userId).toLowerCase();
    const quizTitle = quiz ? quiz.title.toLowerCase() : "";
    const matchesSearch = userName.includes(searchQuery.toLowerCase()) || quizTitle.includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (filterTab === "pending_review") {
      return sub.status === "pending_manual_review";
    }
    if (filterTab === "graded") {
      return sub.status === "graded" || sub.status === "completed";
    }
    return true;
  });

  // Filter security logs
  const filteredSecurityLogs = combinedSecurityLogs.filter((log) => {
    const matchesSearch =
      log.userName.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
      log.quizTitle.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
      (log.reason && log.reason.toLowerCase().includes(logSearchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (logTypeFilter === "all") return true;
    if (logTypeFilter === "terminated") return log.status === "VIOLATION_TERMINATED";
    if (logTypeFilter === "fullscreen") return log.type === "fullscreen_exit";
    if (logTypeFilter === "copy_paste") return log.type === "copy_paste_attempt";
    if (logTypeFilter === "focus_lost") return log.type === "visibility_hidden" || log.type === "window_blur";

    return true;
  });

  const pendingCount = submissions.filter((s) => s.status === "pending_manual_review").length;
  const gradedCount = submissions.filter((s) => s.status === "graded" || s.status === "completed").length;
  const terminatedCount = submissions.filter((s) => s.status === "VIOLATION_TERMINATED").length;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header & Executive Action Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 md:p-6 border border-slate-200 dark:border-slate-800 shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 w-full md:w-auto">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shrink-0 shadow-md">
            <Award className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              لوحة تحكم وتصحيح الاختبارات ومراقبة الأمان
              <span className="text-xs bg-amber-400 text-slate-950 font-black px-2 py-0.5 rounded-full shadow-2xs">
                الطور الرابع 🛡️
              </span>
            </h2>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
              تصحيح ومراجعة الأسئلة، ومراقبة مخالفات الغش والانقطاع محلياً وحسابات الفايربيس
            </p>
          </div>
        </div>

        {/* Action Bar Buttons */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end flex-wrap">
          <button
            type="button"
            onClick={() => setIsImporterOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            استيراد أسئلة بالذكاء (Quiz Importer)
          </button>

          <button
            type="button"
            onClick={() => {
              if (onRefreshData) onRefreshData();
              if (activeMainTab === "security_logs") fetchSecurityLogs();
            }}
            disabled={isLoading || isLoadingLogs}
            className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RotateCw className={`w-4 h-4 ${(isLoading || isLoadingLogs) ? "animate-spin text-emerald-600" : ""}`} />
            تحديث البيانات 🔄
          </button>
        </div>
      </div>

      {/* Main Mode Navigation Bar: Submissions vs Security Audit Log */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveMainTab("submissions")}
          className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer ${
            activeMainTab === "submissions"
              ? "bg-emerald-600 text-white shadow-md"
              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>جدول التسليمات والتصحيح المقالي</span>
          <span className="bg-white/20 text-white px-2 py-0.5 rounded-full text-[10px] font-mono">
            {submissions.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab("security_logs")}
          className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer ${
            activeMainTab === "security_logs"
              ? "bg-rose-600 text-white shadow-md"
              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-amber-300" />
          <span>سجل الأمان ومراقبة الغش 🛡️</span>
          <span className="bg-rose-700 text-white px-2 py-0.5 rounded-full text-[10px] font-mono">
            {combinedSecurityLogs.length}
          </span>
        </button>
      </div>

      {/* 1. SUBMISSIONS & MANUAL ESSAY REVIEW PANEL */}
      {activeMainTab === "submissions" && (
        <>
          {/* Filter Tabs & Search Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold w-full md:w-auto overflow-x-auto">
              <button
                type="button"
                onClick={() => setFilterTab("all")}
                className={`px-4 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  filterTab === "all"
                    ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                كافة التسليمات ({submissions.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("pending_review")}
                className={`px-4 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  filterTab === "pending_review"
                    ? "bg-amber-500 text-white shadow-xs"
                    : "text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                }`}
              >
                <span>بانتظار التصحيح المقالي</span>
                <span className="bg-amber-700 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black">
                  {pendingCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("graded")}
                className={`px-4 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  filterTab === "graded"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                }`}
              >
                تم التصحيح والاعتماد ({gradedCount})
              </button>
            </div>

            {/* Search input */}
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث باسم المشارك أو عنوان الاختبار..."
                className="w-full text-xs font-semibold pr-9 pl-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 outline-hidden transition-all"
              />
            </div>
          </div>

          {/* Submissions List or Skeleton Loading */}
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs animate-pulse flex items-center justify-between"
                >
                  <div className="space-y-2">
                    <div className="h-4 w-48 bg-slate-200 dark:bg-slate-800 rounded-md" />
                    <div className="h-3 w-32 bg-slate-100 dark:bg-slate-800/60 rounded-md" />
                  </div>
                  <div className="h-8 w-28 bg-slate-200 dark:bg-slate-800 rounded-xl" />
                </div>
              ))}
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 text-center border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-300">
                لا توجد تسليمات تطابق الفلتر المحدد حالياً
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                سيتم عرض تسليمات المشاركين فور إكمالهم للاختبارات ورصد إجاباتهم
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSubmissions.map((sub) => {
                const quiz = getQuiz(sub.quizId);
                const userName = getUserName(sub.userId);
                const isPending = sub.status === "pending_manual_review";
                const isTerminated = sub.status === "VIOLATION_TERMINATED";
                const essayCount = quiz?.questions.filter((q) => q.type === "essay").length || 0;

                return (
                  <div
                    key={sub.id}
                    className={`bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs ${
                      isTerminated
                        ? "border-rose-400 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20"
                        : isPending
                        ? "border-amber-300 dark:border-amber-700/60 bg-amber-50/20 dark:bg-amber-950/10"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-black text-slate-900 dark:text-white">
                          {userName}
                        </h4>
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-black text-[10px] ${
                            isTerminated
                              ? "bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950 dark:text-rose-200"
                              : isPending
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          }`}
                        >
                          {isTerminated
                            ? "⛔ ملغى بسبب مخالفة أمنية"
                            : isPending
                            ? "⏳ بانتظار التصحيح اليدوي"
                            : "✓ تم التصحيح والاعتماد"}
                        </span>

                        {sub.violationCount && sub.violationCount > 0 ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            {sub.violationCount} مخالفات
                          </span>
                        ) : null}
                      </div>

                      <p className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <span>اختبار: <b>{quiz?.title || "اختبار"}</b></span>
                        <span>•</span>
                        <span>النتيجة الحالية: <b className="text-emerald-600 dark:text-emerald-400">{sub.totalScore}</b> من أصل {quiz?.points || 0} نقطة</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end md:self-auto">
                      {essayCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedSubmissionForReview(sub)}
                          className={`font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
                            isPending
                              ? "bg-amber-500 hover:bg-amber-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          <BookOpen className="w-4 h-4" />
                          {isPending ? "تصحيح الإجابة المقالية ✍️" : "مراجعة التصحيح 👁️"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 2. DEDICATED ADMIN ANTI-CHEAT SECURITY AUDIT LOG PANEL */}
      {activeMainTab === "security_logs" && (
        <div className="space-y-5">
          {/* Executive Security Overview Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 flex items-center gap-3.5 shadow-2xs">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">إجمالي المخالفات المرصودة</span>
                <h3 className="text-xl font-black text-rose-600 dark:text-rose-400 mt-0.5">
                  {combinedSecurityLogs.length} مخالفة
                </h3>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 flex items-center gap-3.5 shadow-2xs">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">المحاولات الملغاة بالمخالفة</span>
                <h3 className="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">
                  {terminatedCount} محاولات
                </h3>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 flex items-center gap-3.5 shadow-2xs">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                <UserCheck className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">عدد الطلاب المخالفين</span>
                <h3 className="text-xl font-black text-purple-600 dark:text-purple-400 mt-0.5">
                  {new Set(combinedSecurityLogs.map((l) => l.userId)).size} طلاب
                </h3>
              </div>
            </div>
          </div>

          {/* Log Controls & Filter Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Filter Tabs by Log Type */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold w-full md:w-auto overflow-x-auto">
              <button
                type="button"
                onClick={() => setLogTypeFilter("all")}
                className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  logTypeFilter === "all"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                جميع المخالفات ({combinedSecurityLogs.length})
              </button>

              <button
                type="button"
                onClick={() => setLogTypeFilter("terminated")}
                className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                  logTypeFilter === "terminated"
                    ? "bg-rose-600 text-white shadow-xs"
                    : "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                }`}
              >
                <span>إنهاء فوري</span>
                <span className="bg-rose-800 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black">
                  {terminatedCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setLogTypeFilter("fullscreen")}
                className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  logTypeFilter === "fullscreen"
                    ? "bg-purple-600 text-white shadow-xs"
                    : "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                }`}
              >
                خروج من ملء الشاشة ⛶
              </button>

              <button
                type="button"
                onClick={() => setLogTypeFilter("focus_lost")}
                className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  logTypeFilter === "focus_lost"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                }`}
              >
                مغادرة الشاشة 📱
              </button>

              <button
                type="button"
                onClick={() => setLogTypeFilter("copy_paste")}
                className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  logTypeFilter === "copy_paste"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                }`}
              >
                محاولة نسخ/لصق 📋
              </button>
            </div>

            {/* Search Box */}
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder="بحث باسم الطالب، العنوان، أو التفاصيل..."
                className="w-full text-xs font-semibold pr-9 pl-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-rose-500 outline-hidden transition-all"
              />
            </div>
          </div>

          {/* Audit Log Stream */}
          {isLoadingLogs ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs animate-pulse space-y-2"
                >
                  <div className="h-4 w-56 bg-slate-200 dark:bg-slate-800 rounded-md" />
                  <div className="h-3 w-40 bg-slate-100 dark:bg-slate-800/60 rounded-md" />
                </div>
              ))}
            </div>
          ) : filteredSecurityLogs.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 text-center border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                سجل الأمان نظيف ورائع! ✨
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                لم يتم تسجيل أي مخالفة تطابق الفلتر المحدد حالياً.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSecurityLogs.map((log) => {
                const isTerminated = log.status === "VIOLATION_TERMINATED";
                const isFullscreenExit = log.type === "fullscreen_exit";
                const isCopyPaste = log.type === "copy_paste_attempt";

                return (
                  <div
                    key={log.id}
                    className={`bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs ${
                      isTerminated
                        ? "border-rose-400 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{log.userName}</span>
                        </h4>

                        {/* Incident Type Badge */}
                        <span
                          className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${
                            isTerminated
                              ? "bg-rose-600 text-white border-rose-600"
                              : isFullscreenExit
                              ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-200"
                              : isCopyPaste
                              ? "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-200"
                              : "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200"
                          }`}
                        >
                          {isTerminated ? (
                            <>
                              <Zap className="w-3 h-3 text-amber-300" />
                              <span>تم الإلغاء بقرار فوري ⚡</span>
                            </>
                          ) : isFullscreenExit ? (
                            <>
                              <Maximize2 className="w-3 h-3" />
                              <span>خروج من ملء الشاشة ⛶</span>
                            </>
                          ) : isCopyPaste ? (
                            <>
                              <Lock className="w-3 h-3" />
                              <span>محاولة نسخ/لصق النص 📋</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-3 h-3" />
                              <span>مغادرة شاشة الاختبار 📱</span>
                            </>
                          )}
                        </span>

                        {log.leaveDuration && log.leaveDuration > 0 ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            المدة: {log.leaveDuration} ثوانٍ
                          </span>
                        ) : null}
                      </div>

                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        السبب: <strong className="text-slate-800 dark:text-slate-100">{log.reason || log.details}</strong>
                      </p>

                      <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400 dark:text-slate-500 pt-0.5">
                        <span>اختبار: <b className="text-natural-accent">{log.quizTitle}</b></span>
                        <span>•</span>
                        <span className="flex items-center gap-1 dir-ltr">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {new Date(log.timestamp).toLocaleString("ar-EG", {
                            dateStyle: "short",
                            timeStyle: "medium",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Manual Essay Grading Review Modal */}
      {selectedSubmissionForReview && (
        <ManualReviewModal
          isOpen={!!selectedSubmissionForReview}
          onClose={() => setSelectedSubmissionForReview(null)}
          submission={selectedSubmissionForReview}
          quiz={getQuiz(selectedSubmissionForReview.quizId)}
          participantName={getUserName(selectedSubmissionForReview.userId)}
          onGraded={(updatedDb) => {
            onUpdateState(updatedDb);
            setSelectedSubmissionForReview(null);
          }}
        />
      )}

      {/* Smart Bulk Quiz Importer Modal */}
      {isImporterOpen && (
        <QuizImporter
          isOpen={isImporterOpen}
          onClose={() => setIsImporterOpen(false)}
          onImport={(importedQuestions) => {
            setIsImporterOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default AdminDashboard;

