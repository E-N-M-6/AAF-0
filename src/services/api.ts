import { DatabaseState, User, UserProfile, Quiz, QuizQuestion, WebPushSubscription } from "../types";
export type { UserProfile };

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface MarathonSession {
  token: string;
  userId: string;
}

export function clearLegacySessionKeys(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("passcode");
  localStorage.removeItem("saved_user");
  localStorage.removeItem("saved_user_id");
  localStorage.removeItem("userId");
  localStorage.removeItem("user");
}

export function getSession(): MarathonSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("marathon_session");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string" && typeof parsed.userId === "string") {
      return parsed;
    }
  } catch {}
  return null;
}

export function setSession(session: MarathonSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("marathon_session", JSON.stringify(session));
  clearLegacySessionKeys();
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("marathon_session");
  clearLegacySessionKeys();
  window.dispatchEvent(new CustomEvent("marathon_unauthorized"));
}

// Automatically clear legacy auth keys on module load
if (typeof window !== "undefined") {
  clearLegacySessionKeys();
}

export function getQuizAnswerBackupKey(quizId: string, userId: string): string {
  return `quiz_answers_backup_${quizId}_${userId}`;
}

export function saveQuizAnswerBackup(quizId: string, userId: string, answers: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    const key = getQuizAnswerBackupKey(quizId, userId);
    localStorage.setItem(key, JSON.stringify({ quizId, answers, timestamp: Date.now() }));
  } catch {}
}

export function getQuizAnswerBackup(quizId: string, userId: string): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const key = getQuizAnswerBackupKey(quizId, userId);
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.quizId === quizId && parsed.answers && typeof parsed.answers === "object") {
        return parsed.answers;
      }
    }
  } catch {}
  return null;
}

export function clearQuizAnswerBackup(quizId: string, userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = getQuizAnswerBackupKey(quizId, userId);
    localStorage.removeItem(key);
  } catch {}
}

// --- Network Status & Offline Queue Engine ---
const OFFLINE_SUBMISSIONS_QUEUE_KEY = "pending_offline_submissions";

export interface OfflineSubmissionItem {
  id: string;
  quizId: string;
  userId: string;
  answers: Record<string, string>;
  status?: "started" | "grading" | "completed" | "VIOLATION_TERMINATED";
  timestamp: string;
  retries: number;
  networkInterrupted?: boolean;
  clientSubmittedAt?: string;
  disconnectCount?: number;
  offlineDurationSeconds?: number;
  frozenRemainingSeconds?: number;
  awaySeconds?: number;
}

export function isNetworkOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function subscribeNetworkStatus(callback: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleOnline = () => {
    callback(true);
    processOfflineSubmissionsQueue();
  };
  const handleOffline = () => callback(false);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

export function getOfflineSubmissionsQueue(): OfflineSubmissionItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OFFLINE_SUBMISSIONS_QUEUE_KEY) || localStorage.getItem("marathon_offline_submissions_queue");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineSubmissionsQueue(queue: OfflineSubmissionItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(OFFLINE_SUBMISSIONS_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export function enqueueOfflineSubmission(item: Omit<OfflineSubmissionItem, "id" | "timestamp" | "retries">): OfflineSubmissionItem {
  const queue = getOfflineSubmissionsQueue();
  const existingIdx = queue.findIndex(q => q.quizId === item.quizId && q.userId === item.userId);
  const newItem: OfflineSubmissionItem = {
    ...item,
    id: "offsub_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    retries: 0,
    networkInterrupted: true,
  };
  if (existingIdx >= 0) {
    queue[existingIdx] = newItem;
  } else {
    queue.push(newItem);
  }
  saveOfflineSubmissionsQueue(queue);
  return newItem;
}

let isSyncingQueue = false;

export async function processOfflineSubmissionsQueue(onSuccessCallback?: () => void): Promise<void> {
  if (typeof window === "undefined" || !isNetworkOnline() || isSyncingQueue) return;
  const queue = getOfflineSubmissionsQueue();
  if (queue.length === 0) return;

  isSyncingQueue = true;
  const remainingQueue: OfflineSubmissionItem[] = [];
  let syncedAny = false;

  for (const item of queue) {
    try {
      await fetchJson<{ db: DatabaseState }>("/api/quizzes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId: item.quizId,
          userId: item.userId,
          answers: item.answers,
          status: item.status,
          networkInterrupted: true,
          clientSubmittedAt: item.clientSubmittedAt,
          disconnectCount: item.disconnectCount,
          offlineDurationSeconds: item.offlineDurationSeconds,
          frozenRemainingSeconds: item.frozenRemainingSeconds,
          awaySeconds: item.awaySeconds,
        }),
      });
      clearQuizAnswerBackup(item.quizId, item.userId);
      syncedAny = true;
      console.log(`[Offline Queue] Successfully synced submission for quiz ${item.quizId}`);
    } catch (err) {
      console.warn(`[Offline Queue] Failed sync attempt ${item.retries + 1} for quiz ${item.quizId}:`, err);
      item.retries += 1;
      if (item.retries < 10) {
        remainingQueue.push(item);
      }
    }
  }

  saveOfflineSubmissionsQueue(remainingQueue);
  isSyncingQueue = false;

  if (syncedAny && onSuccessCallback) {
    onSuccessCallback();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    processOfflineSubmissionsQueue();
  });
}

export function getAuthHeaders(customHeaders?: HeadersInit): Headers {
  const headers = new Headers();
  
  if (customHeaders) {
    if (customHeaders instanceof Headers) {
      customHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    } else if (Array.isArray(customHeaders)) {
      customHeaders.forEach(([key, value]) => {
        headers.set(key, value);
      });
    } else {
      Object.entries(customHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
    }
  }

  const session = getSession();
  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  return headers;
}

/**
 * Isolated authenticated fetch helper that attaches Authorization: Bearer header
 * without mutating or reassigning window.fetch.
 */
export async function authenticatedFetch(
  url: string | URL | Request,
  options?: RequestInit
): Promise<Response> {
  const headers = getAuthHeaders(options?.headers);
  return fetch(url, {
    cache: options?.cache ?? "no-store",
    ...options,
    headers,
  });
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, {
    cache: "no-store",
    ...options,
  });

  if (response.status === 401) {
    clearSession();
    let errorMsg = "انتهت الجلسة أو الرمز غير صالح، يرجى إعادة تسجيل الدخول.";
    try {
      const data = await response.json();
      if (data && (data.error || data.message)) {
        errorMsg = data.error || data.message;
      }
    } catch {}
    throw new ApiError(errorMsg, 401);
  }

  if (response.status === 503) {
    let errorMsg = "الخدمة مشغولة حالياً، حاول مرة أخرى بعد قليل";
    try {
      const data = await response.json();
      if (data && (data.error || data.message)) {
        errorMsg = data.error || data.message;
      }
    } catch {}
    throw new ApiError(errorMsg, 503);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    let errorMsg = `HTTP error! status: ${response.status}`;
    if (contentType.includes("application/json")) {
      try {
        const data = await response.json();
        if (data && data.error) {
          errorMsg = data.error;
        } else if (data && data.message) {
          errorMsg = data.message;
        }
      } catch {
        // Ignore parsing error and use default status-based message
      }
    }
    throw new ApiError(errorMsg, response.status);
  }

  if (!contentType.includes("application/json")) {
    throw new ApiError(`Expected JSON response but received ${contentType || "unknown content type"}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Client-side canvas rendering before upload:
 * a. Load file onto an HTML5 <canvas> resized to 300x300 pixels.
 * b. Convert canvas to WebP Base64 format with 0.85 quality (canvas.toDataURL('image/webp', 0.85)).
 * c. Post this Data URL directly to the avatar backend endpoint.
 */
export async function compressAvatarImageToBase64(
  fileOrDataUrl: File | Blob | string,
  targetSize = 300,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const processImageSource = (src: string) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (width <= 0 || height <= 0) {
          reject(new Error("أبعاد الصورة غير صالحة"));
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("تعذر إنشاء سياق رسم الكانفاس"));
          return;
        }

        // Center-crop (cover) into exact targetSize x targetSize
        const scale = Math.max(targetSize / width, targetSize / height);
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;
        const offsetX = (targetSize - scaledWidth) / 2;
        const offsetY = (targetSize - scaledHeight) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

        // Convert to WebP Base64 format with 0.85 quality
        let dataUrl = canvas.toDataURL("image/webp", quality);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }

        resolve(dataUrl);
      };

      img.onerror = () => {
        reject(new Error("تعذر قراءة وتحميل الصورة"));
      };

      img.src = src;
    };

    if (typeof fileOrDataUrl === "string") {
      processImageSource(fileOrDataUrl);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === "string") {
          processImageSource(result);
        } else {
          reject(new Error("فشل قراءة ملف الصورة"));
        }
      };
      reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة المحدد"));
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

export const ApiService = {
  /**
   * Check backend and Firestore health status
   */
  async checkHealth(): Promise<{ ok: boolean; firestore: boolean; timestamp: string }> {
    return fetchJson<{ ok: boolean; firestore: boolean; timestamp: string }>("/api/health");
  },

  /**
   * Fetch full state with optional force refresh to bypass server-side caching/cooldown and pull from Firestore
   */
  async getState(forceRefresh?: boolean): Promise<DatabaseState> {
    const timestamp = Date.now();
    const params = new URLSearchParams();
    if (forceRefresh) {
      params.set("force_refresh", "true");
    }
    params.set("_t", timestamp.toString());
    const url = `/api/state?${params.toString()}`;
    return fetchJson<DatabaseState>(url, { cache: "no-store" });
  },

  /**
   * Core data-fetching method: alias for getState with strict cache-busting
   */
  async getAppState(forceRefresh?: boolean): Promise<DatabaseState> {
    return this.getState(forceRefresh);
  },

  /**
   * Fetch leaderboard data with strict cache-busting timestamp
   */
  async getLeaderboard(forceRefresh?: boolean): Promise<any> {
    const timestamp = Date.now();
    const params = new URLSearchParams();
    if (forceRefresh) {
      params.set("force_refresh", "true");
    }
    params.set("_t", timestamp.toString());
    const url = `/api/leaderboard?${params.toString()}`;
    return fetchJson(url, { cache: "no-store" });
  },

  /**
   * Fetch dynamic quizzes data with strict cache-busting timestamp
   */
  async getQuizzes(forceRefresh = true): Promise<{ success: boolean; quizzes: any[]; quizSubmissions?: any[] }> {
    const timestamp = Date.now();
    const url = `/api/quizzes?_t=${timestamp}`;
    return fetchJson<{ success: boolean; quizzes: any[]; quizSubmissions?: any[] }>(url, { cache: "no-store" });
  },

  /**
   * Refresh all dynamic admin data (live state, quiz submissions, security audit logs)
   * with cache-busting timestamp query parameter to bypass stale HTTP and proxy caching
   */
  async refreshAdminData(): Promise<{ db: DatabaseState; submissions: any[]; securityLogs?: any[] }> {
    const [db, subsRes, logsRes] = await Promise.all([
      this.getState(true),
      this.getAdminSubmissions(true),
      this.getSecurityLogs(true).catch(() => ({ success: false, logs: [], flaggedSubmissions: [], summary: {} })),
    ]);
    return {
      db,
      submissions: subsRes.submissions || subsRes.quizSubmissions || [],
      securityLogs: logsRes.logs || [],
    };
  },

  /**
   * Log in user
   */
  async login(username: string, passcode: string): Promise<{ success: boolean; token: string; expiresAt: string; user: User }> {
    const res = await fetchJson<{ success: boolean; token: string; expiresAt: string; user: User }>("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, passcode }),
    });

    if (res.success && res.token && res.user) {
      setSession({ token: res.token, userId: res.user.id });
    }

    return res;
  },

  /**
   * Log out user
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    try {
      await fetchJson<{ success: boolean; message: string }>("/api/logout", {
        method: "POST",
      });
    } catch {}
    clearSession();
    return { success: true, message: "تم تسجيل الخروج بنجاح" };
  },

  /**
   * Toggle attendance
   */
  async toggleAttendance(
    userId: string,
    weekIndex: number,
    type: string,
    attended: boolean
  ): Promise<{ db: DatabaseState; alreadyRecorded?: boolean }> {
    return fetchJson<{ db: DatabaseState }>("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, weekIndex, type, attended }),
    });
  },

  /**
   * Record liturgy attendance with custom score
   */
  async recordLiturgyAttendance(
    userId: string,
    weekIndex: number,
    attended: boolean,
    score: number
  ): Promise<{ db: DatabaseState; alreadyRecorded?: boolean }> {
    return fetchJson<{ db: DatabaseState }>("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, weekIndex, type: "liturgy", attended, score }),
    });
  },

  /**
   * Assign task to users
   */
  async createTask(
    userIds: string[],
    title: string,
    description: string,
    points: number
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds, title, description, points }),
    });
  },

  /**
   * Grade essay question manually by admin
   */
  async gradeEssayManual(
    submissionId: string,
    questionGrades: Record<string, { pointsEarned: number; feedback?: string }>
  ): Promise<{ message: string; db: DatabaseState; submission?: any }> {
    return this.gradeEssay(submissionId, questionGrades);
  },

  /**
   * Grade essay question manually via POST /api/admin/grade-essay
   */
  async gradeEssay(
    submissionId: string,
    questionGrades: Record<string, { pointsEarned: number; feedback?: string }> | { questionId: string; score: number; feedback?: string }
  ): Promise<{ message: string; db: DatabaseState; submission?: any }> {
    const body = typeof questionGrades === "object" && "questionId" in questionGrades
      ? { submissionId, questionId: questionGrades.questionId, score: questionGrades.score, feedback: questionGrades.feedback }
      : { submissionId, questionGrades };
    return fetchJson<{ message: string; db: DatabaseState; submission?: any }>("/api/admin/grade-essay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  /**
   * Reset leaderboard active scores while retaining historical logs
   */
  async resetLeaderboard(): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/leaderboard/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  /**
   * Verify task submission
   */
  async verifyTask(
    taskId: string,
    status: "approved" | "rejected",
    feedback: string
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/tasks/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status, feedback }),
    });
  },

  /**
   * Run AI review for task submission
   */
  async runAiReview(taskId: string): Promise<{ evaluation: string }> {
    return fetchJson<{ evaluation: string }>("/api/tasks/ai-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
  },

  /**
   * Add new user
   */
  async addUser(
    name: string,
    username?: string,
    passcode?: string
  ): Promise<{ db: DatabaseState; message: string }> {
    return fetchJson<{ db: DatabaseState; message: string }>("/api/users/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, passcode }),
    });
  },

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/users/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  },

  /**
   * Update user details (name, username)
   */
  async updateUser(
    userId: string,
    name: string,
    username?: string
  ): Promise<{ db: DatabaseState; user: User; message: string }> {
    return fetchJson<{ db: DatabaseState; user: User; message: string }>("/api/users/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name, username }),
    });
  },

  /**
   * Broadcast group notification or send to a specific user
   */
  async broadcastNotification(message: string, userId?: string, deliveryType?: "in_app" | "both"): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/notifications/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, userId, deliveryType }),
    });
  },

  /**
   * Delete a notification (Admin only)
   */
  async deleteNotification(id: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/notifications/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  },

  /**
   * Get Web Push VAPID Public Key
   */
  async getVapidPublicKey(): Promise<{ publicKey: string }> {
    return fetchJson<{ publicKey: string }>("/api/notifications/vapid-public-key", {
      method: "GET",
    });
  },

  /**
   * Subscribe client device to Web Push
   */
  async subscribeToPush(subscription: WebPushSubscription | PushSubscription | Record<string, unknown>): Promise<{ success: boolean; message: string }> {
    return fetchJson<{ success: boolean; message: string }>("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription }),
    });
  },

  /**
   * Send test push notification to user's device
   */
  async sendTestPush(): Promise<{ success: boolean; message: string }> {
    return fetchJson<{ success: boolean; message: string }>("/api/notifications/test-push", {
      method: "POST",
    });
  },

  /**
   * Change current user's passcode
   */
  async changePasscode(newPasscode: string): Promise<{ success: boolean; message: string; token?: string; db: DatabaseState; user: User }> {
    const res = await fetchJson<{ success: boolean; message: string; token?: string; db: DatabaseState; user: User }>("/api/users/change-passcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPasscode }),
    });

    if (res.success && res.token && res.user) {
      setSession({ token: res.token, userId: res.user.id });
    }

    return res;
  },

  /**
   * Create new quiz
   */
  async createQuiz(
    title: string,
    description: string,
    questions: QuizQuestion[],
    points: number,
    timeLimit?: number,
    deadline?: string,
    proctoringMode?: "OFF" | "WARN" | "STRICT",
    maxLeaves?: number,
    graceSeconds?: number,
    strictImmediateKick?: boolean
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        questions,
        points,
        timeLimit,
        deadline,
        proctoringMode,
        maxLeaves,
        graceSeconds,
        strictImmediateKick,
      }),
    });
  },

  /**
   * Terminate quiz early (Admin only)
   */
  async terminateQuiz(quizId: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId }),
    });
  },

  /**
   * Extend quiz deadline globally for all participants (Admin only)
   */
  async extendQuizGlobal(quizId: string, newDeadline: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/extend-global", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, newDeadline }),
    });
  },

  /**
   * Extend quiz deadline for a specific user or bulk users (Admin only)
   */
  async extendQuizUser(quizId: string, userIdOrIds: string | string[], extendedUntil: string): Promise<{ db: DatabaseState }> {
    const body = typeof userIdOrIds === "string"
      ? { quizId, userId: userIdOrIds, extendedUntil }
      : { quizId, userIds: userIdOrIds, extendedUntil };
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/extend-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  /**
   * Delete quiz
   */
  async deleteQuiz(quizId: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId }),
    });
  },

  /**
   * Attach answer key to an un-keyed quiz and batch-grade all pending submissions (Phase 6.2)
   */
  async attachAnswerKeyAndGrade(
    quizId: string,
    answerKey: Record<string, number>
  ): Promise<{ success: boolean; message: string; quiz: Quiz; gradedCount: number; db: DatabaseState }> {
    return fetchJson<{ success: boolean; message: string; quiz: Quiz; gradedCount: number; db: DatabaseState }>(
      `/api/admin/quizzes/${encodeURIComponent(quizId)}/batch-grade`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId, answerKey }),
      }
    );
  },

  /**
   * Reset database to initial seeding configuration
   */
  async resetData(): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/reset", {
      method: "POST",
    });
  },

  /**
   * Verify confession
   */
  async verifyConfession(
    userId: string,
    monthIndex: number,
    status: "approved" | "rejected" | "pending"
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/confessions/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, monthIndex, status }),
    });
  },

  /**
   * Revert / Unapprove confession
   */
  async revertConfession(
    userId: string,
    monthIndex: number
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/confessions/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, monthIndex }),
    });
  },

  /**
   * Manual/direct confession confirmation
   */
  async manualConfirmConfession(
    userId: string,
    monthIndex: number
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/confessions/manual-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, monthIndex }),
    });
  },

  /**
   * Add custom bonus points
   */
  async addBonus(
    userId: string,
    points: number,
    reason: string
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/bonuses/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, points, reason }),
    });
  },

  /**
   * Delete custom bonus
   */
  async deleteBonus(id: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/bonuses/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bonusId: id }),
    });
  },

  /**
   * Submit manual/paper quiz score
   */
  async manualSubmitQuiz(
    userId: string,
    quizId: string,
    score: number
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/manual-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, quizId, score }),
    });
  },

  /**
   * Submit task proof (as participant)
   */
  async submitTaskProof(
    taskId: string,
    proofNote: string,
    proofImage?: string
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/tasks/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, proofNote, proofImage }),
    });
  },

  /**
   * Start quiz timer/attempt
   */
  async startQuiz(quizId: string, userId: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, userId }),
    });
  },

  /**
   * Submit quiz answers with offline queueing resilience
   */
  async submitQuiz(
    quizId: string,
    userId: string,
    answers: Record<string, string>,
    status?: "started" | "grading" | "completed" | "VIOLATION_TERMINATED",
    networkInterrupted?: boolean,
    telemetry?: {
      clientSubmittedAt?: string;
      disconnectCount?: number;
      offlineDurationSeconds?: number;
      frozenRemainingSeconds?: number;
      awaySeconds?: number;
    }
  ): Promise<{ db: DatabaseState }> {
    saveQuizAnswerBackup(quizId, userId, answers);

    if (!isNetworkOnline()) {
      enqueueOfflineSubmission({
        quizId,
        userId,
        answers,
        status,
        networkInterrupted: true,
        clientSubmittedAt: telemetry?.clientSubmittedAt,
        disconnectCount: telemetry?.disconnectCount,
        offlineDurationSeconds: telemetry?.offlineDurationSeconds,
        frozenRemainingSeconds: telemetry?.frozenRemainingSeconds,
        awaySeconds: telemetry?.awaySeconds,
      });
      throw new ApiError("معطل مؤقتاً بسبب انقطاع الإنترنت 📡. تم حفظ إجاباتك محلياً وستتم المزامنة تلقائياً فور عودة الاتصال.");
    }

    try {
      const res = await fetchJson<{ db: DatabaseState }>("/api/quizzes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          userId,
          answers,
          status,
          networkInterrupted,
          clientSubmittedAt: telemetry?.clientSubmittedAt,
          disconnectCount: telemetry?.disconnectCount,
          offlineDurationSeconds: telemetry?.offlineDurationSeconds,
          frozenRemainingSeconds: telemetry?.frozenRemainingSeconds,
          awaySeconds: telemetry?.awaySeconds,
        }),
      });
      clearQuizAnswerBackup(quizId, userId);
      return res;
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 503 || err.status === 0 || !isNetworkOnline())) {
        enqueueOfflineSubmission({
          quizId,
          userId,
          answers,
          status,
          networkInterrupted: true,
          clientSubmittedAt: telemetry?.clientSubmittedAt,
          disconnectCount: telemetry?.disconnectCount,
          offlineDurationSeconds: telemetry?.offlineDurationSeconds,
          frozenRemainingSeconds: telemetry?.frozenRemainingSeconds,
          awaySeconds: telemetry?.awaySeconds,
        });
      }
      throw err;
    }
  },

  /**
   * Log an exam proctoring violation (e.g. app-switching / focus loss / copy-paste attempt)
   */
  async logQuizViolation(
    quizId: string,
    userId: string,
    leaveDuration: number,
    reason?: string,
    type?: string,
    details?: string,
    awaySeconds?: number
  ): Promise<{ db: DatabaseState }> {
    if (!isNetworkOnline()) {
      return { db: await this.getState().catch(() => ({ users: [], attendance: {}, tasks: [], config: { durationWeeks: 12, points: { meeting: 20, liturgy: 20, praise: 15 } } } as DatabaseState)) };
    }
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/log-violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, userId, leaveDuration, reason, type, details, awaySeconds }),
    });
  },

  /**
   * Admin unlock locked quiz attempt for student ("إعادة فتح للطالب")
   */
  async unlockQuizSubmission(quizId: string, userId: string): Promise<{ success: boolean; db: DatabaseState }> {
    return fetchJson<{ success: boolean; db: DatabaseState }>(`/api/admin/quizzes/${quizId}/unlock/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  /**
   * Expose Admin Security Audit Logs for flagged student submissions and violations
   */
  async getSecurityLogs(forceRefresh = true): Promise<{ success: boolean; logs: any[]; flaggedSubmissions: any[]; summary: any }> {
    const timestamp = Date.now();
    const url = `/api/admin/security-logs?_t=${timestamp}`;
    return fetchJson<{ success: boolean; logs: any[]; flaggedSubmissions: any[]; summary: any }>(url, { cache: "no-store" });
  },

  /**
   * Submit confession proof (as participant)
   */
  async submitConfession(
    userId: string,
    monthIndex: number,
    proofImage?: string
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/confessions/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, monthIndex, proofImage }),
    });
  },

  /**
   * Reopen/reset a quiz attempt for a participant (Admin only)
   */
  async reopenQuizAttempt(quizId: string, userId: string): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/reopen-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, userId }),
    });
  },

  /**
   * Fetch quiz submissions directly with cold-start resilience (Admin only)
   */
  async getAdminSubmissions(forceRefresh = true): Promise<{ success: boolean; submissions: any[]; quizSubmissions: any[]; count?: number }> {
    const timestamp = Date.now();
    const url = `/api/admin/submissions?_t=${timestamp}`;
    return fetchJson<{ success: boolean; submissions: any[]; quizSubmissions: any[]; count?: number }>(url, { cache: "no-store" });
  },

  /**
   * Export full database backup as a JSON blob (Admin only)
   */
  async exportBackup(): Promise<{ blob: Blob; filename: string }> {
    const response = await authenticatedFetch("/api/admin/export", {
      method: "GET",
    });

    if (!response.ok) {
      let errorMsg = `HTTP error! status: ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.error) {
          errorMsg = data.error;
        } else if (data && data.message) {
          errorMsg = data.message;
        }
      } catch {}
      throw new ApiError(errorMsg, response.status);
    }

    const disposition = response.headers.get("content-disposition");
    let filename = `marathon-backup-${new Date().toISOString().split("T")[0]}.json`;
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename=["']?([^"';]+)["']?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const blob = await response.blob();
    return { blob, filename };
  },

  /**
   * Migrate legacy base64 proof images to Firebase Cloud Storage (Admin only)
   */
  async migrateProofs(): Promise<{ success: boolean; migratedTasks: number; migratedConfessions: number; totalMigrated: number; message: string }> {
    return fetchJson<{ success: boolean; migratedTasks: number; migratedConfessions: number; totalMigrated: number; message: string }>("/api/admin/migrate-proofs", {
      method: "POST",
    });
  },

  /**
   * Upload user profile avatar (compressed client-side to 300x300 WebP Base64 Data URL with 0.85 quality)
   */
  async uploadAvatar(fileOrBase64: File | Blob | string): Promise<{ success: boolean; user: User; db: DatabaseState; photoURL?: string; avatarBase64?: string; avatarVersion?: number; avatarUpdatedAt?: string }> {
    let base64String: string;
    if (typeof fileOrBase64 === "string" && fileOrBase64.startsWith("data:image/webp;base64,")) {
      base64String = await compressAvatarImageToBase64(fileOrBase64, 300, 0.85);
    } else {
      base64String = await compressAvatarImageToBase64(fileOrBase64, 300, 0.85);
    }

    return fetchJson<{ success: boolean; user: User; db: DatabaseState; photoURL?: string; avatarBase64?: string; avatarVersion?: number; avatarUpdatedAt?: string }>("/api/profile/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photoURL: base64String,
        avatarBase64: base64String,
        image: base64String,
      }),
    });
  },

  /**
   * Get user avatar (Base64 string or details) from public profile endpoint
   */
  async getAvatar(userId: string): Promise<{ success: boolean; avatarBase64: string | null; avatarVersion?: number; avatarUpdatedAt?: string }> {
    return fetchJson<{ success: boolean; avatarBase64: string | null; avatarVersion?: number; avatarUpdatedAt?: string }>(
      `/api/profile/avatar/${encodeURIComponent(userId)}?format=json`
    );
  },

  /**
   * Delete current user profile avatar
   */
  async deleteAvatar(): Promise<{ success: boolean; user: User; db: DatabaseState }> {
    return fetchJson<{ success: boolean; user: User; db: DatabaseState }>("/api/profile/avatar", {
      method: "DELETE",
    });
  },

  /**
   * Admin removes any user's profile avatar
   */
  async adminRemoveAvatar(userId: string): Promise<{ success: boolean; message: string; db: DatabaseState }> {
    return fetchJson<{ success: boolean; message: string; db: DatabaseState }>("/api/admin/avatar/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  },

  /**
   * Update avatar privacy settings (hide photo on leaderboard)
   */
  async updatePrivacy(hidePhotoOnBoard: boolean): Promise<{ success: boolean; user: User; db: DatabaseState }> {
    return fetchJson<{ success: boolean; user: User; db: DatabaseState }>("/api/profile/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidePhotoOnBoard }),
    });
  },

  /**
   * Snooze avatar prompt modal
   */
  async snoozeAvatarPrompt(): Promise<{ success: boolean; user: User; db: DatabaseState }> {
    return fetchJson<{ success: boolean; user: User; db: DatabaseState }>("/api/profile/avatar/snooze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  /**
   * Get 96px thumbnail dataUrl map for participants
   */
  async getAvatarThumbs(): Promise<{ version: string | number; items: Record<string, string> }> {
    return fetchJson<{ version: string | number; items: Record<string, string> }>("/api/avatars/thumbs", {
      method: "GET",
    });
  },
};

export const getAppState = (forceRefresh?: boolean) => ApiService.getAppState(forceRefresh);
export const getLeaderboard = (forceRefresh?: boolean) => ApiService.getLeaderboard(forceRefresh);
export const refreshAdminData = () => ApiService.refreshAdminData();

