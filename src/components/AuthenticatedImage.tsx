import React, { useState, useEffect } from "react";
import { authenticatedFetch } from "../services/api";

interface AuthenticatedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  src,
  alt = "",
  className = "",
  onClick,
  ...props
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!src) {
      setObjectUrl(null);
      setLoading(false);
      return;
    }

    if (src.startsWith("data:") || src.startsWith("blob:") || !src.startsWith("/api/")) {
      setObjectUrl(src);
      setLoading(false);
      return;
    }

    let isMounted = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(false);

    authenticatedFetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!isMounted) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load authenticated image:", err);
        setError(true);
        setLoading(false);
      });

    return () => {
      isMounted = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [src]);

  if (loading) {
    return (
      <div
        className={`animate-pulse bg-natural-cream/50 rounded-xl flex items-center justify-center text-xs text-natural-muted ${className}`}
        style={{ minHeight: "80px" }}
      >
        جاري تحميل الصورة...
      </div>
    );
  }

  if (error || !objectUrl) {
    return (
      <div className={`text-xs text-rose-500 bg-rose-50 border border-rose-200 rounded-xl p-3 text-center ${className}`}>
        تعذر تحميل الصورة
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      onClick={onClick}
      {...props}
    />
  );
};
