import React, { useState } from "react";
import { createPortal } from "react-dom";
import { User, Attendance, Task, ParticipantScore } from "../types";
import { Award, Trophy, Medal, Search, Sparkles, Star, CalendarDays, CheckCircle2, ListChecks, Crown, Flame, Zap, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { calculateParticipantScore } from "../lib/score";
import { triggerGoldenGlitterCelebration } from "../lib/confetti";
import Avatar from "./Avatar";

interface LeaderboardProps {
  users: User[];
  attendance: Record<string, Attendance>;
  tasks: Task[];
  config: {
    leaderboardResetAt?: string;
    points: {
      meeting: number;
      liturgy: number;
      praise: number;
    };
  };
  quizzes?: any[];
  quizSubmissions?: any[];
  quizTotals?: Record<string, number>;
  quizCounts?: Record<string, number>;
  bonuses?: any[];
  confessions?: any;
}

export default function Leaderboard({
  users,
  attendance,
  tasks,
  config,
  quizzes = [],
  quizSubmissions = [],
  quizTotals,
  quizCounts,
  bonuses = [],
  confessions = {}
}: LeaderboardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserStats, setSelectedUserStats] = useState<ParticipantScore | null>(null);

  // Memoize participant score calculations and ranking so typing doesn't re-execute them
  const rankedScores = React.useMemo(() => {
    const participants = users.filter((u) => u && u.role !== "admin" && u.username !== "." && u.id !== "." && u.name !== ".");

    const scores: ParticipantScore[] = participants.map((user) => {
      const userAtt = attendance[user.id] || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
      const rawScore = calculateParticipantScore(user, userAtt, tasks, quizSubmissions, confessions, bonuses, config, quizTotals, quizCounts);
      return {
        ...rawScore,
        totalPoints: Math.ceil(rawScore.totalPoints),
      };
    });

    const sortedScores = [...scores].sort((a, b) => b.totalPoints - a.totalPoints);

    let denseRank = 1;
    let prevPoints = -1;
    return sortedScores.map((score, idx) => {
      if (idx > 0 && score.totalPoints < prevPoints) {
        denseRank += 1;
      }
      prevPoints = score.totalPoints;
      return {
        ...score,
        rank: denseRank,
      };
    });
  }, [users, attendance, tasks, quizSubmissions, quizTotals, quizCounts, confessions, bonuses, config]);

  const filteredScores = rankedScores.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRankBadge = (rank: number) => {
    switch (rank) {
      case 1:
        return (
          <span className="flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-black border border-amber-300 dark:border-amber-700 text-xs md:text-sm mx-auto">
            🥇
          </span>
        );
      case 2:
        return (
          <span className="flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black border border-slate-300 dark:border-slate-600 text-xs md:text-sm mx-auto">
            🥈
          </span>
        );
      case 3:
        return (
          <span className="flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 font-black border border-orange-300 dark:border-orange-700 text-xs md:text-sm mx-auto">
            🥉
          </span>
        );
      default:
        return (
          <span className="flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-black border border-slate-200 dark:border-slate-700 text-[11px] md:text-sm mx-auto">
            #{rank}
          </span>
        );
    }
  };

  const topThree = rankedScores.slice(0, 3);

  // Helper function to format participant names on podium cards into two distinct large lines
  const formatPodiumName = (name: string, isFirstPlace = false) => {
    if (!name) return null;
    const parts = name.trim().split(/\s+/);

    if (parts.length === 1) {
      return (
        <span className={`block font-black tracking-tight ${isFirstPlace ? 'text-lg sm:text-2xl md:text-3xl' : 'text-base sm:text-xl md:text-2xl'}`}>
          {name}
        </span>
      );
    }

    if (parts.length === 2) {
      return (
        <span className="block leading-snug w-full text-center my-1">
          <span className={`block font-black tracking-tight ${isFirstPlace ? 'text-xl sm:text-3xl md:text-4xl' : 'text-lg sm:text-2xl md:text-3xl'}`}>
            {parts[0]}
          </span>
          <span className={`block font-extrabold opacity-95 mt-0.5 ${isFirstPlace ? 'text-base sm:text-xl md:text-2xl text-amber-800 dark:text-amber-200' : 'text-sm sm:text-lg md:text-xl'}`}>
            {parts[1]}
          </span>
        </span>
      );
    }

    const firstName = parts[0];
    const restName = parts.slice(1).join(" ");
    return (
      <span className="block leading-snug w-full text-center my-1">
        <span className={`block font-black tracking-tight ${isFirstPlace ? 'text-xl sm:text-3xl md:text-4xl' : 'text-lg sm:text-2xl md:text-3xl'}`}>
          {firstName}
        </span>
        <span className={`block font-extrabold opacity-90 mt-0.5 ${isFirstPlace ? 'text-sm sm:text-lg md:text-xl text-amber-800 dark:text-amber-200' : 'text-xs sm:text-base md:text-lg'}`}>
          {restName}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-8 relative max-w-full overflow-x-hidden" id="leaderboard_section">
      {/* Podiums / Top 3 Display */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4 md:gap-8 pt-12 max-w-4xl mx-auto items-end text-center px-1 sm:px-2">
          {/* 2nd Place */}
          {topThree[1] && (
            <motion.div
              initial={{ opacity: 0, y: 25, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              whileHover={{ y: -6, scale: 1.02 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 100 }}
              onClick={() => setSelectedUserStats(topThree[1])}
              className="bg-white dark:bg-slate-900/95 border-2 border-slate-600 dark:border-slate-200 shadow-[0_0_12px_rgba(203,213,225,0.5)] dark:shadow-[0_0_14px_rgba(203,213,225,0.2)] rounded-3xl p-3 sm:p-4 md:p-6 flex flex-col items-center justify-end min-h-[320px] md:min-h-[400px] relative order-1 transition-colors duration-300 cursor-pointer"
            >
              <div className="absolute -top-7 bg-gradient-to-br from-slate-400 to-slate-600 text-white p-2.5 sm:p-3 rounded-full shadow-lg border-2 border-white dark:border-slate-900">
                <Trophy className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
              </div>
              <div className="mb-2 mt-4 flex justify-center">
                <Avatar
                  src={topThree[1].photoURL}
                  name={topThree[1].name}
                  userId={topThree[1].id}
                  userName={topThree[1].name}
                  size={512}
                  avatarVersion={topThree[1].avatarVersion}
                  hasAvatar={topThree[1].hasAvatar && !topThree[1].hidePhotoOnBoard}
                  ringColor="border-4 border-slate-300 dark:border-slate-400 shadow-md"
                />
              </div>
              <div className="text-slate-900 dark:text-slate-300 w-full text-center py-0.5">
                {formatPodiumName(topThree[1].name, false)}
              </div>
              <span className="text-[10px] sm:text-xs bg-slate-100 dark:bg-slate-500/20 text-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-400/30 font-bold px-2.5 sm:px-3 py-1 rounded-full mt-2">
                🥈 الوصيف الأول
              </span>
              <div className="text-base sm:text-xl md:text-2xl font-black text-slate-900 dark:text-slate-300 mt-2">
                {topThree[1].totalPoints}
                <span className="text-[10px] sm:text-xs font-extrabold text-slate-600 dark:text-slate-400 mr-1">نقطة</span>
              </div>
              {/* Podium block */}
              <div className="w-full bg-gradient-to-b from-slate-200/60 to-slate-100/40 dark:from-slate-500/30 dark:to-slate-500/10 h-16 sm:h-20 rounded-2xl mt-3 flex items-center justify-center border border-slate-300 dark:border-slate-500/30">
                <span className="text-2xl sm:text-3xl font-black text-slate-700 dark:text-slate-300">2</span>
              </div>
            </motion.div>
          )}

          {/* 1st Place */}
          {topThree[0] && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              whileHover={{ y: -8, scale: 1.03 }}
              transition={{ type: "spring", stiffness: 100 }}
              onClick={() => {
                triggerGoldenGlitterCelebration();
                setSelectedUserStats(topThree[0]);
              }}
              className="bg-white dark:bg-slate-900/95 border-2 border-amber-400 dark:border-amber-400 shadow-[0_0_22px_rgba(251,191,36,0.6)] dark:shadow-[0_0_25px_rgba(245,158,11,0.35)] rounded-3xl p-3.5 sm:p-5 md:p-8 flex flex-col items-center justify-end min-h-[360px] md:min-h-[460px] relative z-10 order-2 transition-colors duration-300 cursor-pointer"
            >
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
                style={{ willChange: "transform" }}
                className="absolute -top-9 bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-white p-3.5 sm:p-4 rounded-full shadow-xl border-2 border-white dark:border-slate-900 transform-gpu"
              >
                <Trophy className="w-7 h-7 sm:w-8 sm:h-8" />
              </motion.div>
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 dark:text-amber-400 absolute top-6 right-3 sm:top-8 sm:right-6 animate-pulse" />
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 dark:text-amber-300 absolute bottom-[38%] left-2 sm:bottom-1/3 sm:left-4 animate-pulse" />
              
              <div className="mb-2 mt-5 flex justify-center">
                <Avatar
                  src={topThree[0].photoURL}
                  name={topThree[0].name}
                  userId={topThree[0].id}
                  userName={topThree[0].name}
                  size={512}
                  avatarVersion={topThree[0].avatarVersion}
                  hasAvatar={topThree[0].hasAvatar && !topThree[0].hidePhotoOnBoard}
                  ringColor="border-4 border-amber-400 dark:border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                />
              </div>

              <div className="text-amber-900 dark:text-amber-300 w-full text-center py-0.5">
                {formatPodiumName(topThree[0].name, true)}
              </div>
              <span className="text-[10px] sm:text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-400/30 font-extrabold px-3 py-1 rounded-full mt-2.5 flex items-center justify-center gap-1">
                <Star className="w-3.5 h-3.5 fill-amber-500 dark:fill-amber-400 text-amber-500 dark:text-amber-400 shrink-0" /> بطل الصدارة
              </span>
              <div className="text-lg sm:text-2xl md:text-3xl font-black text-amber-700 dark:text-amber-300 mt-2">
                {topThree[0].totalPoints}
                <span className="text-[10px] sm:text-xs font-extrabold text-amber-800 dark:text-amber-300 mr-1">نقطة</span>
              </div>
              {/* Podium block */}
              <div className="w-full bg-gradient-to-b from-amber-400 to-amber-500 dark:from-amber-500/80 dark:to-amber-600/80 text-white h-20 sm:h-28 rounded-2xl mt-3 flex items-center justify-center shadow-md">
                <span className="text-3xl sm:text-4xl font-black text-white">1</span>
              </div>
            </motion.div>
          )}

          {/* 3rd Place */}
          {topThree[2] && (
            <motion.div
              initial={{ opacity: 0, y: 25, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              whileHover={{ y: -5, scale: 1.02 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
              onClick={() => setSelectedUserStats(topThree[2])}
              className="bg-white dark:bg-slate-900/95 border-2 border-orange-300 dark:border-orange-400 shadow-[0_0_20px_rgba(253,186,116,0.7)] dark:shadow-[0_0_22px_rgba(249,115,22,0.25)] rounded-3xl p-3 sm:p-4 md:p-6 flex flex-col items-center justify-end min-h-[300px] md:min-h-[370px] relative order-3 transition-colors duration-300 cursor-pointer"
            >
              <div className="absolute -top-7 bg-gradient-to-br from-amber-600 to-orange-600 text-white p-2.5 sm:p-3 rounded-full shadow-lg border-2 border-white dark:border-slate-900">
                <Trophy className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
              </div>
              <div className="mb-2 mt-4 flex justify-center">
                <Avatar
                  src={topThree[2].photoURL}
                  name={topThree[2].name}
                  userId={topThree[2].id}
                  userName={topThree[2].name}
                  size={512}
                  avatarVersion={topThree[2].avatarVersion}
                  hasAvatar={topThree[2].hasAvatar && !topThree[2].hidePhotoOnBoard}
                  ringColor="border-4 border-orange-400 dark:border-orange-500 shadow-md"
                />
              </div>
              <div className="text-orange-950 dark:text-orange-300 w-full text-center py-0.5">
                {formatPodiumName(topThree[2].name, false)}
              </div>
              <span className="text-[10px] sm:text-xs bg-orange-100 dark:bg-orange-500/20 text-orange-900 dark:text-orange-300 border border-orange-300 dark:border-orange-400/30 font-bold px-2.5 sm:px-3 py-1 rounded-full mt-2">
                🥉 الوصيف الثاني
              </span>
              <div className="text-base sm:text-xl md:text-2xl font-black text-orange-950 dark:text-orange-300 mt-2">
                {topThree[2].totalPoints}
                <span className="text-[10px] sm:text-xs font-extrabold text-orange-700 dark:text-orange-400 mr-1">نقطة</span>
              </div>
              {/* Podium block */}
              <div className="w-full bg-gradient-to-b from-orange-200/60 to-orange-100/40 dark:from-orange-500/30 dark:to-orange-500/10 h-14 sm:h-16 rounded-2xl mt-3 flex items-center justify-center border border-orange-300 dark:border-orange-500/30">
                <span className="text-2xl sm:text-3xl font-black text-orange-700 dark:text-orange-400">3</span>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Main Leaderboard Search & Table Section */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5 }}
        className="bg-white dark:bg-slate-900 rounded-3xl p-5 md:p-7 shadow-md border border-slate-200 dark:border-slate-800"
      >
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h3 className="text-lg md:text-xl font-black text-[#c51f26] dark:text-amber-400 flex items-center gap-2">
              <Award className="text-amber-500 dark:text-amber-400 w-5 h-5 shrink-0" />
              ترتيب جميع المشتركين في الماراثون
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-1">المنافسة مستمرة! اضغط على اسم أي مشارك لرؤية إحصائياته وتفاصيل نقاطه.</p>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
            <motion.input
              whileFocus={{ scale: 1.02 }}
              type="text"
              placeholder="ابحث عن مشارك..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-9 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-hidden focus:border-[#c51f26] dark:focus:border-amber-400 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 transition-all font-bold text-slate-900 dark:text-slate-100 shadow-2xs"
            />
          </div>
        </div>

        {/* List of ranks */}
        <div className="overflow-x-auto rounded-2xl border-2 border-slate-200 dark:border-slate-800 shadow-xs">
          <table className="w-full border-collapse text-right">
            <thead>
              <tr className="bg-gradient-to-r from-[#881337] via-[#c51f26] to-[#1b4393] text-white border-b-2 border-slate-300 dark:border-slate-700 font-black text-xs md:text-sm">
                <th className="py-3 px-2 md:px-4 w-12 md:w-16 text-center whitespace-nowrap">الترتيب</th>
                <th className="py-3 px-3 md:px-4 whitespace-nowrap">المشارك</th>
                <th className="hidden md:table-cell py-3 px-4 text-center whitespace-nowrap">الاجتماعات</th>
                <th className="hidden md:table-cell py-3 px-4 text-center whitespace-nowrap">القداسات</th>
                <th className="hidden md:table-cell py-3 px-4 text-center whitespace-nowrap">التسبحة</th>
                <th className="hidden md:table-cell py-3 px-4 text-center whitespace-nowrap">المهام المقبولة</th>
                <th className="py-3 px-3 md:px-4 text-left whitespace-nowrap">مجموع النقاط</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100">
              {filteredScores.length > 0 ? (
                filteredScores.map((score, index) => (
                  <tr
                    key={score.id}
                    onClick={() => setSelectedUserStats(score)}
                    className="hover:bg-amber-50/60 dark:hover:bg-slate-800/70 cursor-pointer transition-colors duration-150 odd:bg-slate-50/40 dark:odd:bg-slate-900/40"
                  >
                    <td className="py-3 md:py-3.5 px-2 md:px-4 text-center whitespace-nowrap">
                      {getRankBadge(score.rank || index + 1)}
                    </td>
                    <td className="py-3 md:py-4 px-3 md:px-4 text-sm sm:text-base md:text-lg font-black text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={score.photoURL}
                          name={score.name}
                          userId={score.id}
                          userName={score.name}
                          size={96}
                          avatarVersion={score.avatarVersion}
                          hasAvatar={score.hasAvatar && !score.hidePhotoOnBoard}
                        />
                        <span>{score.name}</span>
                      </div>
                    </td>
                    <td className="hidden md:table-cell py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs px-2.5 py-1 rounded-full font-bold border border-slate-300 dark:border-slate-700">
                        {score.meetingsCount} / 12
                      </span>
                    </td>
                    <td className="hidden md:table-cell py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200 text-xs px-2.5 py-1 rounded-full font-bold border border-blue-200 dark:border-blue-800/60">
                        {score.liturgyCount} / 12
                      </span>
                    </td>
                    <td className="hidden md:table-cell py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-xs px-2.5 py-1 rounded-full font-bold border border-amber-200 dark:border-amber-800/60">
                        {score.praiseCount} / 12
                      </span>
                    </td>
                    <td className="hidden md:table-cell py-3.5 px-4 text-center">
                      {score.approvedTasksCount > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs px-2.5 py-1 rounded-full font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> {score.approvedTasksCount} مهام
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-3 md:py-3.5 px-3 md:px-4 text-left whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5 md:gap-2">
                        <span className="hidden lg:inline text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                          (حضور: {score.attendancePoints} + مهام: {score.taskPoints} + كويزات: {score.quizPoints} + اعتراف: {score.confessionPoints} + بونص: {score.bonusPoints})
                        </span>
                        <span className="text-xs md:text-sm font-black text-white bg-gradient-to-r from-[#c51f26] to-[#881337] px-2.5 md:px-3 py-1 rounded-xl shadow-xs border border-rose-800/30">
                          {score.totalPoints} <span className="text-white/80 text-[10px] md:text-xs font-normal">نقطة</span>
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400 font-semibold">
                    لا يوجد نتائج مطابقة للبحث
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Viewport Fixed Stats Modal Overlay rendered into document.body via Portal */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {selectedUserStats && (
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 overflow-y-auto animate-fade-in transform-gpu"
              onClick={() => setSelectedUserStats(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 md:p-6 my-auto text-slate-900 dark:text-slate-100 text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setSelectedUserStats(null)}
                  className="absolute top-4 right-4 z-10 p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="إغلاق النافذة"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Top Bar with Title */}
                <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 pr-8">
                  <Avatar
                    src={selectedUserStats.photoURL}
                    name={selectedUserStats.name}
                    userId={selectedUserStats.id}
                    userName={selectedUserStats.name}
                    size={96}
                    avatarVersion={selectedUserStats.avatarVersion}
                    hasAvatar={selectedUserStats.hasAvatar && !selectedUserStats.hidePhotoOnBoard}
                  />
                  <h4 className="text-base sm:text-lg font-black text-[#c51f26] dark:text-amber-400 text-right">
                    تقرير النقاط التفصيلي لـ: <span className="text-amber-800 dark:text-amber-300 underline underline-offset-4 decoration-amber-500">{selectedUserStats.name}</span>
                  </h4>
                </div>

                <div className="space-y-4 text-right">
                  {/* Point highlights */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-2xl text-center border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-none">نقاط الحضور</p>
                        <p className="text-base font-black text-[#c51f26] dark:text-emerald-400 mt-1.5">{selectedUserStats.attendancePoints}</p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-2xl text-center border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-none">نقاط المهام</p>
                        <p className="text-base font-black text-[#c51f26] dark:text-emerald-400 mt-1.5">{selectedUserStats.taskPoints}</p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-2xl text-center border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-none">نقاط الكويزات</p>
                        <p className="text-base font-black text-[#c51f26] dark:text-emerald-400 mt-1.5">{selectedUserStats.quizPoints}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-2xl text-center border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-none">نقاط الاعتراف</p>
                        <p className="text-base font-black text-[#c51f26] dark:text-emerald-400 mt-1.5">{selectedUserStats.confessionPoints}</p>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-2xl text-center border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-none">نقاط البونص</p>
                        <p className="text-base font-black text-amber-700 dark:text-amber-300 mt-1.5">+{selectedUserStats.bonusPoints}</p>
                      </div>
                    </div>
                  </div>

                  {/* Progress bars */}
                  <div className="space-y-3 pt-2">
                    <div>
                      <div className="flex justify-between text-xs font-bold text-[#c51f26] dark:text-amber-400 mb-1">
                        <span className="flex items-center gap-1">🗓️ حضور الاجتماع الأسبوعي (الجمعة)</span>
                        <span>{selectedUserStats.meetingsCount} من 12 ({( (selectedUserStats.meetingsCount/12)*100 ).toFixed(0)}%)</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#c51f26] dark:bg-amber-400 h-full rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${(selectedUserStats.meetingsCount / 12) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-bold text-[#1b4393] dark:text-blue-400 mb-1">
                        <span className="flex items-center gap-1">⛪ حضور القداس الإلهي (الاثنين)</span>
                        <span>{selectedUserStats.liturgyCount} من 12 ({( (selectedUserStats.liturgyCount/12)*100 ).toFixed(0)}%)</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#1b4393] dark:bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${(selectedUserStats.liturgyCount / 12) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">
                        <span className="flex items-center gap-1">🎼 حضور التسبحة (الخميس)</span>
                        <span>{selectedUserStats.praiseCount} من 12 ({( (selectedUserStats.praiseCount/12)*100 ).toFixed(0)}%)</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${(selectedUserStats.praiseCount / 12) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-50/80 dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 p-4 rounded-2xl flex items-center justify-between mt-4 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Star className="w-5 h-5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />
                      <div>
                        <p className="text-xs text-[#c51f26] dark:text-amber-400 font-black">الترتيب الحالي في الماراثون</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold">أداء رائع ومنافسة متميزة</p>
                      </div>
                    </div>
                    <span className="text-2xl font-black text-amber-600 dark:text-amber-400">#{selectedUserStats.rank}</span>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedUserStats(null)}
                  className="mt-6 w-full bg-[#c51f26] hover:bg-[#a7181e] text-white font-bold py-2.5 rounded-xl text-sm transition-colors cursor-pointer shadow-md"
                >
                  إغلاق النافذة
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
