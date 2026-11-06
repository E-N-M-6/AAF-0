import React, { useState, useEffect } from "react";
import { authenticatedFetch } from "../services/api";

export interface AvatarProps {
  src?: string | null;
  name?: string;
  userId?: string;
  userName?: string;
  size?: 96 | 512 | number;
  avatarVersion?: number;
  hasAvatar?: boolean;
  className?: string;
  ringColor?: string;
  alt?: string;
  showBadge?: boolean;
  badgeContent?: React.ReactNode;
  onClick?: () => void;
}

// In-memory cache for fetched base64 avatars when src is not directly passed
const avatarMemoryBase64Cache = new Map<string, string>();

// Helper to generate deterministic gradient colors from userId or name
const AVATAR_GRADIENTS = [
  "from-[#c51f26] to-[#881337]",
  "from-[#1b4393] to-[#1e3a8a]",
  "from-emerald-600 to-teal-800",
  "from-amber-600 to-orange-700",
  "from-purple-600 to-indigo-800",
  "from-rose-600 to-pink-800",
  "from-cyan-600 to-[#1b4393]",
  "from-amber-500 to-yellow-700",
];

export function getGradientForUser(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
}

export function getInitials(name?: string, userId?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      if (parts[0] === "أبرام" && parts[1] === "ناروز") {
        return "أ ب";
      }
      return `${parts[0][0]} ${parts[1][0]}`;
    }
    if (parts[0] && parts[0].length >= 2) {
      return `${parts[0][0]} ${parts[0][1]}`;
    }
    return parts[0];
  }
  return (userId || "U").slice(0, 2).toUpperCase();
}

/**
 * Inspects incoming photoURL:
 * - Explicitly ALLOW relative paths (e.g., /api/profile/avatar/:userId or /assets/...), data:image/ URIs, and valid external https:// URLs.
 * - Automatically treat any string starting with blob:, http://localhost, https://localhost, http://127.0.0.1, or file:// as invalid,
 *   bypassing broken <img> renders and falling back cleanly to user initials.
 */
export function isInvalidAvatarSrc(src?: string | null): boolean {
  if (!src || typeof src !== "string") return true;
  const trimmed = src.trim();
  if (!trimmed) return true;

  // Explicit blacklist: blob:, localhost, file://
  if (
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("http://localhost") ||
    trimmed.startsWith("https://localhost") ||
    trimmed.startsWith("http://127.0.0.1") ||
    trimmed.startsWith("file://")
  ) {
    return true;
  }

  // Accept ONLY strings starting explicitly with relative paths (e.g. /api/profile/avatar/ or /assets/),
  // data:image/ URIs, or valid external https:// URLs
  const isValid =
    trimmed.startsWith("/api/profile/avatar/") ||
    trimmed.startsWith("/assets/") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("https://");

  return !isValid;
}

export default function Avatar({
  src,
  name,
  userId = "",
  userName,
  size = 96,
  avatarVersion,
  hasAvatar = true,
  className = "",
  ringColor,
  alt,
  showBadge,
  badgeContent,
  onClick,
}: AvatarProps) {
  const displayName = name || userName || "";
  const keyForGradient = userId || displayName || "U";
  const [loadError, setLoadError] = useState<boolean>(false);

  // Check incoming direct src
  const directSrc = typeof src === "string" ? src.trim() : null;
  const isDirectInvalid = isInvalidAvatarSrc(directSrc);
  const isDirectDataUrl = Boolean(directSrc && !isDirectInvalid && directSrc.startsWith("data:image/"));
  const isDirectRemoteOrRelativeUrl = Boolean(
    directSrc &&
      !isDirectInvalid &&
      (directSrc.startsWith("https://") || directSrc.startsWith("/"))
  );

  // Fallback state if src was not provided but userId is present
  const [fallbackBase64, setFallbackBase64] = useState<string | null>(() => {
    if (!directSrc && userId && avatarMemoryBase64Cache.has(userId)) {
      const cached = avatarMemoryBase64Cache.get(userId) || null;
      if (cached && !isInvalidAvatarSrc(cached)) {
        return cached;
      }
    }
    return null;
  });

  // Reset load error state when src, fallbackBase64, or userId changes
  useEffect(() => {
    setLoadError(false);
  }, [src, fallbackBase64, userId, avatarVersion]);

  // Background fallback ONLY if directSrc is missing or invalid, hasAvatar is true, and userId is present
  useEffect(() => {
    if ((directSrc && !isDirectInvalid) || !hasAvatar || !userId || fallbackBase64) return;

    let isMounted = true;
    const fetchAvatar = async () => {
      try {
        const res = await authenticatedFetch(
          `/api/profile/avatar/${encodeURIComponent(userId)}?format=json&v=${avatarVersion || 0}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (
          isMounted &&
          data &&
          typeof data.avatarBase64 === "string" &&
          !isInvalidAvatarSrc(data.avatarBase64) &&
          data.avatarBase64.startsWith("data:image/")
        ) {
          avatarMemoryBase64Cache.set(userId, data.avatarBase64);
          setFallbackBase64(data.avatarBase64);
        }
      } catch {
        // Silently keep initials fallback on network error
      }
    };

    fetchAvatar();
    return () => {
      isMounted = false;
    };
  }, [directSrc, isDirectInvalid, hasAvatar, userId, avatarVersion, fallbackBase64]);

  // Determine final image URL to render:
  // 1. Direct valid src (e.g., relative /api/profile/avatar/:userId, data:image/, https://)
  // 2. Asynchronously resolved fallback Base64
  // 3. Fallback to public binary avatar endpoint if hasAvatar is true and userId is present
  const finalSrc = isDirectDataUrl || isDirectRemoteOrRelativeUrl
    ? directSrc
    : (!isInvalidAvatarSrc(fallbackBase64) ? fallbackBase64 : null) ||
      (hasAvatar && userId && !loadError
        ? `/api/profile/avatar/${encodeURIComponent(userId)}?v=${avatarVersion || 0}`
        : null);

  const shouldRenderImage = !loadError && hasAvatar && Boolean(finalSrc) && !isInvalidAvatarSrc(finalSrc);

  const gradient = getGradientForUser(keyForGradient);
  const initials = getInitials(displayName, keyForGradient);

  const sizeClasses =
    size === 512
      ? "w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 text-2xl sm:text-3xl font-black"
      : "w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 text-xs sm:text-sm font-black";

  return (
    <div
      className={`relative inline-block shrink-0 ${className}`}
      onClick={onClick}
    >
      {/* Container with optional ring */}
      <div
        className={`relative rounded-full overflow-hidden flex items-center justify-center transition-all ${sizeClasses} ${
          ringColor ? ringColor : "border-2 border-slate-200 dark:border-slate-700 shadow-sm"
        }`}
      >
        {shouldRenderImage && finalSrc ? (
          <img
            src={finalSrc}
            alt={alt || displayName || "المستخدم"}
            loading="eager"
            decoding="async"
            className="w-full h-full object-cover rounded-full transition-opacity duration-200"
            onError={() => {
              setLoadError(true);
            }}
          />
        ) : (
          /* Fallback Stylized Colored Circle with User Initials */
          <div
            className={`w-full h-full bg-gradient-to-br ${gradient} text-white flex items-center justify-center font-black select-none tracking-wider shadow-inner transition-opacity duration-200`}
            style={{ direction: "rtl" }}
          >
            <span className="drop-shadow-sm leading-none">{initials}</span>
          </div>
        )}
      </div>

      {showBadge && badgeContent && (
        <div className="absolute -bottom-1 -right-1 z-10">
          {badgeContent}
        </div>
      )}
    </div>
  );
}
