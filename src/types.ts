export interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface User {
  id: string;
  name: string;
  role: "admin" | "participant";
  passcode: string;
  username?: string;
  sessionVersion?: number;
  totalArchivedPoints?: number;
  pushSubscriptions?: WebPushSubscription[];
  hasAvatar?: boolean;
  avatarVersion?: number;
  avatarUpdatedAt?: string | number;
  avatarBase64?: string;
  hidePhotoOnBoard?: boolean;
  hideNameOnBoard?: boolean;
  avatarSnoozeCount?: number;
  avatarSnoozedAt?: number;
  avatarUploads?: number[];
}

export interface Attendance {
  meetings: number[]; // week numbers (1-12)
  liturgy: number[];  // week numbers (1-12)
  praise: number[];   // week numbers (1-12)
  liturgyScores?: Record<string, number>; // key: weekIndex, value: score (20 or 10 or 0)
}

export interface ConfessionMonth {
  status: "pending" | "approved" | "rejected";
  proofImage?: string; // legacy base64 string
  proofImagePath?: string; // Firebase Cloud Storage path
  confessionProofUrl?: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface ConfessionRecord {
  months: Record<string, ConfessionMonth>; // key: monthIndex ("1", "2", "3")
}

export interface Bonus {
  id: string;
  userId: string;
  points: number;
  reason: string;
  createdAt: string;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  points: number;
  status: "pending" | "submitted" | "approved" | "rejected";
  proofImage?: string;
  proofImagePath?: string;
  proofNote?: string;
  feedback?: string;
  submittedAt?: string;
  verifiedAt?: string;
}

export interface QuizQuestion {
  id: string;
  type: "choice" | "boolean" | "essay";
  questionText: string;
  options?: string[]; // array of choice options
  correctAnswer?: string; // index for choice ("0", "1", etc.), "true"/"false" for boolean, or model answer for essay grading
  rubricPoints?: string[]; // array of mandatory key items required for full credit
  points: number;
  isCustomPoints?: boolean; // manual point override indicator
}

export interface Quiz {
  id: string;
  title: string;
  description?: string;
  questions: QuizQuestion[];
  points: number; // total points
  createdAt: string;
  active: boolean;
  timeLimit?: number; // optional time limit in minutes
  deadline?: string;
  endedEarly?: boolean;
  userExtensions?: Record<string, string>; // userId -> ISO_TIMESTAMP
  proctoringMode?: "OFF" | "WARN" | "STRICT";
  maxLeaves?: number;
  graceSeconds?: number;
  strictImmediateKick?: boolean;
}

export interface EssayGradeItem {
  questionId: string;
  score: number;
  matchedRubricPoints: string[];
  missingRubricPoints: string[];
  gradingReasoning: string;
  status: "auto_graded" | "admin_approved" | "admin_overridden";
  gradedAt: string;
}

export interface QuizQuestionResult {
  pointsEarned: number;
  feedback?: string;
  correct: boolean;
  studentAnswer: string;
  matchedRubricPoints?: string[];
  missingRubricPoints?: string[];
  gradingReasoning?: string;
  autoGraded?: boolean;
}

export interface QuizViolationRecord {
  id?: string;
  userId: string;
  quizId: string;
  timestamp: string;
  leaveDuration: number;
  reason?: string;
}

export interface QuizSubmission {
  id: string;
  quizId: string;
  userId: string;
  answers: Record<string, string>; // questionId -> answer
  questionResults: Record<string, QuizQuestionResult>; // questionId -> result
  essayGrades?: Record<string, EssayGradeItem>; // questionId -> essay grade
  totalScore: number;
  submittedAt: string;
  gradedAt?: string;
  status: "started" | "grading" | "completed" | "VIOLATION_TERMINATED";
  isManual?: boolean;
  violationCount?: number;
  violations?: QuizViolationRecord[];
}

export interface AppNotification {
  id: string;
  message: string;
  createdAt: string;
  userId?: string;
  createdByAdmin?: boolean;
  deliveryType?: "in_app" | "both";
}

export interface DatabaseState {
  users: User[];
  attendance: Record<string, Attendance>;
  tasks: Task[];
  config: {
    durationWeeks: number;
    leaderboardResetAt?: string;
    points: {
      meeting: number;
      liturgy: number;
      praise: number;
    };
  };
  notifications?: AppNotification[];
  quizzes?: Quiz[];
  quizSubmissions?: QuizSubmission[];
  quizViolations?: QuizViolationRecord[];
  quizTotals?: Record<string, number>;
  quizCounts?: Record<string, number>;
  bonuses?: Bonus[];
  confessions?: Record<string, ConfessionRecord>; // key: userId
  archives?: any[];
  _isFirestoreActive?: boolean;
  _cooldownRemaining?: number;
}

export interface ParticipantScore {
  id: string;
  name: string;
  attendancePoints: number;
  taskPoints: number;
  quizPoints: number;
  confessionPoints: number;
  bonusPoints: number;
  totalPoints: number;
  meetingsCount: number;
  liturgyCount: number;
  praiseCount: number;
  approvedTasksCount: number;
  quizCount: number;
  rank?: number;
  hasAvatar?: boolean;
  avatarVersion?: number;
  hidePhotoOnBoard?: boolean;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
