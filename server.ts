import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import sharp from "sharp";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore as getFirestoreAdmin } from "firebase-admin/firestore";
import { getStorage as getStorageAdmin } from "firebase-admin/storage";
import webpush from "web-push";
import helmet from "helmet";

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || !process.env.SESSION_SECRET.trim())) {
  console.error("❌ FATAL ERROR: process.env.SESSION_SECRET is missing in production environment. Refusing to start server.");
  process.exit(1);
}

const SESSION_SECRET = (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim())
  ? process.env.SESSION_SECRET.trim()
  : "dev_marathon_session_secret_key_2026_default";

let firebaseInitialized = false;
let dbFirestore: ReturnType<typeof getFirestoreAdmin> | null = null;
let firestoreDisabled = false;
let lastFirestoreFailureTime = 0;
const FIRESTORE_RETRY_COOLDOWN_MS = 30000; // 30 seconds

function isFirestoreAuthError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { code?: number | string; message?: string; details?: string };
  const msg = String(err.message || err.details || error);
  const code = err.code;
  return (
    code === 16 ||
    code === "16" ||
    msg.includes("16 UNAUTHENTICATED") ||
    msg.includes("UNAUTHENTICATED") ||
    msg.includes("invalid authentication credentials") ||
    msg.includes("Could not load the default credentials")
  );
}

function initFirebase(): void {
  if (firebaseInitialized) return;

  let serviceAccount: Record<string, unknown> | null = null;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  // 1. Prioritize process.env.FIREBASE_SERVICE_ACCOUNT_JSON with safe parsing
  const envServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envServiceAccount && envServiceAccount.trim()) {
    try {
      serviceAccount = JSON.parse(envServiceAccount);
      console.log("Firebase Admin credentials successfully loaded from FIREBASE_SERVICE_ACCOUNT_JSON.");
    } catch (parseErr) {
      console.warn("⚠️ تحذير: فشل تحليل متغير البيئة FIREBASE_SERVICE_ACCOUNT_JSON كـ JSON صالح:", parseErr);
    }
  }

  // 2. Initialize Firebase Admin SDK (Service Account or Application Default Credentials)
  if (serviceAccount) {
    try {
      initializeApp({
        credential: cert(serviceAccount),
        ...(storageBucket ? { storageBucket } : {}),
      });
      dbFirestore = getFirestoreAdmin();
      dbFirestore.settings({ ignoreUndefinedProperties: true });
      firebaseInitialized = true;
      console.log("Firebase Admin initialized with service account from FIREBASE_SERVICE_ACCOUNT_JSON.");
    } catch (certError) {
      console.warn("⚠️ تحذير: فشل تهيئة Firebase Admin باستخدام حساب الخدمة:", certError);
      firestoreDisabled = true;
    }
  } else {
    try {
      initializeApp({
        ...(storageBucket ? { storageBucket } : {}),
      });
      dbFirestore = getFirestoreAdmin();
      dbFirestore.settings({ ignoreUndefinedProperties: true });
      firebaseInitialized = true;
      console.log("Firebase Admin initialized with Application Default Credentials (ADC).");
    } catch (defaultError) {
      console.warn("⚠️ تحذير: بيانات اعتماد الفايربيس مفقودة أو غير صالحة. تم تعطيل الاتصال السحابي مؤقتاً والاعتماد على قاعدة البيانات المحلية.");
      firestoreDisabled = true;
    }
  }
}

function getFirestore(): ReturnType<typeof getFirestoreAdmin> | null {
  if (!firebaseInitialized) {
    initFirebase();
  }
  if (firestoreDisabled) {
    const now = Date.now();
    if (now - lastFirestoreFailureTime < FIRESTORE_RETRY_COOLDOWN_MS) {
      return null; // Bypassed during cooldown to keep app extremely responsive
    } else {
      console.log("Firestore recovery cooldown expired. Attempting to reconnect/retry synchronization with Cloud Firestore...");
      firestoreDisabled = false;
    }
  }
  return dbFirestore;
}

let firestoreInitPromise: Promise<ReturnType<typeof getFirestoreAdmin> | null> | null = null;

async function ensureFirestoreInitialized(): Promise<ReturnType<typeof getFirestoreAdmin> | null> {
  const current = getFirestore();
  if (current) return current;

  if (!firestoreInitPromise) {
    firestoreInitPromise = (async () => {
      try {
        if (!firebaseInitialized) {
          initFirebase();
        }
        if (firestoreDisabled) {
          const now = Date.now();
          if (now - lastFirestoreFailureTime >= FIRESTORE_RETRY_COOLDOWN_MS) {
            firestoreDisabled = false;
          }
        }
        return dbFirestore;
      } finally {
        firestoreInitPromise = null;
      }
    })();
  }
  return firestoreInitPromise;
}

async function withFirestoreRetry<T>(
  operation: (db: ReturnType<typeof getFirestoreAdmin>) => Promise<T>,
  maxRetries = 3,
  delayMs = 400
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const db = await ensureFirestoreInitialized();
      if (!db) {
        throw new Error("قاعدة بيانات Firestore غير مهيأة أو في فترة التبريد");
      }
      return await operation(db);
    } catch (err: unknown) {
      lastError = err;
      if (isFirestoreAuthError(err)) {
        throw err;
      }
      if (attempt < maxRetries) {
        console.warn(`[Firestore Retry] المحاولة ${attempt}/${maxRetries} أثناء بدء التشغيل البارد (Cold-Start):`, err instanceof Error ? err.message : err);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

function getStorageBucket() {
  if (!firebaseInitialized) {
    initFirebase();
  }
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName || !bucketName.trim()) return null;
  try {
    return getStorageAdmin().bucket(bucketName.trim());
  } catch (err) {
    console.warn("⚠️ Failed to get Firebase Storage bucket:", err);
    return null;
  }
}

function parseBase64Image(base64Data: string): { buffer: Buffer; mimeType: string; extension: string } {
  const allowedMimeTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const matches = base64Data.match(/^data:(image\/[A-Za-z-+]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("صيغة بيانية غير صالحة للصورة");
  }

  const mimeType = matches[1].toLowerCase();
  const ext = allowedMimeTypes[mimeType];
  if (!ext) {
    throw new Error("نوع الملف غير مدعوم. الأنواع المسموح بها هي JPEG و PNG و WebP فقط.");
  }

  const buffer = Buffer.from(matches[2], "base64");
  return { buffer, mimeType, extension: ext };
}

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const AVATARS_DIR = path.join(UPLOADS_DIR, "avatars");
const PROOFS_DIR = path.join(UPLOADS_DIR, "proofs");
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}
if (!fs.existsSync(PROOFS_DIR)) {
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
}

async function saveProofToStorage(base64Data: string, storagePath: string): Promise<{ storagePath: string; mimeType: string } | null> {
  const { buffer, mimeType } = parseBase64Image(base64Data);

  // 1. Always persist to local storage fallback
  try {
    const localFilePath = path.join(process.cwd(), "public", "uploads", storagePath);
    const localDir = path.dirname(localFilePath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    fs.writeFileSync(localFilePath, buffer);
  } catch (err) {
    console.warn(`⚠️ Failed to save proof file locally (${storagePath}):`, err);
  }

  // 2. Also persist to Cloud Storage if bucket is configured
  const bucket = getStorageBucket();
  if (bucket) {
    try {
      const file = bucket.file(storagePath);
      await file.save(buffer, {
        contentType: mimeType,
        metadata: {
          contentType: mimeType,
        },
        resumable: false,
      });
    } catch (err) {
      console.warn(`Failed to save proof to Cloud Storage (${storagePath}):`, err);
    }
  }

  return { storagePath, mimeType };
}

async function deleteFileFromStorage(filePath?: string): Promise<void> {
  if (!filePath || !filePath.trim()) return;

  // 1. Delete from local storage fallback
  try {
    const localFilePath = path.join(process.cwd(), "public", "uploads", filePath.trim());
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
      console.log(`Successfully deleted old proof file from local storage: ${filePath}`);
    }
  } catch (err) {
    console.warn(`Failed to delete old proof file from local storage (${filePath}):`, err);
  }

  // 2. Delete from Cloud Storage if bucket exists
  const bucket = getStorageBucket();
  if (!bucket) return;
  try {
    const file = bucket.file(filePath.trim());
    const [exists] = await file.exists();
    if (exists) {
      await file.delete();
      console.log(`Successfully deleted old proof file from Storage: ${filePath}`);
    }
  } catch (err) {
    console.warn(`Failed to delete old proof file from Storage (${filePath}):`, err);
  }
}

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
});

function validateImageMagicBytes(buffer: Buffer): string {
  if (!buffer || buffer.length < 12) {
    throw new Error("ملف الصورة غير صالح أو فارغ.");
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // WEBP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  throw new Error("نوع الملف غير مدعوم. الأنواع المسموح بها هي JPEG و PNG و WebP فقط.");
}

interface AvatarRecord {
  userId: string;
  avatarBase64: string;
  avatarUpdatedAt: string;
  avatarVersion: number;
}

const serverAvatarCache = new Map<string, AvatarRecord>();

async function processAvatarWebP(inputBuffer: Buffer): Promise<{ buffer: Buffer; base64: string }> {
  validateImageMagicBytes(inputBuffer);

  const buffer = await sharp(inputBuffer, { failOnError: false } as any)
    .rotate()
    .resize(300, 300, { fit: "cover", position: "center" })
    .webp({ quality: 85 })
    .toBuffer();

  const base64 = `data:image/webp;base64,${buffer.toString("base64")}`;
  return { buffer, base64 };
}

async function processAvatarImages(inputBuffer: Buffer): Promise<{ buf512: Buffer; buf96: Buffer }> {
  const { buffer } = await processAvatarWebP(inputBuffer);
  return { buf512: buffer, buf96: buffer };
}

async function saveAvatarToFirestore(userId: string, avatarBase64: string, avatarVersion: number, avatarUpdatedAt: string): Promise<void> {
  const record: AvatarRecord = {
    userId,
    avatarBase64,
    avatarUpdatedAt,
    avatarVersion,
  };

  // 1. In-memory cache update
  serverAvatarCache.set(userId, record);

  // 2. Persist EXCLUSIVELY to isolated Firestore collection 'avatars/{userId}'
  // Propagate all errors to caller without silent swallowing to ensure API fails explicitly
  await ensureFirestoreInitialized();
  const dbFs = getFirestore();
  if (dbFs) {
    await withFirestoreRetry(async (fsInstance) => {
      await fsInstance.collection("avatars").doc(userId).set(record, { merge: true });
    }, 3, 350);
    console.log(`[Avatar] Successfully persisted avatar to isolated Firestore collection avatars/${userId} (version: ${avatarVersion}).`);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("قاعدة بيانات Firestore غير متصلة؛ تعذر حفظ الصورة الشخصية.");
  }

  // 3. Keep local files as secondary cache
  try {
    const userDir = path.join(AVATARS_DIR, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    const base64Data = avatarBase64.replace(/^data:image\/[a-z0-9-+.]+;base64,/, "");
    const buf = Buffer.from(base64Data, "base64");
    fs.writeFileSync(path.join(userDir, "avatar.webp"), buf);
    fs.writeFileSync(path.join(userDir, "512.webp"), buf);
    fs.writeFileSync(path.join(userDir, "96.webp"), buf);
    fs.writeFileSync(path.join(userDir, "avatar.json"), JSON.stringify(record));
  } catch (err) {
    console.warn(`[Avatar] Local disk fallback write notice for ${userId}:`, err);
  }
}

async function getAvatarFromFirestore(userId: string): Promise<AvatarRecord | null> {
  if (!userId) return null;

  // 1. In-memory cache hit
  const cached = serverAvatarCache.get(userId);
  if (cached && cached.avatarBase64) {
    return cached;
  }

  // 2. Retrieve directly from Firestore dedicated 'avatars/{userId}' with cold-start retry
  try {
    const record = await withFirestoreRetry<AvatarRecord | null>(async (dbFs) => {
      const docSnap = await dbFs.collection("avatars").doc(userId).get();
      if (docSnap.exists) {
        const data = docSnap.data() as Partial<AvatarRecord> | undefined;
        if (data && data.avatarBase64) {
          return {
            userId,
            avatarBase64: data.avatarBase64,
            avatarUpdatedAt: data.avatarUpdatedAt || new Date().toISOString(),
            avatarVersion: typeof data.avatarVersion === "number" ? data.avatarVersion : 1,
          };
        }
      }

      // Check fallback in users/{userId} if present
      const userSnap = await dbFs.collection("users").doc(userId).get();
      if (userSnap.exists) {
        const userData = userSnap.data() as { avatarBase64?: string; avatarUpdatedAt?: string; avatarVersion?: number } | undefined;
        if (userData && userData.avatarBase64) {
          return {
            userId,
            avatarBase64: userData.avatarBase64,
            avatarUpdatedAt: userData.avatarUpdatedAt || new Date().toISOString(),
            avatarVersion: typeof userData.avatarVersion === "number" ? userData.avatarVersion : 1,
          };
        }
      }
      return null;
    }, 3, 350);

    if (record) {
      serverAvatarCache.set(userId, record);
      return record;
    }
  } catch (fsErr) {
    console.warn(`[Avatar] Firestore avatar retrieval error for ${userId}:`, fsErr);
  }

  // 3. Fallback: local disk cache / json file
  try {
    const userJsonPath = path.join(AVATARS_DIR, userId, "avatar.json");
    if (fs.existsSync(userJsonPath)) {
      const data = JSON.parse(fs.readFileSync(userJsonPath, "utf8"));
      if (data && data.avatarBase64) {
        serverAvatarCache.set(userId, data);
        return data;
      }
    }

    const legacyAvatarPath = path.join(AVATARS_DIR, userId, "avatar.webp");
    const legacy512Path = path.join(AVATARS_DIR, userId, "512.webp");
    const legacy96Path = path.join(AVATARS_DIR, userId, "96.webp");
    const diskPath = fs.existsSync(legacyAvatarPath)
      ? legacyAvatarPath
      : fs.existsSync(legacy512Path)
      ? legacy512Path
      : fs.existsSync(legacy96Path)
      ? legacy96Path
      : null;

    if (diskPath) {
      const fileBuf = fs.readFileSync(diskPath);
      const b64 = `data:image/webp;base64,${fileBuf.toString("base64")}`;
      const record: AvatarRecord = {
        userId,
        avatarBase64: b64,
        avatarUpdatedAt: new Date().toISOString(),
        avatarVersion: 1,
      };
      serverAvatarCache.set(userId, record);
      return record;
    }
  } catch (diskErr) {
    console.warn(`[Avatar] Local disk fallback read failed for user ${userId}:`, diskErr);
  }

  // 4. Fallback: Cloud Storage if previously saved
  const bucket = getStorageBucket();
  if (bucket) {
    try {
      const file = bucket.file(`avatars/${userId}/512.webp`);
      const [exists] = await file.exists();
      if (exists) {
        const [buf] = await file.download();
        const b64 = `data:image/webp;base64,${buf.toString("base64")}`;
        const record: AvatarRecord = {
          userId,
          avatarBase64: b64,
          avatarUpdatedAt: new Date().toISOString(),
          avatarVersion: 1,
        };
        serverAvatarCache.set(userId, record);
        return record;
      }
    } catch (storageErr) {
      console.warn(`[Avatar] Cloud Storage download failed for user ${userId}:`, storageErr);
    }
  }

  return null;
}

async function removeAvatarFromFirestore(userId: string): Promise<void> {
  // 1. In-memory
  serverAvatarCache.delete(userId);

  // 2. Isolated Firestore collection
  await ensureFirestoreInitialized();
  const dbFs = getFirestore();
  if (dbFs) {
    try {
      await withFirestoreRetry(async (fsInstance) => {
        await fsInstance.collection("avatars").doc(userId).delete();
      }, 3, 350);
      console.log(`[Avatar] Successfully deleted avatar document from isolated Firestore collection avatars/${userId}.`);
    } catch (fsErr) {
      console.error(`[Avatar] Error deleting avatar from Firestore for user ${userId}:`, fsErr);
      throw fsErr;
    }
  }

  // 3. Disk & storage cleanup
  await deleteAvatarFiles(userId);
}

async function saveAvatarFiles(userId: string, buf512: Buffer, buf96: Buffer): Promise<void> {
  const b64 = `data:image/webp;base64,${buf512.toString("base64")}`;
  await saveAvatarToFirestore(userId, b64, 1, new Date().toISOString());
}

async function deleteAvatarFiles(userId: string): Promise<void> {
  const userDir = path.join(AVATARS_DIR, userId);
  if (fs.existsSync(userDir)) {
    try {
      fs.rmSync(userDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Failed to delete local avatar folder for ${userId}:`, e);
    }
  }

  const bucket = getStorageBucket();
  if (bucket) {
    try {
      await bucket.file(`avatars/${userId}/512.webp`).delete({ ignoreNotFound: true });
      await bucket.file(`avatars/${userId}/96.webp`).delete({ ignoreNotFound: true });
    } catch (err) {
      console.warn(`Failed to delete avatar from Cloud Storage for user ${userId}:`, err);
    }
  }
}

async function getAvatarBuffer(userId: string, _size?: "512" | "96" | string): Promise<Buffer | null> {
  const record = await getAvatarFromFirestore(userId);
  if (record && record.avatarBase64) {
    const base64Data = record.avatarBase64.replace(/^data:image\/[a-z0-9-+.]+;base64,/, "");
    return Buffer.from(base64Data, "base64");
  }
  return null;
}



const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DB_PATH = path.join(process.cwd(), "db.json");

// Allow trust proxy for Google Cloud / Cloud Run health check and proxy headers
app.set("trust proxy", 1);

// 1. Add Helmet security headers and configure CSP for base64 / external images, allowing iframes
app.use(
  helmet({
    frameguard: false, // Disables X-Frame-Options to allow rendering inside the AI Studio iframe preview
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:", "https:", "*"],
        "frame-ancestors": ["'self'", "*"], // Allows the app to be embedded in the AI Studio platform
      },
    },
  })
);

// Disable x-powered-by specifically to prevent server fingerprinting
app.disable("x-powered-by");

// 2. Limit acceptable HTTP methods to GET, POST, OPTIONS, and HEAD to satisfy Nikto and cloud health checks
app.use((req, res, next) => {
  const allowedMethods = ["GET", "POST", "OPTIONS", "HEAD"];
  if (!allowedMethods.includes(req.method)) {
    return res.status(405).json({ error: `طريقة الطلب ${req.method} غير مسموح بها بالخادم.` });
  }
  next();
});

// Increase Express body parser limits BEFORE registering any API routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Strict no-cache middleware for dynamic real-time data endpoints
const noCacheMiddleware: express.Handler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
};

// Serve the uploaded logo directly to avoid bundler resolution issues
app.get("/assets/logo.jpg", (req, res) => {
  const srcPath = path.join(process.cwd(), "src", "assets", "logo.jpg");
  if (fs.existsSync(srcPath)) {
    return res.sendFile(srcPath);
  }
  const rootPath = path.join(process.cwd(), "assets", "logo.jpg");
  if (fs.existsSync(rootPath)) {
    return res.sendFile(rootPath);
  }
  res.status(404).send("Logo not found");
});

// Serve manifest.json
app.get("/manifest.json", (req, res) => {
  const manifestPath = path.join(process.cwd(), "public", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    return res.sendFile(manifestPath);
  }
  res.status(404).send("Manifest not found");
});

// Types definitions
interface Attendance {
  meetings: number[]; // week indices (1-12)
  liturgy: number[];  // week indices (1-12)
  praise: number[];   // week indices (1-12)
  liturgyScores?: Record<string, number>; // key: weekIndex, value: score (20 or 10 or 0)
}

interface ConfessionMonth {
  status: "pending" | "approved" | "rejected";
  proofImage?: string; // base64 string
  proofImagePath?: string; // Firebase Cloud Storage path
  confessionProofUrl?: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

interface ConfessionRecord {
  months: Record<string, ConfessionMonth>; // key: monthIndex ("1", "2", "3")
}

interface Bonus {
  id: string;
  userId: string;
  points: number;
  reason: string;
  createdAt: string;
}

interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  points: number;
  status: "pending" | "submitted" | "approved" | "rejected";
  proofImage?: string; // base64 string
  proofImagePath?: string; // Firebase Cloud Storage path
  proofNote?: string;
  feedback?: string;
  submittedAt?: string;
  verifiedAt?: string;
}

interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface User {
  id: string;
  name: string;
  role: "admin" | "participant";
  passcode: string;
  username?: string;
  sessionVersion?: number;
  totalArchivedPoints?: number;
  pushSubscriptions?: WebPushSubscription[];
  photoURL?: string;
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

interface AppNotification {
  id: string;
  message: string;
  createdAt: string;
  userId?: string;
  createdByAdmin?: boolean;
  deliveryType?: "in_app" | "both";
}

type QuestionType = "choice" | "boolean" | "essay" | "fill_in_the_blank" | "quote";

interface QuizQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  options?: string[];
  correctAnswer?: string;
  modelAnswer?: string;
  rubricPoints?: string[];
  points: number;
}

interface Quiz {
  id: string;
  title: string;
  description?: string;
  questions: QuizQuestion[];
  points: number;
  createdAt: string;
  active: boolean;
  timeLimit?: number;
  deadline?: string;
  endedEarly?: boolean;
  userExtensions?: Record<string, string>;
  proctoringMode?: "OFF" | "WARN" | "STRICT";
  maxLeaves?: number;
  graceSeconds?: number;
  strictImmediateKick?: boolean;
}

interface EssayGradeItem {
  questionId: string;
  score: number;
  matchedRubricPoints?: string[];
  missingRubricPoints?: string[];
  gradingReasoning: string;
  status: "auto_graded" | "admin_approved" | "admin_overridden" | "pending_manual_review";
  gradedAt: string;
}

interface QuizQuestionResult {
  pointsEarned: number;
  feedback?: string;
  correct: boolean;
  studentAnswer: string;
  matchedRubricPoints?: string[];
  missingRubricPoints?: string[];
  gradingReasoning?: string;
  autoGraded?: boolean;
  status?: string;
}

interface QuizViolationRecord {
  id: string;
  userId: string;
  quizId: string;
  timestamp: string;
  leaveDuration: number;
  reason?: string;
  type?: string;
  details?: string;
}

interface QuizSubmission {
  id: string;
  quizId: string;
  userId: string;
  answers: Record<string, string>;
  questionResults: Record<string, QuizQuestionResult>;
  essayGrades?: Record<string, EssayGradeItem>;
  totalScore: number;
  submittedAt: string;
  gradedAt?: string;
  status: "started" | "grading" | "completed" | "graded" | "pending_manual_review" | "pending_auto_grade" | "VIOLATION_TERMINATED";
  isManual?: boolean;
  violationCount?: number;
  violations?: QuizViolationRecord[];
}

interface DatabaseSchema {
  users: User[];
  attendance: Record<string, Attendance>; // key: userId
  tasks: Task[];
  config: {
    durationWeeks: number;
    leaderboardResetAt?: string;
    points: {
      meeting: number;
      liturgy: number;
      praise: number;
    };
    vapidKeys?: {
      publicKey: string;
      privateKey: string;
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
}

// Initial seed data
const initialDB: DatabaseSchema = {
  users: [],
  attendance: {},
  tasks: [],
  config: {
    durationWeeks: 12,
    points: {
      meeting: 20,
      liturgy: 20,
      praise: 15
    }
  },
  notifications: [],
  quizzes: [],
  quizSubmissions: [],
  bonuses: [],
  confessions: {}
};

// Helper to seed initial admin accounts if none exist in the database
function seedAdminUsers(db: DatabaseSchema): boolean {
  if (!db.users) db.users = [];

  const hasAdmin = db.users.some(u => u && u.role === "admin");
  if (hasAdmin) {
    return false; // Database already contains at least one admin; never overwrite or alter existing users
  }

  const seedEnv = process.env.ADMIN_SEED_USERS_JSON;
  if (!seedEnv || !seedEnv.trim()) {
    console.warn("⚠️ تحذير: لا يوجد أي حساب مشرف (role: 'admin') في قاعدة البيانات، ومتغير البيئة ADMIN_SEED_USERS_JSON غير محدد.");
    return false;
  }

  try {
    const parsed = JSON.parse(seedEnv);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("⚠️ تحذير: متغير البيئة ADMIN_SEED_USERS_JSON فارغ أو ليس مصفوفة صالحة.");
      return false;
    }

    let added = false;
    for (const item of parsed) {
      if (item && item.id && item.name && item.passcode) {
        db.users.push({
          id: String(item.id),
          name: String(item.name),
          username: String(item.username || item.name),
          role: "admin",
          passcode: String(item.passcode)
        });
        added = true;
      }
    }

    if (added) {
      console.log("✅ تم إنشاء حسابات المشرفين الأولية بنجاح من متغير ADMIN_SEED_USERS_JSON.");
      return true;
    }
  } catch (err) {
    console.error("⚠️ خطأ أثناء تحليل ADMIN_SEED_USERS_JSON:", err);
  }

  return false;
}

// Helper to calculate the most recent Friday 11:59 PM
function getLastFriday1159PM(now: Date): Date {
  const target = new Date(now);
  const currentDay = target.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  let daysToSubtract = (currentDay - 5 + 7) % 7;
  
  if (currentDay === 5) {
    const currentHours = target.getHours();
    const currentMinutes = target.getMinutes();
    if (currentHours < 23 || (currentHours === 23 && currentMinutes < 59)) {
      daysToSubtract = 7;
    } else {
      daysToSubtract = 0;
    }
  }
  
  target.setDate(target.getDate() - daysToSubtract);
  target.setHours(23, 59, 0, 0);
  return target;
}

// File-based fallback database helpers
function migrateDB(db: DatabaseSchema): boolean {
  if (!db.users) db.users = [];

  let changed = false;

  // 1. Remove old admin user
  const beforeCount = db.users.length;
  db.users = db.users.filter(u => u.id !== "admin" && u.name !== "خادم المسابقة (الآدمن)");
  if (db.users.length !== beforeCount) {
    changed = true;
  }

  // 2. Safe admin seeding: only seed if no admin exists, without overwriting existing accounts
  if (seedAdminUsers(db)) {
    changed = true;
  }

  // 3. Ensure database objects are correctly typed
  if (!db.attendance || Array.isArray(db.attendance)) {
    db.attendance = {};
    changed = true;
  }
  if (!db.confessions || Array.isArray(db.confessions)) {
    db.confessions = {};
    changed = true;
  }
  if (!db.config || !db.config.points) {
    db.config = initialDB.config;
    changed = true;
  } else {
    if (db.config.points.meeting !== 20) {
      db.config.points.meeting = 20;
      changed = true;
    }
    if (db.config.points.praise !== 15) {
      db.config.points.praise = 15;
      changed = true;
    }
    if (db.config.points.liturgy !== 20) {
      db.config.points.liturgy = 20;
      changed = true;
    }
  }
  if (!db.config.vapidKeys) {
    try {
      const keys = webpush.generateVAPIDKeys();
      db.config.vapidKeys = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey
      };
      changed = true;
      console.log("Successfully generated new Web Push VAPID keys:", keys.publicKey);
    } catch (err) {
      console.error("Failed to generate VAPID keys automatically:", err);
    }
  }

  // Prune notifications created before the most recent Friday 11:59 PM to prevent accumulation
  if (db.notifications && db.notifications.length > 0) {
    const lastFriday1159PM = getLastFriday1159PM(new Date());
    const initialLength = db.notifications.length;
    db.notifications = db.notifications.filter(notif => {
      if (!notif || !notif.createdAt) return false;
      const notifTime = new Date(notif.createdAt).getTime();
      return notifTime >= lastFriday1159PM.getTime();
    });
    if (db.notifications.length !== initialLength) {
      changed = true;
      console.log(`Pruned ${initialLength - db.notifications.length} old notifications (created before last Friday 11:59 PM).`);
    }
  }

  // Sanitize and decouple avatars from db.users: keep ONLY lightweight metadata
  if (db.users && Array.isArray(db.users)) {
    for (const u of db.users) {
      // 1. Check if user currently has an avatar
      const hadAvatar = Boolean(
        u.hasAvatar ||
        (u.avatarBase64 && u.avatarBase64.startsWith("data:image/")) ||
        (u.photoURL && (u.photoURL.startsWith("data:image/") || u.photoURL.startsWith("/api/profile/avatar/")))
      );

      // 2. Strip heavy base64 strings and data URIs from db.users
      if (u.avatarBase64) {
        delete u.avatarBase64;
        changed = true;
      }
      if (u.photoURL && u.photoURL.startsWith("data:image/")) {
        delete u.photoURL;
        changed = true;
      }

      // 3. Sanitize legacy invalid URLs (blob:, localhost, file://)
      if (u.photoURL && (
        u.photoURL.startsWith("blob:") ||
        u.photoURL.startsWith("http://localhost") ||
        u.photoURL.startsWith("https://localhost") ||
        u.photoURL.startsWith("http://127.0.0.1") ||
        u.photoURL.startsWith("file://")
      )) {
        u.photoURL = undefined;
        changed = true;
      }

      // 4. Set lightweight metadata flags
      if (hadAvatar) {
        if (!u.hasAvatar) {
          u.hasAvatar = true;
          changed = true;
        }
        if (!u.avatarVersion || typeof u.avatarVersion !== "number") {
          u.avatarVersion = 1;
          changed = true;
        }
        if (!u.avatarUpdatedAt) {
          u.avatarUpdatedAt = new Date().toISOString();
          changed = true;
        }
        const relativeUrl = `/api/profile/avatar/${u.id}`;
        if (u.photoURL !== relativeUrl) {
          u.photoURL = relativeUrl;
          changed = true;
        }
      } else {
        if (u.hasAvatar) {
          u.hasAvatar = false;
          changed = true;
        }
        if (u.photoURL) {
          u.photoURL = undefined;
          changed = true;
        }
      }
    }
  }

  return changed;
}

function readLocalDB(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(initialDB, null, 2), "utf8");
      return initialDB;
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(data);
    
    // Ensure all fields are initialized
    if (!parsed.users) parsed.users = [];
    if (!parsed.attendance || Array.isArray(parsed.attendance)) parsed.attendance = {};
    if (!parsed.tasks) parsed.tasks = [];
    if (!parsed.config || !parsed.config.points) parsed.config = initialDB.config;
    if (!parsed.notifications) parsed.notifications = [];
    if (!parsed.quizzes) parsed.quizzes = [];
    if (!parsed.quizSubmissions) parsed.quizSubmissions = [];
    if (!parsed.bonuses) parsed.bonuses = [];
    if (!parsed.confessions || Array.isArray(parsed.confessions)) parsed.confessions = {};
    
    const wasChanged = migrateDB(parsed);
    if (wasChanged) {
      fs.writeFileSync(DB_PATH, JSON.stringify(parsed, null, 2), "utf8");
    }
    
    return parsed;
  } catch (error) {
    console.error("Error reading local database file, returning initial schema:", error);
    return JSON.parse(JSON.stringify(initialDB));
  }
}

function writeLocalDB(data: DatabaseSchema) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Error writing local database file:", error);
  }
}

// Helper functions for Firestore database operations with strict production persistence
async function readDB(forceRefresh = false): Promise<DatabaseSchema> {
  const isProd = process.env.NODE_ENV === "production";
  await ensureFirestoreInitialized();
  const dbFs = forceRefresh || isProd ? dbFirestore || getFirestore() : getFirestore();
  
  if (!dbFs) {
    if (isProd) {
      const err = new Error("الخدمة مشغولة حالياً، حاول مرة أخرى بعد قليل");
      (err as unknown as { status: number }).status = 503;
      throw err;
    }
    console.log("Firestore not available or cooling down, reading from local db.json");
    if (forceRefresh) {
      const err = new Error("الخدمة غير متصلة بحساب الفايربيس، تحقق من الأسرار");
      (err as unknown as { status: number }).status = 503;
      throw err;
    }
    return readLocalDB();
  }

  try {
    const collections = [
      "users", "attendance", "tasks", "config", "notifications",
      "quizzes", "quizSubmissions", "bonuses", "confessions"
    ] as const;
    
    const snapshots = await withFirestoreRetry(
      async (fsInstance) => {
        const dbRef = fsInstance.collection("appState");
        return await Promise.all(collections.map(c => dbRef.doc(c).get()));
      },
      3,
      400
    );
    
    const db: Record<string, unknown> = {};
    collections.forEach((col, idx) => {
      const snap = snapshots[idx];
      if (snap.exists) {
        const val = snap.data();
        if (col === "config") {
          db[col] = val;
        } else {
          db[col] = val?.data ?? (col === "confessions" ? {} : []);
        }
      } else {
        // Fallback to initialDB
        if (col === "config") {
          db[col] = initialDB.config;
        } else {
          db[col] = (initialDB as unknown as Record<string, unknown>)[col] ?? (col === "confessions" ? {} : []);
        }
      }
    });

    // Make sure all arrays/objects are properly initialized
    const parsedDb = db as unknown as DatabaseSchema;
    if (!parsedDb.users) parsedDb.users = [];
    if (!parsedDb.attendance) parsedDb.attendance = {};
    if (!parsedDb.tasks) parsedDb.tasks = [];
    if (!parsedDb.config) parsedDb.config = initialDB.config;
    if (!parsedDb.notifications) parsedDb.notifications = [];
    if (!parsedDb.quizzes) parsedDb.quizzes = [];
    if (!parsedDb.quizSubmissions) parsedDb.quizSubmissions = [];
    if (!parsedDb.bonuses) parsedDb.bonuses = [];
    if (!parsedDb.confessions) parsedDb.confessions = {};

    try {
      const wasMigrated = migrateDB(parsedDb);
      if (wasMigrated && !isProd) {
        await writeDB(parsedDb);
      }
    } catch (migErr) {
      console.warn("⚠️ تعذر ترحيل التعديلات إلى Firestore:", migErr);
    }

    // Successfully connected and read from Firestore, so heal the circuit breaker!
    firestoreDisabled = false;
    lastFirestoreFailureTime = 0;

    return parsedDb;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isAuthErr = isFirestoreAuthError(error);

    console.warn("⚠️ تحذير Firestore: حدث خطأ أثناء قراءة البيانات من Firestore:", errorMsg);
    lastFirestoreFailureTime = Date.now();
    firestoreDisabled = true;
    
    if (isProd) {
      const err = new Error("الخدمة مشغولة حالياً، حاول مرة أخرى بعد قليل");
      (err as unknown as { status: number }).status = 503;
      throw err;
    }

    if (forceRefresh) {
      const message = isAuthErr
        ? "الخدمة غير متصلة بحساب الفايربيس، تحقق من الأسرار"
        : "فشل المزامنة وجلب البيانات من Firestore: " + errorMsg;
      const err = new Error(message);
      (err as unknown as { status: number }).status = 503;
      throw err;
    }
    
    console.warn("Firestore API غير متاح حالياً. تم التحويل بسلاسة إلى قاعدة البيانات المحلية db.json لتجنب توقف التطبيق.");
    return readLocalDB();
  }
}

async function writeDB(data: DatabaseSchema): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    // Always update local file backup first in non-production
    writeLocalDB(data);
  }

  const dbFs = getFirestore();
  if (!dbFs) {
    if (isProd) {
      const err = new Error("الخدمة مشغولة حالياً، حاول مرة أخرى بعد قليل");
      (err as unknown as { status: number }).status = 503;
      throw err;
    }
    console.log("Firestore not available, skipping Firestore write (written to local db.json)");
    return;
  }

  try {
    const dbRef = dbFs.collection("appState");
    const batch = dbFs.batch();

    // Strip any heavy avatar strings to ensure appState/users payload stays strictly under 50KB
    const lightweightUsers = (data.users || []).map(u => {
      const { avatarBase64: _drop, ...userWithoutBase64 } = u;
      const cleanPhotoURL = userWithoutBase64.photoURL && userWithoutBase64.photoURL.startsWith("data:")
        ? `/api/profile/avatar/${userWithoutBase64.id}`
        : userWithoutBase64.photoURL;
      return {
        ...userWithoutBase64,
        photoURL: cleanPhotoURL,
        hasAvatar: Boolean(userWithoutBase64.hasAvatar),
      };
    });

    batch.set(dbRef.doc("users"), { data: lightweightUsers });
    batch.set(dbRef.doc("attendance"), { data: data.attendance || {} });
    batch.set(dbRef.doc("tasks"), { data: data.tasks || [] });
    batch.set(dbRef.doc("config"), data.config || initialDB.config);
    batch.set(dbRef.doc("notifications"), { data: data.notifications || [] });
    batch.set(dbRef.doc("quizzes"), { data: data.quizzes || [] });
    batch.set(dbRef.doc("quizSubmissions"), { data: data.quizSubmissions || [] });
    batch.set(dbRef.doc("bonuses"), { data: data.bonuses || [] });
    batch.set(dbRef.doc("confessions"), { data: data.confessions || {} });

    await batch.commit();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("⚠️ تحذير Firestore: فشل الحفظ في Firestore:", errorMsg);
    lastFirestoreFailureTime = Date.now();
    firestoreDisabled = true;
    console.warn("Firestore API batch write failed. Triggered offline fallback circuit breaker.");

    const err = new Error("الخدمة مشغولة حالياً، حاول مرة أخرى بعد قليل");
    (err as unknown as { status: number }).status = 503;
    throw err;
  }
}

// Ensure database is initialized at startup (will fail-safe to local DB if Firestore is down)
readDB().catch(err => console.warn("Initial database check warning (running on local db):", err?.message || err));

// Global Mutex to serialize all database operations (reads and writes) on the server
let dbMutex = Promise.resolve();

async function runInMutex<T>(op: () => Promise<T>): Promise<T> {
  let release: () => void;
  const nextActive = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentBefore = dbMutex;
  dbMutex = nextActive;
  await currentBefore;
  try {
    return await op();
  } finally {
    release!();
  }
}

function mutexHandler(handler: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      await runInMutex(async () => {
        await handler(req, res, next);
      });
    } catch (err) {
      next(err);
    }
  };
}

// 1. Transactional Write Queue to prevent file corruption & race conditions
let writeQueue: Promise<void> = Promise.resolve();

async function queueWriteDB(data: DatabaseSchema): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeQueue = writeQueue.then(async () => {
      try {
        await writeDB(data);
        resolve();
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      console.error("Write queue execution failed:", err);
      reject(err);
    });
  });
}

// 1.5. Web Push Notification Helpers
function sendPush(sub: WebPushSubscription, message: string, keys: { publicKey: string, privateKey: string }) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    keys.publicKey,
    keys.privateKey
  );
  
  const payload = JSON.stringify({
    title: "ماراثون Believe your belief 🏆",
    body: message,
    icon: "/assets/logo.jpg",
    badge: "/assets/logo.jpg",
    data: {
      url: "/"
    }
  });

  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth
      }
    },
    payload
  ).catch(err => {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return sub.endpoint;
    }
    console.error("Error sending push notification to endpoint:", sub.endpoint, err);
    return null;
  });
}

async function broadcastPush(message: string, db: DatabaseSchema, targetUserId?: string) {
  if (!db.config.vapidKeys) return;
  const keys = db.config.vapidKeys;

  let usersToSend = db.users || [];
  if (targetUserId) {
    usersToSend = usersToSend.filter(u => u.id === targetUserId);
  }

  const deadEndpoints: string[] = [];
  const pushPromises: Promise<any>[] = [];

  for (const user of usersToSend) {
    if (user.pushSubscriptions && user.pushSubscriptions.length > 0) {
      for (const sub of user.pushSubscriptions) {
        const p = sendPush(sub, message, keys).then(result => {
          if (typeof result === "string") {
            deadEndpoints.push(result);
          }
        });
        pushPromises.push(p);
      }
    }
  }

  if (pushPromises.length === 0) return;

  await Promise.all(pushPromises);

  if (deadEndpoints.length > 0) {
    let changed = false;
    for (const user of db.users) {
      if (user.pushSubscriptions) {
        const originalLength = user.pushSubscriptions.length;
        user.pushSubscriptions = user.pushSubscriptions.filter(s => !deadEndpoints.includes(s.endpoint));
        if (user.pushSubscriptions.length !== originalLength) {
          changed = true;
        }
      }
    }
    if (changed) {
      await queueWriteDB(db);
    }
  }
}

// 2. Secure HMAC-SHA256 Bearer Token Authentication
interface TokenPayload {
  uid: string;
  sv: number;
  iat: number;
  exp: number;
}

function generateToken(user: User): { token: string; expiresAt: string } {
  const iat = Math.floor(Date.now() / 1000);
  const ttlSeconds = user.role === "admin" ? 12 * 60 * 60 : 7 * 24 * 60 * 60; // 12 hours for admin, 7 days for participant
  const exp = iat + ttlSeconds;
  const payload: TokenPayload = {
    uid: user.id,
    sv: user.sessionVersion ?? 1,
    iat,
    exp,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest();
  const sigB64 = hmac.toString("base64url");

  const token = `${payloadB64}.${sigB64}`;
  const expiresAt = new Date(exp * 1000).toISOString();
  return { token, expiresAt };
}

function verifyToken(token: string): TokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  try {
    const expectedHmac = crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest();
    const actualSigBuffer = Buffer.from(sigB64, "base64url");

    if (expectedHmac.length !== actualSigBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(expectedHmac, actualSigBuffer)) {
      return null;
    }

    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as TokenPayload;

    if (!payload || !payload.uid || typeof payload.sv !== "number" || typeof payload.exp !== "number") {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

async function authenticateUser(req: express.Request, preLoadedDb?: DatabaseSchema): Promise<User | null> {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyToken(token);
  if (!payload) return null;

  const db = preLoadedDb || await readDB();
  const user = db.users.find(u => u.id === payload.uid);
  if (!user) return null;

  const userSv = user.sessionVersion ?? 1;
  if (userSv !== payload.sv) {
    return null;
  }

  return user;
}

// 2.5. Central Sanitizer for Database State based on User Role & Identity
function sanitizeDBState(db: DatabaseSchema, user: User | null): DatabaseSchema & { quizTotals: Record<string, number>; quizCounts: Record<string, number> } {
  if (!db) {
    return {
      users: [],
      attendance: {},
      tasks: [],
      config: initialDB.config,
      notifications: [],
      quizzes: [],
      quizSubmissions: [],
      quizTotals: {},
      quizCounts: {},
      bonuses: [],
      confessions: {}
    };
  }
  const isAdmin = Boolean(user && user.role === "admin");

  // 1. Sanitize users list: replace all passcodes with "****" except for the logged-in user themselves (admins can see all)
  const sanitizedUsers = (db.users || []).map(u => {
    const isSelf = user && u.id === user.id;
    const canSeePasscode = isSelf || isAdmin;
    const isHidden = Boolean(u.hidePhotoOnBoard || u.hideNameOnBoard);
    const shouldHidePhoto = isHidden && !isSelf && !isAdmin;
    const effectivePhotoURL = (u.hasAvatar && !shouldHidePhoto)
      ? `/api/profile/avatar/${u.id}?v=${u.avatarVersion || 1}`
      : undefined;

    const { avatarBase64: _drop, ...userWithoutBase64 } = u;
    return {
      ...userWithoutBase64,
      photoURL: effectivePhotoURL,
      passcode: canSeePasscode ? u.passcode : "****",
    };
  });

  // 2. Sanitize confessions list:
  // - Admin sees all confessions but with proofImage stripped to "EXISTS" to prevent giant bandwidth consumption
  // - Participant themselves see their own confessions but with proofImage stripped to "EXISTS"
  // - Other users only see the status of the confession (for points/leaderboard checks)
  const sanitizedConfessions: Record<string, ConfessionRecord> = {};
  if (db.confessions) {
    Object.keys(db.confessions).forEach(userId => {
      const isSelf = user && userId === user.id;
      const userConf = db.confessions![userId];
      if (!userConf) return;

      if (isSelf || isAdmin) {
        const sanitizedMonths: Record<string, ConfessionMonth> = {};
        if (userConf.months) {
          Object.keys(userConf.months).forEach(monthKey => {
            const mData = userConf.months[monthKey];
            const hasProof = Boolean(mData.proofImagePath || (mData.proofImage && mData.proofImage.trim()));
            sanitizedMonths[monthKey] = {
              ...mData,
              proofImage: hasProof ? "EXISTS" : undefined,
            };
          });
        }
        sanitizedConfessions[userId] = { ...userConf, months: sanitizedMonths };
      } else {
        if (userConf.months) {
          const sanitizedMonths: Record<string, ConfessionMonth> = {};
          Object.keys(userConf.months).forEach(monthKey => {
            sanitizedMonths[monthKey] = {
              status: userConf.months[monthKey].status,
            };
          });
          sanitizedConfessions[userId] = { months: sanitizedMonths };
        }
      }
    });
  }

  // 3. Sanitize tasks:
  // - Admin sees all tasks but with proofImage stripped to "EXISTS" to prevent giant bandwidth consumption
  // - Participant themselves see their own tasks but with proofImage stripped to "EXISTS"
  // - Other users see other tasks with proofImage and proofNote stripped to "EXISTS"
  const sanitizedTasks = (db.tasks || []).map(t => {
    const isSelf = user && t.userId === user.id;
    const hasProof = Boolean(t.proofImagePath || (t.proofImage && t.proofImage.trim()));
    if (isAdmin || isSelf) {
      return {
        ...t,
        proofImage: hasProof ? "EXISTS" : "",
      };
    } else {
      return {
        ...t,
        proofImage: hasProof ? "EXISTS" : "",
        proofNote: hasProof ? "EXISTS" : "",
      };
    }
  });

  // 4. Sanitize and filter notifications:
  // - Admin can see all notifications (to display sent logs).
  // - Participants ONLY see global broadcast notifications (no userId) or notifications targeted specifically to them.
  const sanitizedNotifications = (db.notifications || []).filter(notif => {
    if (!notif) return false;
    if (isAdmin) return true;
    return !notif.userId || (user && notif.userId === user.id);
  });

  // 5. Aggregate quiz points per user for leaderboard (respecting leaderboardResetAt)
  const resetAt = db.config?.leaderboardResetAt ? new Date(db.config.leaderboardResetAt).getTime() : 0;
  const quizTotals: Record<string, number> = {};
  const quizCounts: Record<string, number> = {};

  for (const s of (db.quizSubmissions || [])) {
    if (s.status !== "completed") continue;
    if (resetAt > 0) {
      const time = s.submittedAt ? new Date(s.submittedAt).getTime() : 0;
      if (time <= resetAt) continue;
    }
    const score = Number(s.totalScore) || 0;
    quizTotals[s.userId] = (quizTotals[s.userId] || 0) + score;
    quizCounts[s.userId] = (quizCounts[s.userId] || 0) + 1;
  }

  // 6. Sanitize quizzes and submissions:
  // - Admins retain full quizzes (including correctAnswer) and all quizSubmissions.
  // - Non-admins (participants and guests):
  //   a. Strip `correctAnswer` from every question in every quiz object.
  //   b. Omit other users' `userExtensions` (keep only caller's own extension if any).
  //   c. Return ONLY caller's own quizSubmissions.
  let sanitizedQuizzes: Quiz[];
  let sanitizedSubmissions: QuizSubmission[];

  if (isAdmin) {
    sanitizedQuizzes = db.quizzes || [];
    sanitizedSubmissions = db.quizSubmissions || [];
  } else {
    sanitizedQuizzes = (db.quizzes || []).map(quiz => {
      const safeQuestions: QuizQuestion[] = (quiz.questions || []).map(q => {
        const { correctAnswer: _discard, rubricPoints: _discardRubric, ...questionWithoutAnswer } = q;
        return questionWithoutAnswer;
      });

      let safeExtensions: Record<string, string> | undefined = undefined;
      if (quiz.userExtensions && user?.id && quiz.userExtensions[user.id]) {
        safeExtensions = { [user.id]: quiz.userExtensions[user.id] };
      }

      return {
        ...quiz,
        questions: safeQuestions,
        userExtensions: safeExtensions,
      };
    });

    sanitizedSubmissions = (db.quizSubmissions || []).filter(s => {
      if (!user || !user.id) return false;
      return s.userId === user.id;
    });
  }

  let sanitizedViolations: QuizViolationRecord[];
  if (isAdmin) {
    sanitizedViolations = db.quizViolations || [];
  } else {
    sanitizedViolations = (db.quizViolations || []).filter(v => user && v.userId === user.id);
  }

  return {
    ...db,
    users: sanitizedUsers,
    confessions: sanitizedConfessions,
    tasks: sanitizedTasks,
    notifications: sanitizedNotifications,
    quizzes: sanitizedQuizzes,
    quizSubmissions: sanitizedSubmissions,
    quizViolations: sanitizedViolations,
    quizTotals,
    quizCounts,
  };
}

// 3. Admin-Only Access Control Middleware
const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const user = await authenticateUser(req);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "غير مصرح! يجب أن تكون خادماً مسؤولاً (آدمن) لإجراء هذه العملية." });
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Read-only export helper that does zero writes to Firestore or disk
async function getExportData(): Promise<DatabaseSchema> {
  const dbFs = getFirestore();
  if (dbFs) {
    try {
      const collections = [
        "users", "attendance", "tasks", "config", "notifications",
        "quizzes", "quizSubmissions", "bonuses", "confessions"
      ] as const;
      const dbRef = dbFs.collection("appState");
      const snapshots = await Promise.all(collections.map((c) => dbRef.doc(c).get()));
      
      const db: Record<string, unknown> = {};
      collections.forEach((col, idx) => {
        const snap = snapshots[idx];
        if (snap.exists) {
          const val = snap.data();
          if (col === "config") {
            db[col] = val;
          } else {
            db[col] = val?.data ?? (col === "confessions" ? {} : []);
          }
        } else {
          if (col === "config") {
            db[col] = initialDB.config;
          } else {
            db[col] = (initialDB as unknown as Record<string, unknown>)[col] ?? (col === "confessions" ? {} : []);
          }
        }
      });
      return db as unknown as DatabaseSchema;
    } catch (fsErr) {
      console.warn("Firestore read failed during export, falling back to local db.json:", fsErr);
    }
  }

  // Local fallback (read-only, no writeDB or migration writes)
  try {
    if (fs.existsSync(DB_PATH)) {
      const content = fs.readFileSync(DB_PATH, "utf8");
      return JSON.parse(content) as DatabaseSchema;
    }
  } catch (e) {
    console.error("Failed to read local DB file for export:", e);
  }
  return JSON.parse(JSON.stringify(initialDB)) as DatabaseSchema;
}

// API Endpoints

// Export Full Backup JSON (Admin Only, Streaming, Read-Only, Passcode-filtered)
app.get("/api/admin/export", requireAdmin, noCacheMiddleware, async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const filename = `marathon-backup-${today}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const data = await getExportData();

    // Helper to stream JSON chunks with backpressure handling
    const writeChunk = async (chunk: string): Promise<boolean> => {
      if (res.writableEnded || res.destroyed) return false;
      const canContinue = res.write(chunk);
      if (!canContinue) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
      return true;
    };

    // Begin root JSON object
    await writeChunk('{\n');

    // 1. users: exclude all passcode and passcodeHash fields
    await writeChunk('  "users": [\n');
    const users = data.users || [];
    for (let i = 0; i < users.length; i++) {
      const rawUser = users[i];
      const { passcode: _p, ...cleanUser } = rawUser as unknown as Record<string, unknown>;
      delete (cleanUser as Record<string, unknown>).passcodeHash;
      const comma = i < users.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk("    " + JSON.stringify(cleanUser) + comma);
      if (!ok) return;
    }
    await writeChunk('  ],\n');

    // 2. attendance: Record<string, Attendance>
    await writeChunk('  "attendance": {\n');
    const attEntries = Object.entries(data.attendance || {});
    for (let i = 0; i < attEntries.length; i++) {
      const [userId, userAtt] = attEntries[i];
      const comma = i < attEntries.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk(`    ${JSON.stringify(userId)}: ${JSON.stringify(userAtt)}${comma}`);
      if (!ok) return;
    }
    await writeChunk('  },\n');

    // 3. tasks: Task[] (keep base64 proofImage intact)
    await writeChunk('  "tasks": [\n');
    const tasks = data.tasks || [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const comma = i < tasks.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk("    " + JSON.stringify(task) + comma);
      if (!ok) return;
    }
    await writeChunk('  ],\n');

    // 4. config
    await writeChunk(`  "config": ${JSON.stringify(data.config || initialDB.config)},\n`);

    // 5. notifications
    await writeChunk('  "notifications": [\n');
    const notifications = data.notifications || [];
    for (let i = 0; i < notifications.length; i++) {
      const notif = notifications[i];
      const comma = i < notifications.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk("    " + JSON.stringify(notif) + comma);
      if (!ok) return;
    }
    await writeChunk('  ],\n');

    // 6. quizzes
    await writeChunk('  "quizzes": [\n');
    const quizzes = data.quizzes || [];
    for (let i = 0; i < quizzes.length; i++) {
      const quiz = quizzes[i];
      const comma = i < quizzes.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk("    " + JSON.stringify(quiz) + comma);
      if (!ok) return;
    }
    await writeChunk('  ],\n');

    // 7. quizSubmissions
    await writeChunk('  "quizSubmissions": [\n');
    const submissions = data.quizSubmissions || [];
    for (let i = 0; i < submissions.length; i++) {
      const sub = submissions[i];
      const comma = i < submissions.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk("    " + JSON.stringify(sub) + comma);
      if (!ok) return;
    }
    await writeChunk('  ],\n');

    // 8. bonuses
    await writeChunk('  "bonuses": [\n');
    const bonuses = data.bonuses || [];
    for (let i = 0; i < bonuses.length; i++) {
      const bonus = bonuses[i];
      const comma = i < bonuses.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk("    " + JSON.stringify(bonus) + comma);
      if (!ok) return;
    }
    await writeChunk('  ],\n');

    // 9. confessions (keep base64 proofImage intact)
    await writeChunk('  "confessions": {\n');
    const confEntries = Object.entries(data.confessions || {});
    for (let i = 0; i < confEntries.length; i++) {
      const [userId, confRecord] = confEntries[i];
      const comma = i < confEntries.length - 1 ? ",\n" : "\n";
      const ok = await writeChunk(`    ${JSON.stringify(userId)}: ${JSON.stringify(confRecord)}${comma}`);
      if (!ok) return;
    }
    await writeChunk('  }\n');

    // End root JSON object
    await writeChunk('}\n');
    res.end();
  } catch (err: unknown) {
    console.error("Export backup failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "فشل تصدير النسخة الاحتياطية" });
    } else {
      res.end();
    }
  }
});

// Resilient Submissions Fetch Endpoint (Admin Only, Cold-Start Guarded with Retry)
app.get("/api/admin/submissions", requireAdmin, noCacheMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    // 1. Ensure Firestore DB initialization is awaited before querying collections
    await ensureFirestoreInitialized();

    // 2. Query Firestore appState/quizSubmissions with lightweight retry wrapper
    const submissions = await withFirestoreRetry<QuizSubmission[]>(
      async (db) => {
        const snap = await db.collection("appState").doc("quizSubmissions").get();
        if (snap.exists) {
          const val = snap.data();
          const list = (val?.data ?? []) as QuizSubmission[];
          return list;
        }
        const local = readLocalDB();
        return local.quizSubmissions || [];
      },
      3,
      400
    );

    return res.json({
      success: true,
      submissions,
      quizSubmissions: submissions,
      count: submissions.length,
    });
  } catch (err: unknown) {
    console.error("Error in GET /api/admin/submissions during cold-start:", err);
    try {
      const db = await readDB();
      const list = db.quizSubmissions || [];
      return res.json({
        success: true,
        submissions: list,
        quizSubmissions: list,
        count: list.length,
      });
    } catch {
      return res.status(503).json({
        success: false,
        error: "الخدمة مشغولة حالياً أثناء بدء التشغيل، يرجى المحاولة بعد قليل",
        submissions: [],
        quizSubmissions: [],
      });
    }
  }
});

// Admin Anti-Cheat Security Audit Log Viewer Endpoint
app.get("/api/admin/security-logs", requireAdmin, noCacheMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const db = await readDB();
    const users = db.users || [];
    const quizzes = db.quizzes || [];
    const submissions = db.quizSubmissions || [];
    const violations = db.quizViolations || [];

    const getUserName = (userId: string) => {
      const u = users.find(usr => usr.id === userId);
      return u ? u.name : "مشارك غير معروف";
    };

    const getQuizTitle = (quizId: string) => {
      const q = quizzes.find(qz => qz.id === quizId);
      return q ? q.title : "اختبار محذوف أو غير معروف";
    };

    const securityLogs: Array<{
      id: string;
      userId: string;
      userName: string;
      quizId: string;
      quizTitle: string;
      timestamp: string;
      leaveDuration: number;
      reason?: string;
      type?: string;
      details?: string;
      violationCount?: number;
      status?: string;
    }> = [];

    // Process explicit violation records
    for (const v of violations) {
      securityLogs.push({
        id: v.id || "viol_" + Math.random().toString(36).substring(2, 9),
        userId: v.userId,
        userName: getUserName(v.userId),
        quizId: v.quizId,
        quizTitle: getQuizTitle(v.quizId),
        timestamp: v.timestamp,
        leaveDuration: v.leaveDuration || 0,
        reason: v.reason || "مغادرة شاشة الاختبار",
        type: v.type || "visibility_hidden",
        details: v.details || v.reason,
      });
    }

    // Process embedded violations in submissions
    for (const sub of submissions) {
      if (sub.violations && Array.isArray(sub.violations)) {
        for (const v of sub.violations) {
          if (!securityLogs.some(existing => existing.id === v.id)) {
            securityLogs.push({
              id: v.id || "sub_viol_" + Math.random().toString(36).substring(2, 9),
              userId: sub.userId,
              userName: getUserName(sub.userId),
              quizId: sub.quizId,
              quizTitle: getQuizTitle(sub.quizId),
              timestamp: v.timestamp,
              leaveDuration: v.leaveDuration || 0,
              reason: v.reason || "مغادرة شاشة الاختبار",
              type: v.type || "visibility_hidden",
              details: v.details || v.reason,
              violationCount: sub.violationCount,
              status: sub.status,
            });
          }
        }
      }
    }

    // Sort by most recent timestamp descending
    securityLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Flagged submissions list
    const flaggedSubmissions = submissions
      .filter(s => s.status === "VIOLATION_TERMINATED" || (s.violationCount && s.violationCount > 0))
      .map(s => ({
        ...s,
        userName: getUserName(s.userId),
        quizTitle: getQuizTitle(s.quizId),
      }));

    return res.json({
      success: true,
      logs: securityLogs,
      flaggedSubmissions,
      summary: {
        totalViolations: securityLogs.length,
        terminatedAttempts: submissions.filter(s => s.status === "VIOLATION_TERMINATED").length,
        flaggedStudentsCount: new Set(securityLogs.map(l => l.userId)).size,
      },
    });
  } catch (err: unknown) {
    console.error("Error fetching security logs:", err);
    return res.status(500).json({ error: "تعذر إحضار سجل الأمان ومراقبة الغش" });
  }
});

// 1. Get current full state (Secure & Sanitized for non-admins to save bandwidth and memory)
app.get("/api/state", noCacheMiddleware, async (req, res, next) => {
  try {
    const forceRefresh = req.query.force_refresh === "true";
    const db = await readDB(forceRefresh);
    const user = await authenticateUser(req, db);
    const sanitized = sanitizeDBState(db, user);
    // Include health/connection metadata so the client knows if it's connected or offline fallback mode
    res.json({
      ...sanitized,
      _isFirestoreActive: !firestoreDisabled,
      _cooldownRemaining: firestoreDisabled ? Math.max(0, FIRESTORE_RETRY_COOLDOWN_MS - (Date.now() - lastFirestoreFailureTime)) : 0
    });
  } catch (err: unknown) {
    const errObj = err as { status?: number; message?: string };
    if (errObj?.status === 503 || isFirestoreAuthError(err)) {
      return res.status(503).json({ error: "الخدمة غير متصلة بحساب الفايربيس، تحقق من الأسرار" });
    }
    console.error("Error in /api/state:", err);
    next(err);
  }
});

// Dynamic Leaderboard Data Endpoint with strict cache-busting
app.get("/api/leaderboard", noCacheMiddleware, async (req, res, next) => {
  try {
    const forceRefresh = req.query.force_refresh === "true";
    const db = await readDB(forceRefresh);
    const user = await authenticateUser(req, db);
    const sanitized = sanitizeDBState(db, user);
    res.json({
      success: true,
      users: sanitized.users,
      attendance: sanitized.attendance,
      tasks: sanitized.tasks,
      quizzes: sanitized.quizzes,
      quizSubmissions: sanitized.quizSubmissions,
      confessions: sanitized.confessions,
      bonuses: sanitized.bonuses,
      config: sanitized.config,
      quizTotals: sanitized.quizTotals,
      quizCounts: sanitized.quizCounts,
    });
  } catch (err: unknown) {
    const errObj = err as { status?: number; message?: string };
    if (errObj?.status === 503 || isFirestoreAuthError(err)) {
      return res.status(503).json({ error: "الخدمة غير متصلة بحساب الفايربيس، تحقق من الأسرار" });
    }
    console.error("Error in /api/leaderboard:", err);
    next(err);
  }
});

// Dynamic Quizzes Data Endpoint with strict cache-busting
app.get("/api/quizzes", noCacheMiddleware, async (req, res, next) => {
  try {
    const db = await readDB();
    const user = await authenticateUser(req, db);
    const sanitized = sanitizeDBState(db, user);
    res.json({
      success: true,
      quizzes: sanitized.quizzes,
      quizSubmissions: sanitized.quizSubmissions,
    });
  } catch (err: unknown) {
    console.error("Error in /api/quizzes:", err);
    next(err);
  }
});

// Profile Avatar Upload & Processing Engine
app.post("/api/profile/avatar", multerUpload.single("avatar"), mutexHandler(async (req, res) => {
  try {
    const db = await readDB();
    const user = await authenticateUser(req, db);
    if (!user) {
      return res.status(401).json({ error: "انتهت الجلسة أو الرمز غير صالح، يرجى إعادة تسجيل الدخول." });
    }

    // Rate limit: maximum 10 uploads per day (last 24 hours)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const recentUploads = (user.avatarUploads || []).filter(t => now - t < dayMs);
    if (recentUploads.length >= 10) {
      return res.status(429).json({ error: "لقد تجاوزت الحد الأقصى المسموح به لرفع الصور (10 مرات في اليوم). يرجى المحاولة غداً." });
    }

    let avatarBase64: string = "";
    const candidateBase64 = req.body?.photoURL || req.body?.avatarBase64 || req.body?.image;
    const incomingPayloadLength = typeof candidateBase64 === "string"
      ? candidateBase64.length
      : (req.file?.buffer ? req.file.buffer.length : 0);

    console.log(`[POST /api/profile/avatar] Received avatar upload request for user ${user.id} (${user.name}) - Incoming payload string length / buffer bytes: ${incomingPayloadLength}`);

    if (typeof candidateBase64 === "string" && candidateBase64.trim().startsWith("data:image/")) {
      const rawB64 = candidateBase64.trim();
      try {
        const parsed = parseBase64Image(rawB64);
        const processed = await processAvatarWebP(parsed.buffer);
        avatarBase64 = processed.base64;
      } catch {
        if (rawB64.startsWith("data:image/") && rawB64.length <= 10 * 1024 * 1024) {
          avatarBase64 = rawB64;
        } else {
          return res.status(400).json({ error: "صيغة الصورة غير صالحة" });
        }
      }
    } else if (typeof candidateBase64 === "string" && candidateBase64.trim().startsWith("https://")) {
      avatarBase64 = candidateBase64.trim();
    } else if (req.file && req.file.buffer) {
      if (req.file.buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: "حجم الملف كبير جداً. الحد الأقصى المسموح به هو 10 ميجابايت." });
      }
      try {
        const processed = await processAvatarWebP(req.file.buffer);
        avatarBase64 = processed.base64;
      } catch (err: any) {
        return res.status(400).json({ error: err.message || "فشل معالجة صورة الملف الشخصي بواسطة sharp." });
      }
    } else {
      return res.status(400).json({ error: "يرجى تحديد ملف صورة مرفق أو كود Base64 صالح." });
    }

    const targetUser = db.users.find(u => u.id === user.id);
    const nextVersion = (targetUser?.avatarVersion || 0) + 1;
    const avatarUpdatedAt = new Date(now).toISOString();

    // Persist full WebP avatar Base64 exclusively to isolated Firestore avatars/{userId} collection
    await saveAvatarToFirestore(user.id, avatarBase64, nextVersion, avatarUpdatedAt);
    console.log(`[POST /api/profile/avatar] Successfully saved avatar for user ${user.id} to isolated collection avatars/${user.id} (version: ${nextVersion}).`);

    if (targetUser) {
      delete targetUser.avatarBase64;
      targetUser.hasAvatar = true;
      targetUser.avatarVersion = nextVersion;
      targetUser.avatarUpdatedAt = avatarUpdatedAt;
      targetUser.photoURL = `/api/profile/avatar/${user.id}?v=${nextVersion}`;
      targetUser.avatarUploads = [...recentUploads, now];
    }

    await queueWriteDB(db);

    const freshUser = db.users.find(u => u.id === user.id) || user;
    const sanitized = sanitizeDBState(db, freshUser);
    const { passcode: _p, avatarBase64: _dropB64, ...sanitizedUser } = freshUser as unknown as Record<string, unknown>;

    return res.status(200).json({
      success: true,
      photoURL: `/api/profile/avatar/${user.id}?v=${nextVersion}`,
      avatarBase64,
      avatarVersion: nextVersion,
      avatarUpdatedAt,
      user: sanitizedUser,
      db: sanitized,
    });
  } catch (err) {
    console.error("[POST /api/profile/avatar] Unhandled exception occurred during avatar persistence:", err);
    return res.status(500).json({ error: "فشل حفظ وتحديث الصورة الشخصية، يرجى المحاولة مرة أخرى." });
  }
}));

// Delete Avatar
app.delete("/api/profile/avatar", mutexHandler(async (req, res) => {
  const db = await readDB();
  const user = await authenticateUser(req, db);
  if (!user) {
    return res.status(401).json({ error: "انتهت الجلسة أو الرمز غير صالح، يرجى إعادة تسجيل الدخول." });
  }

  await removeAvatarFromFirestore(user.id);

  const targetUser = db.users.find(u => u.id === user.id);
  const now = Date.now();
  const nextVersion = (targetUser?.avatarVersion || 0) + 1;
  if (targetUser) {
    targetUser.photoURL = undefined;
    targetUser.avatarBase64 = undefined;
    targetUser.hasAvatar = false;
    targetUser.avatarVersion = nextVersion;
    targetUser.avatarUpdatedAt = new Date(now).toISOString();
  }

  await queueWriteDB(db);

  const freshUser = db.users.find(u => u.id === user.id) || user;
  const sanitized = sanitizeDBState(db, freshUser);
  const { passcode: _p, ...sanitizedUser } = freshUser as unknown as Record<string, unknown>;

  return res.json({
    success: true,
    user: sanitizedUser,
    db: sanitized,
  });
}));

// Admin Remove Avatar
app.post("/api/admin/avatar/remove", requireAdmin, mutexHandler(async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: "مُعرّف المستخدم مطلوب." });
  }

  const db = await readDB();
  const adminUser = await authenticateUser(req, db);
  const targetUser = db.users.find(u => u.id === userId);
  if (!targetUser) {
    return res.status(404).json({ error: "المستخدم غير موجود." });
  }

  await removeAvatarFromFirestore(userId);

  const now = Date.now();
  targetUser.photoURL = undefined;
  targetUser.avatarBase64 = undefined;
  targetUser.hasAvatar = false;
  targetUser.avatarVersion = (targetUser.avatarVersion || 0) + 1;
  targetUser.avatarUpdatedAt = new Date(now).toISOString();

  if (!db.notifications) db.notifications = [];
  db.notifications.push({
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    message: `قام الخادم (${adminUser?.name || "الآدمن"}) بإزالة الصورة الشخصية للمشارك ${targetUser.name}`,
    createdAt: new Date().toISOString(),
    createdByAdmin: true,
    deliveryType: "in_app",
  });

  await queueWriteDB(db);

  const sanitized = sanitizeDBState(db, adminUser);
  return res.json({
    success: true,
    message: `تمت إزالة الصورة الشخصية للمشارك ${targetUser.name} بنجاح.`,
    db: sanitized,
  });
}));

// GET 96px Avatar Thumbnails Map
app.get("/api/avatars/thumbs", async (req, res) => {
  try {
    const db = await readDB();
    const user = await authenticateUser(req, db);
    if (!user) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const etag = `W/"thumbs_${db.users.reduce((max, u) => Math.max(max, u.avatarVersion || 0), 0)}"`;
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("ETag", etag);

    const items: Record<string, string> = {};
    for (const u of db.users) {
      if (!u || !u.hasAvatar) continue;

      const isSelf = u.id === user.id;
      const isAdmin = user.role === "admin";
      const isHidden = Boolean(u.hidePhotoOnBoard || u.hideNameOnBoard);
      if (isHidden && !isSelf && !isAdmin) {
        continue;
      }

      const avatarRecord = await getAvatarFromFirestore(u.id);
      if (avatarRecord && avatarRecord.avatarBase64) {
        items[u.id] = avatarRecord.avatarBase64;
      }
    }

    return res.json({
      version: etag,
      items,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "فشل جلب الصور المصغرة" });
  }
});

// Public Avatar Endpoint & HTTP Browser Caching
app.get("/api/profile/avatar/:userId", async (req, res) => {
  try {
    await ensureFirestoreInitialized();
    const db = await readDB();

    const targetUserId = req.params.userId;
    const targetUser = db.users.find(u => u.id === targetUserId);
    if (!targetUser) {
      return res.status(404).send("User not found");
    }

    // Respect privacy settings (hidePhotoOnBoard / hideNameOnBoard)
    const isHidden = Boolean(targetUser.hidePhotoOnBoard || targetUser.hideNameOnBoard);
    if (isHidden) {
      // Optional authentication: allow only user themselves or admin to view private photo
      const requestingUser = await authenticateUser(req, db);
      const isSelf = requestingUser && targetUser.id === requestingUser.id;
      const isAdmin = requestingUser && requestingUser.role === "admin";
      if (!isSelf && !isAdmin) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return res.status(403).send("Photo is private");
      }
    }

    // Check if user has an avatar
    if (!targetUser.hasAvatar) {
      if (req.query.format === "json" || req.headers.accept?.includes("application/json")) {
        return res.status(404).json({ success: false, avatarBase64: null, message: "Avatar not found" });
      }
      return res.status(404).send("Avatar not found");
    }

    // Compute robust ETag from user's avatarVersion (or fallback to version 1)
    const avatarVersion = targetUser.avatarVersion || 1;
    const etag = `W/"avatar_${targetUserId}_v${avatarVersion}"`;

    // Handle 304 Not Modified for conditional requests
    if (req.headers["if-none-match"] === etag) {
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("ETag", etag);
      return res.status(304).end();
    }

    // Retrieve avatar exclusively from isolated Firestore collection avatars/{userId} (or server memory cache)
    const avatarRecord = await getAvatarFromFirestore(targetUserId);
    if (!avatarRecord || !avatarRecord.avatarBase64) {
      if (req.query.format === "json" || req.headers.accept?.includes("application/json")) {
        return res.status(404).json({ success: false, avatarBase64: null, message: "Avatar not found" });
      }
      return res.status(404).send("Avatar not found");
    }

    // Set robust public caching headers (1 day cache, 7 days stale-while-revalidate)
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("ETag", etag);

    // Support JSON response format if requested
    if (req.query.format === "json") {
      return res.json({
        success: true,
        avatarBase64: avatarRecord.avatarBase64,
        avatarVersion: avatarRecord.avatarVersion || avatarVersion,
        avatarUpdatedAt: avatarRecord.avatarUpdatedAt,
      });
    }

    // Serve directly as binary image/webp response for standard HTML <img> elements
    const base64Data = avatarRecord.avatarBase64.replace(/^data:image\/[a-z0-9-+.]+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Length", imageBuffer.length.toString());
    return res.send(imageBuffer);
  } catch (err: unknown) {
    console.error("Error in GET /api/profile/avatar/:userId:", err);
    return res.status(500).send("Failed to stream avatar");
  }
});

// Privacy Toggle
app.post("/api/profile/privacy", mutexHandler(async (req, res) => {
  const db = await readDB();
  const user = await authenticateUser(req, db);
  if (!user) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { hidePhotoOnBoard } = req.body || {};
  const targetUser = db.users.find(u => u.id === user.id);
  if (targetUser) {
    targetUser.hidePhotoOnBoard = Boolean(hidePhotoOnBoard);
  }

  await queueWriteDB(db);

  const freshUser = db.users.find(u => u.id === user.id) || user;
  const sanitized = sanitizeDBState(db, freshUser);
  const { passcode: _p, ...sanitizedUser } = freshUser as unknown as Record<string, unknown>;

  return res.json({
    success: true,
    user: sanitizedUser,
    db: sanitized,
  });
}));

// Avatar Prompt Snooze
app.post("/api/profile/avatar/snooze", mutexHandler(async (req, res) => {
  const db = await readDB();
  const user = await authenticateUser(req, db);
  if (!user) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  const targetUser = db.users.find(u => u.id === user.id);
  if (targetUser) {
    targetUser.avatarSnoozeCount = (targetUser.avatarSnoozeCount || 0) + 1;
    targetUser.avatarSnoozedAt = Date.now();
  }

  await queueWriteDB(db);

  const freshUser = db.users.find(u => u.id === user.id) || user;
  const sanitized = sanitizeDBState(db, freshUser);
  const { passcode: _p, ...sanitizedUser } = freshUser as unknown as Record<string, unknown>;

  return res.json({
    success: true,
    user: sanitizedUser,
    db: sanitized,
  });
}));

// 1.2 Get on-demand task proof image safely (supports /api/tasks/:taskId/image and /api/tasks/proof/:id)
async function handleTaskProofStream(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const user = await authenticateUser(req);
    if (!user) {
      return res.status(401).send("Unauthorized");
    }

    const taskId = req.params.taskId || req.params.id;
    const db = await readDB();
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).send("Image not found");
    }

    // 1. Stream binary content directly from Cloud Storage if proofImagePath is set
    if (task.proofImagePath) {
      const bucket = getStorageBucket();
      if (bucket) {
        try {
          const file = bucket.file(task.proofImagePath);
          const [exists] = await file.exists();
          if (exists) {
            const [metadata] = await file.getMetadata();
            const contentType = metadata.contentType || "image/jpeg";
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "public, max-age=86400");
            return file.createReadStream().pipe(res);
          }
        } catch (err) {
          console.warn(`Failed to stream task proof from Cloud Storage (${task.proofImagePath}):`, err);
        }
      }

      // Local storage fallback
      const localFilePath = path.join(process.cwd(), "public", "uploads", task.proofImagePath);
      if (fs.existsSync(localFilePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(localFilePath);
      }
    }

    // 2. Fallback seamlessly to legacy base64 proofImage
    if (task.proofImage && task.proofImage !== "EXISTS") {
      if (task.proofImage.startsWith("data:")) {
        const matches = task.proofImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const contentType = matches[1];
          const buffer = Buffer.from(matches[2], "base64");
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.send(buffer);
        }
      }
      return res.redirect(task.proofImage);
    }

    res.status(404).send("Image not found");
  } catch (err) {
    next(err);
  }
}

app.get("/api/tasks/:taskId/image", handleTaskProofStream);
app.get("/api/tasks/proof/:id", handleTaskProofStream);

// 1.3 Get on-demand confession proof image safely (supports /api/confessions/:userId/:monthIndex/image, /api/confessions/proof/:id, and /api/confessions/proof/:userId/:monthIndex)
async function handleConfessionProofStream(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const user = await authenticateUser(req);
    if (!user) {
      return res.status(401).send("Unauthorized");
    }

    let userId = req.params.userId;
    let monthIndex = req.params.monthIndex;

    if (!userId && req.params.id) {
      const parts = req.params.id.split("-");
      if (parts.length >= 2) {
        monthIndex = parts.pop()!;
        userId = parts.join("-");
      } else {
        userId = req.params.id;
      }
    }

    if (!userId || !monthIndex) {
      return res.status(400).send("Invalid request parameters");
    }

    // Authorization check: User must be an admin OR the exact user whose confession is requested
    if (user.role !== "admin" && user.id !== userId) {
      return res.status(403).send("Forbidden");
    }

    const db = await readDB();
    const conf = db.confessions?.[userId]?.months?.[monthIndex];
    if (!conf) {
      return res.status(404).send("Image not found");
    }

    // 1. Stream binary content directly from Cloud Storage if proofImagePath is set
    if (conf.proofImagePath) {
      const bucket = getStorageBucket();
      if (bucket) {
        try {
          const file = bucket.file(conf.proofImagePath);
          const [exists] = await file.exists();
          if (exists) {
            const [metadata] = await file.getMetadata();
            const contentType = metadata.contentType || "image/jpeg";
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "public, max-age=86400");
            return file.createReadStream().pipe(res);
          }
        } catch (err) {
          console.warn(`Failed to stream confession proof from Cloud Storage (${conf.proofImagePath}):`, err);
        }
      }

      // Local storage fallback
      const localFilePath = path.join(process.cwd(), "public", "uploads", conf.proofImagePath);
      if (fs.existsSync(localFilePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(localFilePath);
      }
    }

    // 2. Fallback seamlessly to legacy base64 proofImage
    if (conf.proofImage && conf.proofImage !== "EXISTS") {
      if (conf.proofImage.startsWith("data:")) {
        const matches = conf.proofImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const contentType = matches[1];
          const buffer = Buffer.from(matches[2], "base64");
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.send(buffer);
        }
      }
      return res.redirect(conf.proofImage);
    }

    res.status(404).send("Image not found");
  } catch (err) {
    next(err);
  }
}

app.get("/api/confessions/:userId/:monthIndex/image", handleConfessionProofStream);
app.get("/api/confessions/proof/:userId/:monthIndex", handleConfessionProofStream);
app.get("/api/confessions/proof/:id", handleConfessionProofStream);

// 1.1. Secure Login Endpoint
app.post("/api/login", async (req, res, next) => {
  try {
    const { username, passcode } = req.body;
    if (!username || !passcode) {
      return res.status(400).json({ error: "اسم المستخدم ورمز الدخول مطلوبان." });
    }

    const cleanInput = username.trim().toLowerCase();
    const db = await readDB();
    const user = db.users.find(
      (u) =>
        u.name.trim().toLowerCase() === cleanInput ||
        (u.username && u.username.trim().toLowerCase() === cleanInput)
    );

    if (!user) {
      return res.status(404).json({ error: "اسم المستخدم غير مسجل بالنظام!" });
    }

    if (user.passcode !== passcode.trim()) {
      return res.status(401).json({ error: "كلمة المرور غير صحيحة! يرجى إعادة المحاولة." });
    }

    if (user.sessionVersion === undefined) {
      user.sessionVersion = 1;
      await queueWriteDB(db);
    }

    const { token, expiresAt } = generateToken(user);
    const sanitizedState = sanitizeDBState(db, user);
    const sanitizedUser = sanitizedState.users.find(u => u.id === user.id) || user;

    res.json({
      success: true,
      token,
      expiresAt,
      user: sanitizedUser,
    });
  } catch (err) {
    next(err);
  }
});

// Logout Endpoint
app.post("/api/logout", (req, res) => {
  res.json({ success: true, message: "تم تسجيل الخروج بنجاح" });
});

// 2. Reset database to seed (Preserves user credentials and accounts)
app.post("/api/reset", requireAdmin, mutexHandler(async (req, res) => {
  const db = await readDB();
  const resetDb: DatabaseSchema = {
    ...initialDB,
    users: (db.users || []).map((u) => ({
      ...u,
      totalArchivedPoints: 0,
    })),
    config: {
      ...initialDB.config,
      vapidKeys: db.config?.vapidKeys || initialDB.config.vapidKeys,
    },
    quizzes: db.quizzes || [],
  };
  await queueWriteDB(resetDb);
  res.json({ message: "تم إعادة ضبط قاعدة البيانات بنجاح وبدء دورة ماراثون جديدة من الصفر مع الحفاظ على حسابات المشاركين", db: resetDb });
}));

// 3. Update attendance
app.post("/api/attendance", requireAdmin, mutexHandler(async (req, res) => {
  const { userId, weekIndex, type, attended, score } = req.body;
  
  if (!userId || weekIndex === undefined || !type) {
    return res.status(400).json({ error: "البيانات المرسلة غير مكتملة" });
  }

  const db = await readDB();
  const weekNum = parseInt(weekIndex, 10);
  const durationWeeks = db.config?.durationWeeks ?? 12;

  // Defensive week boundary validation
  if (isNaN(weekNum) || weekNum < 1 || weekNum > durationWeeks) {
    return res.status(400).json({ error: `الأسبوع المحدد غير صالح. يجب أن يكون بين 1 و ${durationWeeks}` });
  }
  
  // Initialize user attendance if not exists
  if (!db.attendance[userId]) {
    db.attendance[userId] = { meetings: [], liturgy: [], praise: [], liturgyScores: {} };
  }

  const userAtt = db.attendance[userId];
  
  // Make sure all required properties are initialized defensively
  if (!userAtt.meetings || !Array.isArray(userAtt.meetings)) {
    userAtt.meetings = [];
  }
  if (!userAtt.liturgy || !Array.isArray(userAtt.liturgy)) {
    userAtt.liturgy = [];
  }
  if (!userAtt.praise || !Array.isArray(userAtt.praise)) {
    userAtt.praise = [];
  }
  if (!userAtt.liturgyScores || typeof userAtt.liturgyScores !== "object") {
    userAtt.liturgyScores = {};
  }

  const list = userAtt[type as keyof Attendance];
  
  if (type !== "liturgy" && !list) {
    return res.status(400).json({ error: "نوع غياب غير صالح" });
  }

  const weekKey = weekNum.toString();

  let alreadyRecorded = false;
  if (type === "liturgy") {
    const liturgyList = userAtt.liturgy || [];
    const index = liturgyList.indexOf(weekNum);
    const scoreVal = score !== undefined ? parseInt(score, 10) : 0;

    // Validate liturgy score bounds
    if (scoreVal !== 20 && scoreVal !== 10 && scoreVal !== 0) {
      return res.status(400).json({ error: "الدرجة المحددة لحضور القداس غير صالحة. الدرجات المقبولة هي 20 أو 10 أو 0 فقط." });
    }

    if (scoreVal === 20 || scoreVal === 10) {
      userAtt.liturgyScores[weekKey] = scoreVal;
      if (index === -1) {
        liturgyList.push(weekNum);
        liturgyList.sort((a, b) => a - b);
      } else {
        alreadyRecorded = true;
      }
      userAtt.liturgy = liturgyList;
    } else {
      userAtt.liturgyScores[weekKey] = 0;
      if (index !== -1) {
        liturgyList.splice(index, 1);
      }
      userAtt.liturgy = liturgyList;
    }
  } else {
    const typedList = list as number[];
    const index = typedList.indexOf(weekNum);
    if (attended) {
      if (index === -1) {
        typedList.push(weekNum);
        typedList.sort((a, b) => a - b);
      } else {
        alreadyRecorded = true;
      }
    } else {
      if (index !== -1) {
        typedList.splice(index, 1);
      }
    }
  }

  if (!(userAtt as any).timestamps) {
    (userAtt as any).timestamps = {};
  }
  (userAtt as any).timestamps[`${type}_${weekNum}`] = new Date().toISOString();

  await queueWriteDB(db);
  res.json({ message: alreadyRecorded ? "مسجل حضور مسبقاً" : "تم تحديث الغياب بنجاح", alreadyRecorded, db });
}));

// 4. Create a new task (assign task to a user)
app.post("/api/tasks/create", requireAdmin, mutexHandler(async (req, res) => {
  const { userId, userIds, title, description, points } = req.body;

  if ((!userId && (!userIds || !Array.isArray(userIds) || userIds.length === 0)) || !title || points === undefined) {
    return res.status(400).json({ error: "يرجى إدخال اسم المهمة والنقاط والمشاركين المعنيين" });
  }

  const pointsVal = parseInt(points, 10);
  if (isNaN(pointsVal) || pointsVal <= 0) {
    return res.status(400).json({ error: "عدد نقاط المهمة يجب أن يكون رقماً أكبر من الصفر." });
  }

  const db = await readDB();
  const targetUserIds = userIds && Array.isArray(userIds) ? userIds : [userId];

  const createdTasks: Task[] = [];
  const now = Date.now();

  if (!db.notifications) {
    db.notifications = [];
  }

  for (let i = 0; i < targetUserIds.length; i++) {
    const uid = targetUserIds[i];
    const newTask: Task = {
      id: "task_" + now + "_" + Math.floor(Math.random() * 1000000) + "_" + i,
      userId: uid,
      title: title.trim(),
      description: description ? description.trim() : "",
      points: pointsVal,
      status: "pending",
    };
    db.tasks.push(newTask);
    createdTasks.push(newTask);

    const newTaskNotification: AppNotification = {
      id: "notif_" + now + "_" + Math.floor(Math.random() * 1000000) + "_" + i + "_task",
      message: `🎯 لقد تم تكليفك بجهاد مخصص جديد: "${title.trim()}". أسرع بتسليم الإثبات لتكسب +${pointsVal} نقطة! 💪`,
      createdAt: new Date().toISOString(),
      userId: uid,
      createdByAdmin: true
    };
    db.notifications.push(newTaskNotification);

    // Send device push notification to the user
    broadcastPush(`🎯 لقد تم تكليفك بجهاد مخصص جديد: "${title.trim()}". أسرع بتسليم الإثبات لتكسب +${pointsVal} نقطة! 💪`, db, uid).catch(err => {
      console.error("Error sending push notification for assigned task:", err);
    });
  }

  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);
  res.json({ message: "تم إضافة وتكليف المهمة بنجاح للمشاركين المحددين", tasks: createdTasks, db });
}));

// 5. Submit task proof (by participant)
app.post("/api/tasks/submit", mutexHandler(async (req, res) => {
  const { taskId, proofImage, proofNote } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: "معرف المهمة مطلوب" });
  }

  // Authenticate user on backend
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
  }

  const db = await readDB();
  const task = db.tasks.find(t => t.id === taskId);

  if (!task) {
    return res.status(404).json({ error: "المهمة غير موجودة" });
  }

  // Validate ownership: participant can only submit their own task
  if (user.role !== "admin" && task.userId !== user.id) {
    return res.status(403).json({ error: "غير مصرح! لا يمكنك تقديم إثبات لمهمة مسندة إلى مشارك آخر." });
  }

  let storagePath: string | undefined;
  if (proofImage && typeof proofImage === "string" && proofImage.startsWith("data:")) {
    try {
      const parsed = parseBase64Image(proofImage);
      const timestamp = Date.now();
      const targetPath = `proofs/tasks/${task.id}/${timestamp}.${parsed.extension}`;
      const uploadRes = await saveProofToStorage(proofImage, targetPath);

      if (uploadRes) {
        if (task.proofImagePath) {
          await deleteFileFromStorage(task.proofImagePath);
        }
        storagePath = uploadRes.storagePath;
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "فشل رفع ملقم الصور." });
    }
  }

  task.status = "submitted";
  if (storagePath) {
    task.proofImagePath = storagePath;
    task.proofImage = ""; // Keep legacy base64 string empty for Cloud Storage uploads
  } else {
    task.proofImage = proofImage || "";
  }
  task.proofNote = proofNote ? proofNote.trim() : "";
  task.submittedAt = new Date().toISOString();
  task.feedback = ""; // clear old feedback on re-submission

  await queueWriteDB(db);
  res.json({ message: "تم إرسال المهمة بنجاح بانتظار مراجعة الخادم", task, db: sanitizeDBState(db, user) });
}));

// 6. Verify task submission (by admin)
app.post("/api/tasks/verify", requireAdmin, mutexHandler(async (req, res) => {
  const { taskId, status, feedback } = req.body;

  if (!taskId || !status || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "حالة التحقق غير صالحة" });
  }

  const db = await readDB();
  const task = db.tasks.find(t => t.id === taskId);

  if (!task) {
    return res.status(404).json({ error: "المهمة غير موجودة" });
  }

  task.status = status as "approved" | "rejected";
  task.feedback = feedback || "";
  task.verifiedAt = new Date().toISOString();

  await queueWriteDB(db);
  res.json({ message: status === "approved" ? "تم تأكيد المهمة وإضافة النقاط بنجاح" : "تم رفض المهمة مع إرسال التعليق للمشارك", task, db });
}));

// 7. Add a new user (participant)
app.post("/api/users/add", requireAdmin, mutexHandler(async (req, res) => {
  const { name, username, passcode } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "اسم المشارك مطلوب" });
  }

  const db = await readDB();
  const cleanName = name.trim();
  const cleanUsername = (username && username.trim()) ? username.trim() : cleanName;
  
  if (db.users.some(u => u.name.toLowerCase() === cleanName.toLowerCase())) {
    return res.status(400).json({ error: "اسم هذا المشارك مسجل بالفعل" });
  }

  if (db.users.some(u => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(400).json({ error: "اسم المستخدم هذا مسجل ومحجوز بالفعل" });
  }

  const id = "user_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  const pin = passcode || Math.floor(1000 + Math.random() * 9000).toString(); // generate random 4 digit PIN if not provided
  const newUser: User = {
    id,
    name: cleanName,
    username: cleanUsername,
    role: "participant",
    passcode: pin
  };

  db.users.push(newUser);
  db.attendance[id] = { meetings: [], liturgy: [], praise: [] };

  await queueWriteDB(db);
  res.json({ message: `تم تسجيل المشارك بنجاح. اسم المستخدم: ${cleanUsername}، كلمة المرور: ${pin}`, user: newUser, db });
}));

// 8. Delete a user
app.post("/api/users/delete", requireAdmin, mutexHandler(async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "معرف العضو مطلوب" });
  }

  const db = await readDB();
  const targetUser = db.users.find(u => u.id === userId);
  
  if (!targetUser) {
    return res.status(404).json({ error: "المستخدم غير موجود" });
  }

  if (targetUser.role === "admin") {
    return res.status(400).json({ error: "لا يمكن حذف مستخدم مسؤول (آدمن)" });
  }

  db.users = db.users.filter(u => u.id !== userId);
  delete db.attendance[userId];
  db.tasks = db.tasks.filter(t => t.userId !== userId);

  await queueWriteDB(db);
  res.json({ message: "تم حذف العضو وكل بياناته بنجاح", db });
}));

// 8.5. Change user passcode (participant or admin themselves)
app.post("/api/users/change-passcode", mutexHandler(async (req, res) => {
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً لإجراء هذه العملية." });
  }

  const { newPasscode } = req.body;
  if (!newPasscode || !newPasscode.trim()) {
    return res.status(400).json({ error: "الرجاء إدخال رمز الدخول الجديد بشكل صحيح." });
  }

  const cleanPasscode = newPasscode.trim();
  if (cleanPasscode.length < 4) {
    return res.status(400).json({ error: "يجب أن يتكون رمز الدخول الجديد من 4 أرقام أو حروف على الأقل." });
  }

  const db = await readDB();
  const dbUser = db.users.find(u => u.id === user.id);
  if (!dbUser) {
    return res.status(404).json({ error: "المستخدم غير موجود في قاعدة البيانات." });
  }

  // Update passcode and increment sessionVersion to invalidate tokens on all other devices
  dbUser.passcode = cleanPasscode;
  dbUser.sessionVersion = (dbUser.sessionVersion ?? 1) + 1;

  await queueWriteDB(db);

  const { token, expiresAt } = generateToken(dbUser);
  const sanitizedState = sanitizeDBState(db, dbUser);
  const sanitizedUser = sanitizedState.users.find(u => u.id === dbUser.id) || dbUser;

  res.json({ 
    success: true,
    message: "تم تغيير رمز الدخول الخاص بك بنجاح! 🔑", 
    token,
    expiresAt,
    user: sanitizedUser,
    db: sanitizedState
  });
}));

// 8.6. Update user info (name, username)
app.post("/api/users/update", mutexHandler(async (req, res) => {
  const caller = await authenticateUser(req);
  if (!caller) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً لإجراء هذه العملية." });
  }

  const { userId, name, username } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "معرف العضو مطلوب" });
  }

  // Check permission: Must be admin (servants/admins only)
  if (caller.role !== "admin") {
    return res.status(403).json({ error: "تعديل أسماء المشاركين متاح فقط للخدام والإدارة." });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "اسم المشارك لا يمكن أن يكون فارغاً" });
  }

  const db = await readDB();
  const targetUser = db.users.find(u => u.id === userId);
  
  if (!targetUser) {
    return res.status(404).json({ error: "المستخدم غير موجود" });
  }

  const cleanName = name.trim();
  const cleanUsername = (username && username.trim()) ? username.trim() : cleanName;

  targetUser.name = cleanName;
  targetUser.username = cleanUsername;

  await queueWriteDB(db);

  res.json({ 
    message: "تم تعديل اسم المشارك بنجاح! ✨", 
    user: targetUser,
    db: sanitizeDBState(db, caller)
  });
}));

// 9. AI Task Verification using Gemini API (server-side only)
app.post("/api/tasks/ai-review", requireAdmin, async (req, res, next) => {
  try {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: "معرف المهمة مطلوب" });
    }

    const db = await readDB();
    const task = db.tasks.find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: "المهمة غير موجودة" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: "مفتاح الذكاء الاصطناعي (Gemini API Key) غير مهيأ حالياً في الخادم. يرجى إضافته في الإعدادات للاستفادة من المراجعة الذكية للصور."
      });
    }
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const parts: any[] = [];
    
    // Add text prompt
    let prompt = `أنت مساعد ذكي لمسابقة ماراثون صيفي لشباب الكنيسة.
الخادم (الآدمن) يريد التحقق مما إذا كان المشارك قد نفذ المهمة المطلوبة منه بشكل صحيح أم لا بناءً على الصورة المرفقة والتعليق المكتوب.

تفاصيل المهمة المطلوبة:
- عنوان المهمة: ${task.title}
- وصف المهمة: ${task.description}

ما قدمه المشارك:
- تعليق المشارك: ${task.proofNote || 'لا يوجد تعليق'}

يرجى مراجعة الصورة والتعليق بدقة واكتب تقييماً مختصراً باللغة العربية (اللهجة المصرية الودية المشجعة):
1. هل التوصية المقترحة هي القبول (APPROVED) أم الرفض (REJECTED)؟ ابدأ بها بوضوح كعنوان أول سطر في ردك بشكل جذاب ومحدد للغاية.
2. اكتب تحليلاً دقيقاً من سطرين للصورة والتعليق المرفقين ومدى مطابقتهما للمهمة المطلوبة.
3. اكتب رسالة تشجيعية قصيرة وجميلة للشاب لمساعدته روحياً في مسيرته.`;

    parts.push({ text: prompt });

    // Handle Cloud Storage, local file fallback, or base64 image
    if (task.proofImagePath) {
      let imageBuffer: Buffer | null = null;
      let mimeType = "image/jpeg";
      const bucket = getStorageBucket();
      if (bucket) {
        try {
          const file = bucket.file(task.proofImagePath);
          const [exists] = await file.exists();
          if (exists) {
            const [buffer] = await file.download();
            const [metadata] = await file.getMetadata();
            mimeType = metadata.contentType || "image/jpeg";
            imageBuffer = buffer;
          }
        } catch (err) {
          console.warn("⚠️ Failed to load image from Cloud Storage for AI review:", err);
        }
      }

      if (!imageBuffer) {
        const localFilePath = path.join(process.cwd(), "public", "uploads", task.proofImagePath);
        if (fs.existsSync(localFilePath)) {
          imageBuffer = fs.readFileSync(localFilePath);
          const ext = path.extname(localFilePath).toLowerCase();
          mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        }
      }

      if (imageBuffer) {
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: imageBuffer.toString("base64")
          }
        });
      }
    } else if (task.proofImage && task.proofImage.startsWith("data:image")) {
      const match = task.proofImage.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: parts }
    });

    const rawAiEval = response.text || "لم يتمكن الذكاء الاصطناعي من تحليل المهمة.";
    const aiEvaluation = sanitizeReasoningText(rawAiEval);
    res.json({ evaluation: aiEvaluation });
  } catch (error) {
    next(error);
  }
});

// 10. Broadcast Notification
app.post("/api/notifications/broadcast", requireAdmin, mutexHandler(async (req, res) => {
  const { message, userId, deliveryType } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "محتوى التنبيه مطلوب" });
  }

  const dt = deliveryType === "in_app" ? "in_app" : "both";

  const db = await readDB();
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: message.trim(),
    createdAt: new Date().toISOString(),
    createdByAdmin: true,
    deliveryType: dt,
    ...(userId ? { userId } : {})
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  // Keep only last 50 notifications to support individual user feeds without getting cut off
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);

  // Only broadcast Web Push to registered devices if deliveryType is "both"
  if (dt === "both") {
    broadcastPush(message.trim(), db, userId).catch(err => {
      console.error("Web push dispatch failed:", err);
    });
  }

  const successMsg = userId 
    ? "تم إرسال التنبيه الفردي للمشارك المختار بنجاح"
    : "تم إرسال وبث التنبيه لجميع المشاركين بنجاح";
  res.json({ message: successMsg, notification: newNotification, db });
}));

// Delete Notification (Admin Only)
app.post("/api/notifications/delete", requireAdmin, mutexHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "معرف التنبيه مطلوب" });
  }

  const db = await readDB();
  const initialLength = db.notifications?.length || 0;
  db.notifications = db.notifications?.filter(n => n.id !== id) || [];
  const finalLength = db.notifications.length;

  if (initialLength === finalLength) {
    return res.status(404).json({ error: "التنبيه غير موجود أو تم حذفه بالفعل" });
  }

  await queueWriteDB(db);
  res.json({ message: "تم حذف التنبيه بنجاح", db });
}));

// 10.2. Subscribe to push notifications
app.post("/api/notifications/subscribe", mutexHandler(async (req, res) => {
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
  }

  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: "بيانات الاشتراك غير صالحة" });
  }

  const db = await readDB();
  const dbUser = db.users.find(u => u.id === user.id);
  if (!dbUser) {
    return res.status(404).json({ error: "العضو غير موجود" });
  }

  if (!dbUser.pushSubscriptions) {
    dbUser.pushSubscriptions = [];
  }

  // Prevent duplicate subscriptions
  const exists = dbUser.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
  if (!exists) {
    dbUser.pushSubscriptions.push(subscription);
    await queueWriteDB(db);
    console.log(`Registered push subscription for user ${dbUser.name}`);
  }

  res.json({ success: true, message: "تم تفعيل التنبيهات على هذا الجهاز بنجاح! 🔔" });
}));

// 10.2.5. Send test push notification
app.post("/api/notifications/test-push", async (req, res, next) => {
  try {
    const user = await authenticateUser(req);
    if (!user) {
      return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
    }

    const db = await readDB();
    const dbUser = db.users.find(u => u.id === user.id);
    if (!dbUser || !dbUser.pushSubscriptions || dbUser.pushSubscriptions.length === 0) {
      return res.status(400).json({ error: "لم يتم تفعيل هذا الجهاز بعد لتلقي التنبيهات." });
    }

    // Send a test push to this user specifically
    await broadcastPush("نجاح التفعيل! 🎉 هكذا ستصلك تنبيهات الخدام الهامة مباشرة على هاتفك حتى ولو كان المتصفح مغلقاً.", db, user.id);
    res.json({ success: true, message: "تم إرسال التنبيه التجريبي بنجاح! تحقق من هاتفك/جهازك. 🔔" });
  } catch (err) {
    next(err);
  }
});

// 10.3. Get VAPID public key
app.get("/api/notifications/vapid-public-key", async (req, res, next) => {
  try {
    const db = await readDB();
    if (!db.config.vapidKeys) {
      try {
        const keys = webpush.generateVAPIDKeys();
        db.config.vapidKeys = {
          publicKey: keys.publicKey,
          privateKey: keys.privateKey
        };
        await queueWriteDB(db);
      } catch (err) {
        console.error("Failed to generate VAPID keys on demand:", err);
      }
    }
    const publicKey = db.config.vapidKeys?.publicKey;
    if (!publicKey) {
      return res.status(500).json({ error: "مفاتيح التنبيهات لم يتم تكوينها على الخادم بعد." });
    }
    res.json({ publicKey });
  } catch (err) {
    next(err);
  }
});

// Helper to calculate the next Friday from a given date (starts from 00:00:00 of that Friday)
function getNextFriday(createdAtStr: string): Date {
  const date = new Date(createdAtStr);
  const resultDate = new Date(date);
  const currentDay = date.getDay(); // 0-6 (Sunday is 0, Monday is 1, ..., Friday is 5, Saturday is 6)
  let daysUntilFriday = (5 - currentDay + 7) % 7;
  if (daysUntilFriday === 0) {
    daysUntilFriday = 7; // Created on Friday, expires on next Friday (7 days later)
  }
  resultDate.setDate(date.getDate() + daysUntilFriday);
  resultDate.setHours(0, 0, 0, 0); // Expiry at Friday morning 00:00:00
  return resultDate;
}

function isQuizExpired(quiz: Quiz, userId?: string): boolean {
  if (userId && quiz.userExtensions && quiz.userExtensions[userId]) {
    const extTime = new Date(quiz.userExtensions[userId]).getTime();
    if (!isNaN(extTime) && Date.now() < extTime) {
      return false; // User has an active individual extension!
    }
  }
  if (quiz.endedEarly) {
    return true;
  }
  if (quiz.deadline) {
    const deadlineTime = new Date(quiz.deadline).getTime();
    return !isNaN(deadlineTime) && Date.now() >= deadlineTime;
  }
  // Quizzes without a specific deadline do not expire automatically to ensure stability and points preservation.
  return false;
}

// 11. Create a new Quiz (Admin Only)
app.post("/api/quizzes/create", requireAdmin, mutexHandler(async (req, res) => {
  const { title, description, questions, points, timeLimit, deadline, proctoringMode, maxLeaves, graceSeconds, strictImmediateKick } = req.body;
  if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "بيانات الاختبار غير مكتملة" });
  }

  const db = await readDB();
  const parsedTimeLimit = timeLimit ? parseInt(timeLimit, 10) : null;
  
  const isStrictImmediateKick = Boolean(strictImmediateKick);
  const validProctoringMode: "OFF" | "WARN" | "STRICT" =
    isStrictImmediateKick ? "STRICT" : (proctoringMode === "OFF" || proctoringMode === "STRICT" ? proctoringMode : "WARN");
  const parsedMaxLeaves = isStrictImmediateKick
    ? 0
    : (typeof maxLeaves === "number" && maxLeaves >= 0
      ? maxLeaves
      : (parseInt(maxLeaves, 10) >= 0 ? parseInt(maxLeaves, 10) : 1));
  const parsedGraceSeconds = typeof graceSeconds === "number" && graceSeconds > 0
    ? graceSeconds
    : (parseInt(graceSeconds, 10) > 0 ? parseInt(graceSeconds, 10) : 3);

  const newQuiz: Quiz = {
    id: "quiz_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    title,
    description: description ? description.trim() : null,
    questions: questions.map((q: any, idx: number) => ({
      id: q.id || `q_${idx}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
      type: q.type,
      questionText: q.questionText,
      options: q.options || [],
      correctAnswer: q.correctAnswer || "",
      points: parseInt(q.points || "0", 10)
    })),
    points: parseInt(points || "0", 10),
    createdAt: new Date().toISOString(),
    active: true,
    timeLimit: parsedTimeLimit && parsedTimeLimit > 0 ? parsedTimeLimit : null,
    deadline: deadline ? deadline : null,
    proctoringMode: validProctoringMode,
    maxLeaves: parsedMaxLeaves,
    graceSeconds: parsedGraceSeconds,
    strictImmediateKick: isStrictImmediateKick
  };

  if (!db.quizzes) {
    db.quizzes = [];
  }
  db.quizzes.push(newQuiz);

  // Broadcast a notification that a new quiz is published!
  const notifMsg = `🔔 اختبار جديد متاح الآن: "${title}" بقيمة ${points} نقطة! ادخل وحله الآن لتنال النقاط! 🏆`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    createdByAdmin: true
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  // Broadcast device push notification to all subscribed users
  broadcastPush(notifMsg, db).catch(err => {
    console.error("Error broadcasting push notification for new quiz:", err);
  });

  await queueWriteDB(db);
  res.json({ message: "تم نشر الاختبار الجديد وبث التنبيه لجميع المشاركين بنجاح", quiz: newQuiz, db });
}));

// 11.2 Early Terminate Quiz (Admin Only)
app.post("/api/quizzes/terminate", requireAdmin, mutexHandler(async (req, res) => {
  const { quizId } = req.body;
  if (!quizId) {
    return res.status(400).json({ error: "معرف الاختبار مطلوب" });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  quiz.endedEarly = true;
  quiz.active = false;

  // Broadcast closing notification
  const notifMsg = `🔒 تم إغلاق الاختبار "${quiz.title}" بقرار من الخادم. شكراً لمشاركتكم!`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    createdByAdmin: true
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);
  res.json({ message: "تم إغلاق الاختبار بصفة مبكرة بنجاح", quiz, db });
}));

// 11.3 Extend Quiz Globally (Admin Only)
app.post("/api/quizzes/extend-global", requireAdmin, mutexHandler(async (req, res) => {
  const { quizId, newDeadline } = req.body;
  if (!quizId || !newDeadline) {
    return res.status(400).json({ error: "معرف الاختبار والتاريخ الجديد مطلوبان" });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  quiz.deadline = newDeadline ? newDeadline : null;
  quiz.endedEarly = false;
  quiz.active = true;

  const notifMsg = `⏰ تم تمديد مهلة الاختبار "${quiz.title}" حتى ${new Date(newDeadline).toLocaleString("ar-EG")}`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    createdByAdmin: true
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);
  res.json({ message: "تم تمديد المهلة العامة للاختبار بنجاح", quiz, db });
}));

// 11.4 Extend Quiz for Specific User (Admin Only)
app.post("/api/quizzes/extend-user", requireAdmin, mutexHandler(async (req, res) => {
  const { quizId, userId, userIds, extendedUntil } = req.body;
  const targetIds: string[] = Array.isArray(userIds) ? userIds : (userId ? [userId] : []);
  if (!quizId || targetIds.length === 0 || !extendedUntil) {
    return res.status(400).json({ error: "جميع البيانات مطلوبة" });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  if (!quiz.userExtensions) {
    quiz.userExtensions = {};
  }

  const grantedNames: string[] = [];

  for (const tid of targetIds) {
    const targetUser = db.users?.find(u => u.id === tid);
    if (targetUser) {
      quiz.userExtensions[tid] = extendedUntil;
      grantedNames.push(targetUser.name);

      const notifMsg = `⭐ تم منح مهلة خاصة للشاب "${targetUser.name}" للاختبار "${quiz.title}" حتى ${new Date(extendedUntil).toLocaleString("ar-EG")}`;
      const newNotification: AppNotification = {
        id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
        message: notifMsg,
        createdAt: new Date().toISOString(),
        userId: tid,
        createdByAdmin: true
      };

      if (!db.notifications) db.notifications = [];
      db.notifications.push(newNotification);
    }
  }

  if (db.notifications && db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);
  res.json({ message: `تم منح المهلة الخاصة لعدد (${grantedNames.length}) من المشاركين بنجاح`, quiz, db });
}));

// 11.5 Start Quiz (Participant)
app.post("/api/quizzes/start", mutexHandler(async (req, res) => {
  const { quizId, userId } = req.body;
  if (!quizId || !userId) {
    return res.status(400).json({ error: "البيانات غير مكتملة" });
  }

  // Authenticate user on backend
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
  }

  // Validate ownership: participant can only start a quiz for themselves
  if (user.role !== "admin" && user.id !== userId) {
    return res.status(403).json({ error: "غير مصرح! لا يمكنك فتح اختبار باسم مشارك آخر." });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  // Expiration check
  if (isQuizExpired(quiz, userId)) {
    return res.status(400).json({ error: "عذراً، هذا الاختبار قد انتهى وقته المحدد أو تم إغلاقه!" });
  }

  if (!db.quizSubmissions) {
    db.quizSubmissions = [];
  }

  const existingSub = db.quizSubmissions.find(s => s.quizId === quizId && s.userId === userId);
  if (existingSub) {
    return res.status(400).json({ error: "لقد قمت بفتح هذا الاختبار أو حله مسبقاً!" });
  }

  const newSubmission: QuizSubmission = {
    id: "sub_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    quizId,
    userId,
    answers: {},
    questionResults: {},
    totalScore: 0,
    submittedAt: new Date().toISOString(),
    status: "started"
  };

  db.quizSubmissions.push(newSubmission);
  await queueWriteDB(db);

  res.json({ message: "تم بدء الاختبار بنجاح", db: sanitizeDBState(db, user) });
}));

// 11.8 Log Quiz Security Violation (Participant or Admin)
app.post("/api/quizzes/log-violation", mutexHandler(async (req, res) => {
  const { quizId, userId, leaveDuration, reason, type, details } = req.body;
  if (!quizId || !userId) {
    return res.status(400).json({ error: "بيانات رصد المخالفة غير مكتملة" });
  }

  // Authenticate user on backend
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
  }

  // Validate ownership: participant can only log violation for their own attempt
  if (user.role !== "admin" && user.id !== userId) {
    return res.status(403).json({ error: "غير مصرح! لا يمكنك تسجيل مخالفة لمشارك آخر." });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  const violationRecord: QuizViolationRecord = {
    id: "viol_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    userId,
    quizId,
    timestamp: new Date().toISOString(),
    leaveDuration: typeof leaveDuration === "number" ? Math.max(0, leaveDuration) : Math.max(0, parseFloat(leaveDuration) || 0),
    reason: reason || "تم رصد مغادرة شاشة الاختبار / التبديل بين التطبيقات",
    type: type || "visibility_hidden",
    details: details || reason,
  };

  if (!db.quizViolations) {
    db.quizViolations = [];
  }
  db.quizViolations.push(violationRecord);
  if (db.quizViolations.length > 250) {
    db.quizViolations = db.quizViolations.slice(-250);
  }

  // Update submission record if it exists
  if (!db.quizSubmissions) {
    db.quizSubmissions = [];
  }
  const sub = db.quizSubmissions.find(s => s.quizId === quizId && s.userId === userId);
  if (sub) {
    sub.violationCount = (sub.violationCount || 0) + 1;
    if (!sub.violations) {
      sub.violations = [];
    }
    sub.violations.push(violationRecord);
  }

  await queueWriteDB(db);
  res.json({
    message: "تم تسجيل المخالفة بنجاح",
    violation: violationRecord,
    db: sanitizeDBState(db, user)
  });
}));

// Helper: Extract Rubric Points from question or model answer
function extractRubricPoints(question: QuizQuestion): string[] {
  if (Array.isArray(question.rubricPoints) && question.rubricPoints.filter(p => p && p.trim().length > 0).length > 0) {
    return question.rubricPoints.map(p => p.trim()).filter(Boolean);
  }

  const modelAnswer = (question.correctAnswer || "").trim();
  if (!modelAnswer) return ["الإجابة النموذجية المحددة في السؤال"];

  const lines = modelAnswer.split(/[\r\n]+/);
  const extracted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^[\s*•\-–—✔▪▫]+/, "").replace(/^[\d٠-٩]+[\.\-\)\:]\s*/, "").trim();
    if (cleaned.length > 0) {
      if (cleaned.includes(";") || (cleaned.includes("،") && cleaned.split("،").length > 2)) {
        const subItems = cleaned.split(/[;؛]/).map(s => s.trim()).filter(Boolean);
        if (subItems.length > 1) {
          extracted.push(...subItems);
          continue;
        }
      }
      extracted.push(cleaned);
    }
  }

  if (extracted.length <= 1) {
    const semicolonParts = modelAnswer
      .split(/[;؛\n]+/)
      .map(s => s.trim().replace(/^[\s*•\-–—✔▪▫]+/, "").replace(/^[\d٠-٩]+[\.\-\)\:]\s*/, ""))
      .filter(Boolean);
    if (semicolonParts.length > 1) {
      return semicolonParts;
    }
    return [modelAnswer];
  }

  return extracted;
}

function isRawJsonErrorString(str?: string): boolean {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && (parsed.error || parsed.code || parsed.statusCode || parsed.message)) {
        return true;
      }
    } catch {
      if (s.includes('"error"') || s.includes('"code"') || s.includes('503')) {
        return true;
      }
    }
  }
  return (
    s.includes('{"error"') ||
    s.includes('"code":503') ||
    s.includes('503 UNAVAILABLE') ||
    s.includes('RESOURCE_EXHAUSTED') ||
    (s.includes('UNAVAILABLE') && s.includes('{'))
  );
}

function sanitizeReasoningText(text?: string): string {
  if (!text || typeof text !== "string" || isRawJsonErrorString(text)) {
    return "تنبيه: الخدمة آلياً تحت الضغط المؤقت - بانتظار الاعتماد اليدوي من المشرف";
  }
  return text.trim();
}

// 12. Instant Sub-Second Deterministic Quiz Submission Endpoint
app.post(["/api/quizzes/submit", "/api/quiz/submit"], mutexHandler(async (req, res) => {
  const { quizId, userId, answers, status } = req.body;
  if (!quizId || !userId || !answers) {
    return res.status(400).json({ error: "بيانات الإجابة غير مكتملة" });
  }

  // Authenticate user on backend
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
  }

  // Validate ownership: participant can only submit answers for themselves
  if (user.role !== "admin" && user.id !== userId) {
    return res.status(403).json({ error: "غير مصرح! لا يمكنك تقديم إجابات باسم مشارك آخر." });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  // Expiration check
  if (isQuizExpired(quiz, userId)) {
    return res.status(400).json({ error: "عذراً، هذا الاختبار قد انتهى وقته المحدد أو تم إغلاقه!" });
  }

  // Check if already submitted or terminated
  const existingSub = db.quizSubmissions?.find(s => s.quizId === quizId && s.userId === userId);
  if (existingSub && existingSub.status !== "started") {
    if (existingSub.status === "VIOLATION_TERMINATED") {
      return res.status(403).json({ error: "تم إيقاف هذا الامتحان مسبقاً لمخالفة قواعد النزاهة الأمنية، ولا يمكن استقبال إجابات جديدة." });
    }
    return res.status(400).json({ error: "لقد قمت بحل هذا الاختبار مسبقاً!" });
  }

  // Optional Quiz Timer check
  if (quiz.timeLimit && quiz.timeLimit > 0 && existingSub && existingSub.status === "started" && status !== "VIOLATION_TERMINATED") {
    const startTime = new Date(existingSub.submittedAt).getTime();
    const elapsedTimeSeconds = (Date.now() - startTime) / 1000;
    // Allow 45 seconds grace period for network/device delays
    if (elapsedTimeSeconds > (quiz.timeLimit * 60 + 45)) {
      return res.status(400).json({ error: "عذراً، لقد انتهى الوقت المحدد لحل الاختبار وتم إلغاء المحاولة تلقائياً لمنع الغش!" });
    }
  }

  const questionResults: Record<string, QuizQuestionResult> = {};
  const essayGrades: Record<string, EssayGradeItem> = {};
  let totalScore = 0;
  const isViolation = status === "VIOLATION_TERMINATED";

  for (const question of quiz.questions) {
    const studentAnswer = (answers[question.id] || "").toString().trim();
    const hasDefinedKey = question.correctAnswer !== undefined && question.correctAnswer !== null && question.correctAnswer.trim() !== "";
    
    if (question.type === "choice" || (question.type as string) === "mcq") {
      if (!hasDefinedKey) {
        questionResults[question.id] = {
          pointsEarned: 0,
          correct: false,
          studentAnswer,
          feedback: "بانتظار رصد مفتاح الإجابة الصحيحة من المشرف (تصحيح مؤجل)...",
          status: "pending_auto_grade"
        };
      } else {
        const isCorrect = studentAnswer === question.correctAnswer;
        const pointsEarned = isCorrect ? question.points : 0;
        questionResults[question.id] = {
          pointsEarned,
          correct: isCorrect,
          studentAnswer,
          feedback: isCorrect ? "إجابة صحيحة تماماً!" : `إجابة غير صحيحة. الإجابة الصحيحة هي: ${question.options?.[parseInt(question.correctAnswer || "0", 10)] || ""}`,
          status: "auto_graded"
        };
        totalScore += pointsEarned;
      }
    } else if (question.type === "boolean" || (question.type as string) === "true_false") {
      if (!hasDefinedKey) {
        questionResults[question.id] = {
          pointsEarned: 0,
          correct: false,
          studentAnswer,
          feedback: "بانتظار رصد مفتاح الإجابة الصحيحة من المشرف (تصحيح مؤجل)...",
          status: "pending_auto_grade"
        };
      } else {
        const isCorrect = studentAnswer.toLowerCase() === (question.correctAnswer || "").toLowerCase();
        const pointsEarned = isCorrect ? question.points : 0;
        questionResults[question.id] = {
          pointsEarned,
          correct: isCorrect,
          studentAnswer,
          feedback: isCorrect ? "إجابة صحيحة!" : `إجابة غير صحيحة. الإجابة الصحيحة هي: ${(question.correctAnswer === "true" ? "صح" : "خطأ")}`,
          status: "auto_graded"
        };
        totalScore += pointsEarned;
      }
    } else if (question.type === "fill_in_the_blank" || question.type === "quote" || question.type === "essay") {
      const reasoning = question.type === "fill_in_the_blank"
        ? "بانتظار مراجعة وتصحيح إكمال الفراغ من المشرف..."
        : question.type === "quote"
        ? "بانتظار مراجعة وتصحيح إسناد القول من المشرف..."
        : "بانتظار تصحيح المشرف...";

      essayGrades[question.id] = {
        questionId: question.id,
        score: 0,
        gradingReasoning: reasoning,
        status: "pending_manual_review",
        gradedAt: new Date().toISOString()
      };
      questionResults[question.id] = {
        pointsEarned: 0,
        correct: false,
        studentAnswer,
        feedback: reasoning,
        status: "pending_manual_review"
      };
    }
  }

  totalScore = Math.round(totalScore * 100) / 100;
  const hasPendingAuto = Object.values(questionResults).some(r => r.status === "pending_auto_grade");
  const hasPendingManual = Object.values(questionResults).some(r => r.status === "pending_manual_review");

  const submissionStatus: "pending_auto_grade" | "pending_manual_review" | "completed" | "VIOLATION_TERMINATED" = isViolation
    ? "VIOLATION_TERMINATED"
    : (hasPendingAuto
      ? "pending_auto_grade"
      : (hasPendingManual ? "pending_manual_review" : "completed"));

  const newSubmission: QuizSubmission = {
    id: "sub_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    quizId,
    userId,
    answers,
    questionResults,
    essayGrades: Object.keys(essayGrades).length > 0 ? essayGrades : undefined,
    totalScore,
    submittedAt: new Date().toISOString(),
    status: submissionStatus,
    violationCount: existingSub?.violationCount || (isViolation ? 1 : 0),
    violations: existingSub?.violations || []
  };

  if (!db.quizSubmissions) {
    db.quizSubmissions = [];
  }

  const existingIdx = db.quizSubmissions.findIndex(s => s.quizId === quizId && s.userId === userId);
  if (existingIdx !== -1) {
    db.quizSubmissions[existingIdx] = {
      ...db.quizSubmissions[existingIdx],
      answers,
      questionResults,
      essayGrades: Object.keys(essayGrades).length > 0 ? essayGrades : db.quizSubmissions[existingIdx].essayGrades,
      totalScore,
      submittedAt: new Date().toISOString(),
      status: submissionStatus,
      violationCount: db.quizSubmissions[existingIdx].violationCount || (isViolation ? 1 : 0),
      violations: db.quizSubmissions[existingIdx].violations || []
    };
  } else {
    db.quizSubmissions.push(newSubmission);
  }

  const participant = db.users.find(u => u.id === userId);
  const notifMsg = isViolation
    ? `⚠️ تم إيقاف وتسليم اختبار "${quiz.title}" للمشارك ${participant?.name || ""} بسبب رصد مخالفة أمنية ومغادرة شاشة الامتحان.`
    : submissionStatus === "pending_auto_grade"
      ? `تهانينا للمشارك ${participant?.name || ""}! تم تسليم إجاباتك لاختبار "${quiz.title}" بنجاح، وسيتم احتساب النتيجة فور اعتماد مفتاح الإجابات من المشرف! 🎉`
      : submissionStatus === "pending_manual_review"
        ? `تهانينا للمشارك ${participant?.name || ""}! لقد قمت بتسليم إجاباتك لاختبار "${quiz.title}" بنجاح وهو الآن بانتظار تصحيح المشرف! 🎉`
        : `تهانينا للمشارك ${participant?.name || ""}! لقد أنجزت حل اختبار "${quiz.title}" بنجاح وحصلت على ${totalScore} من أصل ${quiz.points} نقطة! 🎉`;
  
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString()
  };
  
  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);
  res.status(200).json({
    message: isViolation
      ? "تم إيقاف الامتحان وتسليم المحاولة لمخالفة قواعد النزاهة الأمنية."
      : submissionStatus === "pending_auto_grade"
        ? "تم تسليم الاختبار بنجاح، وسيتم احتساب النتيجة فور توفير مفتاح الإجابات!"
        : submissionStatus === "pending_manual_review"
          ? "تم تسليم الاختبار بنجاح وبانتظار تصحيح المشرف!"
          : "تم تسليم وحل الاختبار وتقييمه بنجاح!",
    submission: existingIdx !== -1 ? db.quizSubmissions[existingIdx] : newSubmission,
    db: sanitizeDBState(db, user)
  });
}));

// 12.5 Admin Manual Essay Grading Endpoint
app.post(["/api/admin/grade-essay", "/api/admin/grade-essay-manual", "/api/admin/grade-essays", "/api/quizzes/grade-essay"], requireAdmin, mutexHandler(async (req, res) => {
  const { submissionId, questionGrades, questionId, score, feedback: singleFeedback } = req.body;
  if (!submissionId) {
    return res.status(400).json({ error: "معرف تسليم الاختبار مطلوب" });
  }

  const db = await readDB();
  const submission = db.quizSubmissions?.find(s => s.id === submissionId);
  if (!submission) {
    return res.status(404).json({ error: "تسليم الاختبار غير موجود" });
  }

  const quiz = db.quizzes?.find(q => q.id === submission.quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  if (!submission.essayGrades) {
    submission.essayGrades = {};
  }
  if (!submission.questionResults) {
    submission.questionResults = {};
  }

  // Construct standardized question grades map
  const gradesMap: Record<string, { pointsEarned: number; feedback?: string }> = {};
  
  if (questionId !== undefined && (score !== undefined || req.body.pointsEarned !== undefined)) {
    const pts = score !== undefined ? score : req.body.pointsEarned;
    gradesMap[questionId] = {
      pointsEarned: parseFloat(pts || 0),
      feedback: singleFeedback
    };
  } else if (questionGrades && typeof questionGrades === "object") {
    for (const qId of Object.keys(questionGrades)) {
      const item = questionGrades[qId];
      const pts = item.pointsEarned !== undefined ? item.pointsEarned : (item.score !== undefined ? item.score : 0);
      gradesMap[qId] = {
        pointsEarned: parseFloat(pts || 0),
        feedback: item.feedback || item.gradingReasoning
      };
    }
  } else {
    return res.status(400).json({ error: "بيانات درجة السؤال المقالي غير مكتملة" });
  }

  for (const qId of Object.keys(gradesMap)) {
    const question = quiz.questions.find(q => q.id === qId);
    if (question && (question.type === "essay" || question.type === "fill_in_the_blank" || question.type === "quote")) {
      const grade = gradesMap[qId];
      const maxPoints = question.points;
      const pointsEarned = Math.max(0, Math.min(maxPoints, parseFloat(String(grade.pointsEarned || 0))));
      const correct = pointsEarned >= (maxPoints / 2);
      const feedback = grade.feedback?.trim() || "تم تصحيح الإجابة يدوياً ورصد الدرجة بنجاح.";

      submission.essayGrades[qId] = {
        questionId: qId,
        score: pointsEarned,
        gradingReasoning: feedback,
        status: "admin_approved",
        gradedAt: new Date().toISOString()
      };

      submission.questionResults[qId] = {
        ...submission.questionResults[qId],
        pointsEarned,
        correct,
        studentAnswer: submission.answers[qId] || "",
        feedback,
        autoGraded: false,
        status: "graded"
      };
    }
  }

  // Synchronously recalculate total quiz score
  let totalScore = 0;
  for (const question of quiz.questions) {
    const result = submission.questionResults[question.id];
    if (result) {
      totalScore += result.pointsEarned || 0;
    }
  }

  submission.totalScore = Math.round(totalScore * 100) / 100;
  const stillPendingAuto = Object.values(submission.questionResults).some(r => r.status === "pending_auto_grade");
  const stillPendingManual = Object.values(submission.questionResults).some(r => r.status === "pending_manual_review");
  submission.status = stillPendingAuto ? "pending_auto_grade" : (stillPendingManual ? "pending_manual_review" : "graded");
  submission.gradedAt = new Date().toISOString();

  const participant = db.users.find(u => u.id === submission.userId);
  const notifMsg = `🔔 تم تصحيح الأسئلة المقالية ورصد درجاتك في اختبار "${quiz.title}"! الدرجة النهائية: ${submission.totalScore} من أصل ${quiz.points} نقطة. 🎉`;
  
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    userId: submission.userId,
    createdAt: new Date().toISOString()
  };
  
  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  await queueWriteDB(db);
  const user = await authenticateUser(req);
  res.json({
    message: "تم حفظ ورصد درجات الأسئلة المقالية وتحديث النتيجة النهائية بنجاح",
    submission,
    db: sanitizeDBState(db, user)
  });
}));

// 12.8 Phase 6.2 - Delayed Batch-Grading Engine (Admin Only)
app.post(["/api/admin/quizzes/:quizId/batch-grade", "/api/quizzes/:quizId/batch-grade"], requireAdmin, mutexHandler(async (req, res) => {
  const quizId = (req.params.quizId || req.body.quizId || "").trim();
  const { answerKey } = req.body;

  if (!quizId) {
    return res.status(400).json({ error: "معرف الاختبار مطلوب" });
  }

  if (!answerKey || typeof answerKey !== "object" || Object.keys(answerKey).length === 0) {
    return res.status(400).json({ error: "نموذج الإجابة مطلوب ويجب أن يحتوي على إجابة واحدة على الأقل" });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find((q) => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  // 1. Inject the new correctAnswer indices into the respective questions in the Quiz document
  for (const question of quiz.questions) {
    if (answerKey[question.id] !== undefined && answerKey[question.id] !== null) {
      const correctOptionIndex = answerKey[question.id];
      const isBoolean = question.type === "boolean" || (question.type as string) === "true_false";
      if (isBoolean) {
        question.correctAnswer = (correctOptionIndex === 0 || String(correctOptionIndex) === "true") ? "true" : "false";
      } else {
        question.correctAnswer = String(correctOptionIndex);
      }
    }
  }

  // 2. Query/filter all QuizSubmission documents for this quizId where status is pending_auto_grade
  if (!db.quizSubmissions) {
    db.quizSubmissions = [];
  }

  const pendingSubmissions = db.quizSubmissions.filter(
    (s) => s.quizId === quizId && (s.status === "pending_auto_grade" || Object.values(s.questionResults || {}).some(r => r.status === "pending_auto_grade"))
  );

  let updatedCount = 0;

  // 3. Re-evaluation Loop
  for (const submission of pendingSubmissions) {
    if (!submission.questionResults) {
      submission.questionResults = {};
    }

    for (const question of quiz.questions) {
      if (answerKey[question.id] !== undefined && answerKey[question.id] !== null) {
        const correctOptionIndex = answerKey[question.id];
        const studentAnswer = (submission.answers?.[question.id] || "").toString().trim();
        const isBoolean = question.type === "boolean" || (question.type as string) === "true_false";

        let isCorrect = false;
        if (isBoolean) {
          const normStudent = studentAnswer.toLowerCase();
          const targetBoolStr = (correctOptionIndex === 0 || String(correctOptionIndex) === "true") ? "true" : "false";
          isCorrect = normStudent === targetBoolStr || normStudent === String(correctOptionIndex);
        } else {
          isCorrect = studentAnswer === String(correctOptionIndex);
        }

        const pointsEarned = isCorrect ? question.points : 0;
        const optionText = isBoolean
          ? (question.correctAnswer === "true" ? "صح" : "خطأ")
          : (question.options?.[parseInt(String(correctOptionIndex), 10)] || "");

        submission.questionResults[question.id] = {
          pointsEarned,
          correct: isCorrect,
          studentAnswer,
          feedback: isCorrect
            ? "إجابة صحيحة تماماً!"
            : `إجابة غير صحيحة. الإجابة الصحيحة هي: ${optionText}`,
          status: "auto_graded",
          autoGraded: true,
        };
      }
    }

    // Recalculate totalScore cleanly across all question results
    let totalScore = 0;
    if (submission.questionResults) {
      for (const res of Object.values(submission.questionResults)) {
        if (res && typeof res.pointsEarned === "number" && !isNaN(res.pointsEarned)) {
          totalScore += res.pointsEarned;
        }
      }
    }
    submission.totalScore = Math.round(totalScore * 100) / 100;

    // Status resolution:
    // If the submission still has essay/fill-in-the-blank questions pending, set overall status to "pending_manual_review". Otherwise, set it to "graded".
    const stillPendingAuto = Object.values(submission.questionResults).some((r) => r.status === "pending_auto_grade");
    const stillPendingManual = Object.values(submission.questionResults).some((r) => r.status === "pending_manual_review");

    if (stillPendingAuto) {
      submission.status = "pending_auto_grade";
    } else if (stillPendingManual) {
      submission.status = "pending_manual_review";
    } else {
      submission.status = "graded";
    }
    submission.gradedAt = new Date().toISOString();
    updatedCount++;
  }

  // 4. Batch updates in Firestore with chunking (Firestore limit is 500)
  const dbFs = getFirestore();
  if (dbFs) {
    try {
      const directSubsSnap = await dbFs
        .collection("quizSubmissions")
        .where("quizId", "==", quizId)
        .get()
        .catch(() => null);

      if (directSubsSnap && !directSubsSnap.empty) {
        const docs = directSubsSnap.docs;
        const CHUNK_SIZE = 400;
        for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
          const chunk = docs.slice(i, i + CHUNK_SIZE);
          const batch = dbFs.batch();
          for (const doc of chunk) {
            const updated = pendingSubmissions.find((s) => s.id === doc.id);
            if (updated) {
              batch.set(doc.ref, updated, { merge: true });
            }
          }
          await batch.commit();
        }
      }
    } catch (directErr) {
      console.warn("Direct Firestore collection update notice (handled by appState):", directErr);
    }
  }

  // 5. Add notification
  const notifMsg = `📝 تم اعتماد نموذج الإجابة وتصحيح ${updatedCount} تسليماً تلقائياً لاختبار "${quiz.title}"! 🎉`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
  };
  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  // Persist full state to appState and local DB
  await queueWriteDB(db);

  const user = await authenticateUser(req);
  res.status(200).json({
    success: true,
    message: `تم اعتماد نموذج الإجابة بنجاح وإعادة تقييم ${updatedCount} تسليماً معلقاً!`,
    quiz,
    gradedCount: updatedCount,
    db: sanitizeDBState(db, user),
  });
}));

// 13. Delete Quiz (Admin Only)
app.post("/api/quizzes/delete", requireAdmin, mutexHandler(async (req, res) => {
  const { quizId } = req.body;
  if (!quizId) {
    return res.status(400).json({ error: "معرف الاختبار مطلوب" });
  }

  const db = await readDB();
  db.quizzes = db.quizzes?.filter(q => q.id !== quizId) || [];
  db.quizSubmissions = db.quizSubmissions?.filter(s => s.quizId !== quizId) || [];

  await queueWriteDB(db);
  res.json({ message: "تم حذف الاختبار وإجاباته بنجاح", db });
}));

// 13.5 Reopen / Reset Quiz Attempt (Admin Only)
app.post("/api/quizzes/reopen-attempt", requireAdmin, mutexHandler(async (req, res) => {
  const { quizId, userId } = req.body;
  if (!quizId || !userId) {
    return res.status(400).json({ error: "البيانات المرسلة غير مكتملة" });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  const participant = db.users.find(u => u.id === userId);
  if (!participant) {
    return res.status(404).json({ error: "المشارك غير موجود" });
  }

  // Filter out any existing submissions for this user & quiz
  const initialCount = db.quizSubmissions?.length || 0;
  db.quizSubmissions = db.quizSubmissions?.filter(s => !(s.quizId === quizId && s.userId === userId)) || [];
  const finalCount = db.quizSubmissions.length;

  // Also clean up any recorded violations for this quiz & user
  if (db.quizViolations) {
    db.quizViolations = db.quizViolations.filter(v => !(v.quizId === quizId && v.userId === userId));
  }

  if (initialCount === finalCount) {
    return res.status(400).json({ error: "لا توجد محاولة قائمة لهذا المستخدم في هذا الاختبار لإعادة فتحها!" });
  }

  // Add a nice system notification for the user to notify them that their attempt has been reopened
  const notifMsg = `🔓 تم إعادة فتح وإتاحة اختبار "${quiz.title}" لك مجدداً بواسطة الخادم وتصفير أي مخالفات سابقة! بالتوفيق! 🌟`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    userId: userId, // Private notification specifically for this user
    createdByAdmin: true,
    deliveryType: "both"
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  // Send device push notification to the user specifically
  broadcastPush(notifMsg, db, userId).catch(err => {
    console.error("Error sending push notification for reopened quiz attempt:", err);
  });

  await queueWriteDB(db);
  res.json({ message: "تم إعادة فتح الاختبار بنجاح وتم تصفير المحاولة والمخالفات ليتمكن المشارك من حله مجدداً", db });
}));

// 14. Manual Quiz Submission for Paper tests (Admin Only)
app.post("/api/quizzes/manual-submit", requireAdmin, mutexHandler(async (req, res) => {
  const { quizId, userId, score } = req.body;
  if (!quizId || !userId || score === undefined) {
    return res.status(400).json({ error: "البيانات المرسلة غير مكتملة" });
  }

  const db = await readDB();
  const quiz = db.quizzes?.find(q => q.id === quizId);
  if (!quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  const scoreNum = parseInt(score, 10);
  if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > quiz.points) {
    return res.status(400).json({ error: `الدرجة يجب أن تكون رقمية بين 0 و ${quiz.points}` });
  }

  if (!db.quizSubmissions) {
    db.quizSubmissions = [];
  }

  // Find if there is an existing submission (either manual or online)
  const existingIdx = db.quizSubmissions.findIndex(s => s.quizId === quizId && s.userId === userId);
  
  const submission: QuizSubmission = {
    id: existingIdx !== -1 ? db.quizSubmissions[existingIdx].id : "manual_sub_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    quizId,
    userId,
    answers: {},
    questionResults: {},
    totalScore: scoreNum,
    submittedAt: new Date().toISOString(),
    status: "completed",
    isManual: true
  };

  if (existingIdx !== -1) {
    db.quizSubmissions[existingIdx] = submission;
  } else {
    db.quizSubmissions.push(submission);
  }

  await queueWriteDB(db);
  res.json({ message: "تم تسجيل درجة الاختبار الورقي للمشارك بنجاح", db });
}));

// 15. Submit Confession Proof (Participant)
app.post("/api/confessions/submit", mutexHandler(async (req, res) => {
  const { userId, monthIndex, proofImage } = req.body;
  if (!userId || !monthIndex || !proofImage) {
    return res.status(400).json({ error: "البيانات غير مكتملة" });
  }

  // Authenticate user on backend
  const user = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للتحقق من الهوية." });
  }

  // Validate ownership: participant can only submit confession proof for themselves
  if (user.role !== "admin" && user.id !== userId) {
    return res.status(403).json({ error: "غير مصرح! لا يمكنك تقديم إثبات اعتراف لمشارك آخر." });
  }

  const db = await readDB();
  if (!db.confessions) {
    db.confessions = {};
  }
  if (!db.confessions[userId]) {
    db.confessions[userId] = { months: {} };
  }

  const monthKey = monthIndex.toString();
  const existingMonth = db.confessions[userId].months[monthKey];

  let storagePath: string | undefined;
  if (proofImage && typeof proofImage === "string" && proofImage.startsWith("data:")) {
    try {
      const parsed = parseBase64Image(proofImage);
      const targetPath = `proofs/confessions/${userId}/${monthKey}.${parsed.extension}`;
      const uploadRes = await saveProofToStorage(proofImage, targetPath);

      if (uploadRes) {
        if (existingMonth?.proofImagePath) {
          await deleteFileFromStorage(existingMonth.proofImagePath);
        }
        storagePath = uploadRes.storagePath;
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "فشل رفع ملف إثبات الاعتراف." });
    }
  }

  db.confessions[userId].months[monthKey] = {
    status: "pending",
    proofImage: storagePath ? "" : proofImage,
    proofImagePath: storagePath,
    submittedAt: new Date().toISOString()
  };

  await queueWriteDB(db);
  res.json({ message: "تم إرسال إثبات الاعتراف بنجاح وبانتظار تأكيد الخادم", db: sanitizeDBState(db, user) });
}));

// 16. Verify Confession Submission (Admin Only)
app.post("/api/confessions/verify", requireAdmin, mutexHandler(async (req, res) => {
  const { userId, monthIndex, status } = req.body;
  if (!userId || !monthIndex || !status || !["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ error: "الحالة غير صالحة" });
  }

  const db = await readDB();
  if (!db.confessions || !db.confessions[userId] || !db.confessions[userId].months[monthIndex.toString()]) {
    return res.status(404).json({ error: "طلب إثبات الاعتراف غير موجود" });
  }

  const monthKey = monthIndex.toString();
  const monthData = db.confessions[userId].months[monthKey];

  if (status === "approved") {
    monthData.status = "approved";
    monthData.approvedAt = new Date().toISOString();
    delete monthData.rejectedAt;
  } else if (status === "rejected") {
    if (monthData.proofImagePath) {
      await deleteFileFromStorage(monthData.proofImagePath);
      delete monthData.proofImagePath;
    }
    monthData.status = "rejected";
    monthData.rejectedAt = new Date().toISOString();
    delete monthData.approvedAt;
    delete monthData.submittedAt;
    delete monthData.proofImage;
    delete monthData.confessionProofUrl;
  } else if (status === "pending") {
    monthData.status = "pending";
    delete monthData.approvedAt;
    delete monthData.rejectedAt;
  }

  // Create in-app & push notification for participant
  const notifMsg = status === "approved"
    ? `✨ تم تأكيد وتوثيق اعترافك للشهر ${monthIndex} بنجاح وتمت إضافة +20 نقطة بركة لمجموعك! 🎉`
    : status === "rejected"
      ? `🕊️ نسترعي انتباهك: لم يتم قبول إثبات الاعتراف الخاص بك للشهر ${monthIndex}. يرجى إعادة رفع إثبات واضح لحفظ بركة نقاطك.`
      : `⚠️ تم تعديل وإعادة حالة اعترافك للشهر ${monthIndex} إلى قيد المراجعة مع تعديل النقاط.`;

  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    userId: userId,
    createdByAdmin: true,
    deliveryType: "both"
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  broadcastPush(notifMsg, db, userId).catch(err => {
    console.error("Error sending push notification for confession verification:", err);
  });

  await queueWriteDB(db);
  res.json({
    message: status === "approved" ? "تم تأكيد اعتراف المشارك بنجاح وإضافة النقاط" : "تم تحديث حالة الاعتراف بنجاح",
    db: sanitizeDBState(db, (req as any).user)
  });
}));

// Revert / Cancel Confession Approval (Admin Only)
app.post("/api/confessions/revert", requireAdmin, mutexHandler(async (req, res) => {
  const { userId, monthIndex } = req.body;
  if (!userId || !monthIndex) {
    return res.status(400).json({ error: "البيانات غير مكتملة" });
  }

  const db = await readDB();
  if (!db.confessions || !db.confessions[userId] || !db.confessions[userId].months[monthIndex.toString()]) {
    return res.status(404).json({ error: "سجل الاعتراف غير موجود" });
  }

  const monthKey = monthIndex.toString();
  const monthData = db.confessions[userId].months[monthKey];

  if (monthData.status !== "approved") {
    return res.status(400).json({ error: "الاعتراف غير معتمد بالفعل" });
  }

  if (monthData.proofImage || monthData.submittedAt) {
    monthData.status = "pending";
    delete monthData.approvedAt;
  } else {
    delete db.confessions[userId].months[monthKey];
  }

  const notifMsg = `⚠️ تم إلغاء وتحديث اعتماد اعترافك للشهر ${monthIndex} وتخصيم (-20) نقطة من مجموعك.`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    userId: userId,
    createdByAdmin: true,
    deliveryType: "both"
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  broadcastPush(notifMsg, db, userId).catch(err => {
    console.error("Error sending push notification for confession revert:", err);
  });

  await queueWriteDB(db);
  res.json({
    message: "تم إلغاء اعتماد الاعتراف وتخصيم النقاط بنجاح ↺",
    db: sanitizeDBState(db, (req as any).user)
  });
}));

// 17. Manual/Direct Confession Confirmation without proof (Admin Only)
app.post("/api/confessions/manual-confirm", requireAdmin, mutexHandler(async (req, res) => {
  const { userId, monthIndex } = req.body;
  if (!userId || !monthIndex) {
    return res.status(400).json({ error: "البيانات المرسلة غير مكتملة" });
  }

  const db = await readDB();
  if (!db.confessions) {
    db.confessions = {};
  }
  if (!db.confessions[userId]) {
    db.confessions[userId] = { months: {} };
  }

  db.confessions[userId].months[monthIndex.toString()] = {
    status: "approved",
    approvedAt: new Date().toISOString()
  };

  // Create notification for participant
  const notifMsg = `✨ تم تسجيل وتأكيد اعترافك للشهر ${monthIndex} مباشرة بواسطة الخادم المسؤول وتمت إضافة +20 نقطة بركة! 🎉`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    userId: userId,
    createdByAdmin: true,
    deliveryType: "both"
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);
  if (db.notifications.length > 50) {
    db.notifications = db.notifications.slice(-50);
  }

  broadcastPush(notifMsg, db, userId).catch(err => {
    console.error("Error sending push notification for manual confession confirm:", err);
  });

  await queueWriteDB(db);
  res.json({
    message: "تم تسجيل وتأكيد اعتراف المشارك مباشرة بنجاح! 🎉",
    db: sanitizeDBState(db, (req as any).user)
  });
}));

// Reset Marathon Scores & Attendance to Default for New 12-Week Period (Admin Only)
app.post("/api/leaderboard/reset", requireAdmin, mutexHandler(async (req, res) => {
  const db = await readDB();
  if (!db.config) {
    db.config = { durationWeeks: 12, points: { meeting: 20, liturgy: 20, praise: 15 } };
  }

  // 1. Archive full snapshot of current marathon season data before reset
  if (!db.archives) {
    db.archives = [];
  }
  db.archives.push({
    id: "archive_" + Date.now(),
    resetAt: new Date().toISOString(),
    attendance: JSON.parse(JSON.stringify(db.attendance || {})),
    quizSubmissions: JSON.parse(JSON.stringify(db.quizSubmissions || [])),
    confessions: JSON.parse(JSON.stringify(db.confessions || {})),
    tasks: JSON.parse(JSON.stringify(db.tasks || [])),
    bonuses: JSON.parse(JSON.stringify(db.bonuses || [])),
    usersTotalPoints: (db.users || []).map((u) => ({
      id: u.id,
      name: u.name,
      totalArchivedPoints: u.totalArchivedPoints || 0,
    })),
  });

  // 2. Reset attendance, points, and logs to default for the new 12-week marathon cycle
  db.attendance = {};
  db.quizSubmissions = [];
  db.confessions = {};
  db.tasks = [];
  db.bonuses = [];
  delete db.config.leaderboardResetAt;

  // Reset total points for all users back to 0 while keeping their account credentials
  for (const user of db.users) {
    user.totalArchivedPoints = 0;
  }

  // 3. Create broadcast notification for the fresh marathon cycle
  const notifMsg = `🏆 تم بدء دورة ماراثون جديدة (12 أسبوع)! تم تصفير لوحة الصدارة وسجلات الحضور والغياب للبدء من الأسبوع الأول من جديد. بالتوفيق للجميع!`;
  const newNotification: AppNotification = {
    id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    message: notifMsg,
    createdAt: new Date().toISOString(),
    createdByAdmin: true,
    deliveryType: "both"
  };

  if (!db.notifications) {
    db.notifications = [];
  }
  db.notifications.push(newNotification);

  broadcastPush(notifMsg, db).catch(err => {
    console.error("Error broadcasting push for marathon reset:", err);
  });

  await queueWriteDB(db);
  res.json({
    message: "تمت إعادة تعيين وتصفير الماراثون وسجلات الغياب بنجاح لبدء دورة جديدة من الأسبوع الأول! 🏆",
    db: sanitizeDBState(db, (req as any).user)
  });
}));

// 18. Add Bonus Points (Admin Only)
app.post("/api/bonuses/add", requireAdmin, mutexHandler(async (req, res) => {
  const { userId, points, reason } = req.body;
  if (!userId || points === undefined || !reason) {
    return res.status(400).json({ error: "يرجى تحديد المشارك، عدد نقاط البونص، والسبب بوضوح" });
  }

  const db = await readDB();
  const pointsVal = parseInt(points, 10);
  if (isNaN(pointsVal) || pointsVal <= 0) {
    return res.status(400).json({ error: "قيمة البونص يجب أن تكون رقمية أكبر من صفر" });
  }

  if (!db.bonuses) {
    db.bonuses = [];
  }

  const newBonus: Bonus = {
    id: "bonus_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    userId,
    points: pointsVal,
    reason: reason.trim(),
    createdAt: new Date().toISOString()
  };

  db.bonuses.push(newBonus);

  // Broadcast notification about the bonus to make it exciting!
  const participant = db.users.find(u => u.id === userId);
  if (participant) {
    const notifMsg = `🎉 تم منح المشارك البطل "${participant.name}" بونص إضافي بقيمة ${pointsVal} نقطة! السبب: ${reason.trim()}`;
    const newNotification: AppNotification = {
      id: "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
      message: notifMsg,
      createdAt: new Date().toISOString()
    };
    if (!db.notifications) {
      db.notifications = [];
    }
    db.notifications.push(newNotification);
    if (db.notifications.length > 50) {
      db.notifications = db.notifications.slice(-50);
    }
  }

  await queueWriteDB(db);
  res.json({ message: "تم إضافة البونص وبث الخبر بنجاح 🎁", db });
}));

// 19. Delete Bonus (Admin Only)
app.post("/api/bonuses/delete", requireAdmin, mutexHandler(async (req, res) => {
  const { bonusId } = req.body;
  if (!bonusId) {
    return res.status(400).json({ error: "معرف البونص مطلوب" });
  }

  const db = await readDB();
  db.bonuses = db.bonuses?.filter(b => b.id !== bonusId) || [];

  await queueWriteDB(db);
  res.json({ message: "تم حذف البونص بنجاح", db });
}));

// 20. Migrate Base64 Proof Images to Firebase Cloud Storage (Admin Only, Idempotent)
async function handleMigrateProofs(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const bucket = getStorageBucket();
    if (!bucket) {
      return res.status(400).json({
        error: "لم يتم إعداد حاوية التخزين السحابي (process.env.FIREBASE_STORAGE_BUCKET) بالخادم."
      });
    }

    const db = await readDB();
    let migratedTasks = 0;
    let migratedConfessions = 0;

    // 1. Migrate task proofs
    if (db.tasks && Array.isArray(db.tasks)) {
      for (const task of db.tasks) {
        if (task.proofImage && task.proofImage.startsWith("data:")) {
          try {
            const parsed = parseBase64Image(task.proofImage);
            const timestamp = Date.now();
            const storagePath = `proofs/tasks/${task.id}/${timestamp}.${parsed.extension}`;
            const file = bucket.file(storagePath);
            await file.save(parsed.buffer, {
              contentType: parsed.mimeType,
              metadata: { contentType: parsed.mimeType },
              resumable: false,
            });

            task.proofImagePath = storagePath;
            task.proofImage = ""; // Clear legacy base64 string
            migratedTasks++;
          } catch (err) {
            console.warn(`Failed to migrate task proof for task ${task.id}:`, err);
          }
        }
      }
    }

    // 2. Migrate confession proofs
    if (db.confessions) {
      for (const userId of Object.keys(db.confessions)) {
        const userConfession = db.confessions[userId];
        if (userConfession && userConfession.months) {
          for (const monthKey of Object.keys(userConfession.months)) {
            const monthData = userConfession.months[monthKey];
            if (monthData && monthData.proofImage && monthData.proofImage.startsWith("data:")) {
              try {
                const parsed = parseBase64Image(monthData.proofImage);
                const storagePath = `proofs/confessions/${userId}/${monthKey}.${parsed.extension}`;
                const file = bucket.file(storagePath);
                await file.save(parsed.buffer, {
                  contentType: parsed.mimeType,
                  metadata: { contentType: parsed.mimeType },
                  resumable: false,
                });

                monthData.proofImagePath = storagePath;
                monthData.proofImage = ""; // Clear legacy base64 string
                migratedConfessions++;
              } catch (err) {
                console.warn(`Failed to migrate confession proof for user ${userId} month ${monthKey}:`, err);
              }
            }
          }
        }
      }
    }

    const totalMigrated = migratedTasks + migratedConfessions;
    if (totalMigrated > 0) {
      await queueWriteDB(db);
    }

    res.json({
      success: true,
      migratedTasks,
      migratedConfessions,
      totalMigrated,
      message: `تم ترحيل عدد (${totalMigrated}) صورة إثبات إلى Firebase Cloud Storage بنجاح! ☁️`
    });
  } catch (err) {
    next(err);
  }
}

app.post("/api/admin/migrate-proofs", requireAdmin, mutexHandler(handleMigrateProofs));
app.post("/api/admin/migrate-storage", requireAdmin, mutexHandler(handleMigrateProofs));

// Unauthenticated Health Check Endpoint
app.get("/api/health", async (req, res) => {
  try {
    const dbFs = getFirestore();
    let firestoreStatus = false;
    if (dbFs) {
      await dbFs.collection("appState").doc("config").get();
      firestoreStatus = true;
    }
    if (!firestoreStatus && process.env.NODE_ENV === "production") {
      return res.status(503).json({
        ok: false,
        firestore: false,
        timestamp: new Date().toISOString()
      });
    }
    res.json({
      ok: true,
      firestore: firestoreStatus,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      firestore: false,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errorObj = err as { status?: number; message?: string };
  console.error("Unhandled API Error:", errorObj?.message || err);
  if (req.path.startsWith('/api/')) {
    if (errorObj?.status === 503 || isFirestoreAuthError(err)) {
      return res.status(503).json({ error: "الخدمة غير متصلة بحساب الفايربيس، تحقق من الأسرار" });
    }
    res.status(errorObj?.status || 500).json({ error: errorObj?.message || "حدث خطأ غير متوقع في الخادم" });
  } else {
    next(err);
  }
});

// Vite & Static Asset Handling
async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
