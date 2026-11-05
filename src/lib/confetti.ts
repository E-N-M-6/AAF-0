import canvasConfetti from "canvas-confetti";

// Highly robust resolver to support ESM/CommonJS/Vite dual build targets
const confetti: any = typeof canvasConfetti === "function"
  ? canvasConfetti
  : (canvasConfetti as any)?.default || canvasConfetti;

console.log("Confetti module resolution check:", {
  rawImport: canvasConfetti,
  resolvedConfetti: confetti,
  isFunction: typeof confetti === "function"
});

/**
 * Triggers a simple but delightful confetti burst from the center.
 */
export function triggerConfettiBurst() {
  console.log("Triggering Confetti Burst...");
  if (typeof confetti === "function") {
    try {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.7 },
        colors: ["#c51f26", "#eab308", "#1b4393", "#10b981", "#3b82f6"]
      });
    } catch (err) {
      console.error("Error in triggerConfettiBurst:", err);
    }
  } else {
    console.warn("Confetti is not a function:", confetti);
  }
}

/**
 * Triggers a majestic, high-end stream of confetti from both sides,
 * giving an ultimate sense of victory and achievement!
 */
export function triggerDazzlingCelebration() {
  console.log("Triggering Dazzling Celebration...");
  if (typeof confetti !== "function") {
    console.warn("Confetti is not a function:", confetti);
    return;
  }
  try {
    const duration = 2 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      // since particles fall down, animate a bit higher than they would
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
  } catch (err) {
    console.error("Error in triggerDazzlingCelebration:", err);
  }
}

/**
 * Triggers a beautiful golden glitter stream from both sides of the screen.
 */
export function triggerGoldenGlitterCelebration() {
  console.log("Triggering Golden Glitter Celebration...");
  if (typeof confetti !== "function") {
    console.warn("Confetti is not a function:", confetti);
    return;
  }
  try {
    const duration = 2.0 * 1000;
    const animationEnd = Date.now() + duration;
    const colors = ["#d97706", "#f59e0b", "#fbbf24", "#fef08a", "#fffbeb"]; // Luxury gold and cream sparkles

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      confetti({
        particleCount: 20,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        colors: colors,
        zIndex: 99999
      });

      confetti({
        particleCount: 20,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        colors: colors,
        zIndex: 99999
      });
    }, 100);
  } catch (err) {
    console.error("Error in triggerGoldenGlitterCelebration:", err);
  }
}

/**
 * Triggers fireworks confetti celebration!
 */
export function triggerFireworks() {
  console.log("Triggering Fireworks...");
  if (typeof confetti !== "function") {
    console.warn("Confetti is not a function:", confetti);
    return;
  }
  try {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      confetti({
        ...defaults,
        particleCount: 60,
        origin: { x: Math.random(), y: Math.random() - 0.2 }
      });
    }, 400);
  } catch (err) {
    console.error("Error in triggerFireworks:", err);
  }
}
