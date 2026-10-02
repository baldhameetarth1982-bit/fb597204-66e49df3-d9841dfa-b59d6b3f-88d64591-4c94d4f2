import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Subtle fade + slide-in wrapper for route content. Duration kept short
 * (180ms) so navigation still feels instant on low-end devices.
 */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0.08 : 0.16, ease: [0.23, 1, 0.32, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
