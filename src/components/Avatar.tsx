import React, { useState, useEffect } from "react";
import { authenticatedFetch } from "../services/api";

interface AvatarProps {
  userId: string;
  userName?: string;
  size?: 96 | 512;
  avatarVersion?: number;
  hasAvatar?: boolean;
  className?: string;
  ringColor?: string;
  alt?: string;
  showBadge?: boolean;
  badgeContent?: React.ReactNode;
}

// In-memory cache to store blob URLs keyed by userId, size, and version
const avatarBlobCache = new Map<string, string>();

// Helper to generate deterministic gradient colors from userId
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

function getGradientForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
}

function getInitials(name?: string, userId?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.trim().slice(0, 2).toUpperCase();
  }
  return (userId || "U").slice(0, 2).toUpperCase();
}

export default function Avatar({
  userId,
  userName,
  size = 96,
  avatarVersion,
  hasAvatar = true,
  className = "",
  ringColor,
  alt,
  showBadge,
  badgeContent,
}: AvatarProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(hasAvatar));
  const [hasError, setHasError] = useState<boolean>(!hasAvatar);

  const cacheKey = `${userId}_${size}_${avatarVersion || 0}`;

  useEffect(() => {
    if (!hasAvatar || !userId) {
      setImgUrl(null);
      setLoading(false);
      setHasError(true);
      return;
    }

    // Check in-memory cache first
    if (avatarBlobCache.has(cacheKey)) {
      setImgUrl(avatarBlobCache.get(cacheKey)!);
      setLoading(false);
      setHasError(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setHasError(false);

    const fetchAvatar = async () => {
      try {
        const url = `/api/profile/avatar/${encodeURIComponent(userId)}?size=${size}&v=${avatarVersion || 0}`;
        const response = await authenticatedFetch(url);

        if (!response.ok) {
          if (isMounted) {
            setHasError(true);
            setLoading(false);
          }
          return;
        }

        const contentType = response.headers.get("content-type") || "";
        let finalUrl = "";

        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (data && data.avatarBase64) {
            finalUrl = data.avatarBase64;
          } else {
            if (isMounted) {
              setHasError(true);
              setLoading(false);
            }
            return;
          }
        } else {
          const blob = await response.blob();
          if (blob.size === 0) {
            if (isMounted) {
              setHasError(true);
              setLoading(false);
            }
            return;
          }
          finalUrl = URL.createObjectURL(blob);
        }

        avatarBlobCache.set(cacheKey, finalUrl);

        if (isMounted) {
          setImgUrl(finalUrl);
          setLoading(false);
          setHasError(false);
        }
      } catch (err) {
        if (isMounted) {
          setHasError(true);
          setLoading(false);
        }
      }
    };

    fetchAvatar();

    return () => {
      isMounted = false;
    };
  }, [userId, size, avatarVersion, hasAvatar, cacheKey]);

  const gradient = getGradientForUser(userId);
  const initials = getInitials(userName, userId);

  const sizeClasses = size === 512
    ? "w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 text-2xl sm:text-3xl font-black"
    : "w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 text-xs sm:text-sm font-black";

  return (
    <div className={`relative inline-block shrink-0 ${className}`}>
      {/* Container with optional ring */}
      <div
        className={`relative rounded-full overflow-hidden flex items-center justify-center transition-all ${sizeClasses} ${
          ringColor ? ringColor : "border-2 border-slate-200 dark:border-slate-700 shadow-sm"
        }`}
      >
        {!hasError && imgUrl ? (
          <img
            src={imgUrl}
            alt={alt || userName || "المستخدم"}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover rounded-full"
            onError={() => setHasError(true)}
          />
        ) : (
          /* Fallback Colored Initials */
          <div
            className={`w-full h-full bg-gradient-to-br ${gradient} text-white flex items-center justify-center font-black select-none tracking-wider`}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>{initials}</span>
            )}
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
