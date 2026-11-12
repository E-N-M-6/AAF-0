import React, { useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { User, Attendance, Task, DatabaseState, ConfessionMonth, QuizQuestion, Quiz, QuestionType } from "../types";
import { ApiService } from "../services/api";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { BulkQuizImportModal } from "./BulkQuizImportModal";
import { calculateParticipantScore } from "../lib/score";
import { AdminDashboard } from "./AdminDashboard";
import { PostGradingModal } from "./PostGradingModal";
import { 
  Users, 
  CalendarDays, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  Trash2, 
  Sparkles, 
  Image as ImageIcon, 
  Clock, 
  Search, 
  BookOpen, 
  Award,
  ChevronLeft,
  ChevronRight,
  Check,
  RotateCcw,
  AlertCircle,
  Megaphone,
  Send,
  Loader2,
  QrCode,
  Edit3,
  Download,
  Cloud,
  Camera,
  FileText
} from "lucide-react";
import { motion } from "motion/react";
import Avatar from "./Avatar";

const QRScannerModal = lazy(() => import("./QRScannerModal"));

interface AdminBoardProps {
  state: DatabaseState;
  onUpdateState: (newState: DatabaseState) => void;
  setError: (msg: string) => void;
  setSuccess: (msg: string) => void;
}

function isRawJsonError(text?: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && (parsed.error || parsed.code || parsed.statusCode || parsed.message)) {
        return true;
      }
    } catch {
      if (trimmed.includes('"error"') || trimmed.includes('"code"') || trimmed.includes('503')) {
        return true;
      }
    }
  }
  return (
    trimmed.includes('{"error"') ||
    trimmed.includes('"code":503') ||
    trimmed.includes('503 UNAVAILABLE') ||
    trimmed.includes('RESOURCE_EXHAUSTED') ||
    (trimmed.includes('UNAVAILABLE') && trimmed.includes('{'))
  );
}

export default function AdminBoard({ state, onUpdateState, setError, setSuccess }: AdminBoardProps) {
  const [activeTab, setActiveTab] = useState<"attendance" | "admin_dashboard" | "tasks_review" | "assign_task" | "manage_users" | "broadcast" | "quizzes" | "confessions" | "bonus_quiz_manual">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("lastAdminActiveTab");
      if (saved) return saved as any;
    }
    return "attendance";
  });

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lastAdminActiveTab", activeTab);
    }
  }, [activeTab]);
  
  // Post-Grading Modal State (Phase 6.2)
  const [postGradingQuiz, setPostGradingQuiz] = useState<Quiz | null>(null);
  
  // Broadcast Tab State
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string>(""); // empty string means broadcast to everyone
  const [deliveryType, setDeliveryType] = useState<"in_app" | "both">("both");
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);
  
  // Attendance Tab State
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [selectedActivity, setSelectedActivity] = useState<"meetings" | "liturgy" | "praise">("meetings");
  const [searchMember, setSearchMember] = useState("");
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);

  // Assign Task Tab State
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskPoints, setTaskPoints] = useState(20);
  const [isAssigning, setIsAssigning] = useState(false);

  // Manage Users Tab State
  const [newUserName, setNewUserName] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserCode, setNewUserCode] = useState("");
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<{ id: string; name: string; username: string } | null>(null);
  const [isSavingUserEdit, setIsSavingUserEdit] = useState(false);

  // Verification State
  const [selectedProofTask, setSelectedProofTask] = useState<Task | null>(null);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Quiz Administration State
  const [newQuizTitle, setNewQuizTitle] = useState("");
  const [newQuizDesc, setNewQuizDesc] = useState("");
  const [newQuizTimeLimit, setNewQuizTimeLimit] = useState("");
  const [newQuizDeadline, setNewQuizDeadline] = useState("");
  const [newQuizQuestions, setNewQuizQuestions] = useState<any[]>([]);
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false);
  const [newQuizProctoringMode, setNewQuizProctoringMode] = useState<"OFF" | "WARN" | "STRICT">("WARN");
  const [newQuizGraceSeconds, setNewQuizGraceSeconds] = useState<number>(3);
  const [newQuizMaxLeaves, setNewQuizMaxLeaves] = useState<number>(1);
  const [newQuizStrictImmediateKick, setNewQuizStrictImmediateKick] = useState<boolean>(false);
  const [defaultMcqPoints, setDefaultMcqPoints] = useState<number>(2);
  const [defaultTrueFalsePoints, setDefaultTrueFalsePoints] = useState<number>(1);
  const [defaultEssayPoints, setDefaultEssayPoints] = useState<number>(5);
  const [defaultFillBlankPoints, setDefaultFillBlankPoints] = useState<number>(3);
  const [defaultQuotePoints, setDefaultQuotePoints] = useState<number>(4);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState<boolean>(false);
  const [selectedSubmissionDetails, setSelectedSubmissionDetails] = useState<any | null>(null);
  const [essayGrades, setEssayGrades] = useState<Record<string, { pointsEarned: number; feedback: string }>>({});
  const [isSubmittingGrades, setIsSubmittingGrades] = useState(false);
  const [isReopeningQuiz, setIsReopeningQuiz] = useState(false);
  const [isBatchAutoGrading, setIsBatchAutoGrading] = useState(false);
  const [isAutoGradingSingle, setIsAutoGradingSingle] = useState<string | null>(null);

  // Quiz Extension State
  const [extendingQuiz, setExtendingQuiz] = useState<any | null>(null);
  const [extensionType, setExtensionType] = useState<"global" | "user">("global");
  const [globalExtDate, setGlobalExtDate] = useState<string>("");
  const [selectedStudentIdsForExt, setSelectedStudentIdsForExt] = useState<string[]>([]);
  const [userExtDate, setUserExtDate] = useState<string>("");
  const [studentSearchQueryForExt, setStudentSearchQueryForExt] = useState<string>("");
  const [isExtendingQuiz, setIsExtendingQuiz] = useState<boolean>(false);

  // Confession Verification State
  const [confessionSearch, setConfessionSearch] = useState("");
  const [confessionMonthFilter, setConfessionMonthFilter] = useState<string>("all");
  const [confessionStatusFilter, setConfessionStatusFilter] = useState<string>("all");
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Bonus Points Form State
  const [bonusUserId, setBonusUserId] = useState("");
  const [bonusPoints, setBonusPoints] = useState(10);
  const [bonusReason, setBonusReason] = useState("");
  const [isSubmittingBonus, setIsSubmittingBonus] = useState(false);

  // Manual Quiz Scoring Form State
  const [manualQuizId, setManualQuizId] = useState("");
  const [manualQuizUserId, setManualQuizUserId] = useState("");
  const [manualQuizScore, setManualQuizScore] = useState(10);
  const [isSubmittingManualQuiz, setIsSubmittingManualQuiz] = useState(false);

  // Leaderboard Reset Verification State
  const [isResetLeaderboardOpen, setIsResetLeaderboardOpen] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState("");
  const [isResettingLeaderboard, setIsResettingLeaderboard] = useState(false);

  // Backup Export & Storage Migration State
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isMigratingProofs, setIsMigratingProofs] = useState(false);
  const [deletingAvatarUserId, setDeletingAvatarUserId] = useState<string | null>(null);

  const handleAdminRemoveAvatar = async (userId: string, userName: string) => {
    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف وإزالة الصورة الشخصية للمشارك "${userName}"؟`)) {
      return;
    }
    setDeletingAvatarUserId(userId);
    try {
      const res = await ApiService.adminRemoveAvatar(userId);
      onUpdateState(res.db);
      setSuccess(`تمت إزالة الصورة الشخصية للمشارك "${userName}" بنجاح 🗑️`);
    } catch (err: any) {
      setError(err.message || "فشل إزالة صورة المشارك");
    } finally {
      setDeletingAvatarUserId(null);
    }
  };

  // Resilient Submission Data Fetching with Silent Auto-Retry for Cold Starts
  const [isFetchingSubmissions, setIsFetchingSubmissions] = useState(false);
  const retryCountRef = React.useRef(0);
  const retryTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const fetchSubmissionsData = React.useCallback(async (isManual = false) => {
    setIsFetchingSubmissions(true);
    try {
      if (isManual) {
        const adminData = await ApiService.refreshAdminData();
        const freshSubmissions = adminData.submissions || [];
        onUpdateState({
          ...adminData.db,
          quizSubmissions: freshSubmissions.length > 0 ? freshSubmissions : (adminData.db.quizSubmissions || []),
        });
        setIsFetchingSubmissions(false);
        retryCountRef.current = 0;
        setSuccess("تم تحديث وجلب أحدث البيانات والتسليمات بنجاح! 🔄");
        return;
      }

      const res = await ApiService.getAdminSubmissions();
      const freshSubmissions = res.submissions || res.quizSubmissions || [];

      if (freshSubmissions.length > 0) {
        onUpdateState({
          ...state,
          quizSubmissions: freshSubmissions,
        });
        setIsFetchingSubmissions(false);
        retryCountRef.current = 0;
        return;
      }

      // If initial response returns empty while loading, implement automatic silent retry (up to 3 retries spaced 2 seconds apart)
      if (retryCountRef.current < 3) {
        retryCountRef.current += 1;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          fetchSubmissionsData(isManual);
        }, 2000);
      } else {
        setIsFetchingSubmissions(false);
        retryCountRef.current = 0;
        if (isManual) {
          setSuccess("تم فحص وتحديث التسليمات (لا توجد تسليمات جديدة حالياً). 🔄");
        }
      }
    } catch (err: unknown) {
      if (retryCountRef.current < 3) {
        retryCountRef.current += 1;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          fetchSubmissionsData(isManual);
        }, 2000);
      } else {
        setIsFetchingSubmissions(false);
        retryCountRef.current = 0;
        if (isManual) {
          const msg = err instanceof Error ? err.message : "تعذر تحديث البيانات، حاول مرة أخرى";
          setError(msg);
        }
      }
    }
  }, [state, onUpdateState, setError, setSuccess]);

  const handleRefreshSubmissions = () => {
    retryCountRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    fetchSubmissionsData(true);
  };

  React.useEffect(() => {
    if (!state?.quizSubmissions || state.quizSubmissions.length === 0) {
      fetchSubmissionsData(false);
    }
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  // Database lists - memoized to prevent redundant filtering
  const participants = React.useMemo(() => {
    return (state?.users || []).filter(u => u && u.role !== "admin");
  }, [state?.users]);

  const submittedTasks = React.useMemo(() => {
    return (state?.tasks || []).filter(t => t && t.status === "submitted");
  }, [state?.tasks]);

  React.useEffect(() => {
    if (selectedSubmissionDetails) {
      const initialGrades: Record<string, { pointsEarned: number; feedback: string }> = {};
      const sub = selectedSubmissionDetails.sub;
      const quiz = state?.quizzes?.find(q => q.id === sub.quizId);
      if (quiz) {
        (quiz.questions || []).forEach((q: any) => {
          if (q.type === "essay") {
            const result = sub.questionResults?.[q.id] || {};
            const autoItem = sub.essayGrades?.[q.id];
            const autoScore = autoItem ? autoItem.score : (result.pointsEarned ?? 0);
            const rawFeedback = autoItem
              ? autoItem.gradingReasoning
              : (result.feedback && result.feedback !== "بانتظار تصحيح الخادم..." ? result.feedback : "");
            const autoFeedback = isRawJsonError(rawFeedback)
              ? "تنبيه: الخدمة آلياً تحت الضغط المؤقت - بانتظار الاعتماد اليدوي من المشرف"
              : rawFeedback;
            initialGrades[q.id] = {
              pointsEarned: autoScore,
              feedback: autoFeedback
            };
          }
        });
      }
      setEssayGrades(initialGrades);
    } else {
      setEssayGrades({});
    }
  }, [selectedSubmissionDetails, state?.quizzes]);

  // Helper: Get user's name
  const getUserName = (id: string) => (state?.users || []).find(u => u && u.id === id)?.name || "مشارك غير معروف";



  // Track loading/saving states for individual cells/users to prevent optimistic UI race condition collisions with background sync polling
  const [updatingAttendanceKeys, setUpdatingAttendanceKeys] = useState<Record<string, boolean>>({});

  // 1. Toggle Attendance Handler (Optimistic Instant UI Update with background sync)
  const handleToggleAttendance = async (userId: string, attended: boolean) => {
    const key = `${userId}_${selectedActivity}_${selectedWeek}`;
    setUpdatingAttendanceKeys(prev => ({ ...prev, [key]: true }));

    // Instant optimistic local update
    if (state && state.attendance) {
      const userAtt = state.attendance[userId] || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
      const currentList = (userAtt[selectedActivity as keyof Attendance] as number[]) || [];
      let newList: number[];
      if (attended) {
        newList = Array.from(new Set([...currentList, selectedWeek])).sort((a, b) => a - b);
      } else {
        newList = currentList.filter(w => w !== selectedWeek);
      }
      onUpdateState({
        ...state,
        attendance: {
          ...state.attendance,
          [userId]: {
            ...userAtt,
            [selectedActivity]: newList
          }
        }
      });
    }

    try {
      const data = await ApiService.toggleAttendance(userId, selectedWeek, selectedActivity, attended);
      onUpdateState(data.db);
    } catch (err: any) {
      setError(err.message || "عذراً حدث خطأ ما أثناء حفظ الغياب");
      ApiService.getState().then(s => onUpdateState(s)).catch(() => {});
    } finally {
      setUpdatingAttendanceKeys(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleLiturgyAttendance = async (userId: string, attended: boolean, score: number) => {
    const key = `${userId}_liturgy_${selectedWeek}`;
    setUpdatingAttendanceKeys(prev => ({ ...prev, [key]: true }));

    // Instant optimistic local update for liturgy attendance
    if (state && state.attendance) {
      const userAtt = state.attendance[userId] || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
      const currentLiturgy = userAtt.liturgy || [];
      const currentScores = userAtt.liturgyScores || {};
      const weekKey = selectedWeek.toString();

      let newLiturgy: number[];
      const newScores = { ...currentScores };

      if (score === 20 || score === 10) {
        newScores[weekKey] = score;
        newLiturgy = Array.from(new Set([...currentLiturgy, selectedWeek])).sort((a, b) => a - b);
      } else {
        newScores[weekKey] = 0;
        newLiturgy = currentLiturgy.filter(w => w !== selectedWeek);
      }

      onUpdateState({
        ...state,
        attendance: {
          ...state.attendance,
          [userId]: {
            ...userAtt,
            liturgy: newLiturgy,
            liturgyScores: newScores
          }
        }
      });
    }

    try {
      const data = await ApiService.recordLiturgyAttendance(userId, selectedWeek, attended, score);
      onUpdateState(data.db);
    } catch (err: any) {
      setError(err.message || "عذراً حدث خطأ ما أثناء تعديل حضور القداس");
      ApiService.getState().then(s => onUpdateState(s)).catch(() => {});
    } finally {
      setUpdatingAttendanceKeys(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleQRScanUser = async (scannedIdOrUsername: string): Promise<{ success: boolean; userName?: string; message?: string }> => {
    let query = scannedIdOrUsername.trim().toLowerCase();
    if (query.startsWith("marathon_user:")) {
      query = query.replace("marathon_user:", "").trim();
    }

    if (!query) {
      return { success: false, message: "الرجاء إدخال اسم أو كود صريح للمشارك" };
    }

    const allUsers = state?.users || [];
    const foundUser = allUsers.find(u => 
      u && (
        u.id.toLowerCase() === query || 
        (u.username && u.username.toLowerCase() === query) ||
        u.name.toLowerCase() === query
      )
    ) || allUsers.find(u => 
      u && u.role !== "admin" && u.name.toLowerCase().includes(query)
    );

    if (!foundUser) {
      return { success: false, message: `تعذر العثور على أي مشارك بالكود أو الاسم المدخل (${scannedIdOrUsername})` };
    }

    const activityLabels = {
      meetings: "اجتماع الجمعة",
      liturgy: "القداس الأسبوعي",
      praise: "تسبحة الخميس"
    };
    const label = activityLabels[selectedActivity];

    try {
      let data;
      if (selectedActivity === "liturgy") {
        data = await ApiService.recordLiturgyAttendance(foundUser.id, selectedWeek, true, 20);
      } else {
        data = await ApiService.toggleAttendance(foundUser.id, selectedWeek, selectedActivity, true);
      }

      if (data.alreadyRecorded) {
        return { success: true, userName: foundUser.name, message: `مشارك مسجل مسبقاً (${foundUser.name})` };
      }

      // Optimistic update
      onUpdateState(data.db);

      return {
        success: true,
        userName: foundUser.name,
        message: `تم تسجيل حضور ${foundUser.name} بالأسبوع ${selectedWeek} (${label}) بنجاح!`
      };
    } catch (err: any) {
      return { success: false, message: err.message || "حدث خطأ أثناء الاتصال بالخادم" };
    }
  };

  // 2. Assign Task Handler
  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAssigneeIds.length === 0 || !taskTitle.trim() || !taskPoints) {
      setError("يرجى اختيار مشارك واحد على الأقل وملء جميع البيانات المطلوبة");
      return;
    }

    setIsAssigning(true);
    try {
      const data = await ApiService.createTask(
        selectedAssigneeIds,
        taskTitle.trim(),
        taskDesc.trim(),
        taskPoints
      );
      onUpdateState(data.db);
      setSuccess(`تم تكليف المهمة بنجاح لعدد ${selectedAssigneeIds.length} مشارك!`);
      setTaskTitle("");
      setTaskDesc("");
      setTaskPoints(20);
      setSelectedAssigneeIds([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAssigning(false);
    }
  };

  // 2.5 Save Essay Grades Handler (Manual Admin Review)
  const handleSaveEssayGrades = async () => {
    if (!selectedSubmissionDetails) return;
    
    setIsSubmittingGrades(true);
    try {
      const data = await ApiService.gradeEssayManual(selectedSubmissionDetails.sub.id, essayGrades);
      onUpdateState(data.db);
      setSuccess("تم حفظ التصحيح اليدوي ورصد درجات الأسئلة المقالية بنجاح! 🎉");
      setSelectedSubmissionDetails(null);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء حفظ التصحيح اليدوي");
    } finally {
      setIsSubmittingGrades(false);
    }
  };

  // 2.6 Reopen/Reset Quiz Attempt for User
  const handleReopenQuizAttempt = async () => {
    if (!selectedSubmissionDetails) return;
    const { sub, participantName } = selectedSubmissionDetails;
    
    if (!window.confirm(`هل أنت متأكد من رغبتك في مسح المحاولة السابقة وتصفير أي مخالفات أمنية وإعادة فتح الاختبار للمشارك "${participantName}"؟\nسيتمكن من حل الاختبار مجدداً وكأنها محاولة جديدة.`)) {
      return;
    }

    setIsReopeningQuiz(true);
    try {
      const data = await ApiService.reopenQuizAttempt(sub.quizId, sub.userId);
      onUpdateState(data.db);
      setSuccess(`تم بنجاح إعادة فتح الاختبار للمشارك "${participantName}" وتصفير محاولته ومخالفاته السابقة! 🔓`);
      setSelectedSubmissionDetails(null);
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما أثناء إعادة فتح الاختبار");
    } finally {
      setIsReopeningQuiz(false);
    }
  };

  // 3. Verify Task (Approve or Reject)
  const handleVerifyTask = async (taskId: string, status: "approved" | "rejected") => {
    setIsVerifying(true);
    try {
      const data = await ApiService.verifyTask(taskId, status, adminFeedback.trim());
      onUpdateState(data.db);
      setSuccess(status === "approved" ? "تم قبول المهمة وإضافة النقاط بنجاح!" : "تم رفض المهمة وإرسال التعليق");
      setSelectedProofTask(null);
      setAdminFeedback("");
      setAiAnalysis("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsVerifying(false);
    }
  };

  // 4. Run AI Gemini Analysis on Image & Note
  const handleAiAnalysis = async (taskId: string) => {
    setIsAnalyzing(true);
    setAiAnalysis("");
    try {
      const data = await ApiService.runAiReview(taskId);
      setAiAnalysis(data.evaluation);
      
      // Auto-populate feedback if Gemini provides some nice text
      if (data.evaluation) {
        // If there's an introductory or recommendations block, copy it
        setAdminFeedback(data.evaluation);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 5. Create user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) return;

    setIsCreatingUser(true);
    try {
      const data = await ApiService.addUser(
        newUserName.trim(),
        newUserUsername.trim() || undefined,
        newUserCode.trim() || undefined
      );

      onUpdateState(data.db);
      setSuccess(data.message || "تم تسجيل العضو الجديد بنجاح!");
      setNewUserName("");
      setNewUserUsername("");
      setNewUserCode("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsCreatingUser(false);
    }
  };

  // 6. Delete user
  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("هل أنت متأكد من رغبتك في حذف هذا المشارك نهائياً؟ سيتم مسح كافة غيابه ومهامه من النظام.")) {
      return;
    }

    try {
      const data = await ApiService.deleteUser(userId);
      onUpdateState(data.db);
      setSuccess("تم حذف المستخدم وكافة سجلاته بنجاح");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 6.5. Update user info (Name / Username)
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !editingUser.name.trim()) return;

    setIsSavingUserEdit(true);
    try {
      const data = await ApiService.updateUser(editingUser.id, editingUser.name, editingUser.username);
      onUpdateState(data.db);
      setSuccess(data.message || "تم تعديل اسم المشارك بنجاح!");
      setEditingUser(null);
    } catch (err: any) {
      setError(err.message || "فشل تعديل بيانات المشارك");
    } finally {
      setIsSavingUserEdit(false);
    }
  };

  // 7. Broadcast Notification Handler
  const handleBroadcastNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMessage.trim()) {
      setError("يرجى إدخال نص التنبيه أولاً");
      return;
    }

    setIsBroadcasting(true);
    try {
      const data = await ApiService.broadcastNotification(broadcastMessage.trim(), targetUserId || undefined, deliveryType);
      onUpdateState(data.db);
      setSuccess(targetUserId 
        ? "تم إرسال التنبيه الفردي بنجاح للمشارك المختار! 🎯"
        : "تم إرسال وبث التنبيه لجميع المشاركين بنجاح! 🚀"
      );
      setBroadcastMessage("");
      setTargetUserId("");
      setDeliveryType("both");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما أثناء الإرسال");
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleDeleteNotification = async (id: string) => {
    if (!window.confirm("هل أنت متأكد من رغبتك في حذف هذا التنبيه نهائياً من السجل ولدى المشاركين؟")) {
      return;
    }
    setDeletingNotifId(id);
    try {
      const data = await ApiService.deleteNotification(id);
      onUpdateState(data.db);
      setSuccess("تم حذف التنبيه بنجاح! 🗑️");
    } catch (err: any) {
      setError(err.message || "عذراً، فشل حذف التنبيه");
    } finally {
      setDeletingNotifId(null);
    }
  };

  // 8. Quiz Helper Handlers & Default Scoring
  const handleDefaultMcqPointsChange = (val: number) => {
    const pts = Math.max(0.1, isNaN(val) ? 0.5 : val);
    setDefaultMcqPoints(pts);
    setNewQuizQuestions(prev => prev.map(q => {
      if (q.type === "choice" && !q.isCustomPoints) {
        return { ...q, points: pts };
      }
      return q;
    }));
  };

  const handleDefaultTrueFalsePointsChange = (val: number) => {
    const pts = Math.max(0.1, isNaN(val) ? 0.5 : val);
    setDefaultTrueFalsePoints(pts);
    setNewQuizQuestions(prev => prev.map(q => {
      if (q.type === "boolean" && !q.isCustomPoints) {
        return { ...q, points: pts };
      }
      return q;
    }));
  };

  const handleDefaultEssayPointsChange = (val: number) => {
    const pts = Math.max(0.1, isNaN(val) ? 0.5 : val);
    setDefaultEssayPoints(pts);
    setNewQuizQuestions(prev => prev.map(q => {
      if (q.type === "essay" && !q.isCustomPoints) {
        return { ...q, points: pts };
      }
      return q;
    }));
  };

  const handleDefaultFillBlankPointsChange = (val: number) => {
    const pts = Math.max(0.1, isNaN(val) ? 0.5 : val);
    setDefaultFillBlankPoints(pts);
    setNewQuizQuestions(prev => prev.map(q => {
      if (q.type === "fill_in_the_blank" && !q.isCustomPoints) {
        return { ...q, points: pts };
      }
      return q;
    }));
  };

  const handleDefaultQuotePointsChange = (val: number) => {
    const pts = Math.max(0.1, isNaN(val) ? 0.5 : val);
    setDefaultQuotePoints(pts);
    setNewQuizQuestions(prev => prev.map(q => {
      if (q.type === "quote" && !q.isCustomPoints) {
        return { ...q, points: pts };
      }
      return q;
    }));
  };

  const handleBulkImportQuestions = (imported: QuizQuestion[]) => {
    setNewQuizQuestions(prev => [...prev, ...imported]);
    setSuccess(`تم بنجاح استيراد ${imported.length} سؤال وإضافتها للاختبار! 📋✨`);
  };

  const handleAddQuestion = (type: QuestionType) => {
    const pts = type === "choice" 
      ? defaultMcqPoints 
      : type === "boolean" 
        ? defaultTrueFalsePoints 
        : type === "fill_in_the_blank"
          ? defaultFillBlankPoints
          : type === "quote"
            ? defaultQuotePoints
            : defaultEssayPoints;

    const newQ = {
      id: "q_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      type,
      questionText: "",
      options: type === "choice" ? ["", "", "", ""] : [],
      correctAnswer: type === "boolean" ? "true" : "",
      points: pts,
      isCustomPoints: false
    };
    setNewQuizQuestions(prev => [...prev, newQ]);
  };

  const handleUpdateQuestionType = (idx: number, newType: QuestionType) => {
    setNewQuizQuestions(prev => {
      const next = [...prev];
      const target = next[idx];
      const pts = newType === "choice"
        ? defaultMcqPoints
        : newType === "boolean"
          ? defaultTrueFalsePoints
          : newType === "fill_in_the_blank"
            ? defaultFillBlankPoints
            : newType === "quote"
              ? defaultQuotePoints
              : defaultEssayPoints;

      next[idx] = {
        ...target,
        type: newType,
        points: target.isCustomPoints ? target.points : pts,
        options: newType === "choice" ? (target.options?.length === 4 ? target.options : ["", "", "", ""]) : [],
        correctAnswer: newType === "boolean" ? (target.correctAnswer === "false" ? "false" : "true") : (newType === "choice" ? "" : target.correctAnswer || "")
      };
      return next;
    });
  };

  const handleRemoveQuestion = (idx: number) => {
    setNewQuizQuestions(newQuizQuestions.filter((_, i) => i !== idx));
  };

  const handleUpdateQuestion = (idx: number, field: string, value: any) => {
    const updated = [...newQuizQuestions];
    updated[idx] = { ...updated[idx], [field]: value };
    setNewQuizQuestions(updated);
  };

  const handleUpdateOption = (qIdx: number, optIdx: number, val: string) => {
    const updated = [...newQuizQuestions];
    const opts = [...updated[qIdx].options];
    opts[optIdx] = val;
    updated[qIdx] = { ...updated[qIdx], options: opts };
    setNewQuizQuestions(updated);
  };

  const handlePublishQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuizTitle.trim()) {
      setError("يرجى كتابة عنوان الاختبار");
      return;
    }
    if (newQuizQuestions.length === 0) {
      setError("يرجى إضافة سؤال واحد على الأقل للاختبار");
      return;
    }

    // Verify each question is complete
    for (let i = 0; i < newQuizQuestions.length; i++) {
      const q = newQuizQuestions[i];
      if (!q.questionText.trim()) {
        setError(`يرجى كتابة نص السؤال رقم ${i + 1}`);
        return;
      }
      if (q.type === "choice") {
        if (q.options.some((o: string) => !o.trim())) {
          setError(`يرجى ملء جميع اختيارات السؤال رقم ${i + 1}`);
          return;
        }
        // Delayed answer keys allowed: no error if correctAnswer is empty
      }
      if (q.type === "essay" && (!q.correctAnswer || !q.correctAnswer.trim())) {
        setError(`يرجى كتابة نموذج الإجابة الصحيحة للسؤال المقالي رقم ${i + 1} لمساعدة لجنة التقييم في التصحيح والمراجعة`);
        return;
      }
    }

    setIsCreatingQuiz(true);
    const totalPoints = Math.round(newQuizQuestions.reduce((sum, q) => sum + (parseFloat(q.points) || 0), 0) * 100) / 100;

    try {
      const data = await ApiService.createQuiz(
        newQuizTitle.trim(),
        newQuizDesc.trim() || "",
        newQuizQuestions,
        totalPoints,
        newQuizTimeLimit ? parseInt(newQuizTimeLimit, 10) : null,
        newQuizDeadline || null,
        newQuizProctoringMode,
        newQuizStrictImmediateKick ? 0 : newQuizMaxLeaves,
        newQuizGraceSeconds,
        newQuizStrictImmediateKick
      );
      onUpdateState(data.db);
      setSuccess("تم نشر الاختبار الجديد وإرسال تنبيه فوري لجميع المشتركين بنجاح! 🏆");
      setNewQuizTitle("");
      setNewQuizDesc("");
      setNewQuizTimeLimit("");
      setNewQuizDeadline("");
      setNewQuizQuestions([]);
      setNewQuizProctoringMode("WARN");
      setNewQuizGraceSeconds(3);
      setNewQuizMaxLeaves(1);
      setNewQuizStrictImmediateKick(false);
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
    } finally {
      setIsCreatingQuiz(false);
    }
  };

  const handleDeleteQuiz = async (quizId: string) => {
    if (!window.confirm("هل أنت متأكد من رغبتك في حذف هذا الاختبار وكافة تسليمات المشاركين له بشكل نهائي؟ لا يمكن التراجع عن هذا الإجراء.")) {
      return;
    }

    try {
      const data = await ApiService.deleteQuiz(quizId);
      onUpdateState(data.db);
      setSuccess("تم حذف الاختبار وتسليماته بنجاح.");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
    }
  };

  const handleTerminateQuiz = async (quizId: string) => {
    if (!window.confirm("هل أنت متأكد من رغبتك في إنهاء هذا الاختبار مبكراً الآن؟ لن يتمكن أي مشارك لم يبدأ بعد من حله.")) {
      return;
    }

    try {
      const data = await ApiService.terminateQuiz(quizId);
      onUpdateState(data.db);
      setSuccess("تم إغلاق وإنهاء الاختبار مبكراً بنجاح! 🔒");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
    }
  };

  const handleExtendQuizGlobal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendingQuiz) return;
    if (!globalExtDate) {
      setError("يرجى تحديد تاريخ وقت التمديد العام الجديد");
      return;
    }
    setIsExtendingQuiz(true);
    try {
      const data = await ApiService.extendQuizGlobal(extendingQuiz.id, globalExtDate);
      onUpdateState(data.db);
      setSuccess("تم تمديد المهلة العامة للاختبار وإعادة فتحه لجميع المشاركين بنجاح! ⏰");
      setExtendingQuiz(null);
      setGlobalExtDate("");
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء تمديد الاختبار");
    } finally {
      setIsExtendingQuiz(false);
    }
  };

  const handleExtendQuizUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendingQuiz) return;
    if (selectedStudentIdsForExt.length === 0) {
      setError("يرجى تحديد شاب واحد على الأقل لمنحه المهلة الخاصة الاستثنائية");
      return;
    }
    if (!userExtDate) {
      setError("يرجى تحديد تاريخ انتهاء المهلة الخاصة للشباب المختارين");
      return;
    }
    setIsExtendingQuiz(true);
    try {
      const data = await ApiService.extendQuizUser(extendingQuiz.id, selectedStudentIdsForExt, userExtDate);
      onUpdateState(data.db);
      setSuccess(`تم بنجاح منح مهلة خاصة ممتدة لعدد (${selectedStudentIdsForExt.length}) من الشباب المختارين وبث التنبيهات لهم! ⭐`);
      setExtendingQuiz(null);
      setSelectedStudentIdsForExt([]);
      setUserExtDate("");
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء منح المهلة الخاصة");
    } finally {
      setIsExtendingQuiz(false);
    }
  };

  // Reset all database configuration back to initial seed data
  const handleResetData = async () => {
    if (!window.confirm("تحذير هام! هل تريد حقاً إعادة ضبط جميع البيانات الافتراضية وحذف المهام الجديدة؟")) {
      return;
    }

    try {
      const data = await ApiService.resetData();
      onUpdateState(data.db);
      setSuccess("تم تصفير وإعادة ضبط قاعدة البيانات للقيم الافتراضية.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 4. Verify Confession Submission
  const handleVerifyConfession = async (userId: string, monthIndex: number, status: "approved" | "rejected") => {
    // Instant optimistic update
    if (state && state.confessions) {
      const userConf = state.confessions[userId] || { months: {} };
      const currentMonthData = userConf.months[monthIndex.toString()] || {};
      const updatedMonthData: Record<string, any> = {
        ...currentMonthData,
        status: status,
      };
      if (status === "rejected") {
        delete updatedMonthData.proofImage;
        delete updatedMonthData.confessionProofUrl;
        delete updatedMonthData.submittedAt;
        delete updatedMonthData.approvedAt;
        updatedMonthData.rejectedAt = new Date().toISOString();
      } else {
        updatedMonthData.approvedAt = new Date().toISOString();
        delete updatedMonthData.rejectedAt;
      }

      const updatedConfessions: Record<string, any> = {
        ...state.confessions,
        [userId]: {
          ...userConf,
          months: {
            ...userConf.months,
            [monthIndex.toString()]: updatedMonthData
          }
        }
      };
      onUpdateState({
        ...state,
        confessions: updatedConfessions
      });
    }

    try {
      const data = await ApiService.verifyConfession(userId, monthIndex, status);
      onUpdateState(data.db);
      setSuccess(status === "approved" ? "تم اعتماد الاعتراف وإضافة 20 نقطة للمشارك بنجاح! 🕊️" : "تم رفض الإثبات وإبلاغ المشارك لإعادة الرفع.");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
      ApiService.getState().then(s => onUpdateState(s)).catch(() => {});
    }
  };

  // 5. Direct/Manual Confession Registration
  const handleManualConfirmConfession = async (userId: string, monthIndex: number) => {
    // Instant optimistic update
    if (state && state.confessions) {
      const userConf = state.confessions[userId] || { months: {} };
      const currentMonthData = userConf.months[monthIndex.toString()] || {};
      const updatedConfessions: Record<string, any> = {
        ...state.confessions,
        [userId]: {
          ...userConf,
          months: {
            ...userConf.months,
            [monthIndex.toString()]: {
              ...currentMonthData,
              status: "approved" as const,
              approvedAt: new Date().toISOString()
            }
          }
        }
      };
      onUpdateState({
        ...state,
        confessions: updatedConfessions
      });
    }

    try {
      const data = await ApiService.manualConfirmConfession(userId, monthIndex);
      onUpdateState(data.db);
      setSuccess("تم تسجيل الاعتراف وتأكيده يدوياً للمشارك بنجاح! (+20 نقطة) ✓");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
      ApiService.getState().then(s => onUpdateState(s)).catch(() => {});
    }
  };

  // 5.5. Cancel / Revert Confession Approval
  const handleRevertConfession = async (userId: string, monthIndex: number) => {
    if (!window.confirm("هل أنت متأكد من رغبتك في إلغاء اعتماد هذا الاعتراف؟ سيتم تخصيم 20 نقطة من رصيد المشارك وإلغاء حالة الاعتماد.")) {
      return;
    }

    // Instant optimistic update
    if (state && state.confessions) {
      const userConf = state.confessions[userId] || { months: {} };
      const monthKey = monthIndex.toString();
      const monthData = (userConf.months[monthKey] || {}) as ConfessionMonth;
      let updatedMonths = { ...userConf.months };

      if (monthData.proofImage || monthData.submittedAt) {
        updatedMonths[monthKey] = {
          ...monthData,
          status: "pending" as const,
        };
        delete updatedMonths[monthKey].approvedAt;
      } else {
        delete updatedMonths[monthKey];
      }

      onUpdateState({
        ...state,
        confessions: {
          ...state.confessions,
          [userId]: {
            ...userConf,
            months: updatedMonths
          }
        }
      });
    }

    try {
      const data = await ApiService.revertConfession(userId, monthIndex);
      onUpdateState(data.db);
      setSuccess("تم إلغاء اعتماد الاعتراف وتخصيم 20 نقطة بنجاح! ↺");
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء إلغاء اعتماد الاعتراف");
      ApiService.getState().then(s => onUpdateState(s)).catch(() => {});
    }
  };

  // 6. Add Custom Bonus Points
  const handleAddBonus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bonusUserId || !bonusReason.trim() || bonusPoints === undefined) {
      setError("يرجى ملء جميع حقول البونص المطلوبة");
      return;
    }
    setIsSubmittingBonus(true);
    try {
      const data = await ApiService.addBonus(bonusUserId, bonusPoints, bonusReason.trim());
      onUpdateState(data.db);
      setSuccess("تمت إضافة نقاط البونص والمكافأة بنجاح! 🎉");
      setBonusReason("");
      setBonusPoints(10);
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
    } finally {
      setIsSubmittingBonus(false);
    }
  };

  // 7. Delete Custom Bonus Points
  const handleDeleteBonus = async (id: string) => {
    if (!window.confirm("هل تريد حقاً إلغاء وحذف نقاط هذا البونص؟")) return;
    try {
      const data = await ApiService.deleteBonus(id);
      onUpdateState(data.db);
      setSuccess("تم حذف البونص وإعادة احتساب نقاط المشارك.");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
    }
  };

  // 8. Submit Manual Paper Quiz Score
  const handleManualQuizSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualQuizId || !manualQuizUserId || manualQuizScore === undefined) {
      setError("يرجى اختيار الكويز والمشارك وتحديد الدرجة لتسجيلها");
      return;
    }
    setIsSubmittingManualQuiz(true);
    try {
      const data = await ApiService.manualSubmitQuiz(manualQuizUserId, manualQuizId, manualQuizScore);
      onUpdateState(data.db);
      setSuccess("تم رصد درجة الاختبار الورقي للمشارك بنجاح! 🏆");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما");
    } finally {
      setIsSubmittingManualQuiz(false);
    }
  };

  // 9. Reset Leaderboard Scores with 2-Step Verification
  const handleResetLeaderboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetConfirmInput !== "RESET") {
      setError("يرجى كتابة كلمة RESET بالضبط لتأكيد تصفير النقاط");
      return;
    }
    if (!window.confirm("هل أنت تأكد بالتأكيد من تصفير لوحة الصدارة وتنظيف البيانات؟")) {
      return;
    }
    setIsResettingLeaderboard(true);
    try {
      const data = await ApiService.resetLeaderboard();
      onUpdateState(data.db);
      setSuccess("تمت إعادة تعيين وتصفير الماراثون وسجلات الغياب بالكامل لبدء دورة جديدة من الأسبوع الأول بنجاح! 🏆");
      setIsResetLeaderboardOpen(false);
      setResetConfirmInput("");
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء إعادة ضبط الماراثون");
    } finally {
      setIsResettingLeaderboard(false);
    }
  };

  // 10. Full Database Backup Export
  const handleExportBackup = async () => {
    setIsExportingBackup(true);
    try {
      const { blob, filename } = await ApiService.exportBackup();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccess("تم تصدير نسخة احتياطية كاملة وتحميلها بنجاح! 💾");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء تصدير النسخة الاحتياطية";
      setError(msg);
    } finally {
      setIsExportingBackup(false);
    }
  };

  // 11. Storage Proofs Migration
  const handleMigrateProofs = async () => {
    setIsMigratingProofs(true);
    try {
      const res = await ApiService.migrateProofs();
      setSuccess(res.message || "تم ترحيل الصور إلى الخادم السحابي بنجاح! ☁️");
      if (res.totalMigrated > 0) {
        const fresh = await ApiService.getState(true);
        onUpdateState(fresh);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء ترحيل الصور إلى الخادم السحابي";
      setError(msg);
    } finally {
      setIsMigratingProofs(false);
    }
  };

  // Filter members in Attendance sub-search - memoized for performance
  const filteredParticipantsForAtt = React.useMemo(() => {
    return participants.filter(p => 
      p.name.includes(searchMember)
    );
  }, [participants, searchMember]);

  return (
    <div className="space-y-6">

      {/* Tabs */}
      <div className="flex border-b border-natural-border gap-1 overflow-x-auto pb-px">
        <button
          onClick={() => setActiveTab("attendance")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "attendance"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          📅 رصد الغياب والحضور
        </button>
        <button
          onClick={() => setActiveTab("admin_dashboard")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "admin_dashboard"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          📊 لوحة التصحيح والتسليمات
        </button>
        <button
          onClick={() => setActiveTab("quizzes")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "quizzes"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          📝 كويزات واختبارات لجنة التقييم
        </button>
        <button
          onClick={() => setActiveTab("tasks_review")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all relative whitespace-nowrap cursor-pointer ${
            activeTab === "tasks_review"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          📥 مراجعة تسليمات المهام
          {submittedTasks.length > 0 && (
            <span className="absolute -top-1 -left-1.5 bg-amber-800 text-white font-extrabold text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-pulse shadow-sm">
              {submittedTasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("confessions")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all relative whitespace-nowrap cursor-pointer ${
            activeTab === "confessions"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          🕊️ إدارة الاعترافات الشهري
          {Object.keys(state?.confessions || {}).reduce((count, uId) => {
            const userConf = state?.confessions?.[uId];
            if (userConf && userConf.months) {
              Object.values(userConf.months).forEach((m: any) => {
                if (m.status === "pending") {
                  count++;
                }
              });
            }
            return count;
          }, 0) > 0 && (
            <span className="absolute -top-1 -left-1.5 bg-amber-800 text-white font-extrabold text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-pulse shadow-sm">
              {Object.keys(state?.confessions || {}).reduce((count, uId) => {
                const userConf = state?.confessions?.[uId];
                if (userConf && userConf.months) {
                  Object.values(userConf.months).forEach((m: any) => {
                    if (m.status === "pending") {
                      count++;
                    }
                  });
                }
                return count;
              }, 0)}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("assign_task")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "assign_task"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          ✍️ تكليف مهمة لمشارك
        </button>
        <button
          onClick={() => setActiveTab("bonus_quiz_manual")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "bonus_quiz_manual"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          🎁 البونص والدرجات الورقية
        </button>
        <button
          onClick={() => setActiveTab("broadcast")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "broadcast"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          📢 بث تنبيه جماعي (نوتيفيكيشن)
        </button>
        <button
          onClick={() => setActiveTab("manage_users")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "manage_users"
              ? "border-natural-green text-natural-green font-extrabold"
              : "border-transparent text-natural-muted hover:text-natural-text"
          }`}
        >
          👥 إضافة وإدارة المشاركين
        </button>

        <div className="flex items-center gap-2 shrink-0 my-auto ml-auto">
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={isExportingBackup}
            className="px-3 py-1.5 text-xs font-black bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            title="تصدير نسخة احتياطية كاملة من قاعدة البيانات"
          >
            {isExportingBackup ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
            ) : (
              <Download className="w-3.5 h-3.5 text-emerald-700" />
            )}
            تصدير نسخة احتياطية
          </button>

          <button
            type="button"
            onClick={handleMigrateProofs}
            disabled={isMigratingProofs}
            className="px-3 py-1.5 text-xs font-black bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            title="ترحيل صور الإثباتات من قاعدة البيانات إلى Firebase Cloud Storage"
          >
            {isMigratingProofs ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-700" />
            ) : (
              <Cloud className="w-3.5 h-3.5 text-sky-700" />
            )}
            ترحيل الصور للسحاب
          </button>

          <button
            type="button"
            onClick={() => {
              setIsResetLeaderboardOpen(true);
              setResetConfirmInput("");
            }}
            className="px-3 py-1.5 text-xs font-black bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            title="تصفير وإعادة ضبط نقاط لوحة المتصدرين"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
            تصفير لوحة المتصدرين
          </button>
        </div>
      </div>

      {/* Tab 0: Admin Dashboard */}
      {activeTab === "admin_dashboard" && (
        <AdminDashboard
          state={state}
          onUpdateState={onUpdateState}
          onRefreshData={handleRefreshSubmissions}
          isLoading={isFetchingSubmissions}
        />
      )}

      {/* Tab 1: Attendance Roster */}
      {activeTab === "attendance" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="text-base font-bold text-natural-green">تحديث سجل حضور وغياب الشباب</h3>
              <p className="text-xs text-natural-muted">اختر نوع النشاط والأسبوع ثم انقر لحفظ الغياب لكل شاب فوراً.</p>
            </div>

            {/* Attendance config selector */}
            <div className="flex flex-wrap gap-2.5 items-center">
              <div className="flex rounded-xl bg-natural-cream p-1 border border-natural-border">
                <button
                  onClick={() => setSelectedActivity("meetings")}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    selectedActivity === "meetings" ? "bg-natural-green text-white shadow-xs" : "text-natural-text hover:text-natural-green"
                  }`}
                >
                  اجتماع الجمعة (+{state?.config?.points?.meeting ?? 10})
                </button>
                <button
                  onClick={() => setSelectedActivity("liturgy")}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    selectedActivity === "liturgy" ? "bg-natural-green text-white shadow-xs" : "text-natural-text hover:text-natural-green"
                  }`}
                >
                  القداس الأسبوعي (+{state?.config?.points?.liturgy ?? 20})
                </button>
                <button
                  onClick={() => setSelectedActivity("praise")}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    selectedActivity === "praise" ? "bg-natural-green text-white shadow-xs" : "text-natural-text hover:text-natural-green"
                  }`}
                >
                  تسبحة الخميس (+{state?.config?.points?.praise ?? 20})
                </button>
              </div>

              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(parseInt(e.target.value, 10))}
                className="bg-natural-cream border border-natural-border font-bold text-natural-text px-3 py-1.5 rounded-xl text-xs outline-hidden cursor-pointer"
              >
                {Array.from({ length: state?.config?.durationWeeks ?? 12 }).map((_, idx) => (
                  <option key={idx} value={idx + 1}>
                    الأسبوع {idx + 1}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick search and QR Scanner button */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-natural-muted" />
              <input
                type="text"
                placeholder="ابحث عن اسم المشارك لتسجيل حضوره..."
                value={searchMember}
                onChange={(e) => setSearchMember(e.target.value)}
                className="w-full pl-3 pr-9 py-2 text-xs rounded-xl border border-natural-border focus:outline-hidden focus:border-natural-green bg-natural-cream focus:bg-white transition-all font-semibold text-natural-text"
              />
            </div>

            <button
              onClick={() => setIsQRScannerOpen(true)}
              className="bg-natural-accent hover:bg-natural-accent/90 text-white font-extrabold text-xs px-4 py-2 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0 animate-bounce hover:animate-none"
            >
              <QrCode className="w-4 h-4" />
              <span>📷 مسح كود الـ QR للحضور</span>
            </button>
          </div>

          {/* Attendance list */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredParticipantsForAtt.map((p) => {
              const userAtt = (state?.attendance || {})[p.id] || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
              const attendedList = userAtt[selectedActivity] || [];
              const hasAttended = attendedList.includes(selectedWeek);
              const currentLiturgyScore = userAtt.liturgyScores?.[selectedWeek.toString()];

              const cellKey = selectedActivity === "liturgy" 
                ? `${p.id}_liturgy_${selectedWeek}`
                : `${p.id}_${selectedActivity}_${selectedWeek}`;
              const isCellUpdating = !!updatingAttendanceKeys[cellKey];

              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-2xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all select-none ${
                    isCellUpdating 
                      ? "opacity-60 cursor-not-allowed bg-natural-cream/35 border-natural-border"
                      : "bg-white border-natural-border text-natural-text"
                  }`}
                >
                  <div className="text-right">
                    <h4 className="font-bold text-sm text-natural-text flex items-center gap-1.5">
                      {p.name}
                      {isCellUpdating && <Loader2 className="w-3.5 h-3.5 animate-spin text-natural-green" />}
                    </h4>
                    <p className="text-[10px] text-natural-muted mt-0.5">
                      الإجمالي: {((userAtt.meetings?.length || 0) + (userAtt.liturgy?.length || 0) + (userAtt.praise?.length || 0))} حضور
                    </p>
                  </div>

                  {selectedActivity !== "liturgy" ? (
                    <div className="flex flex-wrap gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        disabled={isCellUpdating}
                        onClick={() => handleToggleAttendance(p.id, true)}
                        className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isCellUpdating
                            ? "opacity-50 cursor-not-allowed"
                            : hasAttended
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-xs font-black"
                              : "bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                        }`}
                      >
                        ✓ حاضر
                      </button>
                      <button
                        disabled={isCellUpdating}
                        onClick={() => handleToggleAttendance(p.id, false)}
                        className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isCellUpdating
                            ? "opacity-50 cursor-not-allowed"
                            : !hasAttended
                              ? "bg-rose-600 text-white border-rose-600 shadow-xs font-black"
                              : "bg-white text-rose-600 border-rose-200 hover:bg-rose-50"
                        }`}
                      >
                        ✕ غائب
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        disabled={isCellUpdating}
                        onClick={() => handleLiturgyAttendance(p.id, true, 20)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isCellUpdating
                            ? "opacity-50 cursor-not-allowed"
                            : hasAttended && currentLiturgyScore === 20
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                              : "bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                        }`}
                      >
                        ✓ 20 نقطة
                      </button>
                      <button
                        disabled={isCellUpdating}
                        onClick={() => handleLiturgyAttendance(p.id, true, 10)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isCellUpdating
                            ? "opacity-50 cursor-not-allowed"
                            : hasAttended && currentLiturgyScore === 10
                              ? "bg-amber-500 text-white border-amber-500 shadow-xs"
                              : "bg-white text-amber-500 border-amber-200 hover:bg-amber-50"
                        }`}
                      >
                        ✓ 10 نقاط
                      </button>
                      <button
                        disabled={isCellUpdating}
                        onClick={() => handleLiturgyAttendance(p.id, false, 0)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isCellUpdating
                            ? "opacity-50 cursor-not-allowed"
                            : !hasAttended
                              ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                              : "bg-white text-rose-600 border-rose-200 hover:bg-rose-50"
                        }`}
                      >
                        ✕ غائب
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Review Submitted Tasks */}
      {activeTab === "tasks_review" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div>
            <h3 className="text-base font-bold text-natural-green">مراجعة المهام المرسلة من الشباب</h3>
            <p className="text-xs text-natural-muted">الشباب الذين ينهون مهامهم يرفعون صورة وإثباتاً للتنفيذ، مراجعتك واعتمادك تضيف لهم النقاط.</p>
          </div>

          {submittedTasks.length > 0 ? (
            <div className="divide-y divide-natural-border border border-natural-border rounded-2xl overflow-hidden">
              {submittedTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => {
                    setSelectedProofTask(task);
                    setAdminFeedback(task.feedback || "");
                    setAiAnalysis("");
                  }}
                  className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-natural-cream/40 cursor-pointer transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="bg-natural-green/15 text-natural-green font-bold text-[10px] px-2 py-0.5 rounded-full">
                        بانتظار المراجعة
                      </span>
                      <span className="text-xs font-semibold text-natural-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {task.submittedAt ? new Date(task.submittedAt).toLocaleDateString("ar-EG") : ""}
                      </span>
                    </div>
                    <h4 className="font-bold text-natural-text text-sm">{task.title}</h4>
                    <p className="text-xs text-natural-muted">المكلف بها: <span className="text-natural-accent font-semibold">{getUserName(task.userId)}</span></p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-natural-accent bg-natural-accent/10 px-2.5 py-1 rounded-xl">
                      +{task.points} نقطة
                    </span>
                    <ChevronLeft className="w-4 h-4 text-natural-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-natural-muted font-semibold flex flex-col items-center justify-center gap-2 bg-natural-cream/25 rounded-2xl border border-natural-border border-dashed">
              <CheckCircle2 className="w-10 h-10 text-natural-green stroke-[1.5]" />
              <p className="text-sm">ممتاز! لا يوجد أي مهام معلقة تنتظر المراجعة حالياً.</p>
            </div>
          )}

          {/* Proof Modal Details */}
          {selectedProofTask && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in transform-gpu">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100"
              >
                <button
                  onClick={() => {
                    setSelectedProofTask(null);
                    setAiAnalysis("");
                  }}
                  className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-black p-1 cursor-pointer"
                >
                  ✕
                </button>
                <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 pr-6">
                  <div>
                    <span className="text-xs font-bold text-natural-green bg-natural-green/10 px-2 py-0.5 rounded-md">تفاصيل تسليم المهمة</span>
                    <h4 className="text-base font-bold text-natural-text dark:text-slate-100 mt-1">المشارك: {getUserName(selectedProofTask.userId)}</h4>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Task Metadata & Text proof */}
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-natural-muted">اسم المهمة والمكافأة</p>
                      <h5 className="font-bold text-natural-green text-sm mt-0.5">{selectedProofTask.title}</h5>
                      <p className="text-xs text-natural-muted mt-0.5">{selectedProofTask.description}</p>
                      <span className="inline-block mt-2 text-xs font-bold text-natural-accent bg-natural-accent/10 px-2 py-0.5 rounded-md">
                        المكافأة: {selectedProofTask.points} نقطة
                      </span>
                    </div>

                    <div className="bg-natural-cream/50 p-3.5 rounded-2xl border border-natural-border">
                      <p className="text-xs font-bold text-natural-green mb-1">📝 تعليق وإثبات المشارك:</p>
                      <p className="text-xs text-natural-text whitespace-pre-line leading-relaxed font-semibold">
                        {selectedProofTask.proofNote || "لا يوجد تعليق مكتوب."}
                      </p>
                    </div>

                    {/* Gemini AI assistant container */}
                    <div className="border border-natural-accent/20 bg-natural-accent/5 p-4 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-natural-accent flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-natural-accent animate-pulse" />
                          مراجعة ذكية بـ Gemini AI
                        </span>
                        
                        <button
                          onClick={() => handleAiAnalysis(selectedProofTask.id)}
                          disabled={isAnalyzing}
                          className="bg-natural-accent hover:bg-natural-accent/90 disabled:bg-natural-accent/50 text-white font-bold text-xs px-3 py-1 rounded-xl transition-all cursor-pointer"
                        >
                          {isAnalyzing ? "جاري التحليل..." : "حلل الصورة والبيانات"}
                        </button>
                      </div>

                      {isAnalyzing ? (
                        <div className="flex items-center gap-2 text-xs text-natural-accent font-semibold animate-pulse">
                          <ImageIcon className="w-4 h-4 animate-bounce text-natural-accent" />
                          <span>Gemini يقوم بقراءة الصورة وتحليل مدى مطابقتها للتاسك حالياً...</span>
                        </div>
                      ) : aiAnalysis ? (
                        <div className="text-xs text-natural-text bg-white/90 p-3 rounded-xl border border-natural-accent/15 leading-relaxed max-h-48 overflow-y-auto">
                          {aiAnalysis}
                        </div>
                      ) : (
                        <p className="text-[10px] text-natural-muted">
                          بضغطة واحدة، يقوم Gemini بفحص الصورة المرفوعة والتعليق واقتراح القبول والتعليق المشجع لتوفير وقتك!
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Uploaded Image preview */}
                  <div className="flex flex-col justify-between space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-natural-muted mb-1">🖼️ الصورة المرفوعة كدليل:</p>
                      {selectedProofTask.proofImage ? (
                        <div className="rounded-2xl overflow-hidden border border-natural-border bg-natural-cream h-52 relative flex items-center justify-center">
                          <AuthenticatedImage
                            src={selectedProofTask.proofImage.startsWith("data:") ? selectedProofTask.proofImage : `/api/tasks/${selectedProofTask.id}/image`}
                            alt="إثبات المهمة"
                            className="max-h-full max-w-full object-contain cursor-zoom-in"
                            onClick={() => setZoomedImage(selectedProofTask.proofImage.startsWith("data:") ? selectedProofTask.proofImage : `/api/tasks/${selectedProofTask.id}/image`)}
                          />
                        </div>
                      ) : (
                        <div className="rounded-2xl border-2 border-dashed border-natural-border h-44 flex flex-col items-center justify-center text-natural-muted bg-natural-cream/35 gap-1 text-xs">
                          <ImageIcon className="w-8 h-8 text-natural-muted/55" />
                          <span>لم يرفع العضو أي صورة</span>
                        </div>
                      )}
                    </div>

                    {/* Admin Verification Forms */}
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-natural-green mb-1">رسالة للخادم أو تعليق تشجيعي:</label>
                        <textarea
                          rows={2}
                          placeholder="اكتب تعليقك تشجيعاً للشاب أو سبب رفض التاسك..."
                          value={adminFeedback}
                          onChange={(e) => setAdminFeedback(e.target.value)}
                          className="w-full text-xs p-2.5 rounded-xl border border-natural-border outline-hidden focus:border-natural-green bg-natural-cream focus:bg-white resize-none text-natural-text font-semibold"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleVerifyTask(selectedProofTask.id, "approved")}
                          disabled={isVerifying}
                          className="flex-1 bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4 text-natural-accent" /> اعتماد وقبول المهمة
                        </button>
                        <button
                          onClick={() => handleVerifyTask(selectedProofTask.id, "rejected")}
                          disabled={isVerifying}
                          className="bg-rose-100 hover:bg-rose-200 disabled:bg-rose-50 text-rose-700 font-bold py-2 px-3 rounded-xl text-xs border border-rose-200 flex items-center justify-center gap-1 transition-all cursor-pointer"
                        >
                          <XCircle className="w-4 h-4" /> رفض وتعديل
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Tab 6: Quizzes & Evaluation Committee Grading */}
      {activeTab === "quizzes" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-natural-green flex items-center gap-1.5">
              <BookOpen className="w-5 h-5 text-natural-accent" />
              إدارة الكويزات والاختبارات التفاعلية
            </h3>
            <p className="text-xs text-natural-muted">
              قم بصياغة كويزات تفاعلية اختيارية ومقالية لتقييم معرفة الشباب الروحية والكتابية، وسيقوم نظام لجنة التقييم التلقائي بتصحيح الجزء المقالي منها وتقديم درجات عادلة وملاحظات مشجعة تلقائياً!
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* 1. Create Quiz Section */}
            <div className="space-y-4 border-l border-natural-border/40 pl-0 xl:pl-6">
              <div className="p-4 bg-natural-cream/35 border border-natural-border/70 rounded-2xl">
                <h4 className="text-xs font-black text-natural-green mb-3 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-natural-accent" />
                  إنشاء اختبار جديد ونشره للجميع
                </h4>

                <form onSubmit={handlePublishQuiz} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-natural-green mb-1">عنوان الكويز:</label>
                      <input
                        type="text"
                        required
                        placeholder="مثال: مسابقة في إنجيل القديس مرقس"
                        value={newQuizTitle}
                        onChange={(e) => setNewQuizTitle(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-natural-green mb-1">وصف موجز للاختبار:</label>
                      <input
                        type="text"
                        placeholder="مثال: يرجى الحل بدقة لكسب النقاط والتقييم"
                        value={newQuizDesc}
                        onChange={(e) => setNewQuizDesc(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-natural-green mb-1">مدة الاختبار (بالدقائق):</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="مثال: 15 (مفتوح)"
                        value={newQuizTimeLimit}
                        onChange={(e) => setNewQuizTimeLimit(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-natural-green mb-1">تاريخ ووقت الانتهاء (اختياري):</label>
                      <input
                        type="datetime-local"
                        value={newQuizDeadline}
                        onChange={(e) => setNewQuizDeadline(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold text-right"
                      />
                    </div>
                  </div>

                  {/* Proctoring & Anti-Cheat Settings */}
                  <div className="bg-white p-3.5 rounded-xl border border-natural-border/70 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="block text-[11px] font-black text-natural-green flex items-center gap-1.5">
                        🛡️ وضع المراقبة ومنع الغش (Proctoring Mode):
                      </span>
                      <span className="text-[10px] text-natural-muted font-bold">
                        يتضمن إبقاء الشاشة مضاءة للقراءة في الكتاب المقدس الورقي
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <label
                        className={`p-2.5 rounded-xl border cursor-pointer flex flex-col gap-1 transition-all ${
                          newQuizProctoringMode === "WARN"
                            ? "bg-amber-50 border-amber-300 ring-2 ring-amber-400/30 text-amber-900"
                            : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="proctoringMode"
                            value="WARN"
                            checked={newQuizProctoringMode === "WARN"}
                            onChange={() => setNewQuizProctoringMode("WARN")}
                            className="accent-amber-600"
                          />
                          <span className="text-xs font-black">وضع التنبيه (WARN) ⚠️</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-semibold pr-5">
                          رصد مغادرة الشاشة وتسجيلها بالخادم مع إظهار تنبيه توعوي (الافتراضي).
                        </p>
                      </label>

                      <label
                        className={`p-2.5 rounded-xl border cursor-pointer flex flex-col gap-1 transition-all ${
                          newQuizProctoringMode === "STRICT"
                            ? "bg-rose-50 border-rose-300 ring-2 ring-rose-400/30 text-rose-900"
                            : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="proctoringMode"
                            value="STRICT"
                            checked={newQuizProctoringMode === "STRICT"}
                            onChange={() => setNewQuizProctoringMode("STRICT")}
                            className="accent-rose-600"
                          />
                          <span className="text-xs font-black">الوضع الصارم (STRICT) 🛡️</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-semibold pr-5">
                          نافذة تحذير غير قابلة للإغلاق أولاً، ثم قفل وتسليم تلقائي فوري عند التكرار.
                        </p>
                      </label>

                      <label
                        className={`p-2.5 rounded-xl border cursor-pointer flex flex-col gap-1 transition-all ${
                          newQuizProctoringMode === "OFF"
                            ? "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-400/30 text-emerald-900"
                            : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="proctoringMode"
                            value="OFF"
                            checked={newQuizProctoringMode === "OFF"}
                            onChange={() => setNewQuizProctoringMode("OFF")}
                            className="accent-emerald-600"
                          />
                          <span className="text-xs font-black">معطل (OFF) 🟢</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-semibold pr-5">
                          حل مفتوح بالكامل دون أي رصد لمغادرة الشاشة أو التبديل.
                        </p>
                      </label>
                    </div>

                    {newQuizProctoringMode !== "OFF" && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-natural-border/40">
                          <div>
                            <label className="block text-[10px] font-bold text-natural-green mb-1">
                              مهلة السماح قبل احتساب الخروج (بالثواني):
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="60"
                              value={newQuizGraceSeconds}
                              onChange={(e) => setNewQuizGraceSeconds(Math.max(1, parseInt(e.target.value, 10) || 3))}
                              className="w-full text-xs p-2 rounded-lg border border-natural-border bg-natural-cream outline-hidden font-bold"
                            />
                            <span className="text-[9px] text-natural-muted font-medium mt-0.5 block">
                              أي خروج أقل من {newQuizGraceSeconds} ثوانٍ يتم تجاهله (لتفادي اللمسات العارضة).
                            </span>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-natural-green mb-1">
                              الحد الأقصى للمخالفات المسموحة قبل القفل:
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="10"
                              value={newQuizMaxLeaves}
                              disabled={newQuizStrictImmediateKick}
                              onChange={(e) => setNewQuizMaxLeaves(Math.max(0, parseInt(e.target.value, 10) || 1))}
                              className="w-full text-xs p-2 rounded-lg border border-natural-border bg-natural-cream outline-hidden font-bold disabled:opacity-60"
                            />
                            <span className="text-[9px] text-natural-muted font-medium mt-0.5 block">
                              {newQuizStrictImmediateKick
                                ? "تم قفله على 0 بسبب تفعيل الإنهاء الفوري عند أول خروج."
                                : `في الوضع الصارم: يتم إظهار إنذار أولاً، ثم القفل التلقائي بعد ${newQuizMaxLeaves} خروج.`}
                            </span>
                          </div>
                        </div>

                        {/* Strict Immediate Kick Toggle */}
                        <div className="pt-2 border-t border-natural-border/40">
                          <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors">
                            <input
                              type="checkbox"
                              checked={newQuizStrictImmediateKick}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setNewQuizStrictImmediateKick(checked);
                                if (checked) {
                                  setNewQuizMaxLeaves(0);
                                  setNewQuizGraceSeconds(1);
                                  setNewQuizProctoringMode("STRICT");
                                } else {
                                  setNewQuizMaxLeaves(1);
                                  setNewQuizGraceSeconds(3);
                                }
                              }}
                              className="w-4 h-4 rounded text-rose-600 accent-rose-600 cursor-pointer shrink-0 mt-0.5"
                            />
                            <div className="space-y-0.5">
                              <span className="text-xs font-black text-rose-700 dark:text-rose-400 block">
                                إنهاء فوري عند أول خروج (Strict Immediate Kick) ⚡
                              </span>
                              <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold leading-relaxed block">
                                تعيين maxLeaves = 0: يؤدي أول خروج من صفحة الاختبار أو الخروج من وضع ملء الشاشة أو تقسيم الشاشة إلى تسليم وإلغاء الامتحان فوراً دون أي مهلة سماح أو فرصة ثانية.
                              </span>
                            </div>
                          </label>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Default Points by Question Type */}
                  <div className="bg-white p-3.5 rounded-xl border border-natural-border/70 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="block text-[11px] font-black text-natural-green flex items-center gap-1.5">
                        🎯 التوزيع الافتراضي للدرجات حسب نوع السؤال:
                      </span>
                      <span className="text-[10px] text-natural-muted font-bold">
                        تعديل الدرجة الافتراضية يحدّث تلقائياً جميع الأسئلة غير المخصصة يدوياً
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                      <div className="bg-natural-cream/35 border border-natural-border/70 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-natural-green block">اختيار من متعدد:</span>
                          <span className="text-[9px] text-natural-muted font-medium">MCQ</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={defaultMcqPoints}
                            onChange={(e) => handleDefaultMcqPointsChange(parseFloat(e.target.value))}
                            className="w-12 text-xs font-black text-center p-1.5 rounded-lg border border-natural-border bg-white focus:border-natural-green outline-hidden"
                          />
                          <span className="text-[10px] text-natural-muted font-bold">نقاط</span>
                        </div>
                      </div>

                      <div className="bg-natural-cream/35 border border-natural-border/70 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-natural-olive block">صح أم خطأ:</span>
                          <span className="text-[9px] text-natural-muted font-medium">True/False</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={defaultTrueFalsePoints}
                            onChange={(e) => handleDefaultTrueFalsePointsChange(parseFloat(e.target.value))}
                            className="w-12 text-xs font-black text-center p-1.5 rounded-lg border border-natural-border bg-white focus:border-natural-green outline-hidden"
                          />
                          <span className="text-[10px] text-natural-muted font-bold">نقاط</span>
                        </div>
                      </div>

                      <div className="bg-natural-cream/35 border border-natural-border/70 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-indigo-700 block">أكمل الفراغ:</span>
                          <span className="text-[9px] text-natural-muted font-medium">Fill in Blank</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={defaultFillBlankPoints}
                            onChange={(e) => handleDefaultFillBlankPointsChange(parseFloat(e.target.value))}
                            className="w-12 text-xs font-black text-center p-1.5 rounded-lg border border-natural-border bg-white focus:border-natural-green outline-hidden"
                          />
                          <span className="text-[10px] text-natural-muted font-bold">نقاط</span>
                        </div>
                      </div>

                      <div className="bg-natural-cream/35 border border-natural-border/70 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-purple-700 block">من القائل:</span>
                          <span className="text-[9px] text-natural-muted font-medium">Quote</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={defaultQuotePoints}
                            onChange={(e) => handleDefaultQuotePointsChange(parseFloat(e.target.value))}
                            className="w-12 text-xs font-black text-center p-1.5 rounded-lg border border-natural-border bg-white focus:border-natural-green outline-hidden"
                          />
                          <span className="text-[10px] text-natural-muted font-bold">نقاط</span>
                        </div>
                      </div>

                      <div className="bg-natural-cream/35 border border-natural-border/70 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-natural-accent block">سؤال مقالي:</span>
                          <span className="text-[9px] text-natural-muted font-medium">Essay</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={defaultEssayPoints}
                            onChange={(e) => handleDefaultEssayPointsChange(parseFloat(e.target.value))}
                            className="w-12 text-xs font-black text-center p-1.5 rounded-lg border border-natural-border bg-white focus:border-natural-green outline-hidden"
                          />
                          <span className="text-[10px] text-natural-muted font-bold">نقاط</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Add questions & Bulk Import buttons */}
                  <div className="bg-white p-3 rounded-xl border border-natural-border/70 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="block text-[10px] font-bold text-natural-green">➕ إضافة أسئلة للكويز:</span>
                      <button
                        type="button"
                        onClick={() => setIsBulkImportOpen(true)}
                        className="bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black py-1.5 px-3.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                        استيراد أسئلة بنص كامل
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-natural-border/40">
                      <button
                        type="button"
                        onClick={() => handleAddQuestion("choice")}
                        className="bg-natural-green hover:bg-natural-olive text-white text-[10px] font-bold py-1.5 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> اختيار من متعدد ({defaultMcqPoints} ن)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion("boolean")}
                        className="bg-natural-olive hover:bg-natural-green text-white text-[10px] font-bold py-1.5 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> صح / خطأ ({defaultTrueFalsePoints} ن)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion("fill_in_the_blank")}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold py-1.5 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> أكمل الفراغ ({defaultFillBlankPoints} ن)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion("quote")}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-bold py-1.5 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> من القائل ({defaultQuotePoints} ن)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion("essay")}
                        className="bg-natural-accent hover:bg-orange-600 text-white text-[10px] font-bold py-1.5 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> سؤال مقالي ({defaultEssayPoints} ن)
                      </button>
                    </div>
                  </div>

                  {/* Questions builder list */}
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                    {newQuizQuestions.length === 0 ? (
                      <div className="text-center p-6 border border-dashed border-natural-border rounded-xl text-xs text-natural-muted">
                        لم يتم إضافة أي أسئلة بعد. اضغط على أزرار الإضافة بالأعلى للبدء في صياغة الأسئلة!
                      </div>
                    ) : (
                      newQuizQuestions.map((q, qIdx) => {
                        const defPts = q.type === "choice"
                          ? defaultMcqPoints
                          : q.type === "boolean"
                            ? defaultTrueFalsePoints
                            : q.type === "fill_in_the_blank"
                              ? defaultFillBlankPoints
                              : q.type === "quote"
                                ? defaultQuotePoints
                                : defaultEssayPoints;

                        return (
                          <div key={q.id} className="p-4 bg-white border border-natural-border rounded-xl space-y-3 relative shadow-xs">
                            <button
                              type="button"
                              onClick={() => handleRemoveQuestion(qIdx)}
                              className="absolute left-2 top-2 text-red-500 hover:text-red-700 cursor-pointer"
                              title="حذف السؤال"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>

                            <div className="flex items-center gap-2 border-b border-natural-border pb-1.5 flex-wrap">
                              <span className="text-[10px] font-black bg-natural-green/10 text-natural-green px-2 py-0.5 rounded-md">
                                س {qIdx + 1}
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold text-natural-muted">نوع السؤال:</span>
                                <select
                                  value={q.type}
                                  onChange={(e) => handleUpdateQuestionType(qIdx, e.target.value as QuestionType)}
                                  className="text-xs font-bold p-1 rounded-lg border border-natural-border bg-white text-natural-green outline-hidden cursor-pointer"
                                >
                                  <option value="choice">اختيار من متعدد (MCQ)</option>
                                  <option value="boolean">صح أم خطأ (True/False)</option>
                                  <option value="fill_in_the_blank">أكمل الفراغ (Fill in Blank)</option>
                                  <option value="quote">من القائل (Quote)</option>
                                  <option value="essay">سؤال مقالي (Essay)</option>
                                </select>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div>
                                <label className="block text-[9px] font-bold text-natural-green mb-1">نص السؤال الروحي:</label>
                                <input
                                  type="text"
                                  required
                                  placeholder="اكتب السؤال بوضوح هنا..."
                                  value={q.questionText}
                                  onChange={(e) => handleUpdateQuestion(qIdx, "questionText", e.target.value)}
                                  className="w-full text-xs p-2 rounded-lg border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold"
                                />
                              </div>

                              {/* Type choice options */}
                              {q.type === "choice" && (
                                <div className="space-y-1.5 border-r-2 border-natural-accent/30 pr-3 my-2">
                                  <span className="block text-[9px] font-bold text-natural-green">الاختيارات الأربعة لتختار منها:</span>
                                  {q.options.map((opt: string, optIdx: number) => (
                                    <div key={optIdx} className="flex items-center gap-2">
                                      <span className="text-[10px] font-mono text-natural-muted">{optIdx + 1}.</span>
                                      <input
                                        type="text"
                                        required
                                        placeholder={`الخيار رقم ${optIdx + 1}`}
                                        value={opt}
                                        onChange={(e) => handleUpdateOption(qIdx, optIdx, e.target.value)}
                                        className="flex-1 text-xs p-1.5 rounded-lg border border-natural-border outline-hidden focus:border-natural-green font-semibold"
                                      />
                                    </div>
                                  ))}
                                  <div className="pt-1.5">
                                    <label className="block text-[9px] font-bold text-natural-green mb-1">حدد الإجابة الصحيحة (أو اتركها لمفتاح مؤجل):</label>
                                    <select
                                      value={q.correctAnswer || ""}
                                      onChange={(e) => handleUpdateQuestion(qIdx, "correctAnswer", e.target.value)}
                                      className="text-xs p-1.5 rounded-lg border border-natural-border w-full outline-hidden"
                                    >
                                      <option value="">-- تأجيل تحديد الإجابة الصحيحة (مفتاح مؤجل) --</option>
                                      {q.options.map((opt: string, optIdx: number) => (
                                        <option key={optIdx} value={optIdx.toString()}>
                                          {opt.trim() ? opt : `الخيار رقم ${optIdx + 1}`}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              )}

                              {/* Type boolean correct choice */}
                              {q.type === "boolean" && (
                                <div className="space-y-1.5">
                                  <label className="block text-[9px] font-bold text-natural-green">حدد الإجابة الصحيحة:</label>
                                  <select
                                    value={q.correctAnswer}
                                    onChange={(e) => handleUpdateQuestion(qIdx, "correctAnswer", e.target.value)}
                                    className="text-xs p-1.5 rounded-lg border border-natural-border w-full outline-hidden"
                                  >
                                    <option value="true">صح (True)</option>
                                    <option value="false">خطأ (False)</option>
                                  </select>
                                </div>
                              )}

                              {/* Type essay / fill_in_the_blank / quote correct description & rubric */}
                              {(q.type === "essay" || q.type === "fill_in_the_blank" || q.type === "quote") && (
                                <div className="space-y-2">
                                  <div>
                                    <label className="block text-[9px] font-bold text-natural-green mb-1">
                                      {q.type === "fill_in_the_blank"
                                        ? "نموذج الإجابة الصحيحة لإكمال الفراغ (اختياري - مراجعة يدوية):"
                                        : q.type === "quote"
                                        ? "نموذج إسناد القول والسياق (اختياري - مراجعة يدوية):"
                                        : "الإجابة النموذجية الصحيحة (للمراجعة الذكية):"}
                                    </label>
                                    <textarea
                                      rows={2}
                                      required={q.type === "essay"}
                                      placeholder={
                                        q.type === "fill_in_the_blank"
                                          ? "اكتب الكلمة أو العبارة المتوقعة..."
                                          : q.type === "quote"
                                          ? "اكتب القائل وسياق أو مناسبة العبارة..."
                                          : "اكتب الإجابة النموذجية بالتفصيل لكي يتمكن المصحح من قياس إجابات الشاب وتصحيحها بدقة..."
                                      }
                                      value={q.correctAnswer || ""}
                                      onChange={(e) => handleUpdateQuestion(qIdx, "correctAnswer", e.target.value)}
                                      className="w-full text-xs p-2 rounded-lg border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[9px] font-bold text-natural-green mb-1 flex items-center justify-between">
                                      <span>معايير التقييم الإلزامية (Rubric Points) - ضع كل معيار إلزامي في سطر:</span>
                                      <span className="text-natural-muted font-normal text-[8px]">(اختياري: يقسم النقاط بالتساوي وبصرامة)</span>
                                    </label>
                                    <textarea
                                      rows={2}
                                      placeholder="- المعيار الأول الإلزامي&#10;- المعيار الثاني الإلزامي&#10;(إذا تركتها فارغة، ستُستخرج تلقائياً من الإجابة النموذجية)"
                                      value={Array.isArray(q.rubricPoints) ? q.rubricPoints.join("\n") : (q.rubricPoints || "")}
                                      onChange={(e) => {
                                        const lines = e.target.value.split("\n").map(s => s.trim().replace(/^[\s*•\-–—✔▪▫]+/, "")).filter(Boolean);
                                        handleUpdateQuestion(qIdx, "rubricPoints", lines);
                                      }}
                                      className="w-full text-xs p-2 rounded-lg border border-natural-border bg-slate-50 outline-hidden focus:border-natural-green font-mono"
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="w-48 bg-slate-50 p-2 rounded-lg border border-natural-border/70">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="block text-[9px] font-bold text-natural-green">نقاط السؤال:</label>
                                  {q.isCustomPoints ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleUpdateQuestion(qIdx, "points", defPts);
                                        handleUpdateQuestion(qIdx, "isCustomPoints", false);
                                      }}
                                      className="text-[9px] font-bold text-amber-600 hover:text-amber-800 underline cursor-pointer"
                                      title="إعادة احتساب الدرجة بحسب التوزيع الافتراضي"
                                    >
                                      مخصصة ✏️ (إعادة)
                                    </button>
                                  ) : (
                                    <span className="text-[9px] text-natural-muted font-bold">
                                      تلقائية ({defPts})
                                    </span>
                                  )}
                                </div>
                                <input
                                  type="number"
                                  required
                                  min={0.1}
                                  step={0.5}
                                  value={q.points}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0.5;
                                    handleUpdateQuestion(qIdx, "points", val);
                                    handleUpdateQuestion(qIdx, "isCustomPoints", true);
                                  }}
                                  className={`w-full text-xs p-1 rounded-md border font-black text-center outline-hidden ${
                                    q.isCustomPoints
                                      ? "bg-amber-50 border-amber-300 text-amber-900"
                                      : "bg-white border-natural-border text-natural-green"
                                  }`}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {newQuizQuestions.length > 0 && (
                    <button
                      type="submit"
                      disabled={isCreatingQuiz}
                      className="w-full bg-natural-accent hover:bg-orange-600 disabled:bg-natural-accent/50 text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <Award className="w-4 h-4 text-white fill-white" />
                      {isCreatingQuiz ? "جاري نشر الاختبار للشباب..." : `نشر الاختبار وبث التنبيه فوراً للجميع (${newQuizQuestions.reduce((sum, q) => sum + (q.points || 0), 0)} نقطة) 🏆`}
                    </button>
                  )}
                </form>
              </div>
            </div>

            {/* 2. Active Quizzes & Solutions Section */}
            <div className="space-y-6">
              {/* Active Quizzes List */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-natural-green text-xs">📖 الاختبارات المتاحة حالياً ({state?.quizzes?.length || 0})</h4>
                </div>

                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                  {!state?.quizzes || state?.quizzes?.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-natural-border text-center text-xs text-natural-muted">
                      لا يوجد اختبارات مفعّلة حالياً.
                    </div>
                  ) : (
                    [...(state?.quizzes || [])].reverse().map((quiz) => {
                      const isExpired = quiz.endedEarly || (quiz.deadline && Date.now() >= new Date(quiz.deadline).getTime());
                      return (
                        <div key={quiz.id} className="p-3 bg-natural-cream/45 border border-natural-border/70 rounded-xl flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-right">
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-natural-green leading-tight">{quiz.title}</p>
                            <p className="text-[10px] text-natural-muted font-semibold">{quiz.description || "لا يوجد وصف"}</p>
                            <div className="flex flex-wrap items-center gap-2 text-[9px] text-natural-muted font-bold pt-1">
                              <span className="bg-white px-2 py-0.5 rounded-md border border-natural-border/60">{quiz.questions.length} أسئلة</span>
                              <span className="bg-natural-accent/10 text-natural-accent px-2 py-0.5 rounded-md">{quiz.points} نقطة كليّة</span>
                              {quiz.strictImmediateKick ? (
                                <span className="bg-rose-600 text-white px-2 py-0.5 rounded-md font-black shadow-xs">
                                  ⚡ إنهاء فوري (خروج: 0 | ملء الشاشة)
                                </span>
                              ) : quiz.proctoringMode === "STRICT" ? (
                                <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md border border-rose-300 font-extrabold">
                                  🛡️ صارم (سماح: {quiz.graceSeconds || 3}ث | أقصى خروج: {quiz.maxLeaves || 1})
                                </span>
                              ) : quiz.proctoringMode === "OFF" ? (
                                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">
                                  🟢 بدون مراقبة
                                </span>
                              ) : (
                                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md border border-amber-300 font-bold">
                                  ⚠️ تنبيه (سماح: {quiz.graceSeconds || 3}ث)
                                </span>
                              )}
                              {quiz.deadline && (
                                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100">
                                  📅 ينتهي: {new Date(quiz.deadline).toLocaleString("ar-EG")}
                                </span>
                              )}
                              {quiz.endedEarly && (
                                <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md border border-rose-100 font-extrabold">
                                  🔒 تم إنهاؤه مبكراً
                                </span>
                              )}
                              {quiz.userExtensions && Object.keys(quiz.userExtensions).length > 0 && (
                                <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300 font-extrabold">
                                  ⭐ {Object.keys(quiz.userExtensions).length} ممهلين خاصين
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                            {quiz.questions?.some(q => (q.type === "choice" || q.type === "boolean" || (q.type as string) === "mcq" || (q.type as string) === "true_false") && (!q.correctAnswer || !q.correctAnswer.trim() || q.correctAnswer === "-1")) && (
                              <button
                                type="button"
                                onClick={() => setPostGradingQuiz(quiz)}
                                className="text-[10px] font-black text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs animate-pulse"
                                title="إرفاق نموذج الإجابة وتصحيح التسليمات المعلقة تلقائياً"
                              >
                                <FileText className="w-3 h-3 text-amber-700" />
                                إرفاق نموذج الإجابة 📝
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setExtendingQuiz(quiz);
                                setExtensionType("global");
                                setGlobalExtDate(quiz.deadline ? new Date(quiz.deadline).toISOString().slice(0, 16) : "");
                                setSelectedStudentIdsForExt([]);
                                setUserExtDate("");
                                setStudentSearchQueryForExt("");
                              }}
                              className="text-[10px] font-black text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                              title="تمديد الموعد / منح مهلة خاصة لطالب"
                            >
                              <Clock className="w-3 h-3 text-blue-600" />
                              ⏰ تمديد / مهلة خاصة
                            </button>

                            {!isExpired ? (
                              <button
                                type="button"
                                onClick={() => handleTerminateQuiz(quiz.id)}
                                className="text-[10px] font-black text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                                title="إنهاء الاختبار مبكراً فوراً"
                              >
                                🔒 إنهاء مبكر
                              </button>
                            ) : (
                              <span className="text-[10px] font-extrabold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                                🔒 مغلق / منتهي
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteQuiz(quiz.id)}
                              className="bg-red-50 hover:bg-red-100 text-red-500 p-2 rounded-lg transition-colors cursor-pointer border border-red-100"
                              title="حذف الاختبار والتسليمات"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Submissions list */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="font-bold text-natural-green text-xs">🏆 حلول وتسليمات المشتركين للكويزات ({state?.quizSubmissions?.length || 0})</h4>
                  {isFetchingSubmissions && (
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                      جاري التحقق من التسليمات تلقائياً...
                    </span>
                  )}
                </div>
                
                <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                  {isFetchingSubmissions && (!state?.quizSubmissions || state?.quizSubmissions?.length === 0) ? (
                    /* Clean Skeletal Loading Indicator */
                    <div className="space-y-2.5 animate-pulse">
                      {[1, 2, 3].map((skeletonIdx) => (
                        <div
                          key={skeletonIdx}
                          className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs"
                        >
                          <div className="space-y-2 flex-1">
                            <div className="h-3.5 bg-slate-200 rounded w-1/3" />
                            <div className="h-2.5 bg-slate-150 rounded w-1/2" />
                            <div className="h-2 bg-slate-100 rounded w-1/4" />
                          </div>
                          <div className="w-16 h-6 bg-slate-100 rounded-full shrink-0" />
                        </div>
                      ))}
                    </div>
                  ) : !state?.quizSubmissions || state?.quizSubmissions?.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-natural-border text-center text-xs text-natural-muted">
                      لا يوجد حلول مسلمة من المشاركين حتى الآن.
                    </div>
                  ) : (
                    [...(state?.quizSubmissions || [])].reverse().map((sub) => {
                      const participantName = getUserName(sub.userId);
                      const quizTitle = state?.quizzes?.find(q => q.id === sub.quizId)?.title || "اختبار محذوف";
                      const isStarted = sub.status === "started";
                      return (
                        <div
                          key={sub.id}
                          onClick={() => setSelectedSubmissionDetails({ sub, participantName, quizTitle })}
                          className="p-3 bg-white border border-natural-border hover:border-natural-green/60 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-colors shadow-2xs"
                        >
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-natural-text">
                              بواسطة: <span className="text-natural-green underline">{participantName}</span>
                            </p>
                            <p className="text-[10px] text-natural-muted font-bold leading-tight">حل اختبار: {quizTitle}</p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[9px] font-bold block ${sub.status === "VIOLATION_TERMINATED" || isStarted ? "text-rose-600 font-black" : "text-natural-muted font-mono"}`}>
                                {sub.status === "VIOLATION_TERMINATED" ? "⛔ تم قفل الامتحان لمخالفة أمنية" : isStarted ? "⚠️ دخل الاختبار ولم يكمل" : `تم في: ${new Date(sub.submittedAt).toLocaleString("ar-EG")}`}
                              </span>
                              {sub.networkInterrupted && (
                                <span className="text-[9px] font-black text-sky-800 bg-sky-100 px-1.5 py-0.2 rounded border border-sky-300">
                                  📶 تسليم بعد انقطاع النت ({sub.disconnectCount || 1} مرة - {sub.offlineDurationSeconds || 0}ث)
                                </span>
                              )}
                              {Boolean(sub.violationCount || sub.violations?.length) && (
                                <span className="text-[9px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded border border-rose-300">
                                  ⚠️ {sub.violationCount || sub.violations?.length} مخالفات
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-left shrink-0">
                            {sub.status === "VIOLATION_TERMINATED" ? (
                              <span className="text-xs font-black border px-2.5 py-1 rounded-full text-rose-700 bg-rose-100 border-rose-300 animate-pulse">
                                ⛔ ملغي أمنياً
                              </span>
                            ) : isStarted ? (
                              <span className="text-xs font-black border px-2.5 py-1 rounded-full text-rose-700 bg-rose-50 border-rose-200">
                                ملغي (0)
                              </span>
                            ) : sub.status === "pending_manual_review" || sub.status === "grading" ? (
                              <span className="text-xs font-black border px-2.5 py-1 rounded-full text-amber-700 bg-amber-50 border-amber-200 animate-pulse">
                                بانتظار التصحيح اليدوي ⏳
                              </span>
                            ) : (
                              <span className="text-xs font-black border px-2.5 py-1 rounded-full text-natural-green bg-natural-cream border-natural-border/60">
                                {sub.totalScore} نقطة
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 7: Confessions Management */}
      {activeTab === "confessions" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-natural-green flex items-center gap-1.5 text-right">
              🕊️ إدارة ومراجعة الاعترافات الشهري
            </h3>
            <p className="text-xs text-natural-muted text-right">
              يمكنك هنا مراجعة الصور التي رفعها الشباب كإثبات للاعتراف الروحي واعتماد نقاطهم (+20 نقطة)، أو تأكيد اعترافهم يدوياً ومباشرة إذا تم التأكيد معك شخصياً.
            </p>
          </div>

          {/* Pending Reviews */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-natural-green border-r-2 border-natural-accent pr-2 font-bold text-right">📥 إثباتات اعتراف معلقة بانتظار المراجعة</h4>
            
            {(() => {
              const pendingSubmissions: { userId: string; monthIndex: number; record: any }[] = [];
              Object.entries(state?.confessions || {}).forEach(([uId, userConf]: [string, any]) => {
                if (userConf && userConf.months) {
                  Object.entries(userConf.months).forEach(([mIdx, rec]: [string, any]) => {
                    if (rec.status === "pending") {
                      pendingSubmissions.push({ userId: uId, monthIndex: parseInt(mIdx, 10), record: rec });
                    }
                  });
                }
              });

              if (pendingSubmissions.length === 0) {
                return (
                  <div className="p-6 text-center border border-dashed border-natural-border rounded-2xl bg-natural-cream/10 text-xs text-natural-muted font-bold">
                    🕊️ لا توجد أي إثباتات اعتراف معلقة تنتظر المراجعة حالياً. جميع الطلبات مراجعة!
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pendingSubmissions.map((sub) => {
                    const userName = getUserName(sub.userId);
                    return (
                      <div key={`${sub.userId}-${sub.monthIndex}`} className="p-4 bg-white border border-natural-border rounded-2xl space-y-3 shadow-2xs flex flex-col justify-between">
                        <div className="space-y-1 text-right">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-natural-green underline">{userName}</span>
                            <span className="text-[10px] bg-natural-accent/10 text-natural-accent font-extrabold px-2 py-0.5 rounded-md">الشهر {sub.monthIndex}</span>
                          </div>
                          <span className="text-[9px] text-natural-muted block font-mono">تاريخ التقديم: {new Date(sub.record.submittedAt).toLocaleDateString("ar-EG")}</span>
                        </div>

                        {sub.record.proofImage && (
                          <div className="h-40 w-full rounded-xl border border-natural-border overflow-hidden bg-natural-cream flex items-center justify-center">
                            <AuthenticatedImage 
                              src={sub.record.proofImage.startsWith("data:") ? sub.record.proofImage : `/api/confessions/${sub.userId}/${sub.monthIndex}/image`} 
                              alt="إثبات الاعتراف" 
                              className="max-h-full max-w-full object-contain cursor-zoom-in" 
                              onClick={() => setZoomedImage(sub.record.proofImage.startsWith("data:") ? sub.record.proofImage : `/api/confessions/${sub.userId}/${sub.monthIndex}/image`)} 
                            />
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={() => handleVerifyConfession(sub.userId, sub.monthIndex, "approved")}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 rounded-xl text-[10px] transition-colors cursor-pointer"
                          >
                            ✓ اعتماد (+20)
                          </button>
                          <button
                            onClick={() => handleVerifyConfession(sub.userId, sub.monthIndex, "rejected")}
                            className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-1.5 rounded-xl text-[10px] transition-colors cursor-pointer"
                          >
                            ✕ رفض الإثبات
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Quick Roster Grid */}
          <div className="space-y-4 pt-4 border-t border-natural-border">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div className="text-right">
                <h4 className="text-xs font-black text-natural-green border-r-2 border-natural-accent pr-2 font-bold">📋 سجل ورصد الاعتراف لجميع المشاركين</h4>
                <p className="text-[10px] text-natural-muted">اضغط على زر الشهر لتأكيد اعتراف المشارك يدوياً دون الحاجة لرفع صورة.</p>
              </div>

              <div className="relative w-full md:w-64">
                <Search className="absolute right-3 top-2.5 w-3.5 h-3.5 text-natural-muted" />
                <input
                  type="text"
                  placeholder="ابحث باسم المشارك..."
                  value={confessionSearch}
                  onChange={(e) => setConfessionSearch(e.target.value)}
                  className="w-full pl-3 pr-8 py-1.5 text-xs rounded-xl border border-natural-border outline-hidden bg-natural-cream focus:bg-white text-natural-text font-bold"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-natural-border rounded-2xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-natural-cream text-natural-green border-b border-natural-border">
                  <tr>
                    <th className="p-3 font-bold text-right">المشارك</th>
                    <th className="p-3 font-bold text-center">الشهر الأول (+20)</th>
                    <th className="p-3 font-bold text-center">الشهر الثاني (+20)</th>
                    <th className="p-3 font-bold text-center">الشهر الثالث (+20)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-natural-border">
                  {participants
                    .filter(p => p.name.includes(confessionSearch))
                    .map((p) => {
                      const userConf = state?.confessions?.[p.id] || { months: {} };
                      return (
                        <tr key={p.id} className="hover:bg-natural-cream/15 transition-colors">
                          <td className="p-3 font-bold text-natural-text text-right">{p.name}</td>
                          {[1, 2, 3].map((mIdx) => {
                            const rec = userConf.months[mIdx.toString()];
                            const status = rec?.status || "not_started";
                            return (
                              <td key={mIdx} className="p-3 text-center">
                                {status === "approved" ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg font-bold">
                                      تم التأكيد ✓
                                    </span>
                                    <button
                                      onClick={() => handleRevertConfession(p.id, mIdx)}
                                      className="text-[9px] bg-amber-500/10 hover:bg-amber-600 hover:text-white text-amber-700 font-bold px-2 py-0.5 rounded-md border border-amber-500/20 transition-all cursor-pointer"
                                      title="إلغاء الاعتماد وتخصيم النقاط"
                                    >
                                      ↺ إلغاء الاعتماد
                                    </button>
                                  </div>
                                ) : status === "pending" ? (
                                  <div className="flex flex-col items-center gap-1.5">
                                    <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-md">إثبات معلق ⏳</span>
                                    <button
                                      onClick={() => handleVerifyConfession(p.id, mIdx, "approved")}
                                      className="text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2 py-1 rounded-md transition-colors"
                                    >
                                      تأكيد الآن
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleManualConfirmConfession(p.id, mIdx)}
                                    className="text-[10px] bg-natural-green/10 hover:bg-natural-green hover:text-white text-natural-green font-semibold px-2.5 py-1 rounded-lg border border-natural-green/20 transition-all cursor-pointer"
                                  >
                                    + تسجيل الاعتراف
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Assign Task */}
      {activeTab === "assign_task" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div>
            <h3 className="text-base font-bold text-natural-green">إسناد وتكليف مهمة جديدة مخصصة لعدة مشاركين</h3>
            <p className="text-xs text-natural-muted">يمكنك اختيار مشارك واحد أو تحديد مجموعة من الشباب مرة واحدة لتكليفهم بنفس المهمة الروحية أو الكنسية لتسهيل رصد المتابعة.</p>
          </div>

          <form onSubmit={handleAssignTask} className="max-w-2xl space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-natural-green mb-1.5">اختر المشاركين (يمكنك تحديد عدة أشخاص معاً):</label>
                <div className="bg-natural-cream/40 border border-natural-border p-3.5 rounded-2xl space-y-3">
                  <div className="flex flex-wrap gap-2 items-center justify-between pb-2 border-b border-natural-border/60">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedAssigneeIds(participants.map(p => p.id))}
                        className="px-2.5 py-1 text-[10px] font-bold text-white bg-natural-green rounded-lg hover:bg-natural-olive transition-colors cursor-pointer"
                      >
                        ✓ تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedAssigneeIds([])}
                        className="px-2.5 py-1 text-[10px] font-bold text-natural-text bg-white border border-natural-border rounded-lg hover:bg-natural-cream transition-colors cursor-pointer"
                      >
                        ✕ إلغاء التحديد
                      </button>
                    </div>
                    <span className="text-[10px] font-bold text-natural-muted">
                      تم تحديد {selectedAssigneeIds.length} من أصل {participants.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[160px] overflow-y-auto pr-1">
                    {participants.map((p) => {
                      const isSelected = selectedAssigneeIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedAssigneeIds(selectedAssigneeIds.filter(id => id !== p.id));
                            } else {
                              setSelectedAssigneeIds([...selectedAssigneeIds, p.id]);
                            }
                          }}
                          className={`text-right p-2 rounded-xl border text-xs font-semibold transition-all flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? "bg-natural-green/10 border-natural-green text-natural-green shadow-3xs"
                              : "bg-white border-natural-border hover:border-natural-muted/55 text-natural-text"
                          }`}
                        >
                          <span className="truncate">{p.name}</span>
                          <span className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-natural-green border-natural-green text-white" : "border-natural-border"
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-natural-green mb-1.5">النقاط المقدرة للتنفيذ:</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  step={0.5}
                  required
                  value={taskPoints}
                  onChange={(e) => setTaskPoints(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-natural-cream outline-hidden focus:border-natural-green focus:bg-white transition-all font-semibold text-natural-text"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-natural-green mb-1.5">عنوان المهمة (مثال: حفظ مزمور أو تلخيص كتاب روحي):</label>
              <input
                type="text"
                placeholder="مثلاً: قراءة الأصحاح الأول والثاني من سفر الأمثال"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-natural-cream outline-hidden focus:border-natural-green focus:bg-white transition-all text-natural-text font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-natural-green mb-1.5">وصف المهمة وتعليمات التسليم (اختياري):</label>
              <textarea
                rows={3}
                placeholder="اكتب تفاصيل تنفيذ المهمة... مثلاً: اقرأ بتركيز ودون ثلاث آيات روقتلك وقم برفع صورة بخط يدك للآيات لتأكيد التنفيذ."
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-natural-cream outline-hidden focus:border-natural-green focus:bg-white transition-all resize-none text-natural-text font-semibold"
              />
            </div>

            <button
              type="submit"
              disabled={isAssigning}
              className="bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-2.5 px-6 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4 text-natural-accent" />
              {isAssigning ? "جاري التكليف..." : "تكليف وتنزيل التاسك"}
            </button>
          </form>
        </div>
      )}

      {/* Tab 8: Bonus Points & Manual Quiz Scores */}
      {activeTab === "bonus_quiz_manual" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 divide-y lg:divide-y-0 lg:divide-x lg:divide-natural-border/60">
            
            {/* Left Column: Bonus Points Form */}
            <div className="space-y-5 lg:pl-6 text-right">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-natural-green flex items-center gap-1.5">
                  🎁 منح بونص ونقاط تشجيعية للمتميزين
                </h3>
                <p className="text-xs text-natural-muted">
                  يمكنك تشجيع أي عضو بإضافة نقاط بونص إضافية له مع كتابة السبب تقديراً لتفاعله أو أمانته الاستثنائية.
                </p>
              </div>

              <form onSubmit={handleAddBonus} className="p-4 bg-natural-cream/35 border border-natural-border/70 rounded-2xl space-y-4 text-right">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-bold text-natural-green mb-1">اختر المشارك المتميز:</label>
                    <select
                      required
                      value={bonusUserId}
                      onChange={(e) => setBonusUserId(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-bold text-natural-text"
                    >
                      <option value="">-- اختر المشارك --</option>
                      {participants.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-natural-green mb-1">عدد نقاط المكافأة (البونص):</label>
                    <input
                      type="number"
                      required
                      min={0.5}
                      max={100}
                      step={0.5}
                      value={bonusPoints}
                      onChange={(e) => setBonusPoints(parseFloat(e.target.value) || 0)}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-bold text-natural-text"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-natural-green mb-1">سبب أو مناسبة منح البونص:</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: التفاعل الرائع في ورشة العمل أو حفظ مزمور إضافي"
                    value={bonusReason}
                    onChange={(e) => setBonusReason(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-semibold text-natural-text"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingBonus}
                  className="w-full bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4 text-natural-accent" />
                  {isSubmittingBonus ? "جاري الإضافة..." : "منح البونص للمشارك الآن"}
                </button>
              </form>

              {/* Bonus Log */}
              <div className="space-y-3 text-right">
                <h4 className="text-xs font-black text-natural-green border-r-2 border-natural-accent pr-2 font-bold">📜 سجل نقاط البونص والمكافآت الممنوحة</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {!state?.bonuses || state?.bonuses?.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-natural-border text-center text-xs text-natural-muted">
                      لم يتم منح أي بونص لأي مشارك حتى الآن.
                    </div>
                  ) : (
                    [...(state?.bonuses || [])].reverse().map((bonus) => {
                      const userName = getUserName(bonus.userId);
                      return (
                        <div key={bonus.id} className="p-3 bg-white border border-natural-border rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                          <div className="space-y-0.5 text-right">
                            <p className="text-xs font-bold text-natural-text">
                              المشارك: <span className="text-natural-green underline">{userName}</span>
                            </p>
                            <p className="text-[10px] text-natural-muted font-bold leading-relaxed">{bonus.reason}</p>
                            <span className="text-[9px] text-natural-muted font-mono block">{new Date(bonus.createdAt).toLocaleDateString("ar-EG")}</span>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-natural-accent bg-natural-accent/10 px-2.5 py-1 rounded-lg font-bold">
                              +{bonus.points} بونص
                            </span>
                            <button
                              onClick={() => handleDeleteBonus(bonus.id)}
                              className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-50 cursor-pointer"
                              title="حذف البونص"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Manual Quiz Score Form */}
            <div className="space-y-5 lg:pr-6 pt-6 lg:pt-0 text-right">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-natural-green flex items-center gap-1.5">
                  🏆 رصد وتنزيل الدرجات الورقية للاختبارات
                </h3>
                <p className="text-xs text-natural-muted">
                  إذا تم توزيع الاختبار ورقياً في الاجتماع كخيار بديل، يمكنك رصد وتثبيت درجات المشتركين يدوياً هنا ليتم احتساب نقاطهم الكلية (من 10 نقاط كحد أقصى).
                </p>
              </div>

              <form onSubmit={handleManualQuizSubmit} className="p-4 bg-natural-cream/35 border border-natural-border/70 rounded-2xl space-y-4 text-right">
                <div>
                  <label className="block text-[10px] font-bold text-natural-green mb-1">اختر الاختبار (الكويز):</label>
                  <select
                    required
                    value={manualQuizId}
                    onChange={(e) => {
                      setManualQuizId(e.target.value);
                      const quiz = state?.quizzes?.find(q => q.id === e.target.value);
                      if (quiz) {
                        setManualQuizScore(10);
                      }
                    }}
                    className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-bold text-natural-text"
                  >
                    <option value="">-- اختر الكويز --</option>
                    {state?.quizzes?.map(q => (
                      <option key={q.id} value={q.id}>{q.title} (الدرجة القصوى: {q.points || 10})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-bold text-natural-green mb-1">اختر المشارك:</label>
                    <select
                      required
                      value={manualQuizUserId}
                      onChange={(e) => setManualQuizUserId(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-bold text-natural-text"
                    >
                      <option value="">-- اختر المشارك --</option>
                      {participants.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-natural-green mb-1">الدرجة المستحقة في الاختبار (من 10):</label>
                    <input
                      type="number"
                      required
                      min={0}
                      max={10}
                      step={0.5}
                      value={manualQuizScore}
                      onChange={(e) => setManualQuizScore(parseFloat(e.target.value))}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green font-bold text-natural-text"
                    />
                    <p className="text-[9px] text-natural-muted mt-0.5">درجة الاختبار القصوى هي 10 نقاط.</p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingManualQuiz}
                  className="w-full bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors font-bold"
                >
                  <Send className="w-4 h-4 text-natural-accent" />
                  {isSubmittingManualQuiz ? "جاري رصد وتسجيل الدرجة..." : "تسجيل ورصد الدرجة الورقية"}
                </button>
              </form>

              {/* Manual/Paper Grades history log */}
              <div className="space-y-3 text-right">
                <h4 className="text-xs font-black text-natural-green border-r-2 border-natural-accent pr-2 font-bold">📋 سجل الدرجات الورقية المرصودة</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {(() => {
                    const manualSubmissions = state?.quizSubmissions?.filter(s => s.isManual) || [];
                    if (manualSubmissions.length === 0) {
                      return (
                        <div className="p-4 rounded-xl border border-dashed border-natural-border text-center text-xs text-natural-muted">
                          لم يتم رصد أي درجات ورقية يدوية حتى الآن.
                        </div>
                      );
                    }

                    return [...manualSubmissions].reverse().map((sub) => {
                      const userName = getUserName(sub.userId);
                      const quizTitle = state?.quizzes?.find(q => q.id === sub.quizId)?.title || "اختبار محذوف";
                      return (
                        <div key={sub.id} className="p-3 bg-white border border-natural-border rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                          <div className="space-y-0.5 text-right">
                            <p className="text-xs font-bold text-natural-text">
                              المشارك: <span className="text-natural-green underline">{userName}</span>
                            </p>
                            <p className="text-[10px] text-natural-muted font-bold leading-relaxed">حل اختبار ورقي: {quizTitle}</p>
                            <span className="text-[9px] text-natural-muted font-mono block">{new Date(sub.submittedAt).toLocaleDateString("ar-EG")}</span>
                          </div>
                          
                          <span className="text-xs font-black text-natural-green bg-natural-green/10 px-2.5 py-1 rounded-lg">
                            {sub.totalScore} / 10 نقاط
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Tab 5: Broadcast Notifications */}
      {activeTab === "broadcast" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-natural-green flex items-center gap-1.5">
              <Megaphone className="w-5 h-5 text-natural-accent" />
              إرسال وبث التنبيهات والرسائل (جماعي أو فردي)
            </h3>
            <p className="text-xs text-natural-muted">
              يمكنك بث تنبيه جماعي يظهر لجميع المشتركين فوراً، أو توجيه رسالة/تنبيه خاص يظهر لشخص معين في حسابه الشخصي فقط لكي لا تشوش على الباقين!
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Input Form Column */}
            <div className="lg:col-span-2 space-y-4">
              <form onSubmit={handleBroadcastNotification} className="space-y-4 bg-natural-cream/30 p-5 rounded-2xl border border-natural-border">
                {/* Target Audience Selector */}
                <div className="space-y-2 text-right">
                  <label className="block text-xs font-bold text-natural-green">🎯 الفئة المستهدفة بالتنبيه:</label>
                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-natural-text cursor-pointer select-none">
                      <input 
                        type="radio" 
                        name="targetAudience" 
                        checked={targetUserId === ""} 
                        onChange={() => setTargetUserId("")}
                        className="accent-natural-green w-4 h-4 cursor-pointer"
                      />
                      📢 بث عام لجميع المشاركين
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-bold text-natural-text cursor-pointer select-none">
                      <input 
                        type="radio" 
                        name="targetAudience" 
                        checked={targetUserId !== ""} 
                        onChange={() => {
                          const nonAdminUsers = (state?.users || []).filter(u => u && u.role !== "admin");
                          setTargetUserId(nonAdminUsers[0]?.id || "");
                        }}
                        className="accent-natural-green w-4 h-4 cursor-pointer"
                      />
                      👤 رسالة وتنبيه خاص لمشارك محدد
                    </label>
                  </div>

                  {targetUserId !== "" && (
                    <div className="mt-2 text-right animate-fadeIn">
                      <span className="block text-[10px] font-bold text-natural-muted mb-1">اختر المشارك المستهدف من القائمة:</span>
                      <select
                        value={targetUserId}
                        onChange={(e) => setTargetUserId(e.target.value)}
                        className="text-xs font-bold p-2.5 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green w-full md:w-80 shadow-2xs"
                      >
                        <option value="">-- اختر المشارك --</option>
                        {(state?.users || [])
                          .filter(u => u && u.role !== "admin")
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.username || "رمز الدخول: " + u.passcode})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-natural-green mb-1.5">نص التنبيه أو الرسالة:</label>
                  <textarea
                    rows={4}
                    required
                    placeholder={targetUserId ? "اكتب الرسالة الخاصة للمشارك هنا... (مثال: أهلاً بك يا بطل! لم ترفع تسليم الأسبوع الثاني، يرجى المسارعة في الرفع لنرصد لك نقاطك 😇)" : "اكتب التنبيه هنا بأسلوب مشجع وجذاب... (مثال: شبابنا الغالي، تم تنزيل مهام روحية جديدة! أسرعوا بالمشاركة والتقييم 🚀)"}
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    className="w-full text-xs p-3 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green focus:ring-1 focus:ring-natural-green transition-all font-semibold leading-relaxed text-right"
                  />
                  <div className="flex justify-between items-center mt-1 text-[10px] text-natural-muted">
                    <span>عدد الحروف الحالي: {broadcastMessage.length} حرف</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-right">
                  <label className="block text-xs font-bold text-natural-green">🔔 طريقة تسليم وإرسال التنبيه:</label>
                  <div className="flex flex-col md:flex-row gap-4 pt-1">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-natural-text cursor-pointer select-none">
                      <input 
                        type="radio" 
                        name="deliveryType" 
                        value="both"
                        checked={deliveryType === "both"} 
                        onChange={() => setDeliveryType("both")}
                        className="accent-natural-green w-4 h-4 cursor-pointer"
                      />
                      🌐 داخل الموقع + إشعار مباشر للجهاز (شريط الإشعارات)
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-natural-text cursor-pointer select-none">
                      <input 
                        type="radio" 
                        name="deliveryType" 
                        value="in_app"
                        checked={deliveryType === "in_app"} 
                        onChange={() => setDeliveryType("in_app")}
                        className="accent-natural-green w-4 h-4 cursor-pointer"
                      />
                      📱 داخل الموقع فقط (صامت بدون إشعارات منبثقة)
                    </label>
                  </div>
                </div>

                {/* Quick Templates Selector (Only for public broadcasts) */}
                {targetUserId === "" && (
                  <div>
                    <span className="block text-[10px] font-bold text-natural-green mb-2">⚡ قوالب جاهزة سريعة ومميزة:</span>
                    <div className="flex flex-col gap-2">
                      {[
                        "📢 تم نزول وتحديث المهام والـ Tasks الجديدة للكورس الصيفي! أسرعوا بالإنجاز لجمع النقاط 🚀",
                        "📚 تذكير هام: يرجى تسليم إثباتات المهام والأنشطة الروحية لكي نقوم بمراجعتها وتأكيد النقاط لكم ⚡",
                        "⛪ شبابنا الغالي، لا تنسوا موعد اجتماعنا الأسبوعي وحضور القداس الإلهي لرفع درجات حضوركم الروحي! ♥",
                        "🏆 تم تحديث لوحة الصدارة والترتيب العام للماراثون! ابحث عن اسمك وشاهد مركزك الحالي بين المتنافسين 💪"
                      ].map((template, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setBroadcastMessage(template)}
                          className="text-right text-[11px] font-semibold text-natural-green/90 bg-white hover:bg-natural-cream p-2.5 rounded-xl border border-natural-border/60 transition-all truncate hover:border-natural-green/40 cursor-pointer"
                        >
                          {template}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isBroadcasting}
                  className="w-full bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  <Megaphone className="w-4 h-4 text-natural-accent fill-natural-accent" />
                  {isBroadcasting 
                    ? "جاري إرسال التنبيه..." 
                    : targetUserId 
                      ? "إرسال التنبيه الخاص للمشارك الآن 👤" 
                      : "إرسال وبث التنبيه لجميع المشاركين الآن 🚀"}
                </button>
              </form>
            </div>

            {/* Notification History Column */}
            <div className="space-y-4 text-right">
              <div>
                <h4 className="font-bold text-natural-green text-xs">📜 سجل التنبيهات الأخيرة المرسلة ({state?.notifications?.length || 0})</h4>
                <p className="text-[10px] text-natural-muted mt-0.5">آخر التنبيهات التي تم إرسالها من إدارة الكورس.</p>
              </div>

              <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
                {!state?.notifications || state?.notifications?.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-natural-border text-center text-xs text-natural-muted">
                    لا يوجد تنبيهات مرسلة حتى الآن.
                  </div>
                ) : (
                  [...(state?.notifications || [])].reverse().map((notif) => {
                    const recipientName = notif.userId ? getUserName(notif.userId) : null;
                    return (
                      <div key={notif.id} className="p-3 bg-natural-cream/45 border border-natural-border/70 rounded-xl space-y-2 text-right relative group transition-all hover:border-rose-300 shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
                        <div className="flex justify-between items-center text-[9px] font-bold flex-wrap gap-1">
                          <div className="flex items-center gap-1">
                            {recipientName ? (
                              <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                👤 خاص لـ: {recipientName}
                              </span>
                            ) : (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-150">
                                📢 بث عام للجميع
                              </span>
                            )}
                            {notif.deliveryType === "in_app" && (
                              <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                                📱 داخل الموقع فقط
                              </span>
                            )}
                          </div>
                          {notif.createdByAdmin && (
                            <span className="text-natural-accent bg-natural-accent/10 px-1.5 py-0.5 rounded font-black text-[8px]">
                              إشعار من الخادم 👑
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-natural-text leading-relaxed">{notif.message}</p>
                        <div className="flex justify-between items-center text-[9px] text-natural-muted font-mono pt-1 border-t border-natural-border/30">
                          <button
                            onClick={() => handleDeleteNotification(notif.id)}
                            disabled={deletingNotifId === notif.id}
                            className="text-rose-600 hover:text-rose-800 flex items-center gap-1 font-bold cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            {deletingNotifId === notif.id ? "جاري الحذف..." : "حذف التنبيه"}
                          </button>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(notif.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className="text-natural-border/80 mx-1">|</span>
                            <span>{new Date(notif.createdAt).toLocaleDateString("ar-EG")}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Manage Users */}
      {activeTab === "manage_users" && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-natural-border space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Create new participant Form */}
            <div className="lg:col-span-1 bg-natural-cream/50 p-5 rounded-2xl border border-natural-border space-y-4 h-fit">
              <div>
                <h4 className="font-bold text-natural-green text-sm">تسجيل مشارك جديد</h4>
                <p className="text-[10px] text-natural-muted mt-0.5">أضف شاباً جديداً إلى ماراثون الصيف لإنشاء حسابه ورمز الدخول الخاص به.</p>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-natural-green mb-1">اسم الشاب بالكامل:</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: يوسف مجدي رمسيس"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="w-full text-xs p-2 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green transition-all text-natural-text font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-natural-green mb-1">اسم المستخدم (Username) المفضل:</label>
                  <input
                    type="text"
                    placeholder="مثال: youssef.magdy (أو اتركه فارغاً لاستخدام الاسم)"
                    value={newUserUsername}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                    className="w-full text-xs p-2 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green transition-all text-natural-text font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-natural-green mb-1">كلمة المرور المفضلة (اختياري):</label>
                  <input
                    type="text"
                    placeholder="مثل: 1234 (أو اتركه فارغاً للتوليد التلقائي)"
                    value={newUserCode}
                    onChange={(e) => setNewUserCode(e.target.value)}
                    className="w-full text-xs p-2 rounded-xl border border-natural-border bg-white outline-hidden focus:border-natural-green transition-all font-mono text-left"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isCreatingUser}
                  className="w-full bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-natural-accent" />
                  {isCreatingUser ? "جاري التسجيل..." : "تسجيل الشاب"}
                </button>
              </form>
            </div>

              {/* List current participants */}
              <div className="lg:col-span-2 space-y-3">
                <div>
                  <h4 className="font-bold text-natural-green text-sm">قائمة المشاركين الحالية ({participants.length})</h4>
                  <p className="text-[10px] text-natural-muted mt-0.5">الشباب المقيدين بالنظام مع رموز الدخول والتحكم الخاص بهم.</p>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-natural-border w-full">
                  <table className="w-full min-w-[650px] border-collapse text-right text-xs bg-white">
                    <thead>
                      <tr className="bg-natural-cream text-natural-green border-b border-natural-border font-bold">
                        <th className="py-2.5 px-4 min-w-[180px] whitespace-nowrap">اسم المشارك</th>
                        <th className="py-2.5 px-4 text-center whitespace-nowrap">اسم المستخدم (Username)</th>
                        <th className="py-2.5 px-4 text-center whitespace-nowrap">كلمة المرور (Password)</th>
                        <th className="py-2.5 px-4 text-center whitespace-nowrap font-black">إجمالي النقاط الكلي</th>
                        <th className="py-2.5 px-4 text-left whitespace-nowrap">التحكم بالملف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-natural-border">
                      {participants.map((user) => {
                        const cumScore = calculateParticipantScore(
                          user,
                          (state?.attendance || {})[user.id],
                          state?.tasks || [],
                          state?.quizSubmissions || [],
                          state?.confessions || {},
                          state?.bonuses || [],
                          {} // empty config ignores leaderboardResetAt to show total cumulative score across all periods!
                        );
                        return (
                          <tr key={user.id} className="hover:bg-natural-cream/30">
                            <td className="py-2.5 px-4 font-bold text-natural-text whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <Avatar
                                  src={user.photoURL}
                                  name={user.name}
                                  userId={user.id}
                                  userName={user.name}
                                  size={96}
                                  avatarVersion={user.avatarVersion}
                                  hasAvatar={user.hasAvatar}
                                />
                                <span>{user.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-center font-semibold text-natural-muted">{user.username || user.name}</td>
                            <td className="py-2.5 px-4 text-center font-mono text-natural-green font-bold bg-natural-green/10">{user.passcode}</td>
                            <td className="py-2.5 px-4 text-center whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 font-black px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-500/20 text-xs">
                                <Award className="w-3.5 h-3.5 text-amber-600" />
                                {Math.ceil(cumScore.totalPoints)} نقطة
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-left">
                              <div className="flex items-center justify-end gap-1.5">
                                {user.hasAvatar && (
                                  <button
                                    onClick={() => handleAdminRemoveAvatar(user.id, user.name)}
                                    disabled={deletingAvatarUserId === user.id}
                                    className="text-rose-700 hover:text-white bg-rose-100 hover:bg-rose-600 p-1.5 rounded-lg border border-rose-200 transition-all cursor-pointer inline-flex items-center justify-center"
                                    title="حذف وإزالة الصورة الشخصية للمشارك"
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setEditingUser({ id: user.id, name: user.name, username: user.username || user.name })}
                                  className="text-amber-700 hover:text-white bg-amber-100 hover:bg-amber-600 p-1.5 rounded-lg border border-amber-200 transition-all cursor-pointer inline-flex items-center justify-center"
                                  title="تعديل اسم المشارك"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="text-rose-700 hover:text-white bg-rose-100 hover:bg-rose-600 p-1.5 rounded-lg border border-rose-200 transition-all cursor-pointer inline-flex items-center justify-center"
                                  title="حذف المشارك نهائياً"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-natural-muted text-left md:hidden px-1">💡 اسحب الجدول لليمين أو اليسار لعرض بقية الأعمدة وأزرار التحكم.</p>
              </div>
          </div>

          {/* Admin Edit User Modal */}
          {editingUser && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu">
              <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100 space-y-4">
                <button
                  onClick={() => setEditingUser(null)}
                  className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-black p-1 cursor-pointer"
                >
                  ✕
                </button>
                <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800 pr-6">
                  <h3 className="font-bold text-natural-green dark:text-natural-accent text-base flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-natural-accent" />
                    <span>تعديل اسم وبيانات المشارك</span>
                  </h3>
                </div>

                <form onSubmit={handleUpdateUser} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-natural-green mb-1.5">اسم الشاب بالكامل:</label>
                    <input
                      type="text"
                      required
                      value={editingUser.name}
                      onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-natural-cream focus:bg-white outline-hidden focus:border-natural-green font-semibold text-natural-text"
                      placeholder="ادخل الاسم الجديد..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-natural-green mb-1.5">اسم المستخدم (Username):</label>
                    <input
                      type="text"
                      value={editingUser.username}
                      onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border bg-natural-cream focus:bg-white outline-hidden focus:border-natural-green font-semibold text-natural-text"
                      placeholder="اسم المستخدم المفضل..."
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-natural-border">
                    <button
                      type="button"
                      onClick={() => setEditingUser(null)}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingUserEdit}
                      className="px-5 py-2 bg-natural-green hover:bg-natural-olive text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isSavingUserEdit ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>جاري الحفظ...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5 text-natural-accent" />
                          <span>حفظ التعديلات 💾</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Submission Details Modal */}
      {selectedSubmissionDetails && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100"
          >
            <button
              onClick={() => setSelectedSubmissionDetails(null)}
              className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-black p-1 cursor-pointer"
            >
              ✕
            </button>
            <h4 className="text-sm font-black text-natural-green dark:text-natural-accent mb-4 border-b border-slate-200 dark:border-slate-800 pb-2 pr-6 flex justify-between items-center font-bold">
              <span>تفاصيل مراجعة حل الاختبار والتقييم 🏆</span>
              <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${
                selectedSubmissionDetails.sub.status === "VIOLATION_TERMINATED"
                  ? "bg-rose-100 text-rose-800 border border-rose-300 animate-pulse"
                  : selectedSubmissionDetails.sub.status === "started"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-natural-accent text-white"
              }`}>
                {selectedSubmissionDetails.sub.status === "VIOLATION_TERMINATED"
                  ? "⛔ ملغي لمخالفة أمنية (0)"
                  : selectedSubmissionDetails.sub.status === "started"
                    ? "محاولة ملغية (0)"
                    : `${selectedSubmissionDetails.sub.totalScore} نقطة كلية`}
              </span>
            </h4>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 bg-natural-cream/45 p-3 rounded-2xl border border-natural-border/50 text-xs font-bold">
                <p>🙋‍♂️ المشارك: <span className="text-natural-green">{selectedSubmissionDetails.participantName}</span></p>
                <p>📝 الاختبار: <span className="text-natural-accent">{selectedSubmissionDetails.quizTitle}</span></p>
              </div>

              {/* Security Violations Audit Section */}
              {(selectedSubmissionDetails.sub.status === "VIOLATION_TERMINATED" || Boolean(selectedSubmissionDetails.sub.violationCount) || (selectedSubmissionDetails.sub.violations && selectedSubmissionDetails.sub.violations.length > 0)) && (
                <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-2xl p-3.5 space-y-2 text-right">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-xs font-black text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                      ⚠️ سجل مخالفات الخروج ونزاهة الاختبار:
                    </span>
                    <span className="text-[10px] font-black bg-rose-600 text-white px-2 py-0.5 rounded-full">
                      {selectedSubmissionDetails.sub.status === "VIOLATION_TERMINATED" ? "تم قفل الامتحان بمخالفة أمنية" : `${selectedSubmissionDetails.sub.violations?.length || selectedSubmissionDetails.sub.violationCount || 1} مخالفات رصد`}
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold leading-relaxed">
                    {selectedSubmissionDetails.sub.status === "VIOLATION_TERMINATED"
                      ? "تم رصد مغادرة متكررة لشاشة الاختبار وتجاوز الحد الأقصى للمخالفات المسموحة، مما أدى لقفل الامتحان وتسليمه تلقائياً كإلغاء لمخالفة أمنية. يمكنك العفو وإعادة فتح المحاولة وتصفير المخالفات بالزر الأصفر أدناه."
                      : "تم رصد مغادرة شاشة الاختبار أثناء حل الامتحان. يمكنك فحص التوقيتات أدناه أو إعادة فتح المحاولة وتصفير المخالفات إن تطلب الأمر."}
                  </p>
                  {selectedSubmissionDetails.sub.violations && selectedSubmissionDetails.sub.violations.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {selectedSubmissionDetails.sub.violations.map((v: any, vIdx: number) => (
                        <div key={v.id || vIdx} className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-rose-200 dark:border-rose-800 text-[10px] font-bold flex justify-between items-center text-rose-800 dark:text-rose-200">
                          <span>مخالفة ({vIdx + 1}): {v.reason || "التبديل بين التطبيقات / مغادرة الشاشة"}</span>
                          <span className="bg-rose-100 dark:bg-rose-950 px-2 py-0.5 rounded text-rose-900 dark:text-rose-200 font-mono">
                            المدة: {v.awaySeconds || v.leaveDuration || 0}ث | {new Date(v.timestamp).toLocaleTimeString("ar-EG")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedSubmissionDetails.sub.status === "VIOLATION_TERMINATED" && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await ApiService.unlockQuizSubmission(selectedSubmissionDetails.sub.quizId, selectedSubmissionDetails.sub.userId);
                            if (res.db) onUpdateState(res.db);
                            setSelectedSubmissionDetails(null);
                          } catch {
                            console.warn("Failed to unlock submission");
                          }
                        }}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all"
                      >
                        🔓 إعادة فتح للطالب بالسماح بالمتابعة واستكمال الوقت
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Individual Question Results */}
              <div className="space-y-3.5 pt-2">
                <span className="block text-[11px] font-black text-natural-green border-r-2 border-natural-accent pr-2 mb-2 font-bold">إجابات وتقييم الأسئلة:</span>
                
                {(() => {
                  const quiz = state?.quizzes?.find(q => q.id === selectedSubmissionDetails.sub.quizId);
                  if (!quiz) return <p className="text-xs text-red-500">تم حذف الاختبار الأصلي ولا يمكن عرض تفاصيل الأسئلة.</p>;
                  const isStarted = selectedSubmissionDetails.sub.status === "started";

                  return quiz.questions.map((q: any, idx: number) => {
                    const result = selectedSubmissionDetails.sub.questionResults?.[q.id] || {};
                    return (
                      <div key={q.id} className="p-3 bg-natural-cream/20 border border-natural-border/70 rounded-xl space-y-2">
                        <div className="flex justify-between items-center text-xs font-bold text-natural-green">
                          <span>س {idx + 1}: {q.questionText}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${isStarted ? "bg-rose-100 text-rose-700" : result.correct ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {isStarted ? "0" : result.pointsEarned || 0} / {q.points} نقطة
                          </span>
                        </div>

                        <div className="text-xs space-y-1 text-natural-text/90 pr-2">
                          <p>✍️ إجابة المشارك: <span className="font-bold text-natural-green">
                            {isStarted ? "❌ لم يتم حل السؤال (تم الخروج من الاختبار قبل تسليمه)" : `"${result.studentAnswer || 'لم يجب'}"`}
                          </span></p>
                          
                          {q.type === "choice" && (
                            <p className="text-[10px] text-natural-muted">
                              💡 الإجابة الصحيحة: {q.correctAnswer !== undefined && q.correctAnswer !== null && q.correctAnswer !== "" ? q.options?.[parseInt(q.correctAnswer, 10)] : "مفتاح الإجابة مؤجل (بانتظار التحديد من المشرف)"}
                            </p>
                          )}
                          {q.type === "boolean" && (
                            <p className="text-[10px] text-natural-muted">
                              💡 الإجابة الصحيحة: {q.correctAnswer === "true" ? "صح" : q.correctAnswer === "false" ? "خطأ" : "مفتاح الإجابة مؤجل"}
                            </p>
                          )}
                          {(q.type === "essay" || q.type === "fill_in_the_blank" || q.type === "quote") && (
                            <div className="space-y-3 pt-1">
                              {/* Stored Model Answer as Admin Reference */}
                              <div className="p-3 bg-amber-50/80 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800/60 text-right space-y-1">
                                <span className="text-[11px] font-black text-amber-900 dark:text-amber-300 block">
                                  💡 {q.type === "fill_in_the_blank" ? "نموذج إكمال الفراغ الإسترشادي:" : q.type === "quote" ? "نموذج إسناد القول الإسترشادي:" : "نموذج الإجابة الإسترشادي للمشرف:"}
                                </span>
                                <p className="text-xs font-bold text-amber-950 dark:text-amber-100 leading-relaxed">
                                  {q.modelAnswer || q.correctAnswer || "لا يوجد نموذج محدد لهذا السؤال."}
                                </p>
                              </div>

                              {!isStarted && (
                                <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-natural-border/80 space-y-3 text-right">
                                  <p className="text-xs font-extrabold text-natural-green flex items-center gap-1">
                                    📝 التصحيح اليدوي للسؤال (من {q.points} نقطة):
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="sm:col-span-1">
                                      <label className="block text-[10px] font-bold text-natural-green mb-1 text-right">الدرجة المستحقة:</label>
                                      <input
                                        type="number"
                                        min={0}
                                        max={q.points}
                                        step={0.25}
                                        required
                                        value={essayGrades[q.id]?.pointsEarned ?? (result.pointsEarned || 0)}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          setEssayGrades({
                                            ...essayGrades,
                                            [q.id]: {
                                              ...essayGrades[q.id],
                                              pointsEarned: Math.max(0, Math.min(q.points, val)),
                                              feedback: essayGrades[q.id]?.feedback ?? (result.feedback || "")
                                            }
                                          });
                                        }}
                                        className="w-full text-xs p-2 rounded-lg border border-natural-border bg-natural-cream dark:bg-slate-800 outline-hidden focus:border-natural-green font-bold text-center text-natural-text dark:text-slate-100"
                                      />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <label className="block text-[10px] font-bold text-natural-green mb-1 text-right">تعليق وملاحظات المشرف:</label>
                                      <input
                                        type="text"
                                        placeholder="أحسنت، إجابة ممتازة وواضحة..."
                                        value={essayGrades[q.id]?.feedback ?? (result.feedback && result.feedback !== "بانتظار تصحيح المشرف..." ? result.feedback : "")}
                                        onChange={(e) => {
                                          setEssayGrades({
                                            ...essayGrades,
                                            [q.id]: {
                                              pointsEarned: essayGrades[q.id]?.pointsEarned ?? (result.pointsEarned || 0),
                                              feedback: e.target.value
                                            }
                                          });
                                        }}
                                        className="w-full text-xs p-2 rounded-lg border border-natural-border bg-natural-cream dark:bg-slate-800 outline-hidden focus:border-natural-green font-semibold text-natural-text dark:text-slate-100 text-right"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {!isStarted && q.type !== "essay" && q.type !== "fill_in_the_blank" && q.type !== "quote" && result.feedback ? (
                            <div className="mt-2 bg-white/80 p-2 rounded-lg border border-natural-border/40 text-[11px] font-bold text-natural-green/95 text-right">
                              📝 تقييم الإجابة:
                              <p className="font-medium text-natural-text/90 mt-1 pr-1.5 leading-relaxed font-bold">{result.feedback}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3 border-t border-natural-border/30 pt-4">
              <button
                type="button"
                onClick={handleReopenQuizAttempt}
                disabled={isReopeningQuiz}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                🔓 {isReopeningQuiz ? "جاري إعادة فتح الاختبار..." : "إعادة فتح المحاولة وتصفير المخالفات"}
              </button>

              <button
                type="button"
                onClick={handleSaveEssayGrades}
                disabled={isSubmittingGrades}
                className="flex-1 bg-natural-green hover:bg-natural-olive disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Award className="w-4 h-4 fill-white text-white" />
                {isSubmittingGrades ? "جاري الحفظ..." : "حفظ التصحيح اليدوي"}
              </button>

              <button
                type="button"
                onClick={() => setSelectedSubmissionDetails(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-6 rounded-xl text-xs transition-colors cursor-pointer"
              >
                إغلاق النافذة
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {zoomedImage && createPortal(
        <div 
          id="zoom-modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in transform-gpu"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto flex flex-col items-center">
            <button 
              className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white font-black text-xs bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
              onClick={() => setZoomedImage(null)}
            >
              ✕ إغلاق المعاينة
            </button>
            <AuthenticatedImage 
              src={zoomedImage} 
              alt="صورة إثبات مكبرة" 
              className="max-h-[75vh] max-w-full object-contain rounded-2xl shadow-2xl border-2 border-slate-200 dark:border-slate-700 mt-6" 
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
        </div>,
        document.body
      )}

      {/* Quiz Extension Modal */}
      {extendingQuiz && createPortal(
        <div
          id="quiz-extension-modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu"
          onClick={() => setExtendingQuiz(null)}
        >
          <div
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-right space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  إدارة تمديد مهلة الاختبار
                </h3>
                <p className="text-xs text-slate-500 font-bold mt-0.5">{extendingQuiz.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setExtendingQuiz(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-black text-sm p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Extension Type Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
              <button
                type="button"
                onClick={() => setExtensionType("global")}
                className={`py-2 px-3 text-xs font-black rounded-xl transition-all cursor-pointer ${
                  extensionType === "global"
                    ? "bg-white dark:bg-slate-900 text-blue-600 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                🌐 تمديد عام (للجميع)
              </button>
              <button
                type="button"
                onClick={() => setExtensionType("user")}
                className={`py-2 px-3 text-xs font-black rounded-xl transition-all cursor-pointer ${
                  extensionType === "user"
                    ? "bg-white dark:bg-slate-900 text-amber-600 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                ⭐ مهلة خاصة (طالب محدد)
              </button>
            </div>

            {extensionType === "global" ? (
              <form onSubmit={handleExtendQuizGlobal} className="space-y-4 pt-1">
                <div className="bg-blue-50/80 dark:bg-blue-950/40 p-3 rounded-2xl border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200 font-medium leading-relaxed">
                  يتيح التمديد العام إعادة فتح الاختبار وإتاحته لجميع المشاركين حتى تاريخ موعد الانتهاء الجديد المحدد أدناه.
                </div>

                {/* Quick presets */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">اختيار سريع للتمديد:</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: "+1 يوم", days: 1 },
                      { label: "+2 يوم", days: 2 },
                      { label: "+3 أيام", days: 3 },
                      { label: "+1 أسبوع", days: 7 }
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + preset.days);
                          setGlobalExtDate(d.toISOString().slice(0, 16));
                        }}
                        className="py-1.5 text-[11px] font-extrabold bg-slate-100 hover:bg-blue-100 dark:bg-slate-800 dark:hover:bg-blue-900/60 text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">تاريخ ووقت الانتهاء الجديد:</label>
                  <input
                    type="datetime-local"
                    value={globalExtDate}
                    onChange={(e) => setGlobalExtDate(e.target.value)}
                    required
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-blue-500 font-semibold"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isExtendingQuiz}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isExtendingQuiz ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                  تأكيد التمديد العام وبث التنبيه للجميع
                </button>
              </form>
            ) : (
              <form onSubmit={handleExtendQuizUser} className="space-y-4 pt-1">
                <div className="bg-amber-50/80 dark:bg-amber-950/40 p-3 rounded-2xl border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 font-medium leading-relaxed">
                  تمنح المهلة الخاصة تاريخ انتهاء استثنائي فردي أو جماعي للشباب المختارين دون فتح الاختبار لباقي المجموعات.
                </div>

                {/* Bulk Student Selector */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">
                      تحديد الشباب المستحقين للمهلة ({selectedStudentIdsForExt.length}):
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const filtered = (state?.users || [])
                            .filter((u) => u.role === "participant")
                            .filter((u) =>
                              !studentSearchQueryForExt ||
                              u.name.toLowerCase().includes(studentSearchQueryForExt.toLowerCase()) ||
                              (u.username && u.username.toLowerCase().includes(studentSearchQueryForExt.toLowerCase())) ||
                              (u.passcode && u.passcode.includes(studentSearchQueryForExt))
                            );
                          const allFilteredIds = filtered.map(u => u.id);
                          setSelectedStudentIdsForExt(prev => Array.from(new Set([...prev, ...allFilteredIds])));
                        }}
                        className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-800 transition-colors cursor-pointer"
                      >
                        تحديد الكل في البحث
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedStudentIdsForExt([])}
                        className="text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                      >
                        إلغاء التحديد
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute right-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      placeholder="ابحث باسم الشاب أو اسم المستخدم لتحديد أكثر من شخص..."
                      value={studentSearchQueryForExt}
                      onChange={(e) => setStudentSearchQueryForExt(e.target.value)}
                      className="w-full text-xs pr-8 pl-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-amber-500 font-semibold"
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1 p-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                    {(() => {
                      const filtered = (state?.users || [])
                        .filter((u) => u.role === "participant")
                        .filter((u) =>
                          !studentSearchQueryForExt ||
                          u.name.toLowerCase().includes(studentSearchQueryForExt.toLowerCase()) ||
                          (u.username && u.username.toLowerCase().includes(studentSearchQueryForExt.toLowerCase())) ||
                          (u.passcode && u.passcode.includes(studentSearchQueryForExt))
                        );

                      if (filtered.length === 0) {
                        return <p className="text-xs text-slate-400 text-center py-4">لا يوجد مشاركين يطابقون نتائج البحث</p>;
                      }

                      return filtered.map((student) => {
                        const isSelected = selectedStudentIdsForExt.includes(student.id);
                        return (
                          <label
                            key={student.id}
                            className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all select-none ${
                              isSelected
                                ? "bg-amber-100/90 dark:bg-amber-950/70 border-amber-400 text-amber-950 dark:text-amber-100 font-bold shadow-xs"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setSelectedStudentIdsForExt(prev => prev.filter(id => id !== student.id));
                                  } else {
                                    setSelectedStudentIdsForExt(prev => [...prev, student.id]);
                                  }
                                }}
                                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer accent-amber-600"
                              />
                              <span>{student.name}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
                              {student.username || student.passcode || student.id}
                            </span>
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* Quick presets for user */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">اختيار مهلة خاصة سريعة:</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: "+1 يوم", days: 1 },
                      { label: "+2 يوم", days: 2 },
                      { label: "+3 أيام", days: 3 },
                      { label: "+1 أسبوع", days: 7 }
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + preset.days);
                          setUserExtDate(d.toISOString().slice(0, 16));
                        }}
                        className="py-1.5 text-[11px] font-extrabold bg-slate-100 hover:bg-amber-100 dark:bg-slate-800 dark:hover:bg-amber-900/60 text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">تاريخ انتهاء المهلة الخاصة للشباب المختارين:</label>
                  <input
                    type="datetime-local"
                    value={userExtDate}
                    onChange={(e) => setUserExtDate(e.target.value)}
                    required
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-amber-500 font-semibold"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isExtendingQuiz || selectedStudentIdsForExt.length === 0}
                  className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:cursor-not-allowed"
                >
                  {isExtendingQuiz ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
                  {selectedStudentIdsForExt.length > 0 
                    ? `تأكيد منح المهلة لـ (${selectedStudentIdsForExt.length}) مشاركين إرسال التنبيهات 🚀`
                    : "اختر مشاركاً أو أكثر لمنح المهلة الاستثنائية"}
                </button>
              </form>
            )}

            {/* Active user extensions display */}
            {extendingQuiz.userExtensions && Object.keys(extendingQuiz.userExtensions).length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <p className="text-xs font-black text-slate-800 dark:text-slate-200">الشباب الممنوحين مهل خاصة حالياً:</p>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {Object.entries(extendingQuiz.userExtensions as Record<string, string>).map(([uid, dateStr]) => {
                    const st = state.users.find((u) => u.id === uid);
                    return (
                      <div key={uid} className="flex items-center justify-between text-[11px] bg-slate-50 dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                        <span className="font-bold text-slate-800 dark:text-slate-200">{st ? st.name : uid}</span>
                        <span className="font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-800">
                          حتى {new Date(dateStr).toLocaleString("ar-EG")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Leaderboard Reset Modal with 2-Step Verification */}
      {isResetLeaderboardOpen && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu"
          onClick={() => setIsResetLeaderboardOpen(false)}
        >
          <div
            className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 text-right space-y-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-black text-rose-600 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                تصفير الماراثون وبدء دورة جديدة (تحقق أمني مضاعف)
              </h3>
              <button
                type="button"
                onClick={() => setIsResetLeaderboardOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-black text-sm p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-rose-50 dark:bg-rose-950/40 p-3.5 rounded-2xl border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 font-medium leading-relaxed">
              ⚠️ <strong>هل أنت متأكد من تصفير الماراثون وبدء دورة جديدة (12 أسبوع)؟</strong>
              <br />
              سيؤدي هذا الإجراء إلى تصفير كافة سجلات الغياب والحضور والمهام والاعترافات ونقاط لوحة الصدارة لتبدأ الدورة الجديدة من الأسبوع الأول برصيد صفر للجميع، مع <strong>الحفاظ الكامل والدائم</strong> على حسابات جميع المشاركين وكلمات مرورهم.
            </div>

            <form onSubmit={handleResetLeaderboard} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200">
                  أدخل الكلمة المطلوبة للتأكيد: <span className="text-rose-600 font-mono font-black select-all">RESET</span>
                </label>
                <input
                  type="text"
                  placeholder="اكتب RESET هنا للتأكيد..."
                  value={resetConfirmInput}
                  onChange={(e) => setResetConfirmInput(e.target.value)}
                  required
                  className="w-full text-xs p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-rose-500 font-mono text-center uppercase tracking-widest font-black"
                />
              </div>

              <button
                type="submit"
                disabled={resetConfirmInput !== "RESET" || isResettingLeaderboard}
                className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {isResettingLeaderboard ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                تأكيد تصفير الماراثون والبدء من الأسبوع الأول
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* QR Code Attendance Scanner Modal */}
      {isQRScannerOpen && (
        <Suspense fallback={null}>
          <QRScannerModal
            isOpen={isQRScannerOpen}
            onClose={() => setIsQRScannerOpen(false)}
            onScanUser={handleQRScanUser}
            activityName={
              selectedActivity === "meetings" 
                ? "اجتماع الجمعة" 
                : selectedActivity === "liturgy" 
                  ? "القداس الأسبوعي" 
                  : "تسبحة الخميس"
            }
            weekNum={selectedWeek}
            participants={participants}
          />
        </Suspense>
      )}

      {/* Bulk Quiz Text Importer Modal */}
      {isBulkImportOpen && createPortal(
        <BulkQuizImportModal
          isOpen={isBulkImportOpen}
          onClose={() => setIsBulkImportOpen(false)}
          onImport={handleBulkImportQuestions}
          defaultMcqPoints={defaultMcqPoints}
          defaultTrueFalsePoints={defaultTrueFalsePoints}
          defaultEssayPoints={defaultEssayPoints}
          defaultFillBlankPoints={defaultFillBlankPoints}
          defaultQuotePoints={defaultQuotePoints}
        />,
        document.body
      )}

      {/* Post-Grading Answer Key Modal (Phase 6.2) */}
      {postGradingQuiz && createPortal(
        <PostGradingModal
          isOpen={!!postGradingQuiz}
          onClose={() => setPostGradingQuiz(null)}
          quiz={postGradingQuiz}
          quizzes={state?.quizzes || []}
          onGraded={(updatedDb, msg) => {
            onUpdateState(updatedDb);
            setSuccess(msg);
            setPostGradingQuiz(null);
          }}
        />,
        document.body
      )}
    </div>
  );
}
