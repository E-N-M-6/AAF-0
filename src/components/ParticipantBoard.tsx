import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { User, Attendance, Task, DatabaseState } from "../types";
import { 
  Award, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Upload, 
  FileText, 
  Sparkles, 
  Send, 
  Calendar,
  Image as ImageIcon,
  Check,
  X,
  HelpCircle,
  HelpCircle as QuestionIcon,
  Megaphone,
  Key,
  Bell,
  Camera,
  Trash2,
  Eye,
  EyeOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { calculateParticipantScore } from "../lib/score";
import { ApiService } from "../services/api";
import { triggerDazzlingCelebration, triggerConfettiBurst } from "../lib/confetti";
import PushNotificationManager from "./PushNotificationManager";
import QuizRunner from "./QuizRunner";
import Avatar from "./Avatar";
import AvatarUploadModal from "./AvatarUploadModal";

interface ParticipantBoardProps {
  currentUser: User;
  state: DatabaseState;
  onUpdateState: (newState: DatabaseState) => void;
  onUpdateCurrentUser?: (user: User) => void;
  setError: (msg: string) => void;
  setSuccess: (msg: string) => void;
}

export default function ParticipantBoard({ currentUser, state, onUpdateState, onUpdateCurrentUser, setError, setSuccess }: ParticipantBoardProps) {
  const [selectedTaskToSubmit, setSelectedTaskToSubmit] = useState<Task | null>(null);
  const [proofNote, setProofNote] = useState("");
  const [proofImageBase64, setProofImageBase64] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Quiz Taking States
  const [activeQuizToTake, setActiveQuizToTake] = useState<any | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [isSubmittingQuiz, setIsSubmittingQuiz] = useState(false);
  const [isStartingQuiz, setIsStartingQuiz] = useState<string | null>(null);
  const [showQuizExitConfirm, setShowQuizExitConfirm] = useState(false);

  const handleRequestQuizExit = () => {
    const hasAnswers = Object.values(quizAnswers).some((val) => Boolean(typeof val === "string" ? val.trim() : val));
    if (!hasAnswers) {
      setActiveQuizToTake(null);
      setQuizAnswers({});
      setShowQuizExitConfirm(false);
    } else {
      setShowQuizExitConfirm(true);
    }
  };
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confessionFileInputRef = useRef<HTMLInputElement>(null);

  // Confession Submission States
  const [selectedConfessionMonth, setSelectedConfessionMonth] = useState<number | null>(null);
  const [confessionImagePreview, setConfessionImagePreview] = useState<string | null>(null);
  const [confessionImageBase64, setConfessionImageBase64] = useState<string>("");
  const [isSubmittingConfession, setIsSubmittingConfession] = useState(false);
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [lastSeenNotifId, setLastSeenNotifId] = useState<string | null>(() => {
    return localStorage.getItem(`last_seen_notif_id_${currentUser.id}`);
  });

  useEffect(() => {
    setLastSeenNotifId(localStorage.getItem(`last_seen_notif_id_${currentUser.id}`));
  }, [currentUser.id]);

  // Change Passcode States
  const [isChangingPasscode, setIsChangingPasscode] = useState(false);
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [isSubmittingPasscode, setIsSubmittingPasscode] = useState(false);

  // Push Notifications Manager State
  const [showPushManager, setShowPushManager] = useState(false);

  // Avatar upload & privacy states
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isDeletingAvatar, setIsDeletingAvatar] = useState(false);
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);

  const handleDeleteAvatar = async () => {
    if (!currentUser.hasAvatar) return;
    if (!window.confirm("هل أنت تأكد من رغبتك في حذف صورتك الشخصية؟")) return;

    setIsDeletingAvatar(true);
    try {
      const res = await ApiService.deleteAvatar();
      if (res.success) {
        if (onUpdateCurrentUser) onUpdateCurrentUser(res.user);
        onUpdateState(res.db);
        setSuccess("تم حذف الصورة الشخصية بنجax 🗑️");
      }
    } catch (err: any) {
      setError(err.message || "فشل حذف الصورة الشخصية");
    } finally {
      setIsDeletingAvatar(false);
    }
  };

  const handleTogglePrivacy = async (hidePhoto: boolean) => {
    setIsUpdatingPrivacy(true);
    try {
      const res = await ApiService.updatePrivacy(hidePhoto);
      if (res.success) {
        if (onUpdateCurrentUser) onUpdateCurrentUser(res.user);
        onUpdateState(res.db);
        setSuccess(
          hidePhoto
            ? "تم إخفاء صورتك عن باقي المشتركين في لوحة الصدارة 🔒"
            : "تم إظهار صورتك في لوحة الصدارة العامة 🌐"
        );
      }
    } catch (err: any) {
      setError(err.message || "فشل تحديث إعدادات الخصوصية");
    } finally {
      setIsUpdatingPrivacy(false);
    }
  };

  // Calculate scores using the centralized helper - memoized to prevent redundant calculation
  const myScore = React.useMemo(() => {
    const userAtt = state.attendance[currentUser.id] || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
    return calculateParticipantScore(
      currentUser,
      userAtt,
      state.tasks,
      state.quizSubmissions,
      state.confessions,
      state.bonuses,
      state.config,
      state.quizTotals,
      state.quizCounts
    );
  }, [currentUser, state.attendance, state.tasks, state.quizSubmissions, state.confessions, state.bonuses, state.config, state.quizTotals, state.quizCounts]);

  const myTasks = React.useMemo(() => {
    return state.tasks.filter((t) => t.userId === currentUser.id);
  }, [state.tasks, currentUser.id]);

  const myBonuses = React.useMemo(() => {
    return (state.bonuses || []).filter((b) => b.userId === currentUser.id);
  }, [state.bonuses, currentUser.id]);

  // Compute overall leaderboard rank - memoized to prevent calculating all scores on every user interaction
  const myRank = React.useMemo(() => {
    const participantsScores = state.users
      .filter((u) => u && u.role !== "admin" && u.username !== "." && u.id !== "." && u.name !== ".")
      .map((user) => {
        const userAtt = state.attendance[user.id] || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
        return {
          id: user.id,
          score: calculateParticipantScore(
            user,
            userAtt,
            state.tasks,
            state.quizSubmissions,
            state.confessions,
            state.bonuses,
            state.config,
            state.quizTotals,
            state.quizCounts
          ).totalPoints,
        };
      })
      .sort((a, b) => b.score - a.score);

    return participantsScores.findIndex((p) => p.id === currentUser.id) + 1;
  }, [state.users, state.attendance, state.tasks, state.quizSubmissions, state.confessions, state.bonuses, state.config, state.quizTotals, state.quizCounts, currentUser.id]);

  // Compress and handle image file upload client-side to save network and storage limits
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("يرجى اختيار ملف صورة صالح فقط");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Dynamic Canvas Compression to max 1080px width/height and 0.7 quality
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1080;
        const MAX_HEIGHT = 1080;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);
          setProofImageBase64(compressedBase64);
          setImagePreview(compressedBase64);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Submit proof handler
  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskToSubmit) return;

    if (!proofNote.trim()) {
      setError("يرجى كتابة تعليق أو آية كدليل على التنفيذ");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await ApiService.submitTaskProof(
        selectedTaskToSubmit.id,
        proofNote.trim(),
        proofImageBase64
      );
      onUpdateState(data.db);
      
      // Trigger celebratory confetti feedback
      triggerDazzlingCelebration();
      
      setSuccess("تم إرسال إثبات المهمة بنجاح للخادم لتقييمها واعتماد النقط! 🎉");
      setSelectedTaskToSubmit(null);
      setProofNote("");
      setProofImageBase64("");
      setImagePreview(null);
    } catch (err: any) {
      setError(err.message || "عذراً حدث خطأ أثناء الإرسال");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit passcode change
  const handleSubmitPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPasscode || !newPasscode.trim()) {
      setError("الرجاء إدخال رمز الدخول الجديد.");
      return;
    }
    const cleanPasscode = newPasscode.trim();
    if (cleanPasscode.length < 4) {
      setError("يجب أن يتكون رمز الدخول من 4 أرقام أو حروف على الأقل.");
      return;
    }
    if (cleanPasscode !== confirmPasscode.trim()) {
      setError("رمز الدخول وتأكيد رمز الدخول غير متطابقين.");
      return;
    }

    setIsSubmittingPasscode(true);
    try {
      const res = await ApiService.changePasscode(cleanPasscode);
      
      if (onUpdateCurrentUser) {
        onUpdateCurrentUser(res.user);
      }
      
      onUpdateState(res.db);
      setSuccess("تم تغيير رمز الدخول الخاص بك بنجاح! 🔑");
      setIsChangingPasscode(false);
      setNewPasscode("");
      setConfirmPasscode("");
    } catch (err: any) {
      setError(err.message || "حدث خطأ ما أثناء تغيير رمز الدخول.");
    } finally {
      setIsSubmittingPasscode(false);
    }
  };

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const getNextFriday = (createdAtStr: string): Date => {
    const date = new Date(createdAtStr);
    const resultDate = new Date(date);
    const currentDay = date.getDay(); // 0-6 (Sunday is 0, Monday is 1, ..., Friday is 5, Saturday is 6)
    let daysUntilFriday = (5 - currentDay + 7) % 7;
    if (daysUntilFriday === 0) {
      daysUntilFriday = 7; // Created on Friday, expires next Friday (7 days later)
    }
    resultDate.setDate(date.getDate() + daysUntilFriday);
    resultDate.setHours(0, 0, 0, 0); // Expiry at Friday morning 00:00:00
    return resultDate;
  };

  const isQuizExpired = (quiz: any, userId?: string): boolean => {
    const checkUid = userId || currentUser?.id;
    if (checkUid && quiz.userExtensions && quiz.userExtensions[checkUid]) {
      const extTime = new Date(quiz.userExtensions[checkUid]).getTime();
      if (!isNaN(extTime) && Date.now() < extTime) {
        return false; // User has an active individual extension!
      }
    }
    if (quiz.endedEarly) return true;
    if (quiz.deadline) {
      const deadlineTime = new Date(quiz.deadline).getTime();
      return !isNaN(deadlineTime) && Date.now() >= deadlineTime;
    }
    // Quizzes without a specific deadline do not expire automatically to ensure stability and points preservation.
    return false;
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs < 10 ? "0" : ""}${remainingSecs}`;
  };

  const handleStartQuiz = async (quiz: any) => {
    setIsStartingQuiz(quiz.id);
    setError("");
    setSuccess("");
    try {
      let data;
      try {
        data = await ApiService.startQuiz(quiz.id, currentUser.id);
      } catch (firstErr: any) {
        // If 401 token authentication error occurs, attempt 1-time state force refresh & retry
        if (firstErr.status === 401 || (firstErr.message && firstErr.message.includes("تسجيل الدخول"))) {
          const freshState = await ApiService.getState(true);
          onUpdateState(freshState);
          data = await ApiService.startQuiz(quiz.id, currentUser.id);
        } else {
          throw firstErr;
        }
      }

      onUpdateState(data.db);
      // Open proctored QuizRunner modal
      setActiveQuizToTake(quiz);
    } catch (err: any) {
      setError(err.message || "عذراً حدث خطأ ما أثناء فتح الاختبار");
    } finally {
      setIsStartingQuiz(null);
    }
  };

  const handleConfessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedConfessionMonth === null) return;

    setIsSubmittingConfession(true);
    try {
      const data = await ApiService.submitConfession(
        currentUser.id,
        selectedConfessionMonth,
        confessionImageBase64 || undefined
      );
      onUpdateState(data.db);

      // Trigger celebratory confetti feedback
      triggerDazzlingCelebration();

      setSuccess(`تم تقديم إثبات الاعتراف للشهر ${selectedConfessionMonth} بنجاح! بانتظار مراجعة الخادم. 🎉`);
      setSelectedConfessionMonth(null);
      setConfessionImageBase64("");
      setConfessionImagePreview(null);
    } catch (err: any) {
      setError(err.message || "عذراً حدث خطأ أثناء إرسال إثبات الاعتراف");
    } finally {
      setIsSubmittingConfession(false);
    }
  };

  const handleConfessionImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("يرجى اختيار ملف صورة صالح فقط");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1080;
        const MAX_HEIGHT = 1080;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        setConfessionImageBase64(dataUrl);
        setConfessionImagePreview(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const getStatusBadge = (status: Task["status"]) => {
    switch (status) {
      case "approved":
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-md">تم قبولها (+نقاط) ✓</span>;
      case "rejected":
        return <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-md">تحتاج تعديل ✕</span>;
      case "submitted":
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-md">بانتظار مراجعة الخادم ⏳</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md">غير منجزة</span>;
    }
  };

  // Filter notifications relevant to the current user (either global or targeted specifically to them)
  const myNotifications = React.useMemo(() => {
    return (state.notifications || []).filter(notif => 
      notif && (!notif.userId || notif.userId === currentUser.id)
    );
  }, [state.notifications, currentUser.id]);

  // Find the newest admin-sent/official notification (whether global broadcast or directed specifically to this user)
  // This will serve as the "Sticky / Pinned bulletin" that won't get covered by generic automated logs.
  const newestAdminNotif = React.useMemo(() => {
    const adminNotifs = myNotifications.filter(notif => notif.createdByAdmin);
    return adminNotifs.length > 0 ? adminNotifs[adminNotifs.length - 1] : null;
  }, [myNotifications]);

  // All other notifications for the history log
  const otherNotifications = React.useMemo(() => {
    return myNotifications.filter(notif => !newestAdminNotif || notif.id !== newestAdminNotif.id);
  }, [myNotifications, newestAdminNotif]);

  // Check if there are any unread notifications using the reactive lastSeenNotifId state
  const hasUnreadNotifications = React.useMemo(() => {
    if (otherNotifications.length === 0) return false;
    const newestNotif = otherNotifications[otherNotifications.length - 1];
    return lastSeenNotifId !== newestNotif.id;
  }, [otherNotifications, lastSeenNotifId]);

  // Mark notifications as read when opened and update reactive state instantly
  useEffect(() => {
    if (showAllNotifications && otherNotifications.length > 0) {
      const newestNotif = otherNotifications[otherNotifications.length - 1];
      localStorage.setItem(`last_seen_notif_id_${currentUser.id}`, newestNotif.id);
      setLastSeenNotifId(newestNotif.id);
    }
  }, [showAllNotifications, otherNotifications, currentUser.id]);

  return (
    <div className="space-y-6">
      {/* Welcome & Overall Score summary */}
      <motion.div
        initial={{ opacity: 0, y: 25, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="bg-gradient-to-br from-natural-green via-[#a81a20] to-[#143270] text-white p-6 md:p-8 rounded-3xl shadow-[0_10px_35px_rgba(197,31,38,0.15)] relative overflow-hidden border border-white/10"
      >
        <div className="absolute top-0 left-0 translate-y-[-10%] translate-x-[-10%] opacity-15">
          <Award className="w-64 h-64 text-white/20 animate-rotate-slow" />
        </div>
        <div className="absolute right-1/4 bottom-0 w-32 h-32 bg-natural-accent/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="bg-white/15 text-white text-[10px] font-extrabold px-3 py-1 rounded-full border border-white/20 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-natural-accent fill-natural-accent animate-pulse" />
                المساحة الشخصية للأبطال
              </span>
              <span className="bg-natural-accent text-natural-text text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm">
                مستوى مميز
              </span>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="relative group shrink-0">
                <Avatar
                  userId={currentUser.id}
                  userName={currentUser.name}
                  size={512}
                  avatarVersion={currentUser.avatarVersion}
                  hasAvatar={currentUser.hasAvatar}
                  className="w-16 h-16 sm:w-20 sm:h-20"
                  ringColor="border-2 border-white/50 shadow-md"
                />
                <button
                  type="button"
                  onClick={() => setIsAvatarModalOpen(true)}
                  className="absolute bottom-0 right-0 p-1.5 bg-amber-400 hover:bg-amber-500 text-slate-950 rounded-full shadow-md transition-transform hover:scale-110 cursor-pointer"
                  title="تغيير الصورة الشخصية"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <h2 className="text-xl md:text-2xl font-black flex items-center gap-2 leading-tight">
                  مرحباً بك يا بطل، {currentUser.name}! 👋
                </h2>
                <p className="text-xs text-white/90 font-medium leading-relaxed max-w-xl mt-1">
                  سعيد بجهادك ومشاركتك معنا في ماراثون <span className="text-natural-accent font-black">Believe your belief</span>. استمر في تجميع النقاط والتميز! ✨
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => setIsAvatarModalOpen(true)}
                    className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 active:scale-95 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 transition-all cursor-pointer shadow-2xs"
                  >
                    <Camera className="w-3.5 h-3.5 text-natural-accent" />
                    <span>{currentUser.hasAvatar ? "تغيير الصورة 📸" : "إضافة صورة شخصية 📸"}</span>
                  </button>

                  {currentUser.hasAvatar && (
                    <button
                      type="button"
                      onClick={handleDeleteAvatar}
                      disabled={isDeletingAvatar}
                      className="inline-flex items-center gap-1.5 bg-rose-500/30 hover:bg-rose-600/50 active:scale-95 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 transition-all cursor-pointer shadow-2xs"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-300" />
                      <span>حذف الصورة 🗑️</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleTogglePrivacy(!currentUser.hidePhotoOnBoard)}
                    disabled={isUpdatingPrivacy}
                    className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 active:scale-95 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 transition-all cursor-pointer shadow-2xs"
                    title="التحكم في إظهار صورتك لباقي المتسابقين في لوحة الصدارة"
                  >
                    {currentUser.hidePhotoOnBoard ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5 text-amber-300" />
                        <span>صورتك مخفية عن الصدارة 🔒</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5 text-emerald-300" />
                        <span>صورتك ظاهرة للصدارة 🌐</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNewPasscode("");
                      setConfirmPasscode("");
                      setIsChangingPasscode(true);
                    }}
                    className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 active:scale-95 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 transition-all cursor-pointer shadow-2xs"
                  >
                    <Key className="w-3.5 h-3.5 text-natural-accent" />
                    <span>تغيير رمز الدخول 🔑</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPushManager(!showPushManager)}
                    className={`inline-flex items-center gap-1.5 ${showPushManager ? 'bg-natural-accent text-natural-text font-black' : 'bg-white/15 hover:bg-white/25 text-white'} active:scale-95 text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 transition-all cursor-pointer shadow-2xs`}
                  >
                    <Bell className={`w-3.5 h-3.5 ${showPushManager ? 'text-natural-text' : 'text-natural-accent'}`} />
                    <span>تفعيل إشعارات الأجهزة 🔔</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="flex-1 md:flex-initial bg-white/15 px-5 py-3 rounded-2xl border border-white/20 text-center shadow-lg transition-transform hover:scale-105 duration-200">
              <p className="text-[10px] text-white/80 font-black">النقاط الكلية</p>
              <p className="text-3xl font-black text-natural-accent drop-shadow-sm mt-0.5">{myScore.totalPoints}</p>
            </div>

            <div className="flex-1 md:flex-initial bg-white/15 px-5 py-3 rounded-2xl border border-white/20 text-center shadow-lg transition-transform hover:scale-105 duration-200">
              <p className="text-[10px] text-white/80 font-black">ترتيبك الحالي</p>
              <p className="text-3xl font-black text-white drop-shadow-sm mt-0.5">#{myRank}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Push Notifications Device Manager */}
      <AnimatePresence>
        {showPushManager && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 8 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden"
          >
            <PushNotificationManager onClose={() => setShowPushManager(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Servants Broadcast Announcements / Bulletin board */}
      {((newestAdminNotif) || (otherNotifications.length > 0)) && (
        <div className="space-y-3">
          {/* 1. STICKY PINNED ADMIN NOTIFICATION (Highlighted as main board banner) */}
          {newestAdminNotif && (
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="bg-gradient-to-l from-amber-50 to-amber-100/60 dark:from-amber-950/60 dark:to-slate-900 border-2 border-amber-300 dark:border-amber-500/50 rounded-3xl p-4 md:p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shadow-xs relative overflow-hidden"
            >
              {/* Decorative accent background */}
              <div className="absolute right-0 top-0 bottom-0 w-2.5 bg-amber-500" />
              
              <div className="flex gap-3 items-start md:items-center pr-3">
                <div className="bg-amber-500 text-white p-2 rounded-xl shrink-0 shadow-xs animate-pulse">
                  <Megaphone className="w-4 h-4" />
                </div>
                <div className="space-y-0.5 text-right">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black text-amber-800 dark:text-amber-300 tracking-wider">📢 إعلان مثبت هام من إدارة الكورس:</span>
                    {newestAdminNotif.userId === currentUser.id && (
                      <span className="bg-rose-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full animate-bounce">
                        👤 تنبيه خاص موجه لك شخصياً
                      </span>
                    )}
                  </div>
                  <p className="text-xs md:text-sm font-black text-amber-950 dark:text-amber-100 leading-relaxed text-right">
                    {newestAdminNotif.message}
                  </p>
                </div>
              </div>
              <div className="text-[10px] text-amber-700 dark:text-amber-300 font-mono shrink-0 select-none bg-amber-200/50 dark:bg-amber-900/50 px-2.5 py-1 rounded-lg">
                {new Date(newestAdminNotif.createdAt).toLocaleDateString("ar-EG", { weekday: 'long', day: 'numeric', month: 'short' })}
              </div>
            </motion.div>
          )}

          {/* 2. COLLAPSIBLE LOGS OF OTHER RECENT ALERTS (Activities, quizzes, etc) */}
          {otherNotifications.length > 0 && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => setShowAllNotifications(!showAllNotifications)}
                className="relative inline-flex items-center gap-1.5 text-[11px] font-bold text-natural-green bg-natural-green/10 hover:bg-natural-green/20 px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-2xs"
              >
                {hasUnreadNotifications && !showAllNotifications && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 z-10">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500"></span>
                  </span>
                )}
                <span>{showAllNotifications ? "🔔 إخفاء التنبيهات الأخرى" : `🔔 عرض الإشعارات والتنبيهات السابقة (${otherNotifications.length})`}</span>
                <span className="text-xs">{showAllNotifications ? "▲" : "▼"}</span>
              </button>

              <AnimatePresence>
                {showAllNotifications && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden mt-2.5 space-y-2 max-h-[250px] overflow-y-auto pr-1 text-right"
                  >
                    {[...otherNotifications].reverse().map((notif) => (
                      <div 
                        key={notif.id} 
                        className="p-3 bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-start justify-between gap-3 shadow-xs text-right hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                      >
                        <div className="space-y-1">
                          <p className="text-[11px] font-bold !text-slate-900 dark:!text-slate-100 leading-relaxed">
                            {notif.message}
                          </p>
                          <span className="text-[9px] !text-slate-600 dark:!text-slate-300 font-mono block">
                            {new Date(notif.createdAt).toLocaleDateString("ar-EG", { day: "numeric", month: "short" })} - {new Date(notif.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {notif.createdByAdmin && (
                          <span className="text-[8px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200 shrink-0">
                            من الإدارة 👑
                          </span>
                        )}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* Attendance Stats Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Meeting */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 100 }}
          whileHover={{ scale: 1.02, y: -4 }}
          className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 transition-all duration-200 cursor-pointer space-y-4"
        >
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-1.5">
                🗓️ اجتماع الجمعة الأسبوعي
              </span>
              <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed">بناء الفكر والتعليم الكنسي القويم</p>
            </div>
            <span className="text-[11px] font-extrabold text-natural-green bg-natural-green/10 px-3 py-1 rounded-full whitespace-nowrap">
              {myScore.meetingsCount} / 12 حضور
            </span>
          </div>
          <div className="w-full bg-natural-border/30 h-2.5 rounded-full overflow-hidden">
            <div className="bg-gradient-to-r from-rose-500 to-natural-green h-full rounded-full transition-all duration-500" style={{ width: `${(myScore.meetingsCount / 12) * 100}%` }} />
          </div>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm">تحصل على +{state?.config?.points?.meeting ?? 10} نقطة عند حضور اجتماع الجمعة.</p>
        </motion.div>

        {/* Liturgy */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
          whileHover={{ scale: 1.02, y: -4 }}
          className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 transition-all duration-200 cursor-pointer space-y-4"
        >
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-1.5">
                ⛪ حضور القداس الإلهي
              </span>
              <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed">قمة الشركة الروحية والاتحاد</p>
            </div>
            <span className="text-[11px] font-extrabold text-natural-olive bg-natural-olive/15 px-3 py-1 rounded-full whitespace-nowrap">
              {myScore.liturgyCount} / 12 حضور
            </span>
          </div>
          <div className="w-full bg-natural-border/30 h-2.5 rounded-full overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-natural-olive h-full rounded-full transition-all duration-500" style={{ width: `${(myScore.liturgyCount / 12) * 100}%` }} />
          </div>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm">حضور القداس كل أسبوع يعطيك +{state?.config?.points?.liturgy ?? 15} نقطة إضافية.</p>
        </motion.div>

        {/* Praise */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, type: "spring", stiffness: 100 }}
          whileHover={{ scale: 1.02, y: -4 }}
          className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 transition-all duration-200 cursor-pointer space-y-4"
        >
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-1.5">
                🎼 تسبحة الخميس الأسبوعية
              </span>
              <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed">السهر والتمجيد برفقة الملائكة</p>
            </div>
            <span className="text-[11px] font-extrabold text-natural-accent bg-natural-accent/15 px-3 py-1 rounded-full whitespace-nowrap">
              {myScore.praiseCount} / 12 حضور
            </span>
          </div>
          <div className="w-full bg-natural-border/30 h-2.5 rounded-full overflow-hidden">
            <div className="bg-gradient-to-r from-amber-400 to-natural-accent h-full rounded-full transition-all duration-500" style={{ width: `${(myScore.praiseCount / 12) * 100}%` }} />
          </div>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm">التسبحة سهرة روحية مميزة جداً وتكافئ عليها بـ +{state?.config?.points?.praise ?? 15} نقطة.</p>
        </motion.div>
      </div>

      {/* Interactive Quizzes Section */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 md:p-8 space-y-6 transition-all duration-200 max-w-full overflow-x-hidden"
      >
        <div>
          <h3 className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-2">
            📝 الاختبارات والكويزات التفاعلية
          </h3>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed mt-1">
            شارك في مسابقات الكورس الصيفي والكويزات السريعة؛ وسيقوم المعلمون ولجنة التقييم بمراجعة وتصحيح إجاباتك فوراً لتشجيعك ورصد درجاتك في الحال!
          </p>
        </div>

        {!state.quizzes || state.quizzes.length === 0 ? (
          <div className="py-14 text-center !text-slate-600 dark:!text-slate-300 font-bold border-2 border-dashed border-slate-200 dark:border-slate-700/80 rounded-3xl flex flex-col items-center gap-3 bg-slate-50 dark:bg-slate-900/50">
            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full">
              <Sparkles className="w-10 h-10 text-slate-400 stroke-[1.5]" />
            </div>
            <div className="space-y-1">
              <p className="text-sm">لا توجد اختبارات أو كويزات نشطة حالياً.</p>
              <p className="text-[11px] !text-slate-600 dark:!text-slate-300 font-normal">انتظر تنبيهات وإشعارات الخدام فور نزول كويز جديد! 🔔</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {state.quizzes.map((quiz, index) => {
              const submission = state.quizSubmissions?.find(
                (s) => s.quizId === quiz.id && s.userId === currentUser.id
              );

              return (
                <motion.div
                   key={quiz.id}
                   initial={{ opacity: 0, y: 15 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ delay: 0.35 + index * 0.08, type: "spring", stiffness: 100 }}
                   whileHover={submission ? undefined : { scale: 1.01, y: -2 }}
                   className={`p-5 rounded-3xl border flex flex-col justify-between gap-5 transition-all duration-200 ${
                     submission
                       ? "bg-slate-100/80 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800 text-slate-500"
                       : "bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg"
                   }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-extrabold text-natural-accent bg-natural-accent/10 px-2.5 py-0.5 rounded-full border border-natural-accent/10 whitespace-nowrap">
                          {quiz.points} نقطة كليّة
                        </span>
                        {quiz.proctoringMode && quiz.proctoringMode !== "OFF" && (
                          <span
                            className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                              quiz.proctoringMode === "STRICT"
                                ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                                : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                            }`}
                          >
                            {quiz.proctoringMode === "STRICT" ? "وضع صارم 🛡️" : "مراقبة وتنبيه ⚠️"}
                          </span>
                        )}
                      </div>
                      {submission ? (
                        submission.status === "VIOLATION_TERMINATED" ? (
                          <span className="bg-rose-100 text-rose-800 text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-rose-300 flex items-center gap-1 shrink-0">
                            <X className="w-3 h-3 text-rose-600" /> ملغي (مخالفة أمنية)
                          </span>
                        ) : submission.status === "started" ? (
                          <span className="bg-rose-50 text-rose-800 text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-rose-100 flex items-center gap-1 shrink-0">
                            <X className="w-3 h-3 text-rose-600" /> دخول ملغي
                          </span>
                        ) : submission.status === "grading" ? (
                          <span className="bg-amber-50 text-amber-800 text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-amber-100 flex items-center gap-1 shrink-0 animate-pulse">
                            ⏳ بانتظار تصحيح المقالي
                          </span>
                        ) : (
                          <span className="bg-emerald-50 text-emerald-800 text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-emerald-100 flex items-center gap-1 shrink-0">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> تم التقييم والحل
                          </span>
                        )
                      ) : isQuizExpired(quiz, currentUser?.id) ? (
                        <span className="bg-slate-100 text-slate-500 text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-slate-200 shrink-0">
                          انتهت فترة الحل 🔒
                        </span>
                      ) : (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5 max-w-full overflow-hidden break-words text-xs sm:text-sm">
                          {currentUser?.id && quiz.userExtensions?.[currentUser.id] && new Date(quiz.userExtensions[currentUser.id]).getTime() > Date.now() && (
                            <span className="bg-amber-100 text-amber-900 text-[10px] sm:text-xs font-extrabold px-2.5 py-1 rounded-full border border-amber-300 flex items-center gap-1 shadow-xs max-w-full break-words">
                              ⭐ مهلة خاصة ممتدة حتى {new Date(quiz.userExtensions[currentUser.id]).toLocaleString("ar-EG")}
                            </span>
                          )}
                          <span className="bg-blue-50 text-blue-700 text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-full border border-blue-100 animate-pulse">
                            متاح للحل الآن 🔥
                          </span>
                        </div>
                      )}
                    </div>

                    <h4 className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg">{quiz.title}</h4>
                    <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed font-medium">{quiz.description || "لا يوجد وصف تفصيلي لهذا الكويز."}</p>
                    
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 !text-slate-600 dark:!text-slate-300 text-xs md:text-sm font-bold">
                      <span>📚 {quiz.questions?.length || 0} أسئلة متنوعة</span>
                      {quiz.timeLimit && (
                        <>
                          <span className="text-slate-400">•</span>
                          <span>⏱️ {quiz.timeLimit} دقائق</span>
                        </>
                      )}
                      {quiz.strictImmediateKick && (
                        <>
                          <span className="text-slate-400">•</span>
                          <span className="text-rose-600 dark:text-rose-400 font-extrabold flex items-center gap-0.5">
                            ⚡ إنهاء فوري عند أول خروج (ملء شاشة إلزامي)
                          </span>
                        </>
                      )}
                    </div>

                    {submission && (
                      submission.status === "VIOLATION_TERMINATED" ? (
                        <div className="mt-3 bg-rose-50/70 dark:bg-rose-950/30 p-3.5 rounded-2xl border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-200">
                          ⛔ تم إيقاف المحاولة بمخالفة أمنية:
                          <div className="mt-1.5 text-[10px] text-rose-700/90 dark:text-rose-300 font-medium leading-relaxed pr-1">
                            تم قفل وإلغاء محاولتك لهذا الامتحان بسبب مغادرة شاشة الاختبار أو الخروج من وضع ملء الشاشة أو التبديل بين التطبيقات. يرجى مراجعة الخادم المسؤول لإعادة الفتح.
                          </div>
                        </div>
                      ) : submission.status === "started" ? (
                        <div className="mt-3 bg-rose-50/50 dark:bg-rose-950/10 p-3.5 rounded-xl border border-rose-100/60 text-xs font-bold text-rose-700 dark:text-rose-300">
                          🚫 محاولة غير مكتملة:
                          <div className="mt-1.5 text-[10px] text-rose-600/90 dark:text-rose-400 font-medium leading-relaxed pr-1">
                            لقد قمت بفتح هذا الاختبار مسبقاً وخرجت قبل إرسال الحل، ولذلك تم إلغاء المحاولة تلقائياً لمنع الغش وحصلت على 0 نقاط.
                          </div>
                        </div>
                      ) : submission.status === "grading" ? (
                        <div className="mt-3 bg-amber-50/55 dark:bg-amber-950/10 p-3.5 rounded-xl border border-amber-100 text-xs font-bold text-amber-800 dark:text-amber-300">
                          ⏳ تم استلام الحل وبانتظار التصحيح:
                          <span className="text-sm font-black text-natural-accent mr-1.5">{submission.totalScore} / {quiz.points} نقطة</span>
                          <div className="mt-1.5 text-[10px] text-amber-700/90 dark:text-amber-400 font-medium leading-relaxed pr-1 leading-relaxed">
                            لقد قمت بحل الجزء الإلكتروني (الاختياري والصح والخطأ) بنجاح، وهو الآن بانتظار تصحيح الجزء المقالي يدوياً بواسطة خادم المسابقة ليتم رصد درجتك كاملة!
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 bg-slate-50 dark:bg-slate-900/80 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-natural-green">
                          🎉 نتيجتك الإجمالية: 
                          <span className="text-sm font-black text-natural-accent mr-1.5">{submission.totalScore} / {quiz.points} نقطة</span>
                          <div className="mt-1.5 text-[10px] !text-slate-600 dark:!text-slate-300 font-normal leading-relaxed pr-1">
                            تم تصحيح إجاباتك بدقة وتلقيت النقاط في مجموعك الكلي! استمر بتميزك الروحي والفكري.
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {!submission && (
                    isQuizExpired(quiz, currentUser?.id) ? (
                      <button
                        disabled
                        className="w-full bg-slate-100 text-slate-400 font-bold text-xs py-3 rounded-xl flex items-center justify-center gap-1.5 border border-slate-200"
                      >
                        🔒 انتهى وقت هذا الاختبار تلقائياً
                      </button>
                    ) : (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        disabled={isStartingQuiz !== null}
                        onClick={() => handleStartQuiz(quiz)}
                        className="w-full bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-extrabold text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-md hover:shadow-lg"
                      >
                        <Sparkles className="w-4 h-4 text-natural-accent fill-natural-accent" />
                        {isStartingQuiz === quiz.id ? "جاري فتح الاختبار وبدء المحاولة..." : "ابدأ حل الاختبار الآن واكسب النقاط"}
                      </motion.button>
                    )
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Custom Assigned Tasks List */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 md:p-8 space-y-6 transition-all duration-200"
      >
        <div>
          <h3 className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-2">
            🎯 مهامي وتكليفاتي الخاصة
          </h3>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed mt-1">
            هذه هي المهام والجهادات الروحية المخصصة التي قام خادم المسابقة بتكليفك بها. اضغط لتسليم الإثبات ورفع صورة دليل التنفيذ لكسب النقاط!
          </p>
        </div>

        {myTasks.length > 0 ? (
          <div className="space-y-4">
            {myTasks.map((task, index) => {
              const isPendingOrRejected = task.status === "pending" || task.status === "rejected";

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 + index * 0.08, type: "spring", stiffness: 100 }}
                  whileHover={{ scale: 1.006, y: -2 }}
                  className={`p-5 rounded-3xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all duration-200 ${
                    task.status === "approved"
                      ? "bg-slate-100/80 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800 text-slate-500 opacity-85"
                      : "bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg"
                  }`}
                >
                  <div className="space-y-2 max-w-xl text-right">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {getStatusBadge(task.status)}
                      <span className="text-[10px] font-extrabold text-natural-accent bg-natural-accent/10 px-2.5 py-0.5 rounded-full border border-natural-accent/10">
                        +{task.points} نقطة جهاد
                      </span>
                    </div>
                    <h4 className={`!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg ${task.status === "approved" ? "line-through opacity-60" : ""}`}>
                      {task.title}
                    </h4>
                    <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed font-medium">{task.description}</p>
                    
                    {/* Display Admin Feedback if any */}
                    {task.feedback && (
                      <div className="bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 border border-amber-200/50 p-3 rounded-2xl text-xs mt-3 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <span className="font-black">تعليق خادم المسابقة الروحي:</span> "{task.feedback}"
                        </div>
                      </div>
                    )}
                  </div>

                  {isPendingOrRejected && (
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setSelectedTaskToSubmit(task);
                        setProofNote("");
                        setImagePreview(null);
                        setProofImageBase64("");
                      }}
                      className="px-5 py-2.5 bg-natural-green hover:bg-natural-olive text-white font-extrabold text-xs rounded-2xl flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer shadow-md hover:shadow-lg shrink-0"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {task.status === "rejected" ? "أعد تقديم التسليم" : "تسليم إثبات المهمة"}
                    </motion.button>
                  )}
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="py-12 text-center !text-slate-600 dark:!text-slate-300 font-bold border border-dashed border-slate-200/90 dark:border-slate-700/80 rounded-3xl bg-slate-50 dark:bg-slate-900/50">
            <p className="text-xs">لا يوجد أي مهام مخصصة لك حالياً في هذه القائمة.</p>
          </div>
        )}
      </motion.div>

      {/* Monthly Confessions Section */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.42, duration: 0.5 }}
        className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 md:p-8 space-y-6 transition-all duration-200"
      >
        <div>
          <h3 className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-2">
            🕊️ الاعتراف الشهري والتوجيه الروحي
          </h3>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed mt-1">
            سر الاعتراف المقدس يمنحك سلاماً وبدايات متجددة. احرص على الجلوس مع أب اعترافك مرة واحدة شهرياً لتحصل على +20 نقطة بركة إضافية!
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[1, 2, 3].map((monthIndex) => {
            const confRecord = state.confessions?.[currentUser.id]?.months?.[monthIndex.toString()];
            const status = confRecord?.status || "not_started";

            return (
              <motion.div
                key={monthIndex}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.46 + monthIndex * 0.08, type: "spring", stiffness: 100 }}
                whileHover={{ scale: 1.015, y: -2 }}
                className="p-5 bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl flex flex-col justify-between gap-4 text-right transition-all duration-200"
              >
                <div className="space-y-2">
                  <span className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg block">
                    الشهر {monthIndex === 1 ? "الأول" : monthIndex === 2 ? "الثاني" : "الثالث"}
                  </span>
                  <div className="pt-1">
                    {status === "approved" && (
                      <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 text-[11px] px-3 py-1 rounded-full font-bold border border-emerald-200">
                        ✨ تم تأكيد الاعتراف (+20)
                      </span>
                    )}
                    {status === "pending" && (
                      <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 text-[11px] px-3 py-1 rounded-full font-bold border border-amber-200 animate-pulse">
                        ⏳ بانتظار المراجعة
                      </span>
                    )}
                    {status === "rejected" && (
                      <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-800 text-[11px] px-3 py-1 rounded-full font-bold border border-rose-200">
                        ✕ مرفوض (أعد التقديم)
                      </span>
                    )}
                    {status === "not_started" && (
                      <span className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] px-3 py-1 rounded-full font-extrabold border border-slate-200 dark:border-slate-700">
                        لم يتم تقديم إثبات بعد
                      </span>
                    )}
                  </div>
                </div>

                {(status === "not_started" || status === "rejected") && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setSelectedConfessionMonth(monthIndex);
                      setConfessionImagePreview(null);
                      setConfessionImageBase64("");
                    }}
                    className="w-full bg-natural-green hover:bg-natural-olive text-white font-extrabold text-xs py-2.5 rounded-2xl flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-md hover:shadow-lg"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    تحميل إثبات الاعتراف
                  </motion.button>
                )}
                {status === "approved" && confRecord?.approvedAt && (
                  <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm font-bold pt-1">
                    🗓️ تاريخ الاعتماد: {new Date(confRecord.approvedAt).toLocaleDateString("ar-EG")}
                  </p>
                )}
                {status === "pending" && (
                  <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm font-medium pt-1">
                    سيقوم أب اعترافك أو خادمك بمراجعة الصورة وتأكيد نقاط البركة لك قريباً!
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Bonus Points History Section */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-3xl p-5 md:p-8 space-y-6 transition-all duration-200"
      >
        <div>
          <h3 className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg flex items-center gap-2">
            🎁 نقاط البونص والمكافآت التشجيعية
          </h3>
          <p className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm leading-relaxed mt-1">
            هنا تظهر النقاط الإضافية (البونص) التي يمنحها لك الخدام تقديراً لتميزك الاستثنائي، تفاعلك، أو حفظك للألحان والآيات والأنشطة الإضافية!
          </p>
        </div>

        {myBonuses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myBonuses.map((bonus, index) => (
              <motion.div
                key={bonus.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.55 + index * 0.08, type: "spring", stiffness: 100 }}
                whileHover={{ scale: 1.015, y: -2 }}
                className="p-4 bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-md hover:shadow-lg rounded-2xl flex justify-between items-center gap-4 transition-all duration-200 cursor-pointer"
              >
                <div className="space-y-1 text-right">
                  <h4 className="!text-slate-900 dark:!text-slate-100 font-extrabold text-base md:text-lg">{bonus.reason}</h4>
                  <span className="!text-slate-600 dark:!text-slate-300 text-xs md:text-sm block font-bold">
                    🗓️ {new Date(bonus.createdAt).toLocaleDateString("ar-EG", { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <span className="text-xs font-black text-natural-accent bg-natural-accent/15 px-3.5 py-1.5 rounded-full border border-natural-accent/10 shrink-0">
                  +{bonus.points} بونص 🌟
                </span>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="py-10 text-center !text-slate-600 dark:!text-slate-300 font-bold border border-dashed border-slate-200/90 dark:border-slate-700/80 rounded-3xl bg-slate-50 dark:bg-slate-900/50">
            <p className="text-xs">لم تحصل على نقاط بونص إضافية حتى الآن. شارك وتفاعل بقوة وسيكافئك الخدام بالتأكيد! 😉</p>
          </div>
        )}
      </motion.div>

      {/* Quiz Runner Modal */}
      {activeQuizToTake && (
        <QuizRunner
          quiz={activeQuizToTake}
          currentUser={currentUser}
          onClose={() => setActiveQuizToTake(null)}
          onSuccess={(msg) => setSuccess(msg)}
          onError={(msg) => setError(msg)}
          onUpdateState={onUpdateState}
        />
      )}

      {/* Task Submission Modal */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {selectedTaskToSubmit && (
            <motion.div
              key="task-proof-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu"
              onClick={() => setSelectedTaskToSubmit(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 30, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.9, y: 30, opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 15 }}
                className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setSelectedTaskToSubmit(null)}
                  className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-black cursor-pointer p-1"
                >
                  ✕
                </button>
                <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 pr-6">
                  <div>
                    <span className="text-xs font-bold text-natural-accent">تسليم إثبات التاسك</span>
                    <h4 className="text-base font-bold text-natural-green dark:text-natural-accent mt-1">{selectedTaskToSubmit.title}</h4>
                  </div>
                </div>

                <form onSubmit={handleSubmitProof} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-natural-green dark:text-natural-accent mb-1">
                      ✍️ اكتب إثباتاً أو تعليقاً أو تلخيصك المطلوب (إجباري):
                    </label>
                    <textarea
                      rows={4}
                      required
                      placeholder="اكتب التلخيص، أو تأكيد التنفيذ، أو آية أعجبتك من القراءة المطلوبة..."
                      value={proofNote}
                      onChange={(e) => setProofNote(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 outline-hidden focus:border-natural-green bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 transition-all resize-none font-semibold text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {/* Image file selector */}
                  <div>
                    <label className="block text-xs font-bold text-natural-green dark:text-natural-accent mb-1">
                      📸 ارفع صورة كدليل (اختياري - صورة المكان أو الإنجيل المفتوح أو ملخصك):
                    </label>
                    
                    <div className="flex gap-3 items-center">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-xs transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" /> اختر ملف الصورة
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleImageChange}
                        className="hidden"
                      />
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">يدعم JPG/PNG وسيتم ضغطها تلقائياً</span>
                    </div>

                    {/* Preview Image if selected */}
                    {imagePreview && (
                      <div className="mt-3 relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 h-32 w-44 flex items-center justify-center">
                        <img src={imagePreview} alt="معاينة المرفق" className="max-h-full max-w-full object-contain" />
                        <button
                          type="button"
                          onClick={() => {
                            setImagePreview(null);
                            setProofImageBase64("");
                          }}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black text-white p-1 rounded-full cursor-pointer z-10"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 text-natural-accent" />
                      {isSubmitting ? "جاري الإرسال..." : "إرسال المهمة للخادم"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedTaskToSubmit(null)}
                      className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Monthly Confession Submission Modal */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {selectedConfessionMonth !== null && (
            <motion.div
              key="confession-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu"
              onClick={() => setSelectedConfessionMonth(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 30, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.9, y: 30, opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 15 }}
                className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setSelectedConfessionMonth(null)}
                  className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-black cursor-pointer p-1"
                >
                  ✕
                </button>
                <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 pr-6">
                  <div>
                    <span className="text-xs font-bold text-natural-accent">إرسال إثبات الاعتراف الشهري 🕊️</span>
                    <h4 className="text-base font-bold text-natural-green dark:text-natural-accent mt-1">الشهر {selectedConfessionMonth === 1 ? "الأول" : selectedConfessionMonth === 2 ? "الثاني" : "الثالث"}</h4>
                  </div>
                </div>

                <form onSubmit={handleConfessionSubmit} className="space-y-4">
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
                    🕊️ يرجى رفع صورة أو لقطة شاشة كإثبات على الاعتراف الروحي لتبسيط المراجعة على الخدام واعتماد النقاط (+20 نقطة) لهذا الشهر.
                  </p>

                  <div>
                    <label className="block text-xs font-bold text-natural-green dark:text-natural-accent mb-1">
                      📸 ارفع صورة الإثبات (مثال: صورة مع أب الاعتراف أو محادثة تحديد موعد):
                    </label>
                    
                    <div className="flex gap-3 items-center">
                      <button
                        type="button"
                        onClick={() => confessionFileInputRef.current?.click()}
                        className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-xs transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" /> اختر ملف الصورة
                      </button>
                      <input
                        type="file"
                        ref={confessionFileInputRef}
                        accept="image/*"
                        onChange={handleConfessionImageChange}
                        className="hidden"
                      />
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">يدعم الصور ويتم ضغطها تلقائياً</span>
                    </div>

                    {/* Preview Image if selected */}
                    {confessionImagePreview && (
                      <div className="mt-3 relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 h-32 w-full flex items-center justify-center">
                        <img src={confessionImagePreview} alt="معاينة إثبات الاعتراف" className="max-h-full max-w-full object-contain" />
                        <button
                          type="button"
                          onClick={() => {
                            setConfessionImagePreview(null);
                            setConfessionImageBase64("");
                          }}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black text-white p-1 rounded-full cursor-pointer z-10"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      disabled={isSubmittingConfession}
                      className="flex-1 bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 text-natural-accent" />
                      {isSubmittingConfession ? "جاري الإرسال..." : "إرسال الإثبات للخادم"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedConfessionMonth(null)}
                      className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Change Passcode Modal */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {isChangingPasscode && (
            <motion.div
              key="passcode-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in text-right transform-gpu"
              onClick={() => setIsChangingPasscode(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 30, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.9, y: 30, opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 15 }}
                className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setIsChangingPasscode(false)}
                  className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-black cursor-pointer p-1"
                >
                  ✕
                </button>
                <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 pr-6">
                  <div>
                    <span className="text-xs font-bold text-natural-accent">الأمان والخصوصية</span>
                    <h4 className="text-base font-black text-natural-green dark:text-natural-accent mt-1">تغيير رمز الدخول الخاص بك</h4>
                  </div>
                </div>

                <form onSubmit={handleSubmitPasscode} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-natural-green mb-1.5">
                      🔑 رمز الدخول الجديد (كلمة المرور):
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: 1234 أو كلمة سرية خاصة بك"
                      value={newPasscode}
                      onChange={(e) => setNewPasscode(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border outline-hidden focus:border-natural-green bg-natural-cream focus:bg-white dark:bg-natural-card/50 dark:focus:bg-natural-card transition-all font-bold text-natural-text text-center ltr"
                    />
                    <p className="text-[10px] text-natural-muted mt-1 leading-relaxed">
                      ملاحظة: يمكنك رؤية هذا الرمز في حسابك، وسيكون متاحاً للخدام أيضاً للمساعدة في حال نسيته.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-natural-green mb-1.5">
                      🔄 تأكيد رمز الدخول الجديد:
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="أعد كتابة الرمز الجديد للتأكيد"
                      value={confirmPasscode}
                      onChange={(e) => setConfirmPasscode(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-natural-border outline-hidden focus:border-natural-green bg-natural-cream focus:bg-white dark:bg-natural-card/50 dark:focus:bg-natural-card transition-all font-bold text-natural-text text-center ltr"
                    />
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      disabled={isSubmittingPasscode}
                      className="flex-1 bg-natural-green hover:bg-natural-olive disabled:bg-natural-green/50 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5 text-natural-accent" />
                      {isSubmittingPasscode ? "جاري التحديث..." : "تأكيد وتغيير الرمز 💾"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsChangingPasscode(false)}
                      className="bg-natural-cream border border-natural-border hover:bg-natural-border/30 text-natural-muted font-bold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Avatar Upload / Change Modal */}
      <AvatarUploadModal
        isOpen={isAvatarModalOpen}
        onClose={() => setIsAvatarModalOpen(false)}
        currentUser={currentUser}
        onUpdateState={onUpdateState}
        onUpdateCurrentUser={onUpdateCurrentUser || (() => {})}
        setError={setError}
        setSuccess={setSuccess}
      />

    </div>
  );
}
