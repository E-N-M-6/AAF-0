import { User, Attendance, Task, QuizSubmission, Bonus, ConfessionRecord, ParticipantScore } from "../types";

/**
 * Interface representing custom configuration weights
 */
export interface PointsConfig {
  leaderboardResetAt?: string;
  points?: {
    meeting?: number;
    liturgy?: number;
    praise?: number;
  };
  quizTotals?: Record<string, number>;
  quizCounts?: Record<string, number>;
}

/**
 * Calculates a participant's complete score breakdown.
 * Evaluates attendance, approved tasks, quizzes, confession approvals, and discretionary bonuses.
 * 
 * This shared utility enforces DRY across Leaderboard and ParticipantBoard.
 */
export function calculateParticipantScore(
  user: User,
  userAtt: Attendance | undefined,
  tasks: Task[],
  quizSubmissions: QuizSubmission[] = [],
  confessions: Record<string, ConfessionRecord> = {},
  bonuses: Bonus[] = [],
  config: PointsConfig = {},
  quizTotals?: Record<string, number>,
  quizCounts?: Record<string, number>
): ParticipantScore {
  const resetAt = config?.leaderboardResetAt ? new Date(config.leaderboardResetAt).getTime() : 0;
  const safeAtt = userAtt || { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
  
  let safeMeetings = safeAtt.meetings || [];
  let safeLiturgy = safeAtt.liturgy || [];
  let safePraise = safeAtt.praise || [];

  if (resetAt > 0) {
    const timestamps = (safeAtt as any).timestamps || {};
    safeMeetings = safeMeetings.filter((w) => {
      const ts = timestamps[`meetings_${w}`];
      return ts ? new Date(ts).getTime() > resetAt : false;
    });
    safeLiturgy = safeLiturgy.filter((w) => {
      const ts = timestamps[`liturgy_${w}`];
      return ts ? new Date(ts).getTime() > resetAt : false;
    });
    safePraise = safePraise.filter((w) => {
      const ts = timestamps[`praise_${w}`];
      return ts ? new Date(ts).getTime() > resetAt : false;
    });
  }

  const meetingsCount = safeMeetings.length;
  const liturgyCount = safeLiturgy.length;
  const praiseCount = safePraise.length;

  // Liturgy points: custom score per liturgy week, defaults to 20 points
  let liturgyPoints = 0;
  safeLiturgy.forEach((weekNum: number) => {
    const customScore = safeAtt.liturgyScores?.[weekNum.toString()];
    liturgyPoints += customScore !== undefined ? customScore : 20;
  });

  const meetingMultiplier = config?.points?.meeting ?? 20;
  const praiseMultiplier = config?.points?.praise ?? 15;

  const attendancePoints =
    meetingsCount * meetingMultiplier +
    praiseCount * praiseMultiplier +
    liturgyPoints;

  // Aggregate approved custom tasks
  const userTasks = tasks.filter((t) => {
    if (t.userId !== user.id || t.status !== "approved") return false;
    if (resetAt > 0) {
      const time = t.verifiedAt ? new Date(t.verifiedAt).getTime() : (t.submittedAt ? new Date(t.submittedAt).getTime() : 0);
      return time > resetAt;
    }
    return true;
  });
  const taskPoints = userTasks.reduce((sum, t) => sum + t.points, 0);
  const approvedTasksCount = userTasks.length;

  const completedSubmissions = quizSubmissions.filter((s) => {
    if (s.userId !== user.id || (s.status !== "completed" && s.status !== "graded")) return false;
    if (resetAt > 0) {
      const time = s.submittedAt ? new Date(s.submittedAt).getTime() : 0;
      return time > resetAt;
    }
    return true;
  });

  const effectiveTotals = quizTotals ?? config.quizTotals;
  const effectiveCounts = quizCounts ?? config.quizCounts;

  const quizPoints = (effectiveTotals && typeof effectiveTotals[user.id] === "number")
    ? effectiveTotals[user.id]
    : completedSubmissions.reduce((sum, s) => sum + (s.totalScore || 0), 0);

  const quizCount = (effectiveCounts && typeof effectiveCounts[user.id] === "number")
    ? effectiveCounts[user.id]
    : completedSubmissions.length;

  // Aggregate monthly confessions (+20 points per approved month)
  let confessionPoints = 0;
  const userConf = confessions?.[user.id];
  if (userConf?.months) {
    Object.values(userConf.months).forEach((m) => {
      if (m.status === "approved") {
        if (resetAt > 0) {
          const time = m.approvedAt ? new Date(m.approvedAt).getTime() : (m.submittedAt ? new Date(m.submittedAt).getTime() : 0);
          if (time > resetAt) {
            confessionPoints += 20;
          }
        } else {
          confessionPoints += 20;
        }
      }
    });
  }

  // Aggregate bonus points
  const userBonuses = bonuses.filter((b) => {
    if (b.userId !== user.id) return false;
    if (resetAt > 0) {
      const time = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return time > resetAt;
    }
    return true;
  });
  const bonusPoints = userBonuses.reduce((sum, b) => sum + b.points, 0);

  const archivedBase = resetAt === 0 ? (user.totalArchivedPoints || 0) : 0;
  const totalPoints = archivedBase + attendancePoints + taskPoints + quizPoints + confessionPoints + bonusPoints;

  return {
    id: user.id,
    name: user.name,
    attendancePoints,
    taskPoints,
    quizPoints,
    confessionPoints,
    bonusPoints,
    totalPoints,
    meetingsCount,
    liturgyCount,
    praiseCount,
    approvedTasksCount,
    quizCount,
    photoURL: user.photoURL || user.avatarBase64,
    hasAvatar: user.hasAvatar,
    avatarVersion: user.avatarVersion,
    hidePhotoOnBoard: user.hidePhotoOnBoard ?? user.hideNameOnBoard,
  };
}
