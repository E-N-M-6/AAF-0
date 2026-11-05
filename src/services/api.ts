import { DatabaseState, User, QuizQuestion, WebPushSubscription } from "../types";

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
    ...options,
    headers,
  });
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, options);

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
    const url = forceRefresh ? "/api/state?force_refresh=true" : "/api/state";
    return fetchJson<DatabaseState>(url);
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
   * Grade essay question manually or override
   */
  async gradeEssay(
    submissionId: string,
    questionGrades: Record<string, { pointsEarned: number; feedback?: string }>
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/grade-essay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, questionGrades }),
    });
  },

  /**
   * Auto-grade essay submissions using Gemini strict rubric engine
   */
  async autoGradeEssays(params?: {
    submissionId?: string;
    questionId?: string;
    quizId?: string;
  }): Promise<{ message: string; autoGradedCount?: number; db: DatabaseState; submission?: any }> {
    return fetchJson<{ message: string; autoGradedCount?: number; db: DatabaseState; submission?: any }>(
      "/api/admin/grade-essays",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params || {}),
      }
    );
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
   * Submit quiz answers
   */
  async submitQuiz(
    quizId: string,
    userId: string,
    answers: Record<string, string>,
    status?: "started" | "grading" | "completed" | "VIOLATION_TERMINATED"
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, userId, answers, status }),
    });
  },

  /**
   * Log an exam proctoring violation (e.g. app-switching / focus loss)
   */
  async logQuizViolation(
    quizId: string,
    userId: string,
    leaveDuration: number,
    reason?: string
  ): Promise<{ db: DatabaseState }> {
    return fetchJson<{ db: DatabaseState }>("/api/quizzes/log-violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, userId, leaveDuration, reason }),
    });
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
   * Upload user profile avatar (accepts File or base64)
   */
  async uploadAvatar(fileOrBase64: File | string): Promise<{ success: boolean; user: User; db: DatabaseState; avatarBase64?: string }> {
    if (fileOrBase64 instanceof File) {
      const formData = new FormData();
      formData.append("avatar", fileOrBase64);
      return fetchJson<{ success: boolean; user: User; db: DatabaseState; avatarBase64?: string }>("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
    } else {
      return fetchJson<{ success: boolean; user: User; db: DatabaseState; avatarBase64?: string }>("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: fileOrBase64 }),
      });
    }
  },

  /**
   * Get user avatar (Base64 string or details)
   */
  async getAvatar(userId: string): Promise<{ success: boolean; avatarBase64: string | null; avatarVersion?: number }> {
    return fetchJson<{ success: boolean; avatarBase64: string | null; avatarVersion?: number }>(
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
